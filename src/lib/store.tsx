import type React from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { parseCsvFile, parseCsvText } from "./data/parse";
import { sampleCsvForPersona, sampleCsv, SAMPLE_NAME } from "./data/sample";
import { deleteChat } from "./persistence/chats";
import type { Dataset } from "./data/types";
import {
  clearAll,
  deleteCsv,
  loadCsv,
  loadProjects,
  saveProjects,
  storeCsv,
  replaceCsv,
  type ProjectMeta,
  type ProjectStatus,
} from "./persistence/projects";
import { type PersonaId, PERSONAS } from "./stats/personas";
import {
  type UserProfile,
  loadStoredUser,
  saveStoredUser,
  loadActivePersona,
  saveActivePersona,
  registerUser,
  loginUser,
  logoutUser,
} from "./persistence/auth";
import { getSupabaseClient } from "./persistence/supabase";

interface Active {
  dataset: Dataset;
  csv: string;
  projectId: string | null;
}

export interface CloudSyncStatus {
  isConfigured: boolean;
  isSyncing: boolean;
  lastSyncedAt: string | null;
}

export interface Store {
  ready: boolean;
  projects: ProjectMeta[];
  active: Active | null;
  activeProject: ProjectMeta | null;
  loadFile: (file: File) => Promise<{ errors: string[] }>;
  loadSample: () => void;
  loadPersonaSample: (personaId?: PersonaId) => void;
  clearDataset: () => void;
  /** Detach from a saved project (its data stays saved). Unsaved sessions are kept. */
  startNew: () => void;
  saveAsProject: (name: string) => ProjectMeta | null;
  openProject: (id: string) => { error?: string };
  renameProject: (id: string, name: string) => void;
  deleteProject: (id: string) => void;
  setStatus: (status: ProjectStatus) => void;
  setObjective: (text: string) => void;
  resetAll: () => void;

  // Persona
  persona: PersonaId;
  setPersona: (p: PersonaId) => void;

  // Auth & Cloud
  user: UserProfile | null;
  login: (email: string, pass: string) => Promise<{ user: UserProfile | null; error?: string }>;
  register: (
    email: string,
    pass: string,
    name: string,
    persona: PersonaId,
  ) => Promise<{ user: UserProfile | null; error?: string }>;
  logout: () => void;
  cloudSyncStatus: CloudSyncStatus;
  syncWithCloud: () => Promise<{ success: boolean; count?: number; error?: string }>;
}

const CTX_KEY = "__lumetraStoreContext__";
const g = globalThis as unknown as Record<string, React.Context<Store | null> | undefined>;
const Ctx: React.Context<Store | null> =
  g[CTX_KEY] ?? (g[CTX_KEY] = createContext<Store | null>(null));

function nowIso() {
  return new Date().toISOString();
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [ready, setReady] = useState(false);
  const [active, setActiveState] = useState<Active | null>(null);
  const [persona, setPersonaState] = useState<PersonaId>("engineer");
  const [user, setUser] = useState<UserProfile | null>(null);
  const [cloudSyncStatus, setCloudSyncStatus] = useState<CloudSyncStatus>({
    isConfigured: false,
    isSyncing: false,
    lastSyncedAt: null,
  });

  const activeRef = useRef<Active | null>(null);
  const personaRef = useRef<PersonaId>("engineer");

  const setActive = useCallback((next: Active | null) => {
    activeRef.current = next;
    setActiveState(next);
  }, []);

  const setPersona = useCallback((next: PersonaId) => {
    personaRef.current = next;
    setPersonaState(next);
    saveActivePersona(next);
  }, []);

  useEffect(() => {
    const loadedProjects = loadProjects();
    setProjects(loadedProjects);

    const initialPersona = loadActivePersona();
    setPersonaState(initialPersona);
    personaRef.current = initialPersona;

    const initialUser = loadStoredUser();
    setUser(initialUser);

    const supabase = getSupabaseClient();
    setCloudSyncStatus({
      isConfigured: supabase.isConfigured(),
      isSyncing: false,
      lastSyncedAt: initialUser ? nowIso() : null,
    });

    setReady(true);
  }, []);

  const commit = useCallback((next: ProjectMeta[]) => {
    setProjects(next);
    saveProjects(next);
  }, []);

  const update = useCallback(
    (id: string, patch: Partial<ProjectMeta>) => {
      const next = loadProjects().map((p) =>
        p.id === id ? { ...p, ...patch, updatedAt: nowIso() } : p,
      );
      commit(next);
      const updatedProject = next.find((p) => p.id === id);
      if (updatedProject) {
        const csv = loadCsv(id);
        getSupabaseClient()
          .saveProject(updatedProject, csv, user?.id)
          .catch(() => {});
      }
    },
    [commit, user],
  );

  const attach = useCallback(
    (dataset: Dataset, csv: string) => {
      const projectId = activeRef.current?.projectId ?? null;
      if (projectId) {
        const stored = replaceCsv(projectId, csv);
        update(projectId, {
          status: "data-loaded",
          dataset: {
            name: dataset.name,
            rows: dataset.rows.length,
            columns: dataset.columns.length,
            source: dataset.source,
            stored,
          },
        });
      }
      setActive({ dataset, csv, projectId });
    },
    [setActive, update],
  );

  const loadFile = useCallback(
    async (file: File) => {
      const { result, text } = await parseCsvFile(file);
      if (!result.ok) return { errors: result.errors };
      attach(result.dataset, text);
      return { errors: [] };
    },
    [attach],
  );

  const loadPersonaSample = useCallback(
    (targetPersona?: PersonaId) => {
      const p = targetPersona || personaRef.current;
      const { name, csv } = sampleCsvForPersona(p);
      const res = parseCsvText(csv, name, "sample");
      if (res.ok) attach(res.dataset, csv);
    },
    [attach],
  );

  const loadSample = useCallback(() => {
    // Loads the sample customized for active persona
    loadPersonaSample(personaRef.current);
  }, [loadPersonaSample]);

  const clearDataset = useCallback(() => {
    const cur = activeRef.current;
    if (cur?.projectId) {
      deleteCsv(cur.projectId);
      update(cur.projectId, { status: "no-data", dataset: null });
    }
    setActive(null);
  }, [setActive, update]);

  const startNew = useCallback(() => {
    if (activeRef.current?.projectId) setActive(null);
  }, [setActive]);

  const saveAsProject = useCallback(
    (name: string) => {
      if (!active) return null;
      const id = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
      const stored = storeCsv(id, active.csv);
      const p: ProjectMeta = {
        id,
        name: name.trim() || active.dataset.name,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        status: "data-loaded",
        dataset: {
          name: active.dataset.name,
          rows: active.dataset.rows.length,
          columns: active.dataset.columns.length,
          source: active.dataset.source,
          stored,
        },
      };
      commit([p, ...loadProjects()]);
      setActive({ ...active, projectId: id });

      // Persist safely in Supabase Cloud
      getSupabaseClient()
        .saveProject(p, active.csv, user?.id)
        .catch((err) => {
          console.warn("Could not save to Supabase cloud immediately:", err);
        });

      return p;
    },
    [active, commit, user, setActive],
  );

  const openProject = useCallback(
    (id: string) => {
      const p = loadProjects().find((x) => x.id === id);
      if (!p) return { error: "Project not found." };
      if (!p.dataset) {
        setActive(null);
        return { error: "This project has no dataset yet. Upload one in the Data Workspace." };
      }
      const csv = loadCsv(id);
      if (!csv)
        return {
          error:
            "The data for this project was too large to keep on this device. Re-upload the file to continue.",
        };
      const res = parseCsvText(csv, p.dataset.name, p.dataset.source);
      if (!res.ok) return { error: res.errors.join(" ") };
      setActive({ dataset: res.dataset, csv, projectId: id });
      return {};
    },
    [setActive],
  );

  const renameProject = useCallback(
    (id: string, name: string) => update(id, { name: name.trim() || "Untitled project" }),
    [update],
  );

  const deleteProject = useCallback(
    (id: string) => {
      deleteCsv(id);
      deleteChat(id);
      commit(loadProjects().filter((p) => p.id !== id));
      getSupabaseClient()
        .deleteProject(id)
        .catch(() => {});
      const cur = activeRef.current;
      if (cur?.projectId === id) setActive({ ...cur, projectId: null });
    },
    [commit, setActive],
  );

  const setStatus = useCallback(
    (status: ProjectStatus) => {
      if (active?.projectId) update(active.projectId, { status });
    },
    [active, update],
  );

  const setObjective = useCallback(
    (objective: string) => {
      if (active?.projectId) update(active.projectId, { objective });
    },
    [active, update],
  );

  const resetAll = useCallback(() => {
    clearAll();
    setProjects([]);
    setActive(null);
  }, [setActive]);

  // Auth handlers
  const handleRegister = useCallback(
    async (email: string, pass: string, name: string, targetPersona: PersonaId) => {
      const res = await registerUser(email, pass, name, targetPersona);
      if (res.user) {
        setUser(res.user);
        setPersona(res.user.persona);
        setCloudSyncStatus((prev) => ({ ...prev, lastSyncedAt: nowIso() }));
      }
      return res;
    },
    [setPersona],
  );

  const handleLogin = useCallback(
    async (email: string, pass: string) => {
      const res = await loginUser(email, pass);
      if (res.user) {
        setUser(res.user);
        setPersona(res.user.persona);
        setCloudSyncStatus((prev) => ({ ...prev, lastSyncedAt: nowIso() }));
      }
      return res;
    },
    [setPersona],
  );

  const handleLogout = useCallback(() => {
    logoutUser();
    setUser(null);
  }, []);

  const syncWithCloud = useCallback(async () => {
    setCloudSyncStatus((prev) => ({ ...prev, isSyncing: true }));
    const supabase = getSupabaseClient();
    try {
      const currentProjects = loadProjects();
      let syncedCount = 0;
      for (const p of currentProjects) {
        const csv = loadCsv(p.id);
        const res = await supabase.saveProject(p, csv, user?.id);
        if (res.ok) syncedCount++;
      }
      setCloudSyncStatus({
        isConfigured: supabase.isConfigured(),
        isSyncing: false,
        lastSyncedAt: nowIso(),
      });
      return { success: true, count: syncedCount };
    } catch (e) {
      setCloudSyncStatus((prev) => ({ ...prev, isSyncing: false }));
      return { success: false, error: e instanceof Error ? e.message : "Sync failed" };
    }
  }, [user]);

  const activeProject = useMemo(
    () => projects.find((p) => p.id === active?.projectId) ?? null,
    [projects, active],
  );

  const value: Store = {
    ready,
    projects,
    active,
    activeProject,
    loadFile,
    loadSample,
    loadPersonaSample,
    clearDataset,
    startNew,
    saveAsProject,
    openProject,
    renameProject,
    deleteProject,
    setStatus,
    setObjective,
    resetAll,
    persona,
    setPersona,
    user,
    login: handleLogin,
    register: handleRegister,
    logout: handleLogout,
    cloudSyncStatus,
    syncWithCloud,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore() {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore must be used inside StoreProvider");
  return s;
}

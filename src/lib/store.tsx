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
import { parseCsvFile, parseCsvText, type ParseCsvOptions } from "./data/parse";
import { sampleCsvForPersona } from "./data/sample";
import { deleteChat } from "./persistence/chats";
import type { Dataset } from "./data/types";
import {
  applyCleaningStep,
  replayCleaningSteps,
  type CleaningStep,
  type CleaningStepType,
} from "./data/clean";
import type { SavedAnalysis } from "./stats/analysis";
import {
  clearAll,
  deleteCsv,
  loadCsv,
  loadProjects,
  saveProjects,
  storeCsv,
  replaceCsv,
  duplicateProject as duplicateProjectPersistence,
  type ProjectMeta,
  type ProjectStatus,
} from "./persistence/projects";
import { type PersonaId } from "./stats/personas";
import {
  type UserProfile,
  loadStoredUser,
  loadActivePersona,
  saveActivePersona,
  registerUser,
  loginUser,
  logoutUser,
} from "./persistence/auth";
import { getSupabaseClient } from "./persistence/supabase";

interface Active {
  dataset: Dataset;
  rawDataset: Dataset;
  csv: string;
  projectId: string | null;
}

export type SaveState = "saved" | "pending" | "saving" | "error";

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
  activeProjectId: string | null;
  rawDataset: Dataset | null;
  cleaningSteps: CleaningStep[];
  savedAnalyses: SavedAnalysis[];
  saveState: SaveState;
  lastSaveError: string | null;

  // Project lifecycle
  createProject: (name: string, description?: string, attachActive?: boolean) => ProjectMeta | null;
  saveAsProject: (name: string, description?: string) => ProjectMeta | null;
  openProject: (id: string) => { error?: string; notice?: string };
  renameProject: (id: string, name: string) => void;
  duplicateProject: (id: string) => ProjectMeta | null;
  deleteProject: (id: string) => void;
  setStatus: (status: ProjectStatus) => void;
  setObjective: (text: string) => void;
  setDescription: (text: string) => void;
  startNew: () => void;
  resetAll: () => void;

  // Data Loading
  loadFile: (file: File, options?: ParseCsvOptions) => Promise<{ errors: string[] }>;
  attachDataset: (dataset: Dataset, csv: string) => void;
  loadSample: () => void;
  loadPersonaSample: (personaId?: PersonaId) => void;
  clearDataset: () => void;

  // Data Cleaning
  applyCleaning: (
    type: CleaningStepType,
    params: Record<string, unknown>,
  ) => { success: boolean; error?: string };
  undoCleaning: () => void;
  resetCleaning: () => void;

  // Analyses History
  saveAnalysis: (analysis: SavedAnalysis) => void;
  removeAnalysis: (analysisId: string) => void;

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
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [cleaningSteps, setCleaningSteps] = useState<CleaningStep[]>([]);
  const [savedAnalyses, setSavedAnalyses] = useState<SavedAnalysis[]>([]);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [lastSaveError, setLastSaveError] = useState<string | null>(null);
  const [persona, setPersonaState] = useState<PersonaId>("engineer");
  const [user, setUser] = useState<UserProfile | null>(null);
  const [cloudSyncStatus, setCloudSyncStatus] = useState<CloudSyncStatus>({
    isConfigured: false,
    isSyncing: false,
    lastSyncedAt: null,
  });

  const activeRef = useRef<Active | null>(null);
  const activeProjectIdRef = useRef<string | null>(null);
  const cleaningStepsRef = useRef<CleaningStep[]>([]);
  const savedAnalysesRef = useRef<SavedAnalysis[]>([]);
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

  const commit = useCallback((next: ProjectMeta[]): boolean => {
    setSaveState("saving");
    const ok = saveProjects(next);
    if (ok) {
      setProjects(next);
      setSaveState("saved");
      setLastSaveError(null);
      return true;
    } else {
      setSaveState("error");
      setLastSaveError("Failed to save changes to local storage. Storage quota may be exceeded.");
      return false;
    }
  }, []);

  const update = useCallback(
    (id: string, patch: Partial<ProjectMeta>): boolean => {
      const currentList = loadProjects();
      const next = currentList.map((p) =>
        p.id === id ? { ...p, ...patch, updatedAt: nowIso() } : p,
      );
      const saved = commit(next);
      if (saved) {
        const updatedProject = next.find((p) => p.id === id);
        if (updatedProject) {
          const csv = loadCsv(id);
          getSupabaseClient()
            .saveProject(updatedProject, csv, user?.id)
            .catch(() => {});
        }
      }
      return saved;
    },
    [commit, user],
  );

  const attach = useCallback(
    (dataset: Dataset, csv: string) => {
      const projectId = activeRef.current?.projectId ?? activeProjectIdRef.current ?? null;
      setCleaningSteps([]);
      cleaningStepsRef.current = [];

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
          cleaningSteps: [],
        });
      }
      setActive({ dataset, rawDataset: dataset, csv, projectId });
    },
    [setActive, update],
  );

  const loadFile = useCallback(
    async (file: File, options?: ParseCsvOptions) => {
      const { result, text } = await parseCsvFile(file, options);
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
    loadPersonaSample(personaRef.current);
  }, [loadPersonaSample]);

  const clearDataset = useCallback(() => {
    const cur = activeRef.current;
    if (cur?.projectId) {
      deleteCsv(cur.projectId);
      update(cur.projectId, { status: "no-data", dataset: null, cleaningSteps: [] });
    }
    setCleaningSteps([]);
    cleaningStepsRef.current = [];
    setActive(null);
  }, [setActive, update]);

  const startNew = useCallback(() => {
    activeProjectIdRef.current = null;
    setActiveProjectId(null);
    setActive(null);
    setCleaningSteps([]);
    cleaningStepsRef.current = [];
    setSavedAnalyses([]);
    savedAnalysesRef.current = [];
  }, [setActive]);

  const createProject = useCallback(
    (name: string, description?: string, attachActive: boolean = false): ProjectMeta | null => {
      const trimmedName = name.trim();
      if (!trimmedName) return null;

      const id = "proj_" + Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
      activeProjectIdRef.current = id;
      setActiveProjectId(id);

      const cur = attachActive ? activeRef.current : null;
      let stored = false;

      if (cur?.csv) {
        stored = storeCsv(id, cur.csv);
      }

      const p: ProjectMeta = {
        id,
        name: trimmedName,
        description: description?.trim() || "",
        objective: description?.trim() || "",
        createdAt: nowIso(),
        updatedAt: nowIso(),
        status: cur ? "data-loaded" : "no-data",
        dataset: cur
          ? {
              name: cur.dataset.name,
              rows: cur.dataset.rows.length,
              columns: cur.dataset.columns.length,
              source: cur.dataset.source,
              stored,
            }
          : null,
        cleaningSteps: cur ? cleaningStepsRef.current : [],
        savedAnalyses: cur ? savedAnalysesRef.current : [],
      };

      const success = commit([p, ...loadProjects()]);
      if (!success) return null;

      if (cur) {
        setActive({ ...cur, projectId: id });
      } else {
        setActive(null);
        setCleaningSteps([]);
        cleaningStepsRef.current = [];
        setSavedAnalyses([]);
        savedAnalysesRef.current = [];
      }

      getSupabaseClient()
        .saveProject(p, cur?.csv ?? null, user?.id)
        .catch(() => {});

      return p;
    },
    [commit, user, setActive],
  );

  const saveAsProject = useCallback(
    (name: string, description?: string) => {
      if (!active) return null;
      return createProject(name.trim() || active.dataset.name, description, true);
    },
    [active, createProject],
  );

  const openProject = useCallback(
    (id: string) => {
      const p = loadProjects().find((x) => x.id === id);
      if (!p) return { error: "Project not found." };

      activeProjectIdRef.current = id;
      setActiveProjectId(id);

      const projectCleaningSteps = p.cleaningSteps ?? [];
      const projectAnalyses = p.savedAnalyses ?? [];
      setCleaningSteps(projectCleaningSteps);
      cleaningStepsRef.current = projectCleaningSteps;
      setSavedAnalyses(projectAnalyses);
      savedAnalysesRef.current = projectAnalyses;

      if (!p.dataset) {
        setActive(null);
        return { notice: "This project has no dataset yet. Upload one in the Data Workspace." };
      }

      const csv = loadCsv(id);
      if (!csv) {
        setActive(null);
        return {
          error:
            "The data for this project was not stored locally. Please upload the CSV file again to continue.",
        };
      }

      const res = parseCsvText(csv, p.dataset.name, p.dataset.source);
      if (!res.ok) return { error: res.errors.join(" ") };

      const rawDataset = res.dataset;
      let analyticalDataset = rawDataset;
      if (projectCleaningSteps.length > 0) {
        const replayed = replayCleaningSteps(rawDataset, projectCleaningSteps);
        analyticalDataset = replayed.dataset;
      }

      setActive({ dataset: analyticalDataset, rawDataset, csv, projectId: id });
      return {};
    },
    [setActive],
  );

  const renameProject = useCallback(
    (id: string, name: string) => {
      update(id, { name: name.trim() || "Untitled project" });
    },
    [update],
  );

  const duplicateProject = useCallback((id: string): ProjectMeta | null => {
    const copy = duplicateProjectPersistence(id);
    if (copy) {
      setProjects(loadProjects());
    }
    return copy;
  }, []);

  const deleteProject = useCallback(
    (id: string) => {
      deleteCsv(id);
      deleteChat(id);
      commit(loadProjects().filter((p) => p.id !== id));
      getSupabaseClient()
        .deleteProject(id)
        .catch(() => {});
      if (activeProjectIdRef.current === id) {
        activeProjectIdRef.current = null;
        setActiveProjectId(null);
      }
      const cur = activeRef.current;
      if (cur?.projectId === id) {
        setActive({ ...cur, projectId: null });
      }
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
      if (active?.projectId) update(active.projectId, { objective, description: objective });
    },
    [active, update],
  );

  const setDescription = useCallback(
    (description: string) => {
      if (active?.projectId) update(active.projectId, { description, objective: description });
    },
    [active, update],
  );

  const resetAll = useCallback(() => {
    clearAll();
    setProjects([]);
    setActive(null);
    setCleaningSteps([]);
    cleaningStepsRef.current = [];
    setSavedAnalyses([]);
    savedAnalysesRef.current = [];
  }, [setActive]);

  // Data Cleaning handlers
  const applyCleaning = useCallback(
    (type: CleaningStepType, params: Record<string, unknown>) => {
      const cur = activeRef.current;
      if (!cur) return { success: false, error: "No active dataset." };

      try {
        const { dataset: nextDs, step } = applyCleaningStep(cur.dataset, type, params);
        const nextSteps = [...cleaningStepsRef.current, step];
        setCleaningSteps(nextSteps);
        cleaningStepsRef.current = nextSteps;

        setActive({
          ...cur,
          dataset: nextDs,
        });

        if (cur.projectId) {
          update(cur.projectId, {
            cleaningSteps: nextSteps,
            dataset: cur.dataset
              ? {
                  ...cur.dataset,
                  name: nextDs.name,
                  rows: nextDs.rows.length,
                  columns: nextDs.columns.length,
                  source: nextDs.source,
                  stored: true,
                }
              : null,
          });
        }
        return { success: true };
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : "Cleaning failed." };
      }
    },
    [setActive, update],
  );

  const undoCleaning = useCallback(() => {
    const cur = activeRef.current;
    if (!cur || cleaningStepsRef.current.length === 0) return;

    const nextSteps = cleaningStepsRef.current.slice(0, -1);
    const { dataset: replayedDataset } = replayCleaningSteps(cur.rawDataset, nextSteps);

    setCleaningSteps(nextSteps);
    cleaningStepsRef.current = nextSteps;

    setActive({
      ...cur,
      dataset: replayedDataset,
    });

    if (cur.projectId) {
      update(cur.projectId, {
        cleaningSteps: nextSteps,
        dataset: {
          name: replayedDataset.name,
          rows: replayedDataset.rows.length,
          columns: replayedDataset.columns.length,
          source: replayedDataset.source,
          stored: true,
        },
      });
    }
  }, [setActive, update]);

  const resetCleaning = useCallback(() => {
    const cur = activeRef.current;
    if (!cur) return;

    setCleaningSteps([]);
    cleaningStepsRef.current = [];

    setActive({
      ...cur,
      dataset: cur.rawDataset,
    });

    if (cur.projectId) {
      update(cur.projectId, {
        cleaningSteps: [],
        dataset: {
          name: cur.rawDataset.name,
          rows: cur.rawDataset.rows.length,
          columns: cur.rawDataset.columns.length,
          source: cur.rawDataset.source,
          stored: true,
        },
      });
    }
  }, [setActive, update]);

  // Saved Analyses handlers
  const saveAnalysis = useCallback(
    (analysis: SavedAnalysis) => {
      const cur = activeRef.current;
      const next = [analysis, ...savedAnalysesRef.current.filter((a) => a.id !== analysis.id)];
      setSavedAnalyses(next);
      savedAnalysesRef.current = next;

      if (cur?.projectId) {
        update(cur.projectId, {
          status: "analysed",
          savedAnalyses: next,
        });
      }
    },
    [update],
  );

  const removeAnalysis = useCallback(
    (analysisId: string) => {
      const cur = activeRef.current;
      const next = savedAnalysesRef.current.filter((a) => a.id !== analysisId);
      setSavedAnalyses(next);
      savedAnalysesRef.current = next;

      if (cur?.projectId) {
        update(cur.projectId, {
          savedAnalyses: next,
        });
      }
    },
    [update],
  );

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
    () => projects.find((p) => p.id === (active?.projectId ?? activeProjectId)) ?? null,
    [projects, active, activeProjectId],
  );

  const value: Store = {
    ready,
    projects,
    active,
    activeProject,
    activeProjectId,
    rawDataset: active?.rawDataset ?? null,
    cleaningSteps,
    savedAnalyses,
    saveState,
    lastSaveError,
    createProject,
    saveAsProject,
    openProject,
    renameProject,
    duplicateProject,
    deleteProject,
    setStatus,
    setObjective,
    setDescription,
    startNew,
    resetAll,
    loadFile,
    attachDataset: attach,
    loadSample,
    loadPersonaSample,
    clearDataset,
    applyCleaning,
    undoCleaning,
    resetCleaning,
    saveAnalysis,
    removeAnalysis,
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

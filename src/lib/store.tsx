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
  loadProjectsForUser,
  saveProjects,
  storeCsv,
  replaceCsv,
  duplicateProject as duplicateProjectPersistence,
  type ProjectMeta,
  type ProjectStatus,
} from "./persistence/projects";
import {
  saveDataset,
  loadDataset,
  loadDatasetByProject,
  deleteDataset,
  deleteDatasetByProject,
  duplicateDataset as duplicateDatasetIdb,
  clearAllDatasets,
  migrateFromLocalStorage,
  checkStorageAvailable,
} from "./persistence/indexeddb";
import { type PersonaId } from "./stats/personas";
import {
  type UserProfile,
  loadStoredUser,
  loadActivePersona,
  saveActivePersona,
  registerUser,
  loginUser,
  logoutUser,
  restoreUserSession,
  subscribeToAuthChanges,
  signOutUser,
  sendMagicLink,
  sendPasswordReset,
  updateUserPassword,
  signInWithGoogleOAuth,
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
  openProject: (id: string) => Promise<{ error?: string; notice?: string }>;
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
  authLoading: boolean;
  login: (email: string, pass: string) => Promise<{ user: UserProfile | null; error?: string }>;
  register: (
    email: string,
    pass: string,
    name: string,
    persona: PersonaId,
  ) => Promise<{ user: UserProfile | null; error?: string }>;
  logout: () => void;
  magicLink: (email: string) => Promise<{ success: boolean; error?: string }>;
  resetPassword: (email: string) => Promise<{ success: boolean; error?: string }>;
  updatePassword: (newPass: string) => Promise<{ success: boolean; error?: string }>;
  loginWithGoogle: () => Promise<{ error?: string }>;
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
  const [authLoading, setAuthLoading] = useState(true);
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
    let mounted = true;
    async function init() {
      // 1. Run safe migration from legacy localStorage in background
      try {
        await migrateFromLocalStorage();
      } catch (e) {
        console.warn("Legacy storage migration notice:", e);
      }

      if (!mounted) return;

      const sessionUser = await restoreUserSession();
      if (!mounted) return;
      setUser(sessionUser);
      setAuthLoading(false);

      const loadedProjects = loadProjectsForUser(sessionUser?.id ?? null);
      setProjects(loadedProjects);

      const initialPersona = sessionUser?.persona ?? loadActivePersona();
      setPersonaState(initialPersona);
      personaRef.current = initialPersona;

      const supabase = getSupabaseClient();
      setCloudSyncStatus({
        isConfigured: supabase.isConfigured(),
        isSyncing: false,
        lastSyncedAt: sessionUser ? nowIso() : null,
      });

      setReady(true);
    }

    init();

    const unsubscribe = subscribeToAuthChanges((changedUser) => {
      if (!mounted) return;
      setUser(changedUser);
      setAuthLoading(false);
      if (changedUser) {
        setPersona(changedUser.persona);
        setProjects(loadProjectsForUser(changedUser.id));
      } else {
        // Prevent data leaks on signout
        setActive(null);
        setActiveProjectId(null);
        setCleaningSteps([]);
        cleaningStepsRef.current = [];
        setSavedAnalyses([]);
        savedAnalysesRef.current = [];
        setProjects(loadProjectsForUser(null));
      }
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [setActive, setPersona]);

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
        const supabase = getSupabaseClient();
        if (updatedProject && supabase.isConfigured() && supabase.getConfig().autoSync) {
          loadDataset(updatedProject.dataset?.id || id)
            .then((stored) => {
              const csv = stored?.csv || loadCsv(id);
              supabase.saveProject(updatedProject, csv, user?.id).catch(() => {});
            })
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
        checkStorageAvailable(dataset.sizeBytes)
          .then((quotaCheck) => {
            if (!quotaCheck.ok) {
              setSaveState("error");
              setLastSaveError(quotaCheck.warning || "Storage quota critically low.");
            }
          })
          .catch(() => {});

        saveDataset(dataset, { projectId, csv })
          .then(() => {
            update(projectId, {
              status: "data-loaded",
              dataset: {
                id: dataset.id,
                name: dataset.name,
                rows: dataset.rows.length,
                columns: dataset.columns.length,
                source: dataset.source,
                stored: true,
              },
              cleaningSteps: [],
            });
          })
          .catch((err) => {
            console.warn("IndexedDB save failed, using fallback:", err);
            const stored = replaceCsv(projectId, csv);
            update(projectId, {
              status: "data-loaded",
              dataset: {
                id: dataset.id,
                name: dataset.name,
                rows: dataset.rows.length,
                columns: dataset.columns.length,
                source: dataset.source,
                stored,
              },
              cleaningSteps: [],
            });
            if (!stored) {
              setSaveState("error");
              setLastSaveError(
                err instanceof Error
                  ? err.message
                  : "Failed to store dataset locally. Storage limit reached.",
              );
            }
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
      if (cur.dataset?.id) {
        deleteDataset(cur.dataset.id).catch(() => {});
      }
      deleteDatasetByProject(cur.projectId).catch(() => {});
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

      if (cur?.dataset) {
        const datasetToSave = { ...cur.dataset };
        saveDataset(datasetToSave, { projectId: id, csv: cur.csv })
          .then(() => {
            update(id, {
              dataset: {
                id: datasetToSave.id,
                name: datasetToSave.name,
                rows: datasetToSave.rows.length,
                columns: datasetToSave.columns.length,
                source: datasetToSave.source,
                stored: true,
              },
            });
          })
          .catch(() => {
            if (cur.csv) {
              storeCsv(id, cur.csv);
            }
          });

        stored = true;
      }

      const p: ProjectMeta = {
        id,
        userId: user?.id,
        name: trimmedName,
        description: description?.trim() || "",
        objective: description?.trim() || "",
        createdAt: nowIso(),
        updatedAt: nowIso(),
        status: cur ? "data-loaded" : "no-data",
        dataset: cur
          ? {
              id: cur.dataset.id,
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

      const supabase = getSupabaseClient();
      if (supabase.isConfigured() && supabase.getConfig().autoSync) {
        supabase.saveProject(p, cur?.csv ?? null, user?.id).catch(() => {});
      }

      return p;
    },
    [commit, user, setActive, update],
  );

  const saveAsProject = useCallback(
    (name: string, description?: string) => {
      if (!active) return null;
      return createProject(name.trim() || active.dataset.name, description, true);
    },
    [active, createProject],
  );

  const openProject = useCallback(
    async (id: string): Promise<{ error?: string; notice?: string }> => {
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

      // 1. Try to load structured dataset from IndexedDB first
      try {
        let stored = p.dataset.id ? await loadDataset(p.dataset.id) : null;
        if (!stored) {
          stored = await loadDatasetByProject(id);
        }

        if (stored) {
          const rawDataset: Dataset = {
            id: stored.id,
            name: stored.name,
            source: stored.source,
            columns: stored.columns,
            rows: stored.rows,
            sizeBytes: stored.sizeBytes,
            warnings: stored.warnings ?? [],
            delimiter: stored.delimiter,
            typeOverrides: stored.typeOverrides,
          };

          let analyticalDataset = rawDataset;
          if (projectCleaningSteps.length > 0) {
            const replayed = replayCleaningSteps(rawDataset, projectCleaningSteps);
            analyticalDataset = replayed.dataset;
          }

          setActive({
            dataset: analyticalDataset,
            rawDataset,
            csv: stored.csv ?? "",
            projectId: id,
          });
          return {};
        }
      } catch (err) {
        console.warn("Failed to load dataset from IndexedDB:", err);
      }

      // 2. Fallback to legacy localStorage CSV
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

      // Migrate to IndexedDB in background
      saveDataset(rawDataset, { projectId: id, csv }).catch(() => {});

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
      const source = loadProjects().find((p) => p.id === id);
      const sourceDsId = source?.dataset?.id || id;
      const newDsId = copy.dataset?.id || "ds_" + copy.id;
      duplicateDatasetIdb(sourceDsId, newDsId, copy.id).catch((err) => {
        console.warn("Failed to duplicate dataset in IndexedDB:", err);
      });
    }
    return copy;
  }, []);

  const deleteProject = useCallback(
    (id: string) => {
      const p = loadProjects().find((x) => x.id === id);
      if (p?.dataset?.id) {
        deleteDataset(p.dataset.id).catch(() => {});
      }
      deleteDatasetByProject(id).catch(() => {});
      deleteCsv(id);
      deleteChat(id);
      commit(loadProjects().filter((x) => x.id !== id));
      const supabase = getSupabaseClient();
      if (supabase.isConfigured() && supabase.getConfig().autoSync) {
        supabase.deleteProject(id).catch(() => {});
      }
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

  const resetAll = useCallback(async () => {
    try {
      await clearAllDatasets();
    } catch (e) {
      console.warn("Failed to clear IndexedDB datasets:", e);
    }
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
    signOutUser().catch(() => {});
    setUser(null);
    setActive(null);
    setActiveProjectId(null);
    setCleaningSteps([]);
    cleaningStepsRef.current = [];
    setSavedAnalyses([]);
    savedAnalysesRef.current = [];
    setProjects(loadProjectsForUser(null));
  }, [setActive]);

  const handleMagicLink = useCallback(async (email: string) => {
    return sendMagicLink(email);
  }, []);

  const handleResetPassword = useCallback(async (email: string) => {
    return sendPasswordReset(email);
  }, []);

  const handleUpdatePassword = useCallback(async (newPass: string) => {
    return updateUserPassword(newPass);
  }, []);

  const handleGoogleLogin = useCallback(async () => {
    return signInWithGoogleOAuth();
  }, []);

  const syncWithCloud = useCallback(async () => {
    setCloudSyncStatus((prev) => ({ ...prev, isSyncing: true }));
    const supabase = getSupabaseClient();
    try {
      const currentProjects = loadProjects();
      let syncedCount = 0;
      for (const p of currentProjects) {
        let csv: string | null = null;
        if (p.dataset?.id) {
          const stored = await loadDataset(p.dataset.id).catch(() => null);
          csv = stored?.csv || null;
        }
        if (!csv) {
          const stored = await loadDatasetByProject(p.id).catch(() => null);
          csv = stored?.csv || null;
        }
        if (!csv) {
          csv = loadCsv(p.id);
        }
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
    authLoading,
    login: handleLogin,
    register: handleRegister,
    logout: handleLogout,
    magicLink: handleMagicLink,
    resetPassword: handleResetPassword,
    updatePassword: handleUpdatePassword,
    loginWithGoogle: handleGoogleLogin,
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

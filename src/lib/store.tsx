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
  loadActivePersona,
  saveActivePersona,
  registerUser,
  loginUser,
  restoreUserSession,
  subscribeToAuthChanges,
  signOutUser,
  sendMagicLink,
  sendPasswordReset,
  updateUserPassword,
  signInWithGoogleOAuth,
} from "./persistence/auth";
import {
  getSupabaseClient,
  generateUuid,
  toValidUuid,
  isValidUuid,
  isSupabaseConfigured,
  type CloudImportResult,
  type CloudReport,
} from "./persistence/supabase";
import {
  getPersistenceCoordinator,
  type PersistenceState,
} from "./persistence/coordinator";

interface Active {
  dataset: Dataset;
  rawDataset: Dataset;
  csv: string;
  projectId: string | null;
}

export type SaveState = "saved" | "pending" | "saving" | "error";

export type CloudSyncState =
  | "not_configured"
  | "not_authenticated"
  | "ready"
  | "syncing"
  | "synced"
  | "partially_synced"
  | "failed";

export interface CloudSyncStatus {
  state: CloudSyncState;
  isConfigured: boolean;
  isSyncing: boolean;
  lastSyncedAt: string | null;
  errorMessage: string | null;
  syncedCount: number;
  totalCount: number;
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
  persistenceState: PersistenceState;

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

  // Reports
  saveReport: (report: {
    id?: string;
    projectId?: string;
    title: string;
    markdown: string;
    objective?: string;
    summary?: Record<string, unknown>;
  }) => Promise<{ ok: boolean; id?: string }>;
  loadProjectReports: (projectId: string) => Promise<CloudReport[]>;

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
  syncWithCloud: () => Promise<{
    success: boolean;
    state?: CloudSyncState;
    count?: number;
    total?: number;
    error?: string;
  }>;
  importLocalProjects: () => Promise<CloudImportResult>;
}

const CTX_KEY = "__lumetraStoreContext__";
const g = globalThis as unknown as Record<string, React.Context<Store | null> | undefined>;
const Ctx: React.Context<Store | null> =
  g[CTX_KEY] ?? (g[CTX_KEY] = createContext<Store | null>(null));

function nowIso() {
  return new Date().toISOString();
}

export function computeSyncStatus(
  configured: boolean,
  u: UserProfile | null,
  projs: ProjectMeta[],
  lastSynced: string | null = null,
  err: string | null = null,
): CloudSyncStatus {
  if (!configured) {
    return {
      state: "not_configured",
      isConfigured: false,
      isSyncing: false,
      lastSyncedAt: null,
      errorMessage: "Database credentials are not configured.",
      syncedCount: 0,
      totalCount: projs.length,
    };
  }

  if (!u || !u.id || !isValidUuid(u.id)) {
    return {
      state: "not_authenticated",
      isConfigured: true,
      isSyncing: false,
      lastSyncedAt: null,
      errorMessage: "Sign in to your account to enable automatic persistence.",
      syncedCount: 0,
      totalCount: projs.length,
    };
  }

  const userProjects = projs.filter((p) => p.userId === u.id || !p.userId);
  const total = userProjects.length;
  const synced = userProjects.filter((p) => p.isCloudSynced).length;
  const failed = userProjects.filter((p) => Boolean(p.cloudSyncError)).length;

  let state: CloudSyncState = "ready";
  if (total > 0 && synced === total) {
    state = "synced";
  } else if (synced > 0 && synced < total) {
    state = "partially_synced";
  } else if (failed > 0 && synced === 0) {
    state = "failed";
  } else {
    state = "ready";
  }

  return {
    state,
    isConfigured: true,
    isSyncing: false,
    lastSyncedAt: lastSynced ?? (synced > 0 ? nowIso() : null),
    errorMessage: err,
    syncedCount: synced,
    totalCount: total,
  };
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const coordinator = getPersistenceCoordinator();

  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [ready, setReady] = useState(false);
  const [active, setActiveState] = useState<Active | null>(null);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [cleaningSteps, setCleaningSteps] = useState<CleaningStep[]>([]);
  const [savedAnalyses, setSavedAnalyses] = useState<SavedAnalysis[]>([]);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [lastSaveError, setLastSaveError] = useState<string | null>(null);
  const [persistenceState, setPersistenceState] = useState<PersistenceState>(coordinator.getState());
  const [persona, setPersonaState] = useState<PersonaId>("engineer");
  const [user, setUser] = useState<UserProfile | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [cloudSyncStatus, setCloudSyncStatus] = useState<CloudSyncStatus>({
    state: isSupabaseConfigured() ? "not_authenticated" : "not_configured",
    isConfigured: isSupabaseConfigured(),
    isSyncing: false,
    lastSyncedAt: null,
    errorMessage: null,
    syncedCount: 0,
    totalCount: 0,
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

      coordinator.init(sessionUser?.id ?? null);

      const initialPersona = sessionUser?.persona ?? loadActivePersona();
      setPersonaState(initialPersona);
      personaRef.current = initialPersona;

      let loadedProjects = loadProjectsForUser(sessionUser?.id ?? null);

      // 2. If authenticated user, reconcile unassociated local projects & pull remote list
      if (sessionUser && isSupabaseConfigured()) {
        try {
          const supabase = getSupabaseClient();
          const remoteProjects = await supabase.listProjects(sessionUser.id);
          const allLocal = loadProjects();

          // Associate any unassociated local projects created on this device with current user
          const unassigned = allLocal.filter((p) => !p.userId);
          for (const p of unassigned) {
            p.userId = sessionUser.id;
            coordinator.queueProjectSave(p, sessionUser.id, { immediate: true });
          }

          // Merge any remote-only projects into local cache
          const localIds = new Set(allLocal.map((p) => p.id));
          const toAdd: ProjectMeta[] = [];
          for (const rem of remoteProjects) {
            if (!localIds.has(rem.id)) {
              toAdd.push({
                id: rem.id,
                userId: rem.user_id,
                name: rem.name,
                description: rem.objective,
                objective: rem.objective,
                createdAt: rem.created_at,
                updatedAt: rem.updated_at,
                status: (rem.status as ProjectStatus) || "no-data",
                dataset: rem.dataset_name
                  ? {
                      name: rem.dataset_name,
                      rows: rem.dataset_rows || 0,
                      columns: rem.dataset_columns || 0,
                      source: (rem.dataset_source as "upload" | "sample") || "upload",
                      stored: false,
                    }
                  : null,
                cleaningSteps: rem.cleaning_steps ? JSON.parse(rem.cleaning_steps) : [],
                savedAnalyses: rem.saved_analyses ? JSON.parse(rem.saved_analyses) : [],
                isCloudSynced: true,
                cloudSyncedAt: rem.updated_at,
              });
            }
          }

          if (unassigned.length > 0 || toAdd.length > 0) {
            const merged = [...allLocal, ...toAdd];
            saveProjects(merged);
            loadedProjects = loadProjectsForUser(sessionUser.id);
          }
        } catch (err) {
          console.warn("Project reconciliation notice:", err);
        }
      }

      setProjects(loadedProjects);

      const supabase = getSupabaseClient();
      setCloudSyncStatus(computeSyncStatus(supabase.isConfigured(), sessionUser, loadedProjects));
      setReady(true);
    }

    init();

    // Subscribe to background persistence coordinator status
    const unsubscribeCoordinator = coordinator.subscribe((cState) => {
      if (!mounted) return;
      setPersistenceState(cState);
      setSaveState(
        cState.status === "saving"
          ? "saving"
          : cState.status === "saved"
            ? "saved"
            : cState.status === "pending"
              ? "pending"
              : "error",
      );
      setLastSaveError(cState.error);
    });

    // Subscribe to auth state transitions
    const unsubscribeAuth = subscribeToAuthChanges((changedUser) => {
      if (!mounted) return;
      setUser(changedUser);
      setAuthLoading(false);
      coordinator.init(changedUser?.id ?? null);
      const supabase = getSupabaseClient();

      if (changedUser) {
        setPersona(changedUser.persona);
        const allLocal = loadProjects();
        // Associate unassigned projects with user
        const unassigned = allLocal.filter((p) => !p.userId);
        for (const p of unassigned) {
          p.userId = changedUser.id;
          coordinator.queueProjectSave(p, changedUser.id, { immediate: true });
        }
        if (unassigned.length > 0) {
          saveProjects(allLocal);
        }

        const pList = loadProjectsForUser(changedUser.id);
        setProjects(pList);
        setCloudSyncStatus(computeSyncStatus(supabase.isConfigured(), changedUser, pList));

        // Pull remote projects on login
        if (isSupabaseConfigured()) {
          supabase
            .listProjects(changedUser.id)
            .then((remoteProjects) => {
              if (!mounted) return;
              const current = loadProjects();
              const currentIds = new Set(current.map((p) => p.id));
              const additions: ProjectMeta[] = [];
              for (const rem of remoteProjects) {
                if (!currentIds.has(rem.id)) {
                  additions.push({
                    id: rem.id,
                    userId: rem.user_id,
                    name: rem.name,
                    description: rem.objective,
                    objective: rem.objective,
                    createdAt: rem.created_at,
                    updatedAt: rem.updated_at,
                    status: (rem.status as ProjectStatus) || "no-data",
                    dataset: rem.dataset_name
                      ? {
                          name: rem.dataset_name,
                          rows: rem.dataset_rows || 0,
                          columns: rem.dataset_columns || 0,
                          source: (rem.dataset_source as "upload" | "sample") || "upload",
                          stored: false,
                        }
                      : null,
                    cleaningSteps: rem.cleaning_steps ? JSON.parse(rem.cleaning_steps) : [],
                    savedAnalyses: rem.saved_analyses ? JSON.parse(rem.saved_analyses) : [],
                    isCloudSynced: true,
                    cloudSyncedAt: rem.updated_at,
                  });
                }
              }
              if (additions.length > 0) {
                const updated = [...current, ...additions];
                saveProjects(updated);
                setProjects(loadProjectsForUser(changedUser.id));
              }
            })
            .catch(() => {});
        }
      } else {
        // Prevent data leaks on signout
        setActive(null);
        setActiveProjectId(null);
        setCleaningSteps([]);
        cleaningStepsRef.current = [];
        setSavedAnalyses([]);
        savedAnalysesRef.current = [];
        const pList = loadProjectsForUser(null);
        setProjects(pList);
        setCloudSyncStatus(computeSyncStatus(supabase.isConfigured(), null, pList));
      }
    });

    return () => {
      mounted = false;
      unsubscribeCoordinator();
      unsubscribeAuth();
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
        if (updatedProject) {
          coordinator.queueProjectSave(updatedProject, user?.id, { immediate: false });
        }
      }
      return saved;
    },
    [commit, user],
  );

  const createProject = useCallback(
    (name: string, description?: string, attachActive: boolean = false): ProjectMeta | null => {
      const trimmedName = name.trim();
      if (!trimmedName) return null;

      const id = generateUuid();
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

      // Automatically persist project and dataset immediately
      coordinator.queueProjectSave(p, user?.id, { immediate: true });
      if (cur?.dataset) {
        coordinator.queueDatasetSave(
          id,
          {
            id: cur.dataset.id,
            name: cur.dataset.name,
            source: cur.dataset.source,
            rows: cur.dataset.rows.length,
            columns: cur.dataset.columns.length,
            columnList: cur.dataset.columns,
            cleaningSteps: cleaningStepsRef.current,
            csvContent: cur.csv,
          },
          user?.id,
          { immediate: true },
        );
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

  const attach = useCallback(
    (dataset: Dataset, csv: string) => {
      let projectId = activeRef.current?.projectId ?? activeProjectIdRef.current ?? null;
      setCleaningSteps([]);
      cleaningStepsRef.current = [];

      // Automatically create a project for the dataset if none is currently active
      if (!projectId) {
        const defaultName = dataset.name.replace(/\.[^.]+$/, "") || "Untitled Project";
        const autoProj = createProject(defaultName, "", false);
        if (autoProj) {
          projectId = autoProj.id;
          activeProjectIdRef.current = autoProj.id;
          setActiveProjectId(autoProj.id);
        }
      }

      if (projectId) {
        const targetProjectId = projectId;
        checkStorageAvailable(dataset.sizeBytes)
          .then((quotaCheck) => {
            if (!quotaCheck.ok) {
              setSaveState("error");
              setLastSaveError(quotaCheck.warning || "Storage quota critically low.");
            }
          })
          .catch(() => {});

        saveDataset(dataset, { projectId: targetProjectId, csv })
          .then(() => {
            update(targetProjectId, {
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

            coordinator.queueDatasetSave(
              targetProjectId,
              {
                id: dataset.id,
                name: dataset.name,
                source: dataset.source,
                rows: dataset.rows.length,
                columns: dataset.columns.length,
                columnList: dataset.columns,
                cleaningSteps: [],
                csvContent: csv,
                delimiter: dataset.delimiter,
                typeOverrides: dataset.typeOverrides,
              },
              user?.id,
              { immediate: true },
            );
          })
          .catch((err) => {
            console.warn("IndexedDB save failed, using fallback:", err);
            const stored = replaceCsv(targetProjectId, csv);
            update(targetProjectId, {
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

            coordinator.queueDatasetSave(
              targetProjectId,
              {
                id: dataset.id,
                name: dataset.name,
                source: dataset.source,
                rows: dataset.rows.length,
                columns: dataset.columns.length,
                columnList: dataset.columns,
                cleaningSteps: [],
                csvContent: csv,
              },
              user?.id,
              { immediate: true },
            );

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
    [setActive, update, createProject, user],
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

  const openProject = useCallback(
    async (id: string): Promise<{ error?: string; notice?: string }> => {
      let p = loadProjects().find((x) => x.id === id);

      // If not in local projects list, check if available in cloud
      if (!p && isSupabaseConfigured()) {
        try {
          const cloudRecord = await getSupabaseClient().loadProject(id);
          if (cloudRecord) {
            p = {
              id: cloudRecord.id,
              userId: cloudRecord.user_id,
              name: cloudRecord.name,
              description: cloudRecord.objective,
              objective: cloudRecord.objective,
              createdAt: cloudRecord.created_at,
              updatedAt: cloudRecord.updated_at,
              status: (cloudRecord.status as ProjectStatus) || "no-data",
              dataset: cloudRecord.dataset_name
                ? {
                    name: cloudRecord.dataset_name,
                    rows: cloudRecord.dataset_rows || 0,
                    columns: cloudRecord.dataset_columns || 0,
                    source: (cloudRecord.dataset_source as "upload" | "sample") || "upload",
                    stored: false,
                  }
                : null,
              cleaningSteps: cloudRecord.cleaning_steps
                ? JSON.parse(cloudRecord.cleaning_steps)
                : [],
              savedAnalyses: cloudRecord.saved_analyses
                ? JSON.parse(cloudRecord.saved_analyses)
                : [],
              isCloudSynced: true,
              cloudSyncedAt: cloudRecord.updated_at,
            };
            commit([p, ...loadProjects()]);
          }
        } catch {
          // ignore
        }
      }

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

      // 2. Fallback to localStorage CSV or cloud database
      let csv = loadCsv(id);
      if (!csv && isSupabaseConfigured()) {
        try {
          const cloudRecord = await getSupabaseClient().loadProject(id);
          if (cloudRecord?.csv_content) {
            csv = cloudRecord.csv_content;
          }
        } catch (e) {
          console.warn("Cloud project fallback error:", e);
        }
      }

      if (!csv) {
        setActive(null);
        return {
          error:
            "The data for this project was not found in local storage or cloud. Please upload the CSV file again to continue.",
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

      // Cache in IndexedDB in background
      saveDataset(rawDataset, { projectId: id, csv }).catch(() => {});

      setActive({ dataset: analyticalDataset, rawDataset, csv, projectId: id });
      return {};
    },
    [setActive, commit],
  );

  const renameProject = useCallback(
    (id: string, name: string) => {
      update(id, { name: name.trim() || "Untitled project" });
    },
    [update],
  );

  const duplicateProject = useCallback(
    (id: string): ProjectMeta | null => {
      const copy = duplicateProjectPersistence(id);
      if (copy) {
        setProjects(loadProjects());
        const source = loadProjects().find((p) => p.id === id);
        const sourceDsId = source?.dataset?.id || id;
        const newDsId = copy.dataset?.id || "ds_" + copy.id;
        duplicateDatasetIdb(sourceDsId, newDsId, copy.id).catch((err) => {
          console.warn("Failed to duplicate dataset in IndexedDB:", err);
        });

        // Automatically persist duplicated project
        coordinator.queueProjectSave(copy, user?.id, { immediate: true });
      }
      return copy;
    },
    [user],
  );

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

      // Automatically delete from cloud database
      coordinator.queueProjectDelete(id, user?.id);

      if (activeProjectIdRef.current === id) {
        activeProjectIdRef.current = null;
        setActiveProjectId(null);
      }
      const cur = activeRef.current;
      if (cur?.projectId === id) {
        setActive({ ...cur, projectId: null });
      }
    },
    [commit, setActive, user],
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
    coordinator.resetQueue();
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

          // Debounced, incremental dataset metadata save
          coordinator.queueDatasetSave(
            cur.projectId,
            {
              id: cur.dataset.id,
              name: nextDs.name,
              rows: nextDs.rows.length,
              columns: nextDs.columns.length,
              columnList: nextDs.columns,
              cleaningSteps: nextSteps,
            },
            user?.id,
            { immediate: false },
          );
        }
        return { success: true };
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : "Cleaning failed." };
      }
    },
    [setActive, update, user],
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

      coordinator.queueDatasetSave(
        cur.projectId,
        {
          id: cur.rawDataset.id,
          name: replayedDataset.name,
          rows: replayedDataset.rows.length,
          columns: replayedDataset.columns.length,
          columnList: replayedDataset.columns,
          cleaningSteps: nextSteps,
        },
        user?.id,
        { immediate: false },
      );
    }
  }, [setActive, update, user]);

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

      coordinator.queueDatasetSave(
        cur.projectId,
        {
          id: cur.rawDataset.id,
          name: cur.rawDataset.name,
          rows: cur.rawDataset.rows.length,
          columns: cur.rawDataset.columns.length,
          columnList: cur.rawDataset.columns,
          cleaningSteps: [],
        },
        user?.id,
        { immediate: false },
      );
    }
  }, [setActive, update, user]);

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

        // Automatically persist analysis to database immediately
        coordinator.queueAnalysisSave(cur.projectId, analysis, user?.id);
      }
    },
    [update, user],
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

        coordinator.queueAnalysisDelete(cur.projectId, analysisId, user?.id);
      }
    },
    [update, user],
  );

  // Reports handlers
  const handleSaveReport = useCallback(
    async (report: {
      id?: string;
      projectId?: string;
      title: string;
      markdown: string;
      objective?: string;
      summary?: Record<string, unknown>;
    }): Promise<{ ok: boolean; id?: string }> => {
      const cur = activeRef.current;
      const targetProjectId = report.projectId || cur?.projectId || activeProjectIdRef.current;
      if (!targetProjectId) {
        return { ok: false };
      }

      const reportId = toValidUuid(report.id || generateUuid());
      coordinator.queueReportSave(
        {
          id: reportId,
          projectId: targetProjectId,
          title: report.title,
          markdown: report.markdown,
          objective: report.objective,
          summary: report.summary,
        },
        user?.id,
        { immediate: true },
      );

      return { ok: true, id: reportId };
    },
    [user],
  );

  const handleLoadProjectReports = useCallback(
    async (projectId: string): Promise<CloudReport[]> => {
      const supabase = getSupabaseClient();
      return supabase.loadReports(projectId);
    },
    [],
  );

  // Auth handlers
  const handleRegister = useCallback(
    async (email: string, pass: string, name: string, targetPersona: PersonaId) => {
      const res = await registerUser(email, pass, name, targetPersona);
      if (res.user) {
        setUser(res.user);
        setPersona(res.user.persona);
        coordinator.init(res.user.id);
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
        coordinator.init(res.user.id);
        setCloudSyncStatus((prev) => ({ ...prev, lastSyncedAt: nowIso() }));
      }
      return res;
    },
    [setPersona],
  );

  const handleLogout = useCallback(() => {
    signOutUser().catch(() => {});
    coordinator.init(null);
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

  const syncWithCloud = useCallback(async (): Promise<{
    success: boolean;
    state?: CloudSyncState;
    count?: number;
    total?: number;
    error?: string;
  }> => {
    // Flush the coordinator queue immediately
    await coordinator.flushQueue(true);

    const supabase = getSupabaseClient();
    if (!supabase.isConfigured()) {
      return { success: false, state: "not_configured", error: "Database not configured." };
    }
    if (!user || !user.id) {
      return { success: false, state: "not_authenticated", error: "Sign in required." };
    }

    const allProjects = loadProjectsForUser(user.id);
    return {
      success: true,
      state: "synced",
      count: allProjects.length,
      total: allProjects.length,
    };
  }, [user]);

  const importLocalProjects = useCallback(async (): Promise<CloudImportResult> => {
    setCloudSyncStatus((prev) => ({ ...prev, isSyncing: true }));
    const supabase = getSupabaseClient();
    try {
      const currentProjects = loadProjects();
      const result = await supabase.importLocalProjects(currentProjects, async (p) => {
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
        return csv;
      });

      if (result.success && result.projects.length > 0) {
        const importedUuids = new Set(result.projects.map((p) => p.id));
        const now = nowIso();
        const updated = currentProjects.map((p) => {
          const uId = toValidUuid(p.id);
          if (importedUuids.has(uId)) {
            return {
              ...p,
              id: uId,
              userId: user?.id ?? p.userId,
              isCloudSynced: true,
              cloudSyncedAt: now,
              cloudSyncError: undefined,
            };
          }
          return p;
        });
        commit(updated);
      }

      const all = loadProjects();
      setCloudSyncStatus(
        computeSyncStatus(supabase.isConfigured(), user, all, result.success ? nowIso() : null),
      );
      return result;
    } catch (e) {
      setCloudSyncStatus((prev) => ({ ...prev, isSyncing: false, state: "failed" }));
      return {
        success: false,
        imported: 0,
        skipped: 0,
        errors: [e instanceof Error ? e.message : "Import failed"],
        projects: [],
      };
    }
  }, [commit, user]);

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
    persistenceState,
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
    saveReport: handleSaveReport,
    loadProjectReports: handleLoadProjectReports,
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
    importLocalProjects,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore() {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore must be used inside StoreProvider");
  return s;
}

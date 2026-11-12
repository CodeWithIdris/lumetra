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
import { toCsv } from "./data/export";
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
  updateProjectRevision,
  type ProjectMeta,
  type ProjectStatus,
} from "./persistence/projects";
import {
  saveDatasetVersion,
  loadDatasetVersion,
  listDatasetVersions,
  cacheDatasetVersionMetadata,
  saveDataset,
  loadDataset,
  loadDatasetByProject,
  deleteDataset,
  deleteDatasetByProject,
  duplicateDataset as duplicateDatasetIdb,
  clearAllDatasets,
  migrateFromLocalStorage,
  checkStorageAvailable,
  type DatasetVersionMetadata,
  type StoredDatasetVersion,
  listLocalPersistenceConflicts,
  type LocalPersistenceConflict,
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
  type CloudDatasetVersion,
} from "./persistence/supabase";
import { getPersistenceCoordinator, type PersistenceState } from "./persistence/coordinator";

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
  datasetVersions: DatasetVersionMetadata[];
  persistenceConflicts: LocalPersistenceConflict[];
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
  ) => Promise<{ success: boolean; error?: string }>;
  undoCleaning: () => Promise<void>;
  resetCleaning: () => Promise<void>;
  restoreDatasetVersion: (versionId: string) => Promise<{ success: boolean; error?: string }>;
  resolvePersistenceConflict: (
    conflictId: string,
    resolution: "keep-local" | "use-saved",
  ) => Promise<{ success: boolean; error?: string }>;

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

function toLocalVersionMetadata(version: CloudDatasetVersion): DatasetVersionMetadata {
  return {
    id: version.id,
    projectId: version.projectId,
    datasetId: version.datasetId,
    userId: version.userId,
    version: version.version,
    contentHash: version.contentHash,
    createdAt: version.createdAt,
    description: version.description,
    cleaningSteps: version.cleaningSteps,
  };
}

async function loadProjectDatasetVersions(
  projectId: string,
  userId: string | null,
): Promise<DatasetVersionMetadata[]> {
  const localVersions = await listDatasetVersions(projectId);
  const cloudVersions =
    userId && isSupabaseConfigured()
      ? await getSupabaseClient().listDatasetVersionRecords(projectId, userId)
      : [];
  const merged = new Map<string, DatasetVersionMetadata>(
    localVersions.map((version) => [version.id, version]),
  );
  for (const remote of cloudVersions) {
    const metadata = toLocalVersionMetadata(remote);
    await cacheDatasetVersionMetadata(metadata);
    if (!merged.has(remote.id)) merged.set(remote.id, metadata);
  }
  return [...merged.values()].sort(
    (left, right) => right.version - left.version || right.createdAt.localeCompare(left.createdAt),
  );
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

  const userProjects = projs.filter((p) => p.userId === u.id);
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
  const [datasetVersions, setDatasetVersions] = useState<DatasetVersionMetadata[]>([]);
  const [persistenceConflicts, setPersistenceConflicts] = useState<LocalPersistenceConflict[]>([]);
  const [cleaningSteps, setCleaningSteps] = useState<CleaningStep[]>([]);
  const [savedAnalyses, setSavedAnalyses] = useState<SavedAnalysis[]>([]);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [lastSaveError, setLastSaveError] = useState<string | null>(null);
  const [persistenceState, setPersistenceState] = useState<PersistenceState>(
    coordinator.getState(),
  );
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
  const userIdRef = useRef<string | null>(null);
  const cleaningStepsRef = useRef<CleaningStep[]>([]);
  const savedAnalysesRef = useRef<SavedAnalysis[]>([]);
  const personaRef = useRef<PersonaId>("engineer");

  const setActive = useCallback((next: Active | null) => {
    activeRef.current = next;
    setActiveState(next);
  }, []);

  const clearAccountWorkingState = useCallback(() => {
    setActive(null);
    activeProjectIdRef.current = null;
    setActiveProjectId(null);
    setDatasetVersions([]);
    setPersistenceConflicts([]);
    setCleaningSteps([]);
    cleaningStepsRef.current = [];
    setSavedAnalyses([]);
    savedAnalysesRef.current = [];
  }, [setActive]);

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
      userIdRef.current = sessionUser?.id ?? null;
      setAuthLoading(false);

      coordinator.init(sessionUser?.id ?? null);

      const initialPersona = sessionUser?.persona ?? loadActivePersona();
      setPersonaState(initialPersona);
      personaRef.current = initialPersona;

      let loadedProjects = loadProjectsForUser(sessionUser?.id ?? null);

      // 2. If authenticated, pull only projects already owned by this account.
      if (sessionUser && isSupabaseConfigured()) {
        try {
          const supabase = getSupabaseClient();
          const remoteProjects = await supabase.listProjects(sessionUser.id);
          if (!mounted || userIdRef.current !== sessionUser.id) return;
          const allLocal = loadProjects();

          // Merge any remote-only projects into local cache
          const localIds = new Set(
            allLocal.filter((project) => project.userId === sessionUser.id).map((p) => p.id),
          );
          const toAdd: ProjectMeta[] = [];
          for (const rem of remoteProjects) {
            if (rem.user_id !== sessionUser.id) continue;
            if (!localIds.has(rem.id)) {
              toAdd.push({
                id: rem.id,
                userId: sessionUser.id,
                name: rem.name,
                ...(rem.objective !== undefined
                  ? { description: rem.objective, objective: rem.objective }
                  : {}),
                createdAt: rem.created_at,
                updatedAt: rem.updated_at,
                status: (rem.status as ProjectStatus) || "no-data",
                dataset: rem.dataset_name
                  ? {
                      ...(rem.dataset_id ? { id: rem.dataset_id } : {}),
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
                revision: rem.revision ?? 1,
                datasetRevision: rem.dataset_revision ?? 0,
              });
            }
          }

          if (toAdd.length > 0) {
            const merged = [...allLocal, ...toAdd];
            saveProjects(merged);
            loadedProjects = loadProjectsForUser(sessionUser.id);
          }
        } catch (err) {
          console.warn("Project reconciliation notice:", err);
        }
      }

      if (userIdRef.current !== (sessionUser?.id ?? null)) {
        setReady(true);
        return;
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
      const changedUserId = changedUser?.id ?? null;
      if (userIdRef.current !== changedUserId) {
        clearAccountWorkingState();
      }
      userIdRef.current = changedUserId;
      setUser(changedUser);
      setAuthLoading(false);
      coordinator.init(changedUser?.id ?? null);
      const supabase = getSupabaseClient();

      if (changedUser) {
        setPersona(changedUser.persona);

        const pList = loadProjectsForUser(changedUser.id);
        setProjects(pList);
        setCloudSyncStatus(computeSyncStatus(supabase.isConfigured(), changedUser, pList));

        // Pull remote projects on login
        if (isSupabaseConfigured()) {
          supabase
            .listProjects(changedUser.id)
            .then((remoteProjects) => {
              if (!mounted || userIdRef.current !== changedUser.id) return;
              const current = loadProjects();
              const currentIds = new Set(
                current.filter((project) => project.userId === changedUser.id).map((p) => p.id),
              );
              const additions: ProjectMeta[] = [];
              for (const rem of remoteProjects) {
                if (rem.user_id !== changedUser.id) continue;
                if (!currentIds.has(rem.id)) {
                  additions.push({
                    id: rem.id,
                    userId: changedUser.id,
                    name: rem.name,
                    ...(rem.objective !== undefined
                      ? { description: rem.objective, objective: rem.objective }
                      : {}),
                    createdAt: rem.created_at,
                    updatedAt: rem.updated_at,
                    status: (rem.status as ProjectStatus) || "no-data",
                    dataset: rem.dataset_name
                      ? {
                          ...(rem.dataset_id ? { id: rem.dataset_id } : {}),
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
                    revision: rem.revision ?? 1,
                    datasetRevision: rem.dataset_revision ?? 0,
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
        const pList = loadProjectsForUser(null);
        setProjects(pList);
        setCloudSyncStatus(computeSyncStatus(supabase.isConfigured(), null, pList));
      }
      setReady(true);
    });

    return () => {
      mounted = false;
      unsubscribeCoordinator();
      unsubscribeAuth();
    };
  }, [clearAccountWorkingState, setActive, setPersona]);

  const commit = useCallback(
    (next: ProjectMeta[]): boolean => {
      setSaveState("saving");
      const ok = saveProjects(next);
      if (ok) {
        setProjects(loadProjectsForUser(user?.id ?? null));
        setSaveState("saved");
        setLastSaveError(null);
        return true;
      } else {
        setSaveState("error");
        setLastSaveError("Failed to save changes to local storage. Storage quota may be exceeded.");
        return false;
      }
    },
    [user],
  );

  const update = useCallback(
    (id: string, patch: Partial<ProjectMeta>): boolean => {
      const currentList = loadProjects();
      const currentProject = currentList.find((p) => p.id === id);
      if (!currentProject || (currentProject.userId ?? null) !== (user?.id ?? null)) {
        return false;
      }
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

  const preserveDatasetVersion = useCallback(
    async (
      current: Active,
      dataset: Dataset,
      steps: CleaningStep[],
      description: string,
      force = false,
    ): Promise<DatasetVersionMetadata | null> => {
      if (!current.projectId) return null;
      const version = await saveDatasetVersion({
        projectId: current.projectId,
        userId: user?.id ?? null,
        dataset,
        cleaningSteps: steps,
        description,
        force,
      });
      setDatasetVersions((previous) => {
        const next = new Map(previous.map((entry) => [entry.id, entry]));
        next.set(version.id, version);
        return [...next.values()].sort(
          (left, right) =>
            right.version - left.version || right.createdAt.localeCompare(left.createdAt),
        );
      });
      if (user?.id) coordinator.queueDatasetVersionSave(version, user.id);
      return version;
    },
    [user],
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
            coordinator.queueDatasetSave(
              id,
              {
                id: datasetToSave.id,
                name: datasetToSave.name,
                source: datasetToSave.source,
                rows: datasetToSave.rows.length,
                columns: datasetToSave.columns.length,
                columnList: datasetToSave.columns,
                cleaningSteps: cleaningStepsRef.current,
                csvContent: cur.csv,
                ...(datasetToSave.delimiter !== undefined
                  ? { delimiter: datasetToSave.delimiter }
                  : {}),
                ...(datasetToSave.typeOverrides !== undefined
                  ? { typeOverrides: datasetToSave.typeOverrides }
                  : {}),
              },
              user?.id,
              { immediate: true },
            );
          })
          .catch((err) => {
            const fallbackStored = cur.csv ? storeCsv(id, cur.csv) : false;
            if (fallbackStored) {
              coordinator.queueDatasetSave(
                id,
                {
                  id: datasetToSave.id,
                  name: datasetToSave.name,
                  source: datasetToSave.source,
                  rows: datasetToSave.rows.length,
                  columns: datasetToSave.columns.length,
                  columnList: datasetToSave.columns,
                  cleaningSteps: cleaningStepsRef.current,
                  csvContent: cur.csv,
                },
                user?.id,
                { immediate: true },
              );
            } else {
              setSaveState("error");
              setLastSaveError(
                err instanceof Error
                  ? err.message
                  : "Failed to store dataset locally. Storage limit reached.",
              );
            }
          });

        stored = true;
      }

      const p: ProjectMeta = {
        id,
        ...(user?.id ? { userId: user.id } : {}),
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
      const importedDataset = { ...dataset, version: 1 };
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

        saveDataset(importedDataset, { projectId: targetProjectId, csv })
          .then(async () => {
            update(targetProjectId, {
              status: "data-loaded",
              dataset: {
                id: importedDataset.id,
                name: importedDataset.name,
                rows: importedDataset.rows.length,
                columns: importedDataset.columns.length,
                source: importedDataset.source,
                stored: true,
              },
              cleaningSteps: [],
              datasetRevision: 0,
            });

            coordinator.queueDatasetSave(
              targetProjectId,
              {
                id: importedDataset.id,
                name: importedDataset.name,
                source: importedDataset.source,
                rows: importedDataset.rows.length,
                columns: importedDataset.columns.length,
                columnList: importedDataset.columns,
                cleaningSteps: [],
                csvContent: csv,
                revision: 0,
                ...(importedDataset.delimiter !== undefined
                  ? { delimiter: importedDataset.delimiter }
                  : {}),
                ...(importedDataset.typeOverrides !== undefined
                  ? { typeOverrides: importedDataset.typeOverrides }
                  : {}),
              },
              user?.id,
              { immediate: true },
            );
            try {
              const version = await preserveDatasetVersion(
                {
                  dataset: importedDataset,
                  rawDataset: importedDataset,
                  csv,
                  projectId: targetProjectId,
                },
                importedDataset,
                [],
                "Imported dataset",
                true,
              );
              if (version) {
                importedDataset.version = version.version;
                importedDataset.versionId = version.id;
                await saveDataset(importedDataset, { projectId: targetProjectId, csv });
                setActive({
                  dataset: importedDataset,
                  rawDataset: importedDataset,
                  csv,
                  projectId: targetProjectId,
                });
              }
            } catch (error) {
              setSaveState("error");
              setLastSaveError(
                error instanceof Error
                  ? error.message
                  : "The initial dataset version could not be saved.",
              );
            }
          })
          .catch((err) => {
            console.warn("IndexedDB save failed, using fallback:", err);
            const stored = replaceCsv(targetProjectId, csv);
            update(targetProjectId, {
              status: "data-loaded",
              dataset: {
                id: importedDataset.id,
                name: importedDataset.name,
                rows: importedDataset.rows.length,
                columns: importedDataset.columns.length,
                source: importedDataset.source,
                stored,
              },
              cleaningSteps: [],
            });

            coordinator.queueDatasetSave(
              targetProjectId,
              {
                id: importedDataset.id,
                name: importedDataset.name,
                source: importedDataset.source,
                rows: importedDataset.rows.length,
                columns: importedDataset.columns.length,
                columnList: importedDataset.columns,
                cleaningSteps: [],
                csvContent: csv,
                revision: 0,
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
      setActive({ dataset: importedDataset, rawDataset: importedDataset, csv, projectId });
    },
    [setActive, update, createProject, user, preserveDatasetVersion],
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
      const openingUserId = user?.id ?? null;
      let p = loadProjectsForUser(openingUserId).find((x) => x.id === id);

      // If not in local projects list, check if available in cloud
      if (!p && isSupabaseConfigured()) {
        try {
          const cloudRecord = await getSupabaseClient().loadProject(id);
          if (
            userIdRef.current !== openingUserId ||
            !cloudRecord ||
            !openingUserId ||
            cloudRecord.user_id !== openingUserId
          ) {
            return { error: "Account changed while opening this project." };
          }
          if (cloudRecord) {
            const cloudProject: ProjectMeta = {
              id: cloudRecord.id,
              userId: openingUserId,
              name: cloudRecord.name,
              ...(cloudRecord.objective !== undefined
                ? { description: cloudRecord.objective, objective: cloudRecord.objective }
                : {}),
              createdAt: cloudRecord.created_at,
              updatedAt: cloudRecord.updated_at,
              status: (cloudRecord.status as ProjectStatus) || "no-data",
              dataset: cloudRecord.dataset_name
                ? {
                    ...(cloudRecord.dataset_id ? { id: cloudRecord.dataset_id } : {}),
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
              revision: cloudRecord.revision ?? 1,
              datasetRevision: cloudRecord.dataset_revision ?? 0,
            };
            p = cloudProject;
            commit([cloudProject, ...loadProjects()]);
          }
        } catch {
          // ignore
        }
      }

      if (!p) return { error: "Project not found." };
      if (userIdRef.current !== openingUserId) {
        return { error: "Account changed while opening this project." };
      }

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
          if (userIdRef.current !== openingUserId) {
            return { error: "Account changed while opening this project." };
          }
          const rawDataset: Dataset = {
            id: stored.id,
            ...(stored.version !== undefined ? { version: stored.version } : {}),
            ...(stored.versionId !== undefined ? { versionId: stored.versionId } : {}),
            name: stored.name,
            source: stored.source,
            columns: stored.columns,
            rows: stored.rows,
            sizeBytes: stored.sizeBytes,
            warnings: stored.warnings ?? [],
            ...(stored.delimiter !== undefined ? { delimiter: stored.delimiter } : {}),
            ...(stored.typeOverrides !== undefined ? { typeOverrides: stored.typeOverrides } : {}),
          };

          let analyticalDataset = rawDataset;
          if (projectCleaningSteps.length > 0) {
            const replayed = replayCleaningSteps(rawDataset, projectCleaningSteps);
            analyticalDataset = replayed.dataset;
          }
          const versions = await loadProjectDatasetVersions(id, openingUserId);
          const currentVersion = versions.find((version) => version.datasetId === rawDataset.id);
          if (currentVersion) {
            analyticalDataset = {
              ...analyticalDataset,
              version: currentVersion.version,
              versionId: currentVersion.id,
            };
          }
          setDatasetVersions(versions);

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
          if (
            userIdRef.current !== openingUserId ||
            (cloudRecord && cloudRecord.user_id !== openingUserId)
          ) {
            return { error: "Account changed while opening this project." };
          }
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
      if (userIdRef.current !== openingUserId) {
        return { error: "Account changed while opening this project." };
      }

      const rawDataset = res.dataset;
      let analyticalDataset = rawDataset;
      if (projectCleaningSteps.length > 0) {
        const replayed = replayCleaningSteps(rawDataset, projectCleaningSteps);
        analyticalDataset = replayed.dataset;
      }
      const versions = await loadProjectDatasetVersions(id, openingUserId);
      const currentVersion = versions.find((version) => version.datasetId === rawDataset.id);
      if (currentVersion) {
        analyticalDataset = {
          ...analyticalDataset,
          version: currentVersion.version,
          versionId: currentVersion.id,
        };
      }
      setDatasetVersions(versions);

      // Cache in IndexedDB in background
      saveDataset(rawDataset, { projectId: id, csv }).catch(() => {});

      setActive({ dataset: analyticalDataset, rawDataset, csv, projectId: id });
      return {};
    },
    [setActive, commit, user],
  );

  const renameProject = useCallback(
    (id: string, name: string) => {
      update(id, { name: name.trim() || "Untitled project" });
    },
    [update],
  );

  const duplicateProject = useCallback(
    (id: string): ProjectMeta | null => {
      if (!loadProjectsForUser(user?.id ?? null).some((project) => project.id === id)) {
        return null;
      }
      const copy = duplicateProjectPersistence(id);
      if (copy) {
        setProjects(loadProjectsForUser(user?.id ?? null));
        const source = loadProjectsForUser(user?.id ?? null).find((p) => p.id === id);
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
      const p = loadProjectsForUser(user?.id ?? null).find((x) => x.id === id);
      if (!p) return;
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
    async (type: CleaningStepType, params: Record<string, unknown>) => {
      const cur = activeRef.current;
      if (!cur) return { success: false, error: "No active dataset." };

      try {
        const { dataset: nextDs, step } = applyCleaningStep(cur.dataset, type, params);
        const contentChanged =
          JSON.stringify([cur.dataset.columns, cur.dataset.rows, cur.dataset.typeOverrides]) !==
          JSON.stringify([nextDs.columns, nextDs.rows, nextDs.typeOverrides]);
        let version = cur.dataset.version ?? 1;
        if (contentChanged && cur.projectId) {
          await preserveDatasetVersion(
            cur,
            cur.dataset,
            cleaningStepsRef.current,
            step.description,
          );
          const nextVersion = await preserveDatasetVersion(
            cur,
            nextDs,
            [...cleaningStepsRef.current, step],
            step.description,
            true,
          );
          version = nextVersion?.version ?? version + 1;
        }
        const versionedDataset = { ...nextDs, version };
        const nextSteps = [...cleaningStepsRef.current, step];
        setCleaningSteps(nextSteps);
        cleaningStepsRef.current = nextSteps;

        setActive({
          ...cur,
          dataset: versionedDataset,
        });

        if (cur.projectId) {
          update(cur.projectId, {
            cleaningSteps: nextSteps,
            dataset: cur.dataset
              ? {
                  ...cur.dataset,
                  name: versionedDataset.name,
                  rows: versionedDataset.rows.length,
                  columns: versionedDataset.columns.length,
                  source: versionedDataset.source,
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
              revision:
                loadProjects().find((project) => project.id === cur.projectId)?.datasetRevision ??
                0,
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
    [setActive, update, user, preserveDatasetVersion],
  );

  const undoCleaning = useCallback(async () => {
    const cur = activeRef.current;
    if (!cur || cleaningStepsRef.current.length === 0) return;

    const nextSteps = cleaningStepsRef.current.slice(0, -1);
    const { dataset: replayedDataset } = replayCleaningSteps(cur.rawDataset, nextSteps);
    await preserveDatasetVersion(
      cur,
      cur.dataset,
      cleaningStepsRef.current,
      "Undid the last transformation",
    );
    const savedVersion = await preserveDatasetVersion(
      cur,
      replayedDataset,
      nextSteps,
      "Undid the last transformation",
      true,
    );
    const restoredDataset: Dataset = {
      ...replayedDataset,
      ...(savedVersion
        ? { version: savedVersion.version, versionId: savedVersion.id }
        : cur.dataset.version !== undefined
          ? {
              version: cur.dataset.version,
              ...(cur.dataset.versionId ? { versionId: cur.dataset.versionId } : {}),
            }
          : {}),
    };

    setCleaningSteps(nextSteps);
    cleaningStepsRef.current = nextSteps;

    setActive({
      ...cur,
      dataset: restoredDataset,
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
          revision:
            loadProjects().find((project) => project.id === cur.projectId)?.datasetRevision ?? 0,
        },
        user?.id,
        { immediate: false },
      );
    }
  }, [setActive, update, user, preserveDatasetVersion]);

  const resetCleaning = useCallback(async () => {
    const cur = activeRef.current;
    if (!cur) return;
    await preserveDatasetVersion(
      cur,
      cur.dataset,
      cleaningStepsRef.current,
      "Reset transformations to the imported dataset",
    );
    const savedVersion = await preserveDatasetVersion(
      cur,
      cur.rawDataset,
      [],
      "Reset transformations to the imported dataset",
      true,
    );
    const restoredDataset = {
      ...cur.rawDataset,
      version: savedVersion?.version ?? 1,
      ...(savedVersion?.id
        ? { versionId: savedVersion.id }
        : cur.rawDataset.versionId
          ? { versionId: cur.rawDataset.versionId }
          : {}),
    };

    setCleaningSteps([]);
    cleaningStepsRef.current = [];

    setActive({
      ...cur,
      dataset: restoredDataset,
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
          revision:
            loadProjects().find((project) => project.id === cur.projectId)?.datasetRevision ?? 0,
        },
        user?.id,
        { immediate: false },
      );
    }
  }, [setActive, update, user, preserveDatasetVersion]);

  const restoreDatasetVersion = useCallback(
    async (versionId: string): Promise<{ success: boolean; error?: string }> => {
      const current = activeRef.current;
      if (!current?.projectId)
        return { success: false, error: "Open a project before restoring a version." };
      try {
        let version = await loadDatasetVersion(versionId);
        if (!version && user?.id) {
          const remote = await getSupabaseClient().downloadDatasetVersionRecord(versionId, user.id);
          if (!remote) return { success: false, error: "This saved version is not available." };
          version = await saveDatasetVersion({
            id: remote.metadata.id,
            version: remote.metadata.version,
            force: true,
            projectId: current.projectId,
            userId: remote.metadata.userId,
            dataset: {
              id: remote.dataset.id,
              name: remote.dataset.name,
              source: remote.dataset.source,
              columns: remote.dataset.columns,
              rows: remote.dataset.rows,
              sizeBytes: remote.dataset.sizeBytes,
              warnings: remote.dataset.warnings,
              ...(remote.dataset.delimiter !== undefined
                ? { delimiter: remote.dataset.delimiter }
                : {}),
              ...(remote.dataset.typeOverrides !== undefined
                ? { typeOverrides: remote.dataset.typeOverrides }
                : {}),
            },
            cleaningSteps: remote.metadata.cleaningSteps,
            description: remote.metadata.description,
          });
        }
        if (!version || version.projectId !== current.projectId) {
          return { success: false, error: "That version does not belong to this project." };
        }
        await preserveDatasetVersion(
          current,
          current.dataset,
          cleaningStepsRef.current,
          "Current data before restoring an earlier version",
        );
        const restoredCsv =
          version.dataset.csv ?? toCsv([version.dataset.columns, ...version.dataset.rows]);
        const restored: Dataset = {
          id: current.dataset.id,
          name: version.dataset.name,
          source: version.dataset.source,
          columns: version.dataset.columns,
          rows: version.dataset.rows.map((row) => [...row]),
          sizeBytes: version.dataset.sizeBytes,
          warnings: [...version.dataset.warnings],
          ...(version.dataset.delimiter !== undefined
            ? { delimiter: version.dataset.delimiter }
            : {}),
          ...(version.dataset.typeOverrides !== undefined
            ? { typeOverrides: version.dataset.typeOverrides }
            : {}),
        };
        const restoredVersion = await preserveDatasetVersion(
          current,
          restored,
          [],
          `Restored version ${version.version}`,
          true,
        );
        restored.version = restoredVersion?.version ?? version.version + 1;
        if (restoredVersion) restored.versionId = restoredVersion.id;
        await saveDataset(restored, { projectId: current.projectId, csv: restoredCsv });
        setCleaningSteps([]);
        cleaningStepsRef.current = [];
        setActive({
          dataset: restored,
          rawDataset: restored,
          csv: restoredCsv,
          projectId: current.projectId,
        });
        update(current.projectId, {
          status: "data-loaded",
          cleaningSteps: [],
          dataset: {
            id: restored.id,
            name: restored.name,
            rows: restored.rows.length,
            columns: restored.columns.length,
            source: restored.source,
            stored: true,
          },
        });
        coordinator.queueDatasetSave(
          current.projectId,
          {
            id: restored.id,
            name: restored.name,
            source: restored.source,
            rows: restored.rows.length,
            columns: restored.columns.length,
            columnList: restored.columns,
            cleaningSteps: [],
            csvContent: restoredCsv,
            revision:
              loadProjects().find((project) => project.id === current.projectId)?.datasetRevision ??
              0,
          },
          user?.id,
          { immediate: true },
        );
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error:
            error instanceof Error ? error.message : "The saved version could not be restored.",
        };
      }
    },
    [preserveDatasetVersion, setActive, update, user],
  );

  const resolvePersistenceConflict = useCallback(
    async (
      conflictId: string,
      resolution: "keep-local" | "use-saved",
    ): Promise<{ success: boolean; error?: string }> => {
      const conflict = persistenceConflicts.find((entry) => entry.id === conflictId);
      if (!conflict || !user?.id || conflict.userId !== user.id) {
        return { success: false, error: "This recovery choice is no longer available." };
      }
      if (
        resolution === "use-saved" &&
        conflict.entityType === "dataset" &&
        !conflict.remoteVersionId
      ) {
        return {
          success: false,
          error: "The newer saved data could not be recovered on this device.",
        };
      }

      try {
        if (resolution === "keep-local") {
          await coordinator.keepLocalConflict(conflict);
        } else {
          await coordinator.discardLocalConflict(conflict);
          if (conflict.entityType === "dataset") {
            updateProjectRevision(conflict.projectId, user.id, "dataset", conflict.remoteRevision);
            const remoteVersionId = conflict.remoteVersionId;
            if (!remoteVersionId) {
              return {
                success: false,
                error: "The newer saved data could not be recovered on this device.",
              };
            }
            const restored = await restoreDatasetVersion(remoteVersionId);
            if (!restored.success) return restored;
          } else if (conflict.entityType === "project" && conflict.remoteSnapshot) {
            const snapshot = conflict.remoteSnapshot;
            const currentProjects = loadProjects();
            const nextProjects = currentProjects.map((project) =>
              project.id === conflict.projectId && project.userId === user.id
                ? {
                    ...project,
                    name: String(snapshot["name"] ?? project.name),
                    ...(typeof snapshot["description"] === "string"
                      ? { description: snapshot["description"] }
                      : {}),
                    ...(typeof snapshot["objective"] === "string"
                      ? { objective: snapshot["objective"] }
                      : {}),
                    status: (snapshot["status"] as ProjectStatus) ?? project.status,
                    revision: conflict.remoteRevision,
                    isCloudSynced: true,
                    updatedAt: String(snapshot["updated_at"] ?? project.updatedAt),
                  }
                : project,
            );
            if (!saveProjects(nextProjects)) {
              return { success: false, error: "The saved project copy could not be restored." };
            }
            setProjects(loadProjectsForUser(user.id));
          } else if (conflict.entityType === "analysis" && conflict.remoteSnapshot) {
            const snapshot = conflict.remoteSnapshot;
            const remoteAnalysis: SavedAnalysis = {
              id: conflict.entityId,
              revision: conflict.remoteRevision,
              name: String(snapshot["name"] ?? "Saved analysis"),
              type: snapshot["type"] as SavedAnalysis["type"],
              timestamp: String(snapshot["created_at"] ?? conflict.createdAt),
              datasetId: typeof snapshot["dataset_id"] === "string" ? snapshot["dataset_id"] : "",
              ...(typeof snapshot["dataset_version"] === "number"
                ? { datasetVersion: snapshot["dataset_version"] }
                : {}),
              datasetName: String(snapshot["dataset_name"] ?? ""),
              datasetSignature: String(snapshot["dataset_signature"] ?? ""),
              variables: Array.isArray(snapshot["variables"])
                ? (snapshot["variables"] as string[])
                : [],
              configuration:
                (snapshot["configuration"] as Record<string, unknown> | undefined) ?? {},
              sampleSize: Number(snapshot["sample_size"]) || 0,
              missingCount: Number(snapshot["missing_count"]) || 0,
              missingHandling: String(snapshot["missing_handling"] ?? "exclude"),
              results: (snapshot["results"] as Record<string, unknown> | undefined) ?? {},
              interpretation:
                snapshot["interpretation"] && typeof snapshot["interpretation"] === "object"
                  ? (snapshot["interpretation"] as SavedAnalysis["interpretation"])
                  : {
                      observedResults: [],
                      statisticalInference: [],
                      assumptions: [],
                      limitations: [],
                      recommendations: [],
                    },
              methodNotes: Array.isArray(snapshot["method_notes"])
                ? (snapshot["method_notes"] as string[])
                : [],
            };
            const nextAnalyses = [
              remoteAnalysis,
              ...savedAnalysesRef.current.filter((entry) => entry.id !== remoteAnalysis.id),
            ];
            savedAnalysesRef.current = nextAnalyses;
            setSavedAnalyses(nextAnalyses);
            const nextProjects = loadProjects().map((project) =>
              project.id === conflict.projectId && project.userId === user.id
                ? { ...project, savedAnalyses: nextAnalyses }
                : project,
            );
            if (!saveProjects(nextProjects)) {
              return { success: false, error: "The saved analysis copy could not be restored." };
            }
          }
        }
        setPersistenceConflicts((previous) => previous.filter((entry) => entry.id !== conflictId));
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "The recovery choice could not be saved.",
        };
      }
    },
    [persistenceConflicts, restoreDatasetVersion, user],
  );

  // Saved Analyses handlers
  const saveAnalysis = useCallback(
    (analysis: SavedAnalysis) => {
      const cur = activeRef.current;
      const versionedAnalysis: SavedAnalysis = {
        ...analysis,
        ...(cur?.dataset.version !== undefined
          ? { datasetVersion: cur.dataset.version }
          : analysis.datasetVersion !== undefined
            ? { datasetVersion: analysis.datasetVersion }
            : {}),
        ...(cur?.dataset.versionId
          ? { datasetVersionId: cur.dataset.versionId }
          : analysis.datasetVersionId
            ? { datasetVersionId: analysis.datasetVersionId }
            : {}),
      };
      const next = [
        versionedAnalysis,
        ...savedAnalysesRef.current.filter((a) => a.id !== versionedAnalysis.id),
      ];
      setSavedAnalyses(next);
      savedAnalysesRef.current = next;

      if (cur?.projectId) {
        update(cur.projectId, {
          status: "analysed",
          savedAnalyses: next,
        });

        // Automatically persist analysis to database immediately
        coordinator.queueAnalysisSave(cur.projectId, versionedAnalysis, user?.id);
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
          ...(report.objective !== undefined ? { objective: report.objective } : {}),
          ...(report.summary !== undefined ? { summary: report.summary } : {}),
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
        if (userIdRef.current !== res.user.id) {
          clearAccountWorkingState();
          setProjects(loadProjectsForUser(res.user.id));
        }
        userIdRef.current = res.user.id;
        setUser(res.user);
        setPersona(res.user.persona);
        coordinator.init(res.user.id);
        setCloudSyncStatus((prev) => ({ ...prev, lastSyncedAt: nowIso() }));
      }
      return res;
    },
    [clearAccountWorkingState, setPersona],
  );

  const handleLogin = useCallback(
    async (email: string, pass: string) => {
      const res = await loginUser(email, pass);
      if (res.user) {
        if (userIdRef.current !== res.user.id) {
          clearAccountWorkingState();
          setProjects(loadProjectsForUser(res.user.id));
        }
        userIdRef.current = res.user.id;
        setUser(res.user);
        setPersona(res.user.persona);
        coordinator.init(res.user.id);
        setCloudSyncStatus((prev) => ({ ...prev, lastSyncedAt: nowIso() }));
      }
      return res;
    },
    [clearAccountWorkingState, setPersona],
  );

  const handleLogout = useCallback(() => {
    signOutUser().catch(() => {});
    userIdRef.current = null;
    coordinator.init(null);
    setUser(null);
    clearAccountWorkingState();
    setProjects(loadProjectsForUser(null));
  }, [clearAccountWorkingState]);

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
    const supabase = getSupabaseClient();
    if (!supabase.isConfigured()) {
      return { success: false, state: "not_configured", error: "Database not configured." };
    }
    if (!user || !isValidUuid(user.id)) {
      return { success: false, state: "not_authenticated", error: "Sign in required." };
    }

    await coordinator.flushQueue(true);
    if (coordinator.hasPendingWritesForUser(user.id)) {
      return {
        success: false,
        state: "failed",
        error: coordinator.getState().error || "Some account changes are still pending.",
      };
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
      const guestProjects = loadProjectsForUser(null);
      const result = await supabase.importLocalProjects(
        guestProjects,
        async (p) => {
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
        },
        {
          getDatasetVersions: async (project): Promise<StoredDatasetVersion[]> => {
            const metadata = await listDatasetVersions(project.id);
            const versions = await Promise.all(
              metadata.map((version) => loadDatasetVersion(version.id)),
            );
            return versions.filter((version): version is StoredDatasetVersion => version !== null);
          },
        },
      );

      if (result.success && result.projects.length > 0) {
        const importedUuids = new Set(result.projects.map((p) => p.id));
        const now = nowIso();
        const updated = loadProjects().map((p) => {
          const uId = toValidUuid(p.id);
          if (!p.userId && importedUuids.has(uId)) {
            const { cloudSyncError: _cloudSyncError, ...projectWithoutSyncError } = p;
            return {
              ...projectWithoutSyncError,
              id: uId,
              ...(user?.id ? { userId: user.id } : {}),
              isCloudSynced: true,
              cloudSyncedAt: now,
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

  useEffect(() => {
    let activeRequest = true;
    if (!activeProjectId) {
      setDatasetVersions([]);
      setPersistenceConflicts([]);
      return () => {
        activeRequest = false;
      };
    }

    const loadVersions = async () => {
      try {
        const availableVersions = await loadProjectDatasetVersions(
          activeProjectId,
          user?.id ?? null,
        );
        const localConflicts = user?.id
          ? await listLocalPersistenceConflicts(activeProjectId, user.id)
          : [];
        if (!activeRequest || userIdRef.current !== (user?.id ?? null)) return;
        setDatasetVersions(availableVersions);
        setPersistenceConflicts(localConflicts);
      } catch (error) {
        console.warn("Could not load recovery history:", error);
      }
    };

    void loadVersions();
    return () => {
      activeRequest = false;
    };
  }, [activeProjectId, active?.dataset.id, user?.id, persistenceState.status]);

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
    datasetVersions,
    persistenceConflicts,
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
    restoreDatasetVersion,
    resolvePersistenceConflict,
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

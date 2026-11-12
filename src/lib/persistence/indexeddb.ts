/**
 * Pure IndexedDB persistence adapter for Lumetra.
 * Adheres strictly to AGENTS.md:
 * - Pure persistence module under src/lib/persistence/
 * - Supports large datasets up to the 20 MB import limit
 * - Preserves missing values as null (never coerced to zero)
 * - Safe versioned schema with atomic multi-store updates
 * - Handles quota errors, blocked upgrades, and storage estimation
 */

import type { Cell, ColumnType, Dataset } from "../data/types";
import { parseCsvText } from "../data/parse";
import { toCsv } from "../data/export";
import { loadProjects, saveProjects, type ProjectMeta } from "./projects";

export const DB_NAME = "lumetra_storage";
export const DB_VERSION = 2;
export const DATASETS_STORE = "datasets";
export const METADATA_STORE = "dataset_meta";
export const DATASET_VERSIONS_STORE = "dataset_versions";
export const DATASET_VERSION_METADATA_STORE = "dataset_version_meta";
export const PERSISTENCE_CONFLICTS_STORE = "persistence_conflicts";
export const MAX_INDEXEDDB_DATASET_BYTES = 20 * 1024 * 1024; // 20 MB limit? why 20mb limit?

export interface StoredDataset {
  id: string;
  version?: number;
  versionId?: string;
  projectId?: string;
  name: string;
  source: "upload" | "sample";
  columns: string[];
  rows: Cell[][];
  sizeBytes: number;
  warnings: string[];
  delimiter?: string;
  typeOverrides?: Record<string, ColumnType>;
  csv?: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoredDatasetMeta {
  id: string;
  projectId?: string;
  name: string;
  source: "upload" | "sample";
  columnCount: number;
  rowCount: number;
  sizeBytes: number;
  columns: string[];
  delimiter?: string;
  hasCsv: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DatasetVersionMetadata {
  id: string;
  projectId: string;
  datasetId: string;
  userId: string | null;
  version: number;
  contentHash: string;
  createdAt: string;
  description: string;
  cleaningSteps: unknown[];
}

export interface StoredDatasetVersion extends DatasetVersionMetadata {
  dataset: StoredDataset;
}

export interface LocalPersistenceConflict {
  id: string;
  userId: string;
  projectId: string;
  entityType: "project" | "dataset" | "analysis" | "report";
  entityId: string;
  expectedRevision: number;
  remoteRevision: number;
  localVersionId?: string;
  remoteVersionId?: string;
  remoteSnapshot?: Record<string, unknown>;
  createdAt: string;
}

export type PersistenceErrorType =
  | "NOT_FOUND"
  | "QUOTA_EXCEEDED"
  | "BLOCKED"
  | "UPGRADE_FAILED"
  | "DATABASE_ERROR"
  | "UNAVAILABLE"
  | "VERIFICATION_FAILED";

export class PersistenceError extends Error {
  constructor(
    public readonly type: PersistenceErrorType,
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "PersistenceError";
  }
}

export interface StorageEstimateInfo {
  usage: number;
  quota: number;
  percentUsed: number;
  available: number;
  isEstimate: boolean;
}

export interface MigrationResult {
  success: boolean;
  migrated: number;
  skipped: number;
  errors: string[];
}

let cachedDb: IDBDatabase | null = null;
let dbOpeningPromise: Promise<IDBDatabase> | null = null;

/** Check whether IndexedDB is available in the current environment */
export function isIndexedDbSupported(): boolean {
  try {
    return (
      typeof window !== "undefined" &&
      typeof window.indexedDB !== "undefined" &&
      window.indexedDB !== null
    );
  } catch {
    return false;
  }
}

/** Open or retrieve cached IndexedDB connection */
export function openDatabase(): Promise<IDBDatabase> {
  if (cachedDb) {
    return Promise.resolve(cachedDb);
  }
  if (dbOpeningPromise) {
    return dbOpeningPromise;
  }

  if (!isIndexedDbSupported()) {
    return Promise.reject(
      new PersistenceError(
        "UNAVAILABLE",
        "IndexedDB is not supported or is disabled in this environment.",
      ),
    );
  }

  dbOpeningPromise = new Promise<IDBDatabase>((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = window.indexedDB.open(DB_NAME, DB_VERSION);
    } catch (err) {
      dbOpeningPromise = null;
      return reject(
        new PersistenceError(
          "DATABASE_ERROR",
          err instanceof Error ? err.message : "Failed to open IndexedDB",
          err,
        ),
      );
    }

    request.onblocked = (event) => {
      console.warn("IndexedDB upgrade blocked by another connection:", event);
    };

    request.onerror = () => {
      dbOpeningPromise = null;
      const err = request.error;
      reject(
        new PersistenceError(
          "DATABASE_ERROR",
          err ? err.message : "Unknown IndexedDB opening error",
          err,
        ),
      );
    };

    request.onupgradeneeded = (event) => {
      const db = request.result;
      // Store 1: Full structured dataset records + CSV
      if (!db.objectStoreNames.contains(DATASETS_STORE)) {
        const datasetStore = db.createObjectStore(DATASETS_STORE, { keyPath: "id" });
        datasetStore.createIndex("projectId", "projectId", { unique: false });
        datasetStore.createIndex("updatedAt", "updatedAt", { unique: false });
      }

      // Store 2: Lightweight dataset metadata (fast listing without reading all rows)
      if (!db.objectStoreNames.contains(METADATA_STORE)) {
        const metaStore = db.createObjectStore(METADATA_STORE, { keyPath: "id" });
        metaStore.createIndex("projectId", "projectId", { unique: false });
        metaStore.createIndex("updatedAt", "updatedAt", { unique: false });
      }

      if (!db.objectStoreNames.contains(DATASET_VERSIONS_STORE)) {
        const versionsStore = db.createObjectStore(DATASET_VERSIONS_STORE, { keyPath: "id" });
        versionsStore.createIndex("projectId", "projectId", { unique: false });
        versionsStore.createIndex("datasetId", "datasetId", { unique: false });
      }

      if (!db.objectStoreNames.contains(DATASET_VERSION_METADATA_STORE)) {
        const versionMetaStore = db.createObjectStore(DATASET_VERSION_METADATA_STORE, {
          keyPath: "id",
        });
        versionMetaStore.createIndex("projectId", "projectId", { unique: false });
        versionMetaStore.createIndex("datasetId", "datasetId", { unique: false });
      }

      if (!db.objectStoreNames.contains(PERSISTENCE_CONFLICTS_STORE)) {
        const conflictsStore = db.createObjectStore(PERSISTENCE_CONFLICTS_STORE, {
          keyPath: "id",
        });
        conflictsStore.createIndex("projectId", "projectId", { unique: false });
        conflictsStore.createIndex("userId", "userId", { unique: false });
      }
    };

    request.onsuccess = () => {
      dbOpeningPromise = null;
      const db = request.result;
      cachedDb = db;

      db.onversionchange = () => {
        // If another tab upgrades the database, close this connection cleanly
        db.close();
        cachedDb = null;
      };

      db.onclose = () => {
        cachedDb = null;
      };

      resolve(db);
    };
  });

  return dbOpeningPromise;
}

export function hashDataset(dataset: Dataset): string {
  const content = JSON.stringify({
    columns: dataset.columns,
    rows: dataset.rows,
    typeOverrides: dataset.typeOverrides ?? null,
  });
  let first = 0x811c9dc5;
  let second = 0x01000193;
  for (let i = 0; i < content.length; i++) {
    const code = content.charCodeAt(i);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}`;
}

function createVersionId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

export async function saveDatasetVersion(input: {
  id?: string;
  version?: number;
  force?: boolean;
  projectId: string;
  userId: string | null;
  dataset: Dataset;
  cleaningSteps: unknown[];
  description: string;
}): Promise<StoredDatasetVersion> {
  const db = await openDatabase();
  const existing = await listDatasetVersions(input.projectId, input.dataset.id);
  const contentHash = hashDataset(input.dataset);
  const cleaningStepsJson = JSON.stringify(input.cleaningSteps);
  const latest = existing[0];
  if (
    !input.force &&
    latest?.contentHash === contentHash &&
    JSON.stringify(latest.cleaningSteps) === cleaningStepsJson
  ) {
    const savedLatest = await loadDatasetVersion(latest.id);
    if (savedLatest) return savedLatest;
  }
  const now = new Date().toISOString();
  const version = input.version ?? (latest?.version ?? 0) + 1;
  const id = input.id ?? createVersionId();
  const dataset: StoredDataset = {
    ...input.dataset,
    version,
    versionId: id,
    projectId: input.projectId,
    rows: input.dataset.rows.map((row) => [...row]),
    columns: [...input.dataset.columns],
    warnings: [...input.dataset.warnings],
    csv: toCsv([input.dataset.columns, ...input.dataset.rows]),
    createdAt: now,
    updatedAt: now,
  };
  const metadata: DatasetVersionMetadata = {
    id,
    projectId: input.projectId,
    datasetId: input.dataset.id,
    userId: input.userId,
    version,
    contentHash,
    createdAt: now,
    description: input.description,
    cleaningSteps: structuredClone(input.cleaningSteps),
  };
  const record: StoredDatasetVersion = { ...metadata, dataset };

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(
      [DATASET_VERSIONS_STORE, DATASET_VERSION_METADATA_STORE],
      "readwrite",
    );
    tx.oncomplete = () => resolve();
    tx.onerror = () =>
      reject(new PersistenceError("DATABASE_ERROR", "Could not save dataset version.", tx.error));
    tx.onabort = () =>
      reject(
        new PersistenceError("DATABASE_ERROR", "Dataset version save was interrupted.", tx.error),
      );
    tx.objectStore(DATASET_VERSIONS_STORE).put(record);
    tx.objectStore(DATASET_VERSION_METADATA_STORE).put(metadata);
  });
  return record;
}

export async function loadDatasetVersion(id: string): Promise<StoredDatasetVersion | null> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([DATASET_VERSIONS_STORE], "readonly");
    const request = tx.objectStore(DATASET_VERSIONS_STORE).get(id);
    request.onsuccess = () => {
      const version = request.result as StoredDatasetVersion | undefined;
      if (version && hashDataset(version.dataset) !== version.contentHash) {
        reject(
          new PersistenceError(
            "VERIFICATION_FAILED",
            "The saved dataset content does not match its version details.",
          ),
        );
        return;
      }
      resolve(version ?? null);
    };
    request.onerror = () =>
      reject(
        new PersistenceError("DATABASE_ERROR", "Could not load dataset version.", request.error),
      );
  });
}

export async function cacheDatasetVersionMetadata(metadata: DatasetVersionMetadata): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([DATASET_VERSION_METADATA_STORE], "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () =>
      reject(new PersistenceError("DATABASE_ERROR", "Could not cache version details.", tx.error));
    tx.objectStore(DATASET_VERSION_METADATA_STORE).put(metadata);
  });
}

export async function listDatasetVersions(
  projectId: string,
  datasetId?: string,
): Promise<DatasetVersionMetadata[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([DATASET_VERSION_METADATA_STORE], "readonly");
    const store = tx.objectStore(DATASET_VERSION_METADATA_STORE);
    const request = datasetId
      ? store.index("datasetId").getAll(datasetId)
      : store.index("projectId").getAll(projectId);
    request.onsuccess = () => {
      const records = (request.result as DatasetVersionMetadata[]).filter(
        (record) => record.projectId === projectId,
      );
      records.sort((a, b) => b.version - a.version || b.createdAt.localeCompare(a.createdAt));
      resolve(records);
    };
    request.onerror = () =>
      reject(
        new PersistenceError("DATABASE_ERROR", "Could not list dataset versions.", request.error),
      );
  });
}

export async function saveLocalPersistenceConflict(
  conflict: LocalPersistenceConflict,
): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([PERSISTENCE_CONFLICTS_STORE], "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () =>
      reject(
        new PersistenceError("DATABASE_ERROR", "Could not save the recovery record.", tx.error),
      );
    tx.objectStore(PERSISTENCE_CONFLICTS_STORE).put(conflict);
  });
}

export async function listLocalPersistenceConflicts(
  projectId: string,
  userId: string,
): Promise<LocalPersistenceConflict[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([PERSISTENCE_CONFLICTS_STORE], "readonly");
    const request = tx
      .objectStore(PERSISTENCE_CONFLICTS_STORE)
      .index("projectId")
      .getAll(projectId);
    request.onsuccess = () =>
      resolve(
        (request.result as LocalPersistenceConflict[]).filter((record) => record.userId === userId),
      );
    request.onerror = () =>
      reject(
        new PersistenceError("DATABASE_ERROR", "Could not load recovery records.", request.error),
      );
  });
}

export async function deleteLocalPersistenceConflict(id: string): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([PERSISTENCE_CONFLICTS_STORE], "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () =>
      reject(
        new PersistenceError("DATABASE_ERROR", "Could not clear the recovery record.", tx.error),
      );
    tx.objectStore(PERSISTENCE_CONFLICTS_STORE).delete(id);
  });
}

/** Close cached database connection (useful during tests or reset) */
export function closeDatabase(): void {
  if (cachedDb) {
    cachedDb.close();
    cachedDb = null;
  }
  dbOpeningPromise = null;
}

/** Query browser storage estimate */
export async function getStorageEstimate(): Promise<StorageEstimateInfo | null> {
  if (
    typeof navigator === "undefined" ||
    !navigator.storage ||
    typeof navigator.storage.estimate !== "function"
  ) {
    return null;
  }
  try {
    const est = await navigator.storage.estimate();
    const usage = est.usage ?? 0;
    const quota = est.quota ?? 0;
    const available = Math.max(0, quota - usage);
    const percentUsed = quota > 0 ? (usage / quota) * 100 : 0;
    return {
      usage,
      quota,
      available,
      percentUsed,
      isEstimate: true,
    };
  } catch {
    return null;
  }
}

/** Check if there is enough space before large writes */
export async function checkStorageAvailable(
  bytesNeeded: number,
): Promise<{ ok: boolean; warning?: string; estimate?: StorageEstimateInfo | null }> {
  const estimate = await getStorageEstimate();
  if (!estimate) {
    return { ok: true, estimate: null };
  }

  if (estimate.quota > 0 && estimate.available < bytesNeeded) {
    return {
      ok: false,
      warning: `Estimated available browser storage (${(estimate.available / (1024 * 1024)).toFixed(1)} MB) is insufficient for this dataset (${(bytesNeeded / (1024 * 1024)).toFixed(1)} MB).`,
      estimate,
    };
  }

  if (estimate.percentUsed > 90) {
    return {
      ok: true,
      warning: `Browser storage is ${estimate.percentUsed.toFixed(0)}% full. Consider removing unused projects or exporting your analyses.`,
      estimate,
    };
  }

  return { ok: true, estimate };
}

function extractMeta(record: StoredDataset): StoredDatasetMeta {
  return {
    id: record.id,
    ...(record.projectId !== undefined ? { projectId: record.projectId } : {}),
    name: record.name,
    source: record.source,
    columnCount: record.columns.length,
    rowCount: record.rows.length,
    sizeBytes: record.sizeBytes,
    columns: record.columns,
    ...(record.delimiter !== undefined ? { delimiter: record.delimiter } : {}),
    hasCsv: Boolean(record.csv),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/**
 * Save a dataset to IndexedDB.
 * Updates both the full record and metadata store atomically.
 */
export async function saveDataset(
  dataset: Dataset,
  options?: { projectId?: string; csv?: string; createdAt?: string },
): Promise<StoredDataset> {
  const db = await openDatabase();
  const now = new Date().toISOString();

  const record: StoredDataset = {
    id: dataset.id,
    ...(dataset.version !== undefined ? { version: dataset.version } : {}),
    ...(dataset.versionId !== undefined ? { versionId: dataset.versionId } : {}),
    ...(options?.projectId !== undefined ? { projectId: options.projectId } : {}),
    name: dataset.name,
    source: dataset.source,
    columns: dataset.columns,
    rows: dataset.rows,
    sizeBytes: dataset.sizeBytes,
    warnings: dataset.warnings,
    ...(dataset.delimiter !== undefined ? { delimiter: dataset.delimiter } : {}),
    ...(dataset.typeOverrides !== undefined ? { typeOverrides: dataset.typeOverrides } : {}),
    ...(options?.csv !== undefined ? { csv: options.csv } : {}),
    createdAt: options?.createdAt ?? now,
    updatedAt: now,
  };

  const meta = extractMeta(record);

  return new Promise<StoredDataset>((resolve, reject) => {
    let tx: IDBTransaction;
    try {
      tx = db.transaction([DATASETS_STORE, METADATA_STORE], "readwrite");
    } catch (err) {
      return reject(
        new PersistenceError(
          "DATABASE_ERROR",
          err instanceof Error ? err.message : "Failed to begin transaction",
          err,
        ),
      );
    }

    tx.onabort = () => {
      const error = tx.error;
      const isQuota =
        error &&
        (error.name === "QuotaExceededError" ||
          error.message.includes("quota") ||
          error.name.includes("Quota"));
      if (isQuota) {
        reject(
          new PersistenceError(
            "QUOTA_EXCEEDED",
            "Browser local storage quota was exceeded while saving the dataset.",
            error,
          ),
        );
      } else {
        reject(
          new PersistenceError(
            "DATABASE_ERROR",
            error ? error.message : "Transaction aborted",
            error,
          ),
        );
      }
    };

    tx.onerror = () => {
      const error = tx.error;
      const isQuota =
        error &&
        (error.name === "QuotaExceededError" ||
          error.message.includes("quota") ||
          error.name.includes("Quota"));
      if (isQuota) {
        reject(
          new PersistenceError(
            "QUOTA_EXCEEDED",
            "Browser local storage quota was exceeded while saving the dataset.",
            error,
          ),
        );
      } else {
        reject(
          new PersistenceError(
            "DATABASE_ERROR",
            error ? error.message : "Transaction error",
            error,
          ),
        );
      }
    };

    tx.oncomplete = () => {
      resolve(record);
    };

    try {
      const datasetStore = tx.objectStore(DATASETS_STORE);
      const metaStore = tx.objectStore(METADATA_STORE);
      datasetStore.put(record);
      metaStore.put(meta);
    } catch (err) {
      try {
        tx.abort();
      } catch {
        // Ignored
      }
      reject(
        new PersistenceError(
          "DATABASE_ERROR",
          err instanceof Error ? err.message : "Failed to put dataset record",
          err,
        ),
      );
    }
  });
}

/** Load dataset by stable dataset identifier */
export async function loadDataset(id: string): Promise<StoredDataset | null> {
  const db = await openDatabase();
  return new Promise<StoredDataset | null>((resolve, reject) => {
    let tx: IDBTransaction;
    try {
      tx = db.transaction([DATASETS_STORE], "readonly");
    } catch (err) {
      return reject(
        new PersistenceError(
          "DATABASE_ERROR",
          err instanceof Error ? err.message : "Failed to open transaction",
          err,
        ),
      );
    }

    const store = tx.objectStore(DATASETS_STORE);
    const request = store.get(id);

    request.onsuccess = () => {
      const res = request.result as StoredDataset | undefined;
      resolve(res ?? null);
    };

    request.onerror = () => {
      reject(
        new PersistenceError(
          "DATABASE_ERROR",
          request.error?.message ?? "Error loading dataset",
          request.error,
        ),
      );
    };
  });
}

/** Load dataset by associated projectId */
export async function loadDatasetByProject(projectId: string): Promise<StoredDataset | null> {
  const db = await openDatabase();
  return new Promise<StoredDataset | null>((resolve, reject) => {
    let tx: IDBTransaction;
    try {
      tx = db.transaction([DATASETS_STORE], "readonly");
    } catch (err) {
      return reject(
        new PersistenceError(
          "DATABASE_ERROR",
          err instanceof Error ? err.message : "Failed to open transaction",
          err,
        ),
      );
    }

    const store = tx.objectStore(DATASETS_STORE);
    const index = store.index("projectId");
    const request = index.get(projectId);

    request.onsuccess = () => {
      const res = request.result as StoredDataset | undefined;
      resolve(res ?? null);
    };

    request.onerror = () => {
      reject(
        new PersistenceError(
          "DATABASE_ERROR",
          request.error?.message ?? "Error querying dataset by project ID",
          request.error,
        ),
      );
    };
  });
}

/**
 * Update an existing dataset record.
 * Merges patch, preserves existing data if write fails.
 */
export async function updateDataset(
  id: string,
  patch: Partial<Omit<StoredDataset, "id">>,
): Promise<StoredDataset> {
  const current = await loadDataset(id);
  if (!current) {
    throw new PersistenceError("NOT_FOUND", `Dataset with id "${id}" was not found.`);
  }

  const updated: StoredDataset = {
    ...current,
    ...patch,
    id: current.id,
    updatedAt: new Date().toISOString(),
  };

  const db = await openDatabase();
  const meta = extractMeta(updated);

  return new Promise<StoredDataset>((resolve, reject) => {
    let tx: IDBTransaction;
    try {
      tx = db.transaction([DATASETS_STORE, METADATA_STORE], "readwrite");
    } catch (err) {
      return reject(
        new PersistenceError(
          "DATABASE_ERROR",
          err instanceof Error ? err.message : "Failed to open transaction",
          err,
        ),
      );
    }

    tx.onabort = () => {
      const error = tx.error;
      const isQuota =
        error &&
        (error.name === "QuotaExceededError" ||
          error.message.includes("quota") ||
          error.name.includes("Quota"));
      if (isQuota) {
        reject(
          new PersistenceError(
            "QUOTA_EXCEEDED",
            "Storage quota exceeded while updating dataset.",
            error,
          ),
        );
      } else {
        reject(
          new PersistenceError(
            "DATABASE_ERROR",
            error ? error.message : "Update transaction aborted",
            error,
          ),
        );
      }
    };

    tx.onerror = () => {
      reject(
        new PersistenceError(
          "DATABASE_ERROR",
          tx.error?.message ?? "Failed to update dataset",
          tx.error,
        ),
      );
    };

    tx.oncomplete = () => {
      resolve(updated);
    };

    const datasetStore = tx.objectStore(DATASETS_STORE);
    const metaStore = tx.objectStore(METADATA_STORE);
    datasetStore.put(updated);
    metaStore.put(meta);
  });
}

/** Delete a dataset and its metadata by dataset ID */
export async function deleteDataset(id: string): Promise<boolean> {
  const db = await openDatabase();
  return new Promise<boolean>((resolve, reject) => {
    let tx: IDBTransaction;
    try {
      tx = db.transaction([DATASETS_STORE, METADATA_STORE], "readwrite");
    } catch (err) {
      return reject(
        new PersistenceError(
          "DATABASE_ERROR",
          err instanceof Error ? err.message : "Failed to open transaction",
          err,
        ),
      );
    }

    tx.onerror = () => {
      reject(
        new PersistenceError(
          "DATABASE_ERROR",
          tx.error?.message ?? "Failed to delete dataset",
          tx.error,
        ),
      );
    };

    tx.oncomplete = () => {
      resolve(true);
    };

    const datasetStore = tx.objectStore(DATASETS_STORE);
    const metaStore = tx.objectStore(METADATA_STORE);
    datasetStore.delete(id);
    metaStore.delete(id);
  });
}

/** Delete all datasets associated with a given projectId */
export async function deleteDatasetByProject(projectId: string): Promise<boolean> {
  const existing = await loadDatasetByProject(projectId);
  if (!existing) {
    return false;
  }
  return deleteDataset(existing.id);
}

/**
 * Duplicate a dataset with independent ID and projectId.
 * Ensures the copy's mutable state is isolated and deleting the source
 * or copy does not affect the other.
 */
export async function duplicateDataset(
  sourceDatasetIdOrProjectId: string,
  newId: string,
  newProjectId: string,
): Promise<StoredDataset | null> {
  let source = await loadDataset(sourceDatasetIdOrProjectId);
  if (!source) {
    source = await loadDatasetByProject(sourceDatasetIdOrProjectId);
  }
  if (!source) {
    return null;
  }

  // Deep clone rows to eliminate shared array references
  const clonedRows: Cell[][] = source.rows.map((r) => [...r]);

  const clonedDataset: Dataset = {
    id: newId,
    name: source.name,
    source: source.source,
    columns: [...source.columns],
    rows: clonedRows,
    sizeBytes: source.sizeBytes,
    warnings: [...source.warnings],
    ...(source.delimiter !== undefined ? { delimiter: source.delimiter } : {}),
    ...(source.typeOverrides ? { typeOverrides: { ...source.typeOverrides } } : {}),
  };

  return saveDataset(clonedDataset, {
    projectId: newProjectId,
    ...(source.csv !== undefined ? { csv: source.csv } : {}),
    createdAt: new Date().toISOString(),
  });
}

/**
 * List lightweight dataset metadata for all saved datasets.
 * Does NOT load rows or heavy columns into memory.
 */
export async function listDatasetMetadata(): Promise<StoredDatasetMeta[]> {
  const db = await openDatabase();
  return new Promise<StoredDatasetMeta[]>((resolve, reject) => {
    let tx: IDBTransaction;
    try {
      tx = db.transaction([METADATA_STORE], "readonly");
    } catch (err) {
      return reject(
        new PersistenceError(
          "DATABASE_ERROR",
          err instanceof Error ? err.message : "Failed to open transaction",
          err,
        ),
      );
    }

    const store = tx.objectStore(METADATA_STORE);
    const request = store.getAll();

    request.onsuccess = () => {
      const records = (request.result as StoredDatasetMeta[]) || [];
      records.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      resolve(records);
    };

    request.onerror = () => {
      reject(
        new PersistenceError(
          "DATABASE_ERROR",
          request.error?.message ?? "Failed to list dataset metadata",
          request.error,
        ),
      );
    };
  });
}

/** Clear all datasets and metadata from IndexedDB */
export async function clearAllDatasets(): Promise<void> {
  const db = await openDatabase();
  return new Promise<void>((resolve, reject) => {
    let tx: IDBTransaction;
    try {
      tx = db.transaction([DATASETS_STORE, METADATA_STORE], "readwrite");
    } catch (err) {
      return reject(
        new PersistenceError(
          "DATABASE_ERROR",
          err instanceof Error ? err.message : "Failed to open transaction",
          err,
        ),
      );
    }

    tx.onerror = () => {
      reject(
        new PersistenceError(
          "DATABASE_ERROR",
          tx.error?.message ?? "Failed to clear datasets",
          tx.error,
        ),
      );
    };

    tx.oncomplete = () => {
      resolve();
    };

    tx.objectStore(DATASETS_STORE).clear();
    tx.objectStore(METADATA_STORE).clear();
  });
}

/**
 * Safe Migration from legacy localStorage (`lumetra.data.v1.{projectId}`).
 *
 * Guarantees:
 * 1. Checks if replacement write succeeds in IndexedDB.
 * 2. Verifies the written record by reading it back and checking row count and size.
 * 3. Never deletes legacy data before verification.
 * 4. Idempotent and safe to retry after an interruption.
 * 5. Updates `lumetra.projects.v1` metadata with the stable dataset ID.
 */
export async function migrateFromLocalStorage(): Promise<MigrationResult> {
  const result: MigrationResult = {
    success: true,
    migrated: 0,
    skipped: 0,
    errors: [],
  };

  if (typeof window === "undefined" || !window.localStorage) {
    return result;
  }

  const s = window.localStorage;
  const legacyPrefix = "lumetra.data.v1.";
  const legacyKeys: string[] = [];

  for (let i = 0; i < s.length; i++) {
    const key = s.key(i);
    if (key && key.startsWith(legacyPrefix)) {
      legacyKeys.push(key);
    }
  }

  if (legacyKeys.length === 0) {
    return result;
  }

  const projects = loadProjects();
  let projectsUpdated = false;

  for (const key of legacyKeys) {
    const projectId = key.slice(legacyPrefix.length);
    const rawCsv = s.getItem(key);
    if (!rawCsv) {
      continue;
    }

    try {
      // Check if dataset already exists in IndexedDB for this project
      const existing = await loadDatasetByProject(projectId);
      if (existing) {
        // Already migrated and verified in a previous run; safe to retire legacy key
        s.removeItem(key);
        result.skipped++;
        continue;
      }

      const project = projects.find((p) => p.id === projectId);
      const datasetName = project?.dataset?.name || `${project?.name || "Dataset"}.csv`;
      const datasetSource = project?.dataset?.source || "upload";

      const parsed = parseCsvText(rawCsv, datasetName, datasetSource);
      if (!parsed.ok) {
        result.errors.push(
          `Project "${projectId}": CSV parsing failed during migration (${parsed.errors.join("; ")})`,
        );
        result.success = false;
        // Keep legacy copy intact
        continue;
      }

      const stableDatasetId = project?.dataset?.id || `ds_${projectId}`;
      const datasetToSave: Dataset = {
        ...parsed.dataset,
        id: stableDatasetId,
      };

      // 1. Write to IndexedDB
      await saveDataset(datasetToSave, {
        projectId,
        csv: rawCsv,
      });

      // 2. Strict Verification Read-back
      const readBack = await loadDataset(stableDatasetId);
      if (
        !readBack ||
        readBack.rows.length !== datasetToSave.rows.length ||
        readBack.columns.length !== datasetToSave.columns.length
      ) {
        throw new PersistenceError(
          "VERIFICATION_FAILED",
          `Verification read-back failed for project "${projectId}".`,
        );
      }

      // 3. Update project metadata
      if (project) {
        project.dataset = {
          name: datasetToSave.name,
          rows: datasetToSave.rows.length,
          columns: datasetToSave.columns.length,
          source: datasetToSave.source,
          stored: true,
          id: stableDatasetId,
        };
        projectsUpdated = true;
      }

      // 4. Safely retire legacy key ONLY after verification succeeded
      s.removeItem(key);
      result.migrated++;
    } catch (e) {
      result.success = false;
      const errMsg = e instanceof Error ? e.message : "Unknown error";
      result.errors.push(`Failed to migrate project "${projectId}": ${errMsg}`);
      // Do NOT delete legacy data when error occurs
    }
  }

  if (projectsUpdated) {
    saveProjects(projects);
  }

  return result;
}

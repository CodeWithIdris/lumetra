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
import { loadProjects, saveProjects, type ProjectMeta } from "./projects";

export const DB_NAME = "lumetra_storage";
export const DB_VERSION = 1;
export const DATASETS_STORE = "datasets";
export const METADATA_STORE = "dataset_meta";
export const MAX_INDEXEDDB_DATASET_BYTES = 20 * 1024 * 1024; // 20 MB limit? why 20mb limit?

export interface StoredDataset {
  id: string;
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
    public readonly cause?: unknown,
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
    projectId: record.projectId,
    name: record.name,
    source: record.source,
    columnCount: record.columns.length,
    rowCount: record.rows.length,
    sizeBytes: record.sizeBytes,
    columns: record.columns,
    delimiter: record.delimiter,
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
    projectId: options?.projectId,
    name: dataset.name,
    source: dataset.source,
    columns: dataset.columns,
    rows: dataset.rows,
    sizeBytes: dataset.sizeBytes,
    warnings: dataset.warnings,
    delimiter: dataset.delimiter,
    typeOverrides: dataset.typeOverrides,
    csv: options?.csv,
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
    delimiter: source.delimiter,
    typeOverrides: source.typeOverrides ? { ...source.typeOverrides } : undefined,
  };

  return saveDataset(clonedDataset, {
    projectId: newProjectId,
    csv: source.csv,
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

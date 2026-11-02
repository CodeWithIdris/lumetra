/**
 * Centralized Persistence Coordinator Engine for Lumetra.
 * Adheres strictly to AGENTS.md:
 * - Pure persistence module under src/lib/persistence/
 * - Manages automatic, invisible persistence without user-facing manual controls
 * - Debounces rapid edits; flushes lifecycle events immediately
 * - Enforces parent-child write ordering (lumetra_projects before child datasets/analyses/reports)
 * - Retries network/server failures with exponential backoff
 * - Maintains durable pending-write queue across page reloads and browser closures
 * - Handles online/offline transitions automatically
 * - Provides subtle, neutral persistence status states
 * - Preserves missing values as null (never coerced to zero)
 */

import type { CleaningStep } from "../data/clean";
import { parseCsvText } from "../data/parse";
import type { SavedAnalysis } from "../stats/analysis";
import { loadDataset, loadDatasetByProject, saveDataset } from "./indexeddb";
import type { ProjectMeta } from "./projects";
import { loadCsv } from "./projects";
import { getSupabaseClient, isValidUuid, toValidUuid, generateUuid } from "./supabase";

export type PersistenceStatus = "saved" | "saving" | "pending" | "offline" | "retrying" | "error";

export interface PersistenceState {
  status: PersistenceStatus;
  statusText: string;
  lastSavedAt: string | null;
  pendingCount: number;
  isOnline: boolean;
  error: string | null;
}

export type EntityType =
  | "project"
  | "dataset"
  | "analysis"
  | "analysis_delete"
  | "report"
  | "report_delete"
  | "delete_project";

export interface PendingWriteItem {
  id: string;
  entityType: EntityType;
  entityId: string;
  projectId: string;
  userId: string;
  sequence: number;
  timestamp: number;
  data: Record<string, unknown>;
  retryCount: number;
}

const QUEUE_STORAGE_KEY = "lumetra.persistence_queue.v1";
const LAST_SAVED_KEY = "lumetra.persistence_last_saved.v1";
const MAX_BACKOFF_MS = 30000;
const BASE_BACKOFF_MS = 1000;
const MAX_RETRIES = 5;

type Listener = (state: PersistenceState) => void;

class PersistenceCoordinator {
  private queue: PendingWriteItem[] = [];
  private sequenceCounter = 0;
  private currentUserId: string | null = null;
  private isProcessing = false;
  private activeProcessingPromise: Promise<void> | null = null;
  private legacyQueueMigration: Promise<void> | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<Listener>();
  private status: PersistenceStatus = "saved";
  private lastSavedAt: string | null = null;
  private lastError: string | null = null;
  private isOnline = true;

  constructor() {
    if (typeof window !== "undefined") {
      this.isOnline = typeof navigator !== "undefined" ? navigator.onLine : true;
      this.lastSavedAt = localStorage.getItem(LAST_SAVED_KEY);
      this.loadQueueFromStorage();

      window.addEventListener("online", this.handleOnline);
      window.addEventListener("offline", this.handleOffline);
    }
  }

  // --- Listener subscription ---
  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    const s = this.getState();
    this.listeners.forEach((fn) => {
      try {
        fn(s);
      } catch (err) {
        console.warn("Persistence listener error:", err);
      }
    });
  }

  public getState(): PersistenceState {
    let statusText = "All changes saved";
    if (this.status === "saving") {
      statusText = "Saving...";
    } else if (this.status === "offline") {
      statusText = "Working offline";
    } else if (this.status === "retrying") {
      statusText = "Couldn't save changes. Retrying...";
    } else if (this.status === "pending") {
      statusText = "Changes pending";
    } else if (this.status === "error") {
      statusText = this.lastError || "Couldn't save changes";
    } else if (!this.currentUserId) {
      statusText = "Saved to this device";
    }

    return {
      status: this.status,
      statusText,
      lastSavedAt: this.lastSavedAt,
      pendingCount: this.queue.length,
      isOnline: this.isOnline,
      error: this.lastError,
    };
  }

  public hasPendingWritesForUser(userId: string): boolean {
    return this.queue.some((item) => item.userId === userId);
  }

  public setOnlineStatus(online: boolean) {
    this.isOnline = online;
    if (!online) {
      this.status = "offline";
      this.notify();
    } else {
      if (this.queue.length > 0) {
        this.status = "pending";
        this.notify();
        this.flushQueue(true);
      } else {
        this.status = "saved";
        this.notify();
      }
    }
  }

  private handleOnline = () => {
    this.setOnlineStatus(true);
  };

  private handleOffline = () => {
    this.setOnlineStatus(false);
  };

  /**
   * Initialize coordinator with active authenticated session user ID.
   */
  public init(userId: string | null) {
    this.currentUserId = userId;
    this.loadQueueFromStorage();
    this.notify();
    if (userId && this.isOnline && this.queue.some((item) => item.userId === userId)) {
      void this.flushQueue(true);
    }
  }

  public setUserId(userId: string | null) {
    this.init(userId);
  }

  // --- Queue Storage Management ---
  private saveQueueToStorage(): boolean {
    if (typeof window === "undefined") return true;
    try {
      const persistedQueue = this.queue.map((item) => {
        if (item.entityType !== "dataset") return item;
        const dataset = item.data["dataset"] as { csvContent?: string | null } | undefined;
        if (typeof dataset?.csvContent !== "string") return item;

        return {
          ...item,
          data: {
            ...item.data,
            dataset: { ...dataset, csvContent: undefined },
            csvContentStoredExternally: true,
          },
        };
      });
      localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(persistedQueue));
      return true;
    } catch {
      this.lastError = "Couldn't save pending changes to this device.";
      return false;
    }
  }

  private loadQueueFromStorage() {
    if (typeof window === "undefined") return;
    try {
      const raw = localStorage.getItem(QUEUE_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        this.queue = parsed;
        this.sequenceCounter = Math.max(
          this.sequenceCounter,
          ...this.queue.map((item) => Number(item.sequence) || 0),
        );
        const legacyDatasetWrites = this.queue.filter((item) => {
          if (item.entityType !== "dataset") return false;
          const dataset = item.data?.["dataset"] as { csvContent?: unknown } | undefined;
          return typeof dataset?.csvContent === "string";
        });
        if (legacyDatasetWrites.length > 0 && !this.legacyQueueMigration) {
          this.legacyQueueMigration = this.migrateLegacyDatasetWrites(legacyDatasetWrites);
        }
        if (this.queue.length > 0) {
          this.status = this.isOnline ? "pending" : "offline";
        }
      }
    } catch {
      this.status = "error";
      this.lastError = "Pending changes could not be read from this device.";
    }
  }

  private async migrateLegacyDatasetWrites(items: PendingWriteItem[]): Promise<void> {
    try {
      for (const item of items) {
        const dataset = item.data["dataset"] as {
          id?: string;
          name: string;
          source?: "upload" | "sample";
          csvContent: string;
        };
        const parsed = parseCsvText(dataset.csvContent, dataset.name, dataset.source);
        if (!parsed.ok) {
          throw new Error(`Could not migrate queued dataset "${dataset.name}" to IndexedDB.`);
        }
        await saveDataset(
          { ...parsed.dataset, id: dataset.id || parsed.dataset.id },
          {
            projectId: item.projectId,
            csv: dataset.csvContent,
          },
        );
        item.data = {
          ...item.data,
          ["dataset"]: { ...dataset, csvContent: undefined },
          ["csvContentStoredExternally"]: true,
        };
      }
      if (!this.saveQueueToStorage()) {
        throw new Error("Could not save the migrated pending-write queue.");
      }
    } catch (err) {
      this.lastError =
        err instanceof Error
          ? `Pending dataset migration failed: ${err.message}`
          : "Pending dataset migration failed.";
      this.status = "error";
      this.notify();
    } finally {
      this.legacyQueueMigration = null;
    }
  }

  private updateLastSaved() {
    const now = new Date().toISOString();
    this.lastSavedAt = now;
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem(LAST_SAVED_KEY, now);
      } catch {
        // ignore
      }
    }
  }

  // --- Enqueue operations ---

  /**
   * Queue or update a project write operation.
   */
  public queueProjectSave(
    project: ProjectMeta,
    userId: string | undefined,
    options?: { immediate?: boolean },
  ) {
    const targetUserId = userId || this.currentUserId || "";
    this.enqueue(
      {
        entityType: "project",
        entityId: project.id,
        projectId: project.id,
        userId: targetUserId,
        data: { project },
      },
      Boolean(options?.immediate),
    );
  }

  /**
   * Queue a dataset save operation.
   */
  public queueDatasetSave(
    projectId: string,
    dataset: {
      id?: string;
      name: string;
      source?: string;
      rows: number;
      columns: number;
      columnList?: string[];
      cleaningSteps?: CleaningStep[];
      csvContent?: string | null;
      delimiter?: string;
      typeOverrides?: Record<string, unknown>;
    },
    userId: string | undefined,
    options?: { immediate?: boolean },
  ) {
    const targetUserId = userId || this.currentUserId || "";
    this.enqueue(
      {
        entityType: "dataset",
        entityId: dataset.id || `${projectId}_dataset`,
        projectId,
        userId: targetUserId,
        data: { dataset },
      },
      Boolean(options?.immediate),
    );
  }

  /**
   * Queue a saved analysis write operation.
   */
  public queueAnalysisSave(projectId: string, analysis: SavedAnalysis, userId: string | undefined) {
    const targetUserId = userId || this.currentUserId || "";
    this.enqueue(
      {
        entityType: "analysis",
        entityId: analysis.id,
        projectId,
        userId: targetUserId,
        data: { analysis },
      },
      true, // Lifecycle event: save immediately
    );
  }

  /**
   * Queue analysis removal.
   */
  public queueAnalysisDelete(projectId: string, analysisId: string, userId: string | undefined) {
    const targetUserId = userId || this.currentUserId || "";
    this.enqueue(
      {
        entityType: "analysis_delete",
        entityId: analysisId,
        projectId,
        userId: targetUserId,
        data: {},
      },
      true,
    );
  }

  /**
   * Queue a report write operation.
   */
  public queueReportSave(
    report: {
      id?: string;
      projectId: string;
      title: string;
      markdown: string;
      objective?: string;
      summary?: Record<string, unknown>;
    },
    userId: string | undefined,
    options?: { immediate?: boolean },
  ) {
    const targetUserId = userId || this.currentUserId || "";
    const reportId = report.id || generateUuid();
    this.enqueue(
      {
        entityType: "report",
        entityId: reportId,
        projectId: report.projectId,
        userId: targetUserId,
        data: { report: { ...report, id: reportId } },
      },
      options?.immediate !== undefined ? options.immediate : true,
    );
  }

  /**
   * Queue project deletion.
   */
  public queueProjectDelete(projectId: string, userId: string | undefined) {
    const targetUserId = userId || this.currentUserId || "";
    this.queue = this.queue.filter(
      (queued) => queued.projectId !== projectId || queued.userId !== targetUserId,
    );
    this.enqueue(
      {
        entityType: "delete_project",
        entityId: projectId,
        projectId,
        userId: targetUserId,
        data: {},
      },
      true, // Delete immediately
    );
  }

  private enqueue(
    item: {
      entityType: EntityType;
      entityId: string;
      projectId: string;
      userId: string;
      data: Record<string, unknown>;
    },
    immediate: boolean,
  ) {
    this.sequenceCounter++;
    const now = Date.now();

    // Deduplicate / coalesce existing pending write for the same entity if not yet in flight
    const existingIndex = this.queue.findIndex(
      (q) =>
        q.userId === item.userId &&
        q.entityType === item.entityType &&
        q.entityId === item.entityId &&
        q.projectId === item.projectId,
    );

    const writeItem: PendingWriteItem = {
      id: generateUuid(),
      entityType: item.entityType,
      entityId: item.entityId,
      projectId: item.projectId,
      userId: item.userId || this.currentUserId || "",
      sequence: this.sequenceCounter,
      timestamp: now,
      data: item.data,
      retryCount: 0,
    };

    if (existingIndex >= 0) {
      this.queue[existingIndex] = writeItem;
    } else {
      this.queue.push(writeItem);
    }

    if (!this.saveQueueToStorage()) {
      this.status = "error";
      this.notify();
      return;
    }

    if (!this.isOnline) {
      this.status = "offline";
      this.notify();
      return;
    }

    if (immediate) {
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
        this.debounceTimer = null;
      }
      this.status = "saving";
      this.notify();
      this.flushQueue();
    } else {
      this.status = "pending";
      this.notify();
      if (!this.debounceTimer) {
        this.debounceTimer = setTimeout(() => {
          this.debounceTimer = null;
          this.flushQueue();
        }, 500);
      }
    }
  }

  // --- Queue Processor ---
  public async flushQueue(force: boolean = false): Promise<void> {
    if (this.activeProcessingPromise) {
      await this.activeProcessingPromise;
      return;
    }

    this.activeProcessingPromise = this.processQueueInternal(force);
    try {
      await this.activeProcessingPromise;
    } finally {
      this.activeProcessingPromise = null;
    }
  }

  private async processQueueInternal(force: boolean = false): Promise<void> {
    if (this.isProcessing && !force) return;
    if (this.legacyQueueMigration) {
      await this.legacyQueueMigration;
    }
    if (this.queue.length === 0) {
      this.status = "saved";
      this.lastError = null;
      this.notify();
      return;
    }

    if (!this.isOnline) {
      this.status = "offline";
      this.notify();
      return;
    }

    const supabase = getSupabaseClient();
    if (!supabase.isConfigured()) {
      // Offline/local only mode
      this.status = "saved";
      this.notify();
      return;
    }

    // Resolve authenticated user ID
    const activeUserId = this.currentUserId;
    if (!activeUserId || !isValidUuid(activeUserId)) {
      this.status = this.queue.length > 0 ? "pending" : "saved";
      this.notify();
      return;
    }

    this.isProcessing = true;
    this.status = "saving";
    this.notify();

    try {
      // Sort queue to guarantee parent-child relationship ordering:
      // 1. "delete_project" first or last? Deletions can run directly.
      // 2. "project" MUST run before "dataset", "analysis", or "report" for the same projectId
      this.sortQueueForDependencyOrder();

      while (this.queue.length > 0) {
        if (this.currentUserId !== activeUserId) {
          break;
        }
        if (!this.isOnline) {
          this.status = "offline";
          this.notify();
          break;
        }

        const itemIndex = this.queue.findIndex((queued) => queued.userId === activeUserId);
        if (itemIndex < 0) {
          this.status = "pending";
          this.notify();
          break;
        }
        const item = this.queue[itemIndex];
        if (!item) break;

        const success = await this.executeWriteItem(item, activeUserId);
        if (success) {
          const completedIndex = this.queue.findIndex((queued) => queued.id === item.id);
          if (completedIndex >= 0) this.queue.splice(completedIndex, 1);
          this.saveQueueToStorage();
          this.updateLastSaved();
          this.lastError = null;
        } else {
          item.retryCount++;
          if (item.retryCount > MAX_RETRIES) {
            console.warn(
              `Write item ${item.entityType}:${item.entityId} exceeded max retries. Keeping it queued.`,
            );
            this.saveQueueToStorage();
            this.lastError = `Failed to sync ${item.entityType}.`;
            this.status = "error";
            this.notify();
            break;
          } else {
            this.saveQueueToStorage();
            const backoff = Math.min(
              MAX_BACKOFF_MS,
              BASE_BACKOFF_MS * Math.pow(2, item.retryCount),
            );
            this.status = "retrying";
            this.notify();
            this.scheduleRetry(backoff);
            break;
          }
        }
      }

      if (this.queue.length === 0) {
        this.status = "saved";
        this.lastError = null;
        this.notify();
      }
    } catch (err) {
      console.warn("Queue processing error:", err);
      this.status = "retrying";
      this.notify();
      this.scheduleRetry(5000);
    } finally {
      this.isProcessing = false;
    }
  }

  private sortQueueForDependencyOrder() {
    const typePriority: Record<EntityType, number> = {
      delete_project: 0,
      project: 1,
      dataset: 2,
      analysis: 3,
      analysis_delete: 3,
      report: 4,
      report_delete: 4,
    };

    this.queue.sort((a, b) => {
      // If same project, order by typePriority
      if (a.projectId === b.projectId) {
        const pDiff =
          a.userId === b.userId ? typePriority[a.entityType] - typePriority[b.entityType] : 0;
        if (pDiff !== 0) return pDiff;
      }
      return a.sequence - b.sequence;
    });
  }

  private async executeWriteItem(item: PendingWriteItem, userId: string): Promise<boolean> {
    const supabase = getSupabaseClient();

    try {
      switch (item.entityType) {
        case "project": {
          const project = item.data["project"] as ProjectMeta;
          const res = await supabase.upsertProjectRecord(project, userId);
          return res.ok;
        }

        case "dataset": {
          let dataset = item.data["dataset"] as {
            id?: string;
            name: string;
            source?: string;
            rows: number;
            columns: number;
            columnList?: string[];
            cleaningSteps?: CleaningStep[];
            csvContent?: string | null;
            delimiter?: string;
            typeOverrides?: Record<string, unknown>;
          };
          if (item.data["csvContentStoredExternally"]) {
            const storedDataset = dataset.id ? await loadDataset(dataset.id) : null;
            const datasetByProject = storedDataset ?? (await loadDatasetByProject(item.projectId));
            const csvContent = datasetByProject?.csv ?? loadCsv(item.projectId);
            if (csvContent === null || csvContent === undefined) {
              throw new Error("Dataset content is unavailable in local storage.");
            }
            dataset = { ...dataset, csvContent };
          }
          const res = await supabase.upsertDatasetRecord(item.projectId, dataset, userId);
          return res.ok;
        }

        case "analysis": {
          const analysis = item.data["analysis"] as SavedAnalysis;
          const res = await supabase.upsertAnalysisRecord(item.projectId, analysis, userId);
          return res.ok;
        }

        case "analysis_delete": {
          const res = await supabase.deleteAnalysisRecord(item.entityId, userId);
          return res.ok;
        }

        case "report": {
          const report = item.data["report"] as {
            id?: string;
            projectId: string;
            title: string;
            markdown: string;
            objective?: string;
            summary?: Record<string, unknown>;
          };
          const res = await supabase.upsertReportRecord(report, userId);
          return res.ok;
        }

        case "report_delete": {
          const res = await supabase.deleteReportRecord(item.entityId, userId);
          return res.ok;
        }

        case "delete_project": {
          const res = await supabase.deleteProject(item.projectId, userId);
          return res.ok;
        }

        default:
          return true;
      }
    } catch (e) {
      console.warn(`Write execution failed for ${item.entityType}:`, e);
      return false;
    }
  }

  private scheduleRetry(delayMs: number) {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.isOnline) {
        this.flushQueue(true);
      }
    }, delayMs);
  }

  /**
   * Reset / clear queue (e.g. for testing or logout).
   */
  public resetQueue() {
    this.queue = [];
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.debounceTimer = null;
    this.retryTimer = null;
    this.isProcessing = false;
    this.activeProcessingPromise = null;
    this.status = "saved";
    this.lastError = null;
    this.saveQueueToStorage();
    this.notify();
  }
}

let coordinatorInstance: PersistenceCoordinator | null = null;

export function getPersistenceCoordinator(): PersistenceCoordinator {
  if (!coordinatorInstance) {
    coordinatorInstance = new PersistenceCoordinator();
  }
  return coordinatorInstance;
}

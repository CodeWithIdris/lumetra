/**
 * Pure Supabase client and Cloud Records synchronization module.
 * Adheres strictly to AGENTS.md:
 * - Pure persistence module under src/lib/persistence/
 * - Implements PostgreSQL cloud persistence with Row Level Security (RLS)
 * - Tables: lumetra_projects, datasets, saved_analyses, reports
 * - Preserves missing values as null, never coerced to zero
 * - Never exposes service_role or secret keys
 * - Uses authenticated session for all operations
 * - Retains offline-safe local vaults and IndexedDB cache
 */
import type { CleaningStep } from "../data/clean";
import type { PersonaId } from "../stats/personas";
import type { SavedAnalysis } from "../stats/analysis";
import type { ProjectMeta } from "./projects";
import {
  hashDataset,
  type DatasetVersionMetadata,
  type StoredDataset,
  type StoredDatasetVersion,
} from "./indexeddb";
import {
  supabase,
  getSupabaseClientInstance,
  isSupabaseConfigured,
  validateSupabaseConfig,
} from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";

export { isSupabaseConfigured };

export interface SupabaseConfig {
  url: string;
  anonKey: string;
  tableName: string;
  autoSync: boolean;
}

export interface CloudRecord {
  id: string;
  user_id?: string | undefined;
  name: string;
  status: string;
  objective?: string | undefined;
  dataset_name?: string | undefined;
  dataset_id?: string | undefined;
  dataset_rows?: number | undefined;
  dataset_columns?: number | undefined;
  dataset_source?: string | undefined;
  csv_content?: string | undefined;
  cleaning_steps?: string | undefined;
  saved_analyses?: string | undefined;
  created_at: string;
  updated_at: string;
  revision?: number;
  dataset_revision?: number;
}

function formatPersistenceError(error: { code?: string; message: string }): string {
  if (error.code === "PGRST205") {
    return `PGRST205: ${error.message}. Apply migration 20261029101800_create_lumetra_schema_and_rls.sql.`;
  }
  return error.message;
}

function mapSavedAnalysis(record: Record<string, unknown>): Record<string, unknown> {
  return {
    id: record["id"],
    revision: record["revision"],
    name: record["name"],
    type: record["type"],
    timestamp: record["created_at"] ?? record["timestamp"],
    datasetId: record["dataset_id"] ?? record["datasetId"],
    datasetVersion: record["dataset_version"] ?? record["datasetVersion"],
    datasetVersionId: record["dataset_version_id"] ?? record["datasetVersionId"],
    datasetName: record["dataset_name"] ?? record["datasetName"],
    datasetSignature: record["dataset_signature"] ?? record["datasetSignature"],
    variables: record["variables"],
    configuration: record["configuration"],
    sampleSize: record["sample_size"] ?? record["sampleSize"],
    missingCount: record["missing_count"] ?? record["missingCount"],
    missingHandling: record["missing_handling"] ?? record["missingHandling"],
    results: record["results"],
    interpretation: record["interpretation"],
    methodNotes: record["method_notes"] ?? record["methodNotes"],
  };
}

function serializeSavedAnalyses(records: Array<Record<string, unknown>>): string | undefined {
  return records.length > 0 ? JSON.stringify(records.map(mapSavedAnalysis)) : undefined;
}

export interface CloudDatasetVersion {
  id: string;
  projectId: string;
  datasetId: string;
  userId: string;
  version: number;
  contentHash: string;
  createdAt: string;
  description: string;
  cleaningSteps: unknown[];
}

export interface RevisionConflict {
  ok: false;
  conflict: true;
  remoteRevision: number;
  remoteRecord?: Record<string, unknown>;
  error: string;
}

export type RevisionWriteResult =
  | {
      ok: true;
      revision: number;
      remoteId?: string;
      datasetId?: string;
      analysisId?: string;
      id?: string;
    }
  | {
      ok: false;
      conflict?: false;
      error: string;
    }
  | RevisionConflict;

export interface CloudReport {
  id: string;
  project_id: string;
  user_id: string;
  revision?: number;
  title: string;
  objective?: string | null;
  content_markdown: string;
  summary?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface CloudImportResult {
  success: boolean;
  imported: number;
  skipped: number;
  errors: string[];
  projects: ProjectMeta[];
}

function toSupabaseJson(value: unknown, ancestors: Set<object> = new Set()): Json {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("A saved value contains a non-finite number.");
    return value;
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) throw new Error("A saved value contains a circular reference.");
    ancestors.add(value);
    try {
      return value.map((entry) => toSupabaseJson(entry, ancestors));
    } finally {
      ancestors.delete(value);
    }
  }
  if (typeof value === "object") {
    if (ancestors.has(value)) throw new Error("A saved value contains a circular reference.");
    ancestors.add(value);
    try {
      const result: { [key: string]: Json | undefined } = {};
      for (const [key, entry] of Object.entries(value)) {
        if (entry !== undefined) result[key] = toSupabaseJson(entry, ancestors);
      }
      return result;
    } finally {
      ancestors.delete(value);
    }
  }
  throw new Error("A saved value cannot be represented as JSON.");
}

const CONFIG_STORAGE_KEY = "lumetra.supabase.config.v1";
const CLOUD_CACHE_KEY = "lumetra.supabase.cloud_cache.v1";

const envUrl =
  (typeof import.meta !== "undefined" && import.meta.env?.["VITE_SUPABASE_URL"]) ||
  (typeof process !== "undefined" && process.env?.["VITE_SUPABASE_URL"]) ||
  "";

const envKey =
  (typeof import.meta !== "undefined" &&
    (import.meta.env?.["VITE_SUPABASE_PUBLISHABLE_KEY"] ||
      import.meta.env?.["VITE_SUPABASE_ANON_KEY"])) ||
  (typeof process !== "undefined" &&
    (process.env?.["VITE_SUPABASE_PUBLISHABLE_KEY"] || process.env?.["VITE_SUPABASE_ANON_KEY"])) ||
  "";

const DEFAULT_CONFIG: SupabaseConfig = {
  url: envUrl,
  anonKey: envKey,
  tableName: "lumetra_projects",
  autoSync: false,
};
const DATASET_STORAGE_THRESHOLD_BYTES = 512 * 1024;
const DATASET_STORAGE_BUCKET = "lumetra-dataset-versions";

export function createDatasetContentPath(
  userId: string,
  projectId: string,
  datasetId: string,
  revision: number,
): string {
  return `${userId}/${projectId}/datasets/${datasetId}/${revision}-${generateUuid()}.csv`;
}

/** UUID Validation and Generation Helpers */
export function isValidUuid(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str);
}

export function generateUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Converts a non-UUID ID (e.g. legacy 'proj_...') to a stable, valid UUID */
export function toValidUuid(id: string): string {
  if (isValidUuid(id)) return id;
  let hex = "";
  for (let i = 0; i < id.length; i++) {
    hex += id.charCodeAt(i).toString(16);
  }
  hex = hex.padEnd(32, "0").slice(0, 32);
  const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  if (isValidUuid(uuid)) return uuid;
  return generateUuid();
}

export function getSupabaseEnvConfig() {
  return { url: envUrl, anonKey: envKey };
}

export function validateSupabaseCredentials(
  url?: string,
  key?: string,
): {
  isConfigured: boolean;
  missing: string[];
  error: string | null;
} {
  const checkUrl = (url !== undefined ? url : loadSupabaseConfig().url).trim();
  const checkKey = (key !== undefined ? key : loadSupabaseConfig().anonKey).trim();
  const missing: string[] = [];
  if (!checkUrl) missing.push("VITE_SUPABASE_URL (Project URL)");
  if (!checkKey) missing.push("VITE_SUPABASE_PUBLISHABLE_KEY (Anon / Publishable API Key)");

  if (missing.length > 0) {
    return {
      isConfigured: false,
      missing,
      error: `Missing required Supabase credentials: ${missing.join(", ")}. Please configure them in .env.local or your environment settings.`,
    };
  }
  return {
    isConfigured: true,
    missing: [],
    error: null,
  };
}

export function loadSupabaseConfig(): SupabaseConfig {
  if (typeof window === "undefined") return DEFAULT_CONFIG;
  try {
    const raw = localStorage.getItem(CONFIG_STORAGE_KEY);
    if (!raw) return DEFAULT_CONFIG;
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      url: parsed.url || envUrl,
      anonKey: parsed.anonKey || envKey,
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function saveSupabaseConfig(cfg: Partial<SupabaseConfig>): SupabaseConfig {
  const current = loadSupabaseConfig();
  const next = { ...current, ...cfg };
  if (typeof window !== "undefined") {
    localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(next));
  }
  return next;
}

class SupabaseService {
  private config: SupabaseConfig;

  constructor() {
    this.config = loadSupabaseConfig();
  }

  public isConfigured(): boolean {
    const c = loadSupabaseConfig();
    return Boolean(c.url && c.anonKey && c.url.startsWith("http"));
  }

  public getConfig(): SupabaseConfig {
    return loadSupabaseConfig();
  }

  public setConfig(cfg: Partial<SupabaseConfig>) {
    this.config = saveSupabaseConfig(cfg);
  }

  private getHeaders() {
    const c = loadSupabaseConfig();
    return {
      "Content-Type": "application/json",
      apikey: c.anonKey,
      Authorization: `Bearer ${c.anonKey}`,
    };
  }

  /**
   * Test connection to a Supabase project URL.
   * Checks Supabase Auth settings and health to verify remote connectivity and credentials
   * without requiring elevated secret keys or OpenAPI root access.
   */
  public async testConnection(
    url: string,
    anonKey: string,
  ): Promise<{ ok: boolean; message: string }> {
    const cleanUrl = url.replace(/\/$/, "");
    if (!cleanUrl || !anonKey) {
      return { ok: false, message: "URL and Anon Key are required." };
    }
    try {
      // 1. Authenticate with /auth/v1/settings using the publishable key
      const authRes = await fetch(`${cleanUrl}/auth/v1/settings`, {
        method: "GET",
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
        },
      });
      if (authRes.ok || authRes.status === 200) {
        return { ok: true, message: "Successfully connected to Supabase project!" };
      }

      // Check if project returned invalid key
      if (authRes.status === 401) {
        try {
          const body = (await authRes.json()) as { message?: string };
          if (body?.message === "Invalid API key") {
            return {
              ok: false,
              message: "Supabase returned: Invalid API key. Please check your publishable key.",
            };
          }
        } catch {
          // ignore parsing error
        }
      }

      // 2. Fallback: check Auth health
      const healthRes = await fetch(`${cleanUrl}/auth/v1/health`, {
        method: "GET",
        headers: {
          apikey: anonKey,
        },
      });
      if (healthRes.ok || healthRes.status === 200) {
        return { ok: true, message: "Successfully connected to Supabase project!" };
      }

      // 3. Fallback: PostgREST endpoint
      const restRes = await fetch(`${cleanUrl}/rest/v1/`, {
        method: "GET",
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
        },
      });
      if (restRes.ok || restRes.status === 200 || restRes.status === 404) {
        return { ok: true, message: "Successfully connected to Supabase project!" };
      }
      return {
        ok: false,
        message: `Supabase returned status: ${authRes.status} ${authRes.statusText}`,
      };
    } catch (e) {
      return {
        ok: false,
        message: e instanceof Error ? e.message : "Network error connecting to Supabase",
      };
    }
  }

  /**
   * Supabase Auth: Sign Up
   */
  public async signUp(
    email: string,
    pass: string,
    data?: Record<string, unknown>,
  ): Promise<{ userId?: string; error?: string }> {
    const c = loadSupabaseConfig();
    if (!this.isConfigured()) return {};

    const cleanUrl = c.url.replace(/\/$/, "");
    try {
      const res = await fetch(`${cleanUrl}/auth/v1/signup`, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify({ email, password: pass, data }),
      });
      const json = await res.json();
      if (!res.ok) {
        return { error: json.msg || json.error_description || json.message || "Failed to sign up" };
      }
      return { userId: json.user?.id || json.id };
    } catch (e) {
      return { error: e instanceof Error ? e.message : "Supabase connection error" };
    }
  }

  /**
   * Supabase Auth: Sign In
   */
  public async signIn(
    email: string,
    pass: string,
  ): Promise<{ userId?: string; name?: string; persona?: string; error?: string }> {
    const c = loadSupabaseConfig();
    if (!this.isConfigured()) return {};

    const cleanUrl = c.url.replace(/\/$/, "");
    try {
      const res = await fetch(`${cleanUrl}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify({ email, password: pass }),
      });
      const json = await res.json();
      if (!res.ok) {
        return {
          error: json.msg || json.error_description || json.message || "Invalid credentials",
        };
      }
      const user = json.user;
      return {
        userId: user?.id,
        name: user?.user_metadata?.name,
        persona: user?.user_metadata?.persona,
      };
    } catch (e) {
      return { error: e instanceof Error ? e.message : "Supabase connection error" };
    }
  }

  /**
   * Supabase Auth: Sign Out
   */
  public async signOut(): Promise<void> {
    const c = loadSupabaseConfig();
    if (!this.isConfigured()) return;
    try {
      const cleanUrl = c.url.replace(/\/$/, "");
      await fetch(`${cleanUrl}/auth/v1/logout`, {
        method: "POST",
        headers: this.getHeaders(),
      });
    } catch {
      // Ignored
    }
  }

  /**
   * Save a project, dataset, and analyses into Supabase PostgreSQL Cloud Database.
   * Enforces Row Level Security using the active authenticated session.
   * Requires remote writes and read-back verification before returning success.
   */
  public async saveProject(
    project: ProjectMeta,
    csvContent: string | null,
    userId?: string,
    options?: { columns?: string[]; datasetVersions?: StoredDatasetVersion[] },
  ): Promise<{
    ok: boolean;
    error?: string;
    remoteId?: string;
    datasetId?: string;
    revision?: number;
  }> {
    if (!this.isConfigured()) {
      return {
        ok: false,
        error:
          "Supabase database credentials are not configured. Please configure them in Settings.",
      };
    }

    const client = getSupabaseClientInstance();
    if (!client) {
      return { ok: false, error: "Supabase client not initialized." };
    }

    // Determine authenticated user identity from verified Supabase session
    let sessionUserId = userId;
    try {
      const { data: userData, error: userErr } = await client.auth.getUser();
      if (!userErr && userData?.user?.id) {
        sessionUserId = userData.user.id;
      } else {
        const { data: sessionData } = await client.auth.getSession();
        if (sessionData?.session?.user?.id) {
          sessionUserId = sessionData.session.user.id;
        }
      }
    } catch {
      // Fallback to supplied userId
    }

    if (!sessionUserId || !isValidUuid(sessionUserId)) {
      return {
        ok: false,
        error:
          "Authentication required. You must be signed in to a verified Supabase account to sync projects to cloud storage.",
      };
    }
    if (userId && sessionUserId !== userId) {
      return { ok: false, error: "Authenticated account changed before project persistence." };
    }

    const record: CloudRecord = {
      id: project.id,
      user_id: sessionUserId,
      name: project.name,
      status: project.status,
      objective: project.objective,
      dataset_name: project.dataset?.name,
      dataset_rows: project.dataset?.rows,
      dataset_columns: project.dataset?.columns,
      dataset_source: project.dataset?.source,
      csv_content: csvContent || undefined,
      cleaning_steps:
        project.cleaningSteps && project.cleaningSteps.length > 0
          ? JSON.stringify(project.cleaningSteps)
          : undefined,
      saved_analyses:
        project.savedAnalyses && project.savedAnalyses.length > 0
          ? JSON.stringify(project.savedAnalyses)
          : undefined,
      created_at: project.createdAt,
      updated_at: project.updatedAt,
    };
    this.saveToLocalCloudVault(record);

    const projectUuid = toValidUuid(project.id);
    try {
      const projectResult = await this.upsertProjectRecord(project, sessionUserId);
      if (!projectResult.ok) return projectResult;
      let datasetUuid: string | null = null;
      if (project.dataset || csvContent) {
        datasetUuid = toValidUuid(project.dataset?.id || `${projectUuid}_dataset`);
        const columnsList = options?.columns || [];
        const datasetResult = await this.upsertDatasetRecord(
          project.id,
          {
            id: project.dataset?.id || datasetUuid,
            name: project.dataset?.name || `${project.name}.csv`,
            source: project.dataset?.source || "upload",
            rows: project.dataset?.rows || 0,
            columns: project.dataset?.columns || columnsList.length,
            columnList: columnsList,
            cleaningSteps: project.cleaningSteps || [],
            csvContent,
            revision: project.datasetRevision ?? 0,
          },
          sessionUserId,
        );
        if (!datasetResult.ok) return datasetResult;
      }

      for (const version of options?.datasetVersions ?? []) {
        const versionResult = await this.saveDatasetVersionRecord(
          version,
          version.dataset,
          sessionUserId,
        );
        if (!versionResult.ok) {
          return {
            ok: false,
            error: versionResult.error ?? "Could not import a saved dataset version.",
          };
        }
      }

      if (project.savedAnalyses && project.savedAnalyses.length > 0) {
        for (const analysis of project.savedAnalyses) {
          const analysisResult = await this.upsertAnalysisRecord(
            project.id,
            analysis,
            sessionUserId,
          );
          if (!analysisResult.ok) return analysisResult;
        }
      }

      const verification = await this.verifyRemoteProject(projectUuid, sessionUserId, {
        hasDataset: Boolean(project.dataset || csvContent),
        ...(datasetUuid ? { datasetUuid } : {}),
        expectedAnalysesCount: project.savedAnalyses?.length ?? 0,
      });

      if (!verification.ok) {
        return { ok: false, error: verification.error ?? "Remote verification failed." };
      }

      return {
        ok: true,
        remoteId: projectUuid,
        ...(datasetUuid != null ? { datasetId: datasetUuid } : {}),
        revision: projectResult.revision,
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Network error" };
    }
  }

  /**
   * Strictly verifies that remote records exist in PostgreSQL via authenticated SELECT queries.
   * Does NOT fall back to local storage.
   */
  public async verifyRemoteProject(
    projectUuid: string,
    userId: string,
    expected: {
      hasDataset: boolean;
      datasetUuid?: string;
      expectedAnalysesCount: number;
    },
  ): Promise<{ ok: boolean; error?: string }> {
    const client = getSupabaseClientInstance();
    if (!client) {
      return { ok: false, error: "Supabase client unavailable for verification." };
    }

    try {
      // 1. Verify project row exists for this user
      const { data: projectRow, error: pErr } = await client
        .from("lumetra_projects")
        .select("id, name, user_id")
        .eq("id", projectUuid)
        .eq("user_id", userId)
        .maybeSingle();

      if (pErr) {
        return {
          ok: false,
          error: `Remote verification read-back failed for project: ${pErr.message}`,
        };
      }
      if (!projectRow) {
        return {
          ok: false,
          error: "Remote verification read-back failed: Project was not found in Supabase.",
        };
      }

      // 2. Verify dataset row exists if expected
      if (expected.hasDataset) {
        let query = client
          .from("datasets")
          .select("id, project_id, user_id")
          .eq("project_id", projectUuid)
          .eq("user_id", userId);

        if (expected.datasetUuid) {
          query = query.eq("id", expected.datasetUuid);
        }

        const { data: datasetRow, error: dErr } = await query.maybeSingle();
        if (dErr) {
          return {
            ok: false,
            error: `Remote verification read-back failed for dataset: ${dErr.message}`,
          };
        }
        if (!datasetRow) {
          return {
            ok: false,
            error: "Remote verification read-back failed: Dataset was not found in Supabase.",
          };
        }
      }

      // 3. Verify analyses rows count if expected
      if (expected.expectedAnalysesCount > 0) {
        const { data: analysesRows, error: aErr } = await client
          .from("saved_analyses")
          .select("id")
          .eq("project_id", projectUuid)
          .eq("user_id", userId);

        if (aErr) {
          return {
            ok: false,
            error: `Remote verification read-back failed for analyses: ${aErr.message}`,
          };
        }
        if (!analysesRows || analysesRows.length < expected.expectedAnalysesCount) {
          return {
            ok: false,
            error: `Remote verification read-back failed: Expected ${expected.expectedAnalysesCount} analyses, but found ${analysesRows?.length ?? 0} in Supabase.`,
          };
        }
      }

      return { ok: true };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : "Verification read-back query error.",
      };
    }
  }

  /**
   * Load a project and its dataset from PostgreSQL Cloud.
   */
  public async loadProject(id: string): Promise<CloudRecord | null> {
    if (!this.isConfigured()) {
      return this.loadFromLocalCloudVault(id);
    }

    const client = getSupabaseClientInstance();
    if (!client) {
      return this.loadFromLocalCloudVault(id);
    }

    const projectUuid = toValidUuid(id);

    try {
      const { data, error } = await client
        .from("lumetra_projects")
        .select("*, datasets(*), saved_analyses(*), reports(*)")
        .eq("id", projectUuid)
        .maybeSingle();

      if (error) throw error;
      if (!data) return null;

      const row = data as Record<string, unknown>;
      const datasets = ((row["datasets"] as Array<Record<string, unknown>>) || []).sort(
        (left, right) =>
          String(right["updated_at"] ?? "").localeCompare(String(left["updated_at"] ?? "")),
      );
      const primaryDataset = datasets[0] || null;
      const analyses = (row["saved_analyses"] as Array<Record<string, unknown>>) || [];
      let datasetCsv =
        (primaryDataset?.["csv_content"] as string | null) ||
        (row["csv_content"] as string | null) ||
        null;
      const datasetContentPath = primaryDataset?.["content_path"] as string | null | undefined;
      if (!datasetCsv && datasetContentPath) {
        const { data: file, error: downloadError } = await client.storage
          .from(DATASET_STORAGE_BUCKET)
          .download(datasetContentPath);
        if (downloadError) throw new Error(downloadError.message);
        datasetCsv = await file.text();
      }

      const record: CloudRecord = {
        id: (row["id"] as string) || id,
        user_id: (row["user_id"] as string) || undefined,
        name: (row["name"] as string) || "Project",
        status: (row["status"] as string) || "no-data",
        objective: (row["objective"] as string) || undefined,
        dataset_name:
          (primaryDataset?.["name"] as string) || (row["dataset_name"] as string) || undefined,
        dataset_id: (primaryDataset?.["id"] as string) || undefined,
        dataset_rows:
          (primaryDataset?.["row_count"] as number) || (row["dataset_rows"] as number) || undefined,
        dataset_columns:
          (primaryDataset?.["column_count"] as number) ||
          (row["dataset_columns"] as number) ||
          undefined,
        dataset_source:
          (primaryDataset?.["source"] as string) || (row["dataset_source"] as string) || undefined,
        csv_content: datasetCsv ?? undefined,
        cleaning_steps: primaryDataset?.["cleaning_steps"]
          ? JSON.stringify(primaryDataset["cleaning_steps"])
          : (row["cleaning_steps"] as string) || undefined,
        saved_analyses:
          serializeSavedAnalyses(analyses) ?? ((row["saved_analyses"] as string) || undefined),
        created_at: (row["created_at"] as string) || new Date().toISOString(),
        updated_at: (row["updated_at"] as string) || new Date().toISOString(),
        revision: Number(row["revision"]) || 1,
        dataset_revision: Number(primaryDataset?.["revision"]) || 0,
      };

      return record;
    } catch (error) {
      console.warn("Could not load a saved project.", error);
      throw error;
    }
  }

  /**
   * List all projects owned by the authenticated user in PostgreSQL Cloud.
   * RLS automatically ensures User A only receives their own projects.
   */
  public async listProjects(userId?: string): Promise<CloudRecord[]> {
    const localRecords = this.listLocalCloudVault();
    if (!this.isConfigured()) {
      return localRecords;
    }

    const client = getSupabaseClientInstance();
    if (!client) {
      return localRecords;
    }

    try {
      let query = client
        .from("lumetra_projects")
        .select("*, datasets(*), saved_analyses(*)")
        .order("updated_at", { ascending: false });

      if (userId) {
        query = query.eq("user_id", userId);
      }

      const { data, error } = await query;
      if (error) {
        throw error;
      }
      if (!data) {
        return [];
      }

      const records: CloudRecord[] = (data as Array<Record<string, unknown>>).map((row) => {
        const datasets = ((row["datasets"] as Array<Record<string, unknown>>) || []).sort(
          (left, right) =>
            String(right["updated_at"] ?? "").localeCompare(String(left["updated_at"] ?? "")),
        );
        const ds = datasets[0] || null;
        const analyses = (row["saved_analyses"] as Array<Record<string, unknown>>) || [];

        return {
          id: row["id"] as string,
          user_id: row["user_id"] as string,
          name: row["name"] as string,
          status: row["status"] as string,
          objective: (row["objective"] as string) || undefined,
          dataset_name: (ds?.["name"] as string) || (row["dataset_name"] as string) || undefined,
          dataset_id: (ds?.["id"] as string) || undefined,
          dataset_rows:
            (ds?.["row_count"] as number) || (row["dataset_rows"] as number) || undefined,
          dataset_columns:
            (ds?.["column_count"] as number) || (row["dataset_columns"] as number) || undefined,
          dataset_source:
            (ds?.["source"] as string) || (row["dataset_source"] as string) || undefined,
          csv_content:
            (ds?.["csv_content"] as string) || (row["csv_content"] as string) || undefined,
          cleaning_steps: ds?.["cleaning_steps"]
            ? JSON.stringify(ds["cleaning_steps"])
            : (row["cleaning_steps"] as string) || undefined,
          saved_analyses:
            serializeSavedAnalyses(analyses) ?? ((row["saved_analyses"] as string) || undefined),
          created_at: row["created_at"] as string,
          updated_at: row["updated_at"] as string,
          revision: Number(row["revision"]) || 1,
          dataset_revision: Number(ds?.["revision"]) || 0,
        };
      });

      return records;
    } catch (error) {
      console.warn("Could not load saved projects.", error);
      throw error;
    }
  }

  /**
   * Delete a project from Supabase PostgreSQL Cloud.
   * Foreign keys cascade deletion to datasets, saved_analyses, and reports.
   */
  public async deleteProject(
    id: string,
    userId?: string,
  ): Promise<{ ok: boolean; error?: string }> {
    if (!this.isConfigured()) {
      this.deleteFromLocalCloudVault(id);
      return { ok: true };
    }

    const client = getSupabaseClientInstance();
    if (!client) return { ok: false, error: "Database client unavailable." };

    const sessionUserId = await this.resolveSessionUserId(userId);
    if (!sessionUserId || (userId && sessionUserId !== userId)) {
      return { ok: false, error: "Authenticated account changed before project deletion." };
    }

    const projectUuid = toValidUuid(id);
    try {
      const [datasets, versions] = await Promise.all([
        client
          .from("datasets")
          .select("content_path")
          .eq("project_id", projectUuid)
          .eq("user_id", sessionUserId),
        client
          .from("dataset_versions")
          .select("content_path")
          .eq("project_id", projectUuid)
          .eq("user_id", sessionUserId),
      ]);
      if (datasets.error) return { ok: false, error: datasets.error.message };
      if (versions.error) return { ok: false, error: versions.error.message };
      const storagePaths = [
        ...(datasets.data ?? []).map((record) => record.content_path),
        ...(versions.data ?? []).map((record) => record.content_path),
      ].filter((path): path is string => Boolean(path));

      const projectStoragePrefix = `${sessionUserId}/${projectUuid}/`;
      if (storagePaths.some((path) => !path.startsWith(projectStoragePrefix))) {
        return {
          ok: false,
          error: "Project files could not be verified as belonging to this project. Nothing was deleted.",
        };
      }

      if (storagePaths.length > 0) {
        const activeUserId = await this.resolveSessionUserId(userId);
        if (activeUserId !== sessionUserId) {
          return {
            ok: false,
            error: "The active account changed during project deletion. Retry while signed in to the same account.",
          };
        }
        const { error: storageError } = await client.storage
          .from(DATASET_STORAGE_BUCKET)
          .remove(storagePaths);
        if (storageError) {
          return {
            ok: false,
            error: `Project files could not be removed (${storageError.message}). The project is still saved; retry deletion to finish.`,
          };
        }
      }

      const activeUserId = await this.resolveSessionUserId(userId);
      if (activeUserId !== sessionUserId) {
        return {
          ok: false,
          error: "The active account changed during project deletion. Retry while signed in to the same account.",
        };
      }

      const { error } = await client
        .from("lumetra_projects")
        .delete()
        .eq("id", projectUuid)
        .eq("user_id", sessionUserId);
      if (error) {
        return {
          ok: false,
          error: `Project files were removed, but the project records could not be deleted (${error.message}). Retry deletion to finish.`,
        };
      }
      this.deleteFromLocalCloudVault(id);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Project delete error." };
    }
  }

  /**
   * Persists an analytical report linked to an owning project (idempotent upsert).
   */
  public async saveReport(report: {
    id?: string;
    projectId: string;
    title: string;
    markdown: string;
    objective?: string;
    summary?: Record<string, unknown>;
    userId?: string;
  }): Promise<RevisionWriteResult> {
    return this.upsertReportRecord(report, report.userId);
  }

  public async loadUserPreference(userId: string): Promise<PersonaId | null> {
    const client = getSupabaseClientInstance();
    if (!client) return null;
    const sessionUserId = await this.resolveSessionUserId(userId);
    if (sessionUserId !== userId) return null;
    const { data, error } = await client
      .from("user_preferences")
      .select("persona")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data?.persona ?? null;
  }

  public async saveUserPreference(
    userId: string,
    persona: PersonaId,
  ): Promise<{ ok: boolean; error?: string }> {
    const client = getSupabaseClientInstance();
    if (!client) return { ok: false, error: "Account settings are unavailable." };
    const sessionUserId = await this.resolveSessionUserId(userId);
    if (sessionUserId !== userId) {
      return { ok: false, error: "The active account changed before saving this preference." };
    }
    const { error } = await client
      .from("user_preferences")
      .upsert(
        { user_id: userId, persona, updated_at: new Date().toISOString() },
        { onConflict: "user_id" },
      );
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }

  /**
   * Resolve authenticated user ID from active Supabase session.
   */
  public async resolveSessionUserId(fallbackUserId?: string): Promise<string | null> {
    const client = getSupabaseClientInstance();
    if (!client) return fallbackUserId ?? null;
    try {
      const { data: userData, error: userErr } = await client.auth.getUser();
      if (!userErr && userData?.user?.id) {
        return userData.user.id;
      }
      const { data: sessionData } = await client.auth.getSession();
      if (sessionData?.session?.user?.id) {
        return sessionData.session.user.id;
      }
    } catch {
      // ignore
    }
    return fallbackUserId ?? null;
  }

  public async saveDatasetVersionRecord(
    version: DatasetVersionMetadata,
    dataset: StoredDataset,
    userId: string,
  ): Promise<{ ok: boolean; error?: string }> {
    if (hashDataset(dataset) !== version.contentHash) {
      return { ok: false, error: "The dataset snapshot does not match its saved version." };
    }
    const client = getSupabaseClientInstance();
    if (!client) return { ok: false, error: "Database client unavailable." };
    const sessionUserId = await this.resolveSessionUserId(userId);
    if (!sessionUserId || sessionUserId !== userId) {
      return { ok: false, error: "Authenticated account changed before saving this version." };
    }

    const projectUuid = toValidUuid(version.projectId);
    const storagePath = `${userId}/${projectUuid}/${version.id}.json`;
    try {
      const { data: existing, error: lookupError } = await client
        .from("dataset_versions")
        .select("id, dataset_id, version_number, content_hash, content_path")
        .eq("id", version.id)
        .eq("user_id", userId)
        .maybeSingle();
      if (lookupError) return { ok: false, error: lookupError.message };
      if (
        existing &&
        (existing.dataset_id !== version.datasetId ||
          existing.version_number !== version.version ||
          existing.content_hash !== version.contentHash)
      ) {
        return { ok: false, error: "This saved version identifier already belongs to other data." };
      }

      const { error: uploadError } = await client.storage
        .from("lumetra-dataset-versions")
        .upload(storagePath, new Blob([JSON.stringify(dataset)], { type: "application/json" }), {
          upsert: true,
          contentType: "application/json",
        });
      if (uploadError) return { ok: false, error: uploadError.message };

      if (existing) return { ok: true };

      const { error } = await client.from("dataset_versions").insert({
        id: version.id,
        project_id: projectUuid,
        dataset_id: version.datasetId,
        user_id: userId,
        version_number: version.version,
        content_hash: version.contentHash,
        content_path: storagePath,
        cleaning_steps: version.cleaningSteps as never,
        change_description: version.description,
        created_at: version.createdAt,
      });
      if (error) return { ok: false, error: error.message };
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Version save failed." };
    }
  }

  public async listDatasetVersionRecords(
    projectId: string,
    userId: string,
  ): Promise<CloudDatasetVersion[]> {
    const client = getSupabaseClientInstance();
    if (!client) return [];
    try {
      const { data, error } = await client
        .from("dataset_versions")
        .select("*")
        .eq("project_id", toValidUuid(projectId))
        .eq("user_id", userId)
        .order("version_number", { ascending: false });
      if (error || !data) return [];
      return data.map((record) => ({
        id: record.id,
        projectId,
        datasetId: record.dataset_id,
        userId: record.user_id,
        version: record.version_number,
        contentHash: record.content_hash,
        createdAt: record.created_at,
        description: record.change_description,
        cleaningSteps: Array.isArray(record.cleaning_steps) ? record.cleaning_steps : [],
      }));
    } catch {
      return [];
    }
  }

  public async downloadDatasetVersionRecord(
    versionId: string,
    userId: string,
  ): Promise<{ metadata: CloudDatasetVersion; dataset: StoredDataset } | null> {
    const client = getSupabaseClientInstance();
    if (!client) return null;
    try {
      const { data: record, error } = await client
        .from("dataset_versions")
        .select("*")
        .eq("id", versionId)
        .eq("user_id", userId)
        .maybeSingle();
      if (error || !record) return null;
      const { data: file, error: downloadError } = await client.storage
        .from("lumetra-dataset-versions")
        .download(record.content_path);
      if (downloadError || !file) return null;
      const content = await file.text();
      let dataset: StoredDataset;
      try {
        const parsed = JSON.parse(content) as StoredDataset;
        if (
          parsed.id !== record.dataset_id ||
          !Array.isArray(parsed.columns) ||
          !Array.isArray(parsed.rows) ||
          hashDataset(parsed) !== record.content_hash
        ) {
          throw new Error("The saved dataset content did not match its version details.");
        }
        dataset = parsed;
      } catch (error) {
        if (record.content_path.endsWith(".json")) throw error;
        const { parseCsvText } = await import("../data/parse");
        const parsed = parseCsvText(content, "Recovered dataset");
        if (!parsed.ok) return null;
        dataset = {
          ...parsed.dataset,
          id: record.dataset_id,
          projectId: record.project_id,
          createdAt: record.created_at,
          updatedAt: record.created_at,
        };
      }
      return {
        metadata: {
          id: record.id,
          projectId: record.project_id,
          datasetId: record.dataset_id,
          userId: record.user_id,
          version: record.version_number,
          contentHash: record.content_hash,
          createdAt: record.created_at,
          description: record.change_description,
          cleaningSteps: Array.isArray(record.cleaning_steps) ? record.cleaning_steps : [],
        },
        dataset,
      };
    } catch {
      return null;
    }
  }

  /**
   * Granular, idempotent upsert for a project record.
   */
  public async upsertProjectRecord(
    project: ProjectMeta,
    userId?: string,
  ): Promise<RevisionWriteResult> {
    if (!this.isConfigured()) {
      return { ok: false, error: "Database not configured." };
    }
    const client = getSupabaseClientInstance();
    if (!client) {
      return { ok: false, error: "Database client unavailable." };
    }

    const sessionUserId = await this.resolveSessionUserId(userId);
    if (!sessionUserId || !isValidUuid(sessionUserId) || (userId && sessionUserId !== userId)) {
      return { ok: false, error: "Authentication required to persist project." };
    }

    const projectUuid = toValidUuid(project.id);
    try {
      const expectedRevision = project.revision ?? (project.isCloudSynced ? 1 : 0);
      const values = {
        id: projectUuid,
        user_id: sessionUserId,
        name: project.name,
        description: project.description || null,
        objective: project.objective || null,
        status: project.status,
        updated_at: new Date().toISOString(),
      };

      if (expectedRevision <= 0) {
        const { data, error } = await client
          .from("lumetra_projects")
          .insert({ ...values, revision: 1 })
          .select("revision")
          .maybeSingle();
        if (error?.code === "23505") {
          const current = await client
            .from("lumetra_projects")
            .select("*")
            .eq("id", projectUuid)
            .eq("user_id", sessionUserId)
            .maybeSingle();
          return {
            ok: false,
            conflict: true,
            remoteRevision: current.data?.revision ?? 1,
            ...(current.data ? { remoteRecord: current.data } : {}),
            error: "This project was created on another device.",
          };
        }
        if (error || !data) {
          return {
            ok: false,
            error: error ? formatPersistenceError(error) : "Project insert failed.",
          };
        }
        return { ok: true, revision: data.revision, remoteId: projectUuid };
      }

      const { data: previous, error: readError } = await client
        .from("lumetra_projects")
        .select("*")
        .eq("id", projectUuid)
        .eq("user_id", sessionUserId)
        .maybeSingle();
      if (readError) return { ok: false, error: readError.message };
      if (!previous || previous.revision !== expectedRevision) {
        return {
          ok: false,
          conflict: true,
          remoteRevision: previous?.revision ?? 0,
          ...(previous ? { remoteRecord: previous } : {}),
          error: "This project has a newer saved version.",
        };
      }

      const { error: historyError } = await client.from("project_history").insert({
        project_id: projectUuid,
        user_id: sessionUserId,
        entity_type: "project",
        entity_id: projectUuid,
        revision: expectedRevision,
        change_description: "Project details changed",
        snapshot: {
          id: previous.id,
          name: previous.name,
          description: previous.description,
          objective: previous.objective,
          status: previous.status,
          revision: previous.revision,
          updated_at: previous.updated_at,
        },
      });
      if (historyError) return { ok: false, error: historyError.message };

      const { data, error } = await client
        .from("lumetra_projects")
        .update({ ...values, revision: expectedRevision + 1 })
        .eq("id", projectUuid)
        .eq("user_id", sessionUserId)
        .eq("revision", expectedRevision)
        .select("revision")
        .maybeSingle();
      if (error) return { ok: false, error: error.message };
      if (!data) {
        const current = await client
          .from("lumetra_projects")
          .select("*")
          .eq("id", projectUuid)
          .eq("user_id", sessionUserId)
          .maybeSingle();
        return {
          ok: false,
          conflict: true,
          remoteRevision: current.data?.revision ?? 0,
          ...(current.data ? { remoteRecord: current.data } : {}),
          error: "This project changed while it was being saved.",
        };
      }
      return { ok: true, revision: data.revision, remoteId: projectUuid };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Project write error" };
    }
  }

  /**
   * Granular, idempotent upsert for a dataset record.
   * Incremental: if csvContent is undefined, metadata and cleaning steps are updated
   * without requiring re-uploading the entire CSV payload.
   */
  public async upsertDatasetRecord(
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
      revision?: number;
    },
    userId?: string,
  ): Promise<RevisionWriteResult> {
    if (!this.isConfigured()) {
      return { ok: false, error: "Database not configured." };
    }
    const client = getSupabaseClientInstance();
    if (!client) {
      return { ok: false, error: "Database client unavailable." };
    }

    const sessionUserId = await this.resolveSessionUserId(userId);
    if (!sessionUserId || !isValidUuid(sessionUserId) || (userId && sessionUserId !== userId)) {
      return { ok: false, error: "Authentication required to persist dataset." };
    }

    const projectUuid = toValidUuid(projectId);
    let datasetUuid = toValidUuid(dataset.id || `${projectUuid}_dataset`);
    try {
      let current = await client
        .from("datasets")
        .select("*")
        .eq("id", datasetUuid)
        .eq("user_id", sessionUserId)
        .maybeSingle();
      if (current.error) return { ok: false, error: current.error.message };
      if (!current.data) {
        const existingForProject = await client
          .from("datasets")
          .select("*")
          .eq("project_id", projectUuid)
          .eq("user_id", sessionUserId)
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (existingForProject.error) {
          return { ok: false, error: existingForProject.error.message };
        }
        if (existingForProject.data) {
          current = existingForProject;
          datasetUuid = existingForProject.data.id;
        } else {
          datasetUuid = toValidUuid(`${projectUuid}_dataset`);
          current = await client
            .from("datasets")
            .select("*")
            .eq("id", datasetUuid)
            .eq("user_id", sessionUserId)
            .maybeSingle();
          if (current.error) return { ok: false, error: current.error.message };
        }
      }
      const expectedRevision = dataset.revision ?? 0;
      const revision = current.data?.revision ?? 0;
      if (revision !== expectedRevision) {
        return {
          ok: false,
          conflict: true,
          remoteRevision: revision,
          ...(current.data ? { remoteRecord: current.data } : {}),
          error: "This dataset has a newer saved version.",
        };
      }

      const nextRevision = expectedRevision + 1;
      let contentPath = current.data?.content_path ?? null;
      let csvContent: string | null | undefined;
      let newContentPath: string | null = null;
      const removeUnreferencedUpload = async () => {
        if (!newContentPath) return;
        const { error } = await client.storage
          .from(DATASET_STORAGE_BUCKET)
          .remove([newContentPath]);
        if (error) console.warn("An unused dataset upload could not be removed.");
      };
      if (dataset.csvContent !== undefined) {
        if (
          typeof dataset.csvContent === "string" &&
          new TextEncoder().encode(dataset.csvContent).byteLength > DATASET_STORAGE_THRESHOLD_BYTES
        ) {
          newContentPath = createDatasetContentPath(
            sessionUserId,
            projectUuid,
            datasetUuid,
            nextRevision,
          );
          const { error: uploadError } = await client.storage
            .from(DATASET_STORAGE_BUCKET)
            .upload(newContentPath, new Blob([dataset.csvContent], { type: "text/csv" }), {
              contentType: "text/csv",
            });
          if (uploadError) return { ok: false, error: uploadError.message };
          contentPath = newContentPath;
          csvContent = null;
        } else {
          csvContent = dataset.csvContent;
          contentPath = null;
        }
      }

      const values = {
        project_id: projectUuid,
        user_id: sessionUserId,
        name: dataset.name,
        source: dataset.source === "sample" ? ("sample" as const) : ("upload" as const),
        row_count: dataset.rows,
        column_count: dataset.columns,
        columns: dataset.columnList || [],
        delimiter: dataset.delimiter || ",",
        cleaning_steps: toSupabaseJson(dataset.cleaningSteps || []),
        ...(dataset.typeOverrides !== undefined
          ? { type_overrides: toSupabaseJson(dataset.typeOverrides) }
          : {}),
        ...(dataset.csvContent !== undefined
          ? { csv_content: csvContent ?? null, content_path: contentPath }
          : {}),
        updated_at: new Date().toISOString(),
      };

      if (!current.data) {
        const { data, error } = await client
          .from("datasets")
          .insert({
            id: datasetUuid,
            ...values,
            csv_content: csvContent ?? null,
            content_path: contentPath,
            revision: 1,
          })
          .select("revision")
          .maybeSingle();
        if (error?.code === "23505") {
          await removeUnreferencedUpload();
          const remote = await this.loadDatasetRecord(datasetUuid, sessionUserId);
          return {
            ok: false,
            conflict: true,
            remoteRevision: Number(remote?.["revision"]) || 1,
            ...(remote ? { remoteRecord: remote } : {}),
            error: "This dataset was saved on another device.",
          };
        }
        if (error || !data) {
          await removeUnreferencedUpload();
          return { ok: false, error: error?.message || "Dataset insert failed." };
        }
        return { ok: true, revision: data.revision, datasetId: datasetUuid };
      }

      const { data, error } = await client
        .from("datasets")
        .update({ ...values, revision: expectedRevision + 1 })
        .eq("id", datasetUuid)
        .eq("user_id", sessionUserId)
        .eq("revision", expectedRevision)
        .select("revision")
        .maybeSingle();
      if (error) {
        await removeUnreferencedUpload();
        return { ok: false, error: error.message };
      }
      if (!data) {
        await removeUnreferencedUpload();
        const remote = await this.loadDatasetRecord(datasetUuid, sessionUserId);
        return {
          ok: false,
          conflict: true,
          remoteRevision: Number(remote?.["revision"]) || 0,
          ...(remote ? { remoteRecord: remote } : {}),
          error: "This dataset changed while it was being saved.",
        };
      }
      const oldContentPath = current.data.content_path as string | null;
      if (oldContentPath && oldContentPath !== newContentPath && dataset.csvContent !== undefined) {
        const { error: removeError } = await client.storage
          .from(DATASET_STORAGE_BUCKET)
          .remove([oldContentPath]);
        if (removeError) console.warn("An outdated dataset file could not be removed.");
      }
      return { ok: true, revision: data.revision, datasetId: datasetUuid };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Dataset write error" };
    }
  }

  public async loadDatasetRecord(
    datasetId: string,
    userId: string,
  ): Promise<Record<string, unknown> | null> {
    const client = getSupabaseClientInstance();
    if (!client) return null;
    const { data, error } = await client
      .from("datasets")
      .select("*")
      .eq("id", toValidUuid(datasetId))
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    if (data.content_path) {
      const { data: file, error: downloadError } = await client.storage
        .from(DATASET_STORAGE_BUCKET)
        .download(data.content_path);
      if (downloadError) throw new Error(downloadError.message);
      return { ...data, csv_content: await file.text() };
    }
    return data as Record<string, unknown>;
  }

  public async deleteDatasetRecord(
    projectId: string,
    userId: string,
    expectedRevision: number,
  ): Promise<RevisionWriteResult> {
    const client = getSupabaseClientInstance();
    if (!client) return { ok: false, error: "Database client unavailable." };
    const sessionUserId = await this.resolveSessionUserId(userId);
    if (!sessionUserId || sessionUserId !== userId) {
      return { ok: false, error: "The active account changed before removing this dataset." };
    }
    const projectUuid = toValidUuid(projectId);
    const current = await client
      .from("datasets")
      .select("id, revision, content_path")
      .eq("project_id", projectUuid)
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (current.error) return { ok: false, error: current.error.message };
    if (!current.data) return { ok: true, revision: 0 };
    if (current.data.revision !== expectedRevision) {
      const remote = await this.loadDatasetRecord(current.data.id, userId);
      return {
        ok: false,
        conflict: true,
        remoteRevision: current.data.revision,
        ...(remote ? { remoteRecord: remote } : {}),
        error: "This dataset has a newer saved version.",
      };
    }
    const { error } = await client
      .from("datasets")
      .delete()
      .eq("id", current.data.id)
      .eq("project_id", projectUuid)
      .eq("user_id", userId)
      .eq("revision", expectedRevision);
    if (error) return { ok: false, error: error.message };
    if (current.data.content_path) {
      const { error: storageError } = await client.storage
        .from(DATASET_STORAGE_BUCKET)
        .remove([current.data.content_path]);
      if (storageError) console.warn("An outdated dataset file could not be removed.");
    }
    return { ok: true, revision: 0 };
  }

  /**
   * Granular, idempotent upsert for a saved analysis record.
   */
  public async upsertAnalysisRecord(
    projectId: string,
    analysis: SavedAnalysis,
    userId?: string,
  ): Promise<RevisionWriteResult> {
    if (!this.isConfigured()) {
      return { ok: false, error: "Database not configured." };
    }
    const client = getSupabaseClientInstance();
    if (!client) {
      return { ok: false, error: "Database client unavailable." };
    }

    const sessionUserId = await this.resolveSessionUserId(userId);
    if (!sessionUserId || !isValidUuid(sessionUserId) || (userId && sessionUserId !== userId)) {
      return { ok: false, error: "Authentication required to persist analysis." };
    }

    const projectUuid = toValidUuid(projectId);
    const analysisUuid = toValidUuid(analysis.id);
    try {
      const current = await client
        .from("saved_analyses")
        .select("*")
        .eq("id", analysisUuid)
        .eq("user_id", sessionUserId)
        .maybeSingle();
      if (current.error) return { ok: false, error: current.error.message };
      const expectedRevision = analysis.revision ?? 0;
      const revision = current.data?.revision ?? 0;
      if (revision !== expectedRevision) {
        return {
          ok: false,
          conflict: true,
          remoteRevision: revision,
          ...(current.data ? { remoteRecord: current.data } : {}),
          error: "This analysis has a newer saved version.",
        };
      }

      const values = {
        project_id: projectUuid,
        user_id: sessionUserId,
        name: analysis.name,
        type: analysis.type,
        dataset_id: analysis.datasetId ? toValidUuid(analysis.datasetId) : null,
        dataset_name: analysis.datasetName || null,
        dataset_signature: analysis.datasetSignature,
        dataset_version: analysis.datasetVersion ?? null,
        dataset_version_id: analysis.datasetVersionId ?? null,
        variables: analysis.variables,
        configuration: toSupabaseJson(analysis.configuration),
        sample_size: analysis.sampleSize,
        missing_count: analysis.missingCount,
        missing_handling: analysis.missingHandling,
        results: toSupabaseJson(analysis.results),
        interpretation: toSupabaseJson(analysis.interpretation),
        method_notes: toSupabaseJson(analysis.methodNotes),
        updated_at: new Date().toISOString(),
      };

      if (!current.data) {
        const { data, error } = await client
          .from("saved_analyses")
          .insert({ id: analysisUuid, ...values, revision: 1 })
          .select("revision")
          .maybeSingle();
        if (error?.code === "23505") {
          const remote = await client
            .from("saved_analyses")
            .select("*")
            .eq("id", analysisUuid)
            .eq("user_id", sessionUserId)
            .maybeSingle();
          return {
            ok: false,
            conflict: true,
            remoteRevision: remote.data?.revision ?? 1,
            ...(remote.data ? { remoteRecord: remote.data } : {}),
            error: "This analysis was saved on another device.",
          };
        }
        if (error || !data)
          return { ok: false, error: error?.message || "Analysis insert failed." };
        return { ok: true, revision: data.revision, analysisId: analysisUuid };
      }

      const { error: historyError } = await client.from("project_history").insert({
        project_id: projectUuid,
        user_id: sessionUserId,
        entity_type: "analysis",
        entity_id: analysisUuid,
        revision: expectedRevision,
        change_description: "Saved analysis changed",
        snapshot: {
          id: current.data.id,
          name: current.data.name,
          type: current.data.type,
          dataset_id: current.data.dataset_id,
          dataset_version: current.data.dataset_version,
          dataset_signature: current.data.dataset_signature,
          variables: current.data.variables,
          configuration: current.data.configuration,
          sample_size: current.data.sample_size,
          missing_count: current.data.missing_count,
          results: current.data.results,
          interpretation: current.data.interpretation,
        },
      });
      if (historyError) return { ok: false, error: historyError.message };

      const { data, error } = await client
        .from("saved_analyses")
        .update({ ...values, revision: expectedRevision + 1 })
        .eq("id", analysisUuid)
        .eq("user_id", sessionUserId)
        .eq("revision", expectedRevision)
        .select("revision")
        .maybeSingle();
      if (error) return { ok: false, error: error.message };
      if (!data) {
        const remote = await client
          .from("saved_analyses")
          .select("*")
          .eq("id", analysisUuid)
          .eq("user_id", sessionUserId)
          .maybeSingle();
        return {
          ok: false,
          conflict: true,
          remoteRevision: remote.data?.revision ?? 0,
          ...(remote.data ? { remoteRecord: remote.data } : {}),
          error: "This analysis changed while it was being saved.",
        };
      }
      return { ok: true, revision: data.revision, analysisId: analysisUuid };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Analysis write error" };
    }
  }

  /**
   * Delete a saved analysis from PostgreSQL Cloud.
   */
  public async deleteAnalysisRecord(
    analysisId: string,
    userId?: string,
  ): Promise<{ ok: boolean; error?: string }> {
    if (!this.isConfigured()) return { ok: true };
    const client = getSupabaseClientInstance();
    if (!client) return { ok: false, error: "Client not available" };

    const sessionUserId = await this.resolveSessionUserId(userId);
    if (!sessionUserId || (userId && sessionUserId !== userId)) {
      return { ok: false, error: "Authenticated account changed before analysis deletion." };
    }

    const analysisUuid = toValidUuid(analysisId);
    try {
      const { error } = await client
        .from("saved_analyses")
        .delete()
        .eq("id", analysisUuid)
        .eq("user_id", sessionUserId);
      if (error) return { ok: false, error: error.message };
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Delete error" };
    }
  }

  /**
   * Granular, idempotent upsert for an analytical report.
   */
  public async upsertReportRecord(
    report: {
      id?: string;
      projectId: string;
      title: string;
      markdown: string;
      objective?: string;
      summary?: Record<string, unknown>;
      revision?: number;
    },
    userId?: string,
  ): Promise<RevisionWriteResult> {
    if (!this.isConfigured()) {
      return { ok: true, revision: report.revision ?? 0, id: report.id || generateUuid() };
    }
    const client = getSupabaseClientInstance();
    if (!client) {
      return { ok: false, error: "Database client unavailable." };
    }

    const sessionUserId = await this.resolveSessionUserId(userId);
    if (!sessionUserId || !isValidUuid(sessionUserId) || (userId && sessionUserId !== userId)) {
      return { ok: false, error: "Authentication required to persist report." };
    }

    const reportUuid = toValidUuid(report.id || generateUuid());
    const projectUuid = toValidUuid(report.projectId);
    try {
      const current = await client
        .from("reports")
        .select("*")
        .eq("id", reportUuid)
        .eq("user_id", sessionUserId)
        .maybeSingle();
      if (current.error) return { ok: false, error: current.error.message };
      const expectedRevision = report.revision ?? 0;
      const revision = current.data?.revision ?? 0;
      if (revision !== expectedRevision) {
        return {
          ok: false,
          conflict: true,
          remoteRevision: revision,
          ...(current.data ? { remoteRecord: current.data } : {}),
          error: "This report has a newer saved version.",
        };
      }

      const values = {
        project_id: projectUuid,
        user_id: sessionUserId,
        title: report.title,
        objective: report.objective || null,
        content_markdown: report.markdown,
        summary: report.summary ? toSupabaseJson(report.summary) : null,
        updated_at: new Date().toISOString(),
      };
      if (!current.data) {
        const { data, error } = await client
          .from("reports")
          .insert({ id: reportUuid, ...values, revision: 1 })
          .select("revision")
          .maybeSingle();
        if (error?.code === "23505") {
          const remote = await client
            .from("reports")
            .select("*")
            .eq("id", reportUuid)
            .eq("user_id", sessionUserId)
            .maybeSingle();
          return {
            ok: false,
            conflict: true,
            remoteRevision: remote.data?.revision ?? 1,
            ...(remote.data ? { remoteRecord: remote.data } : {}),
            error: "This report was saved on another device.",
          };
        }
        if (error || !data) return { ok: false, error: error?.message || "Report insert failed." };
        return { ok: true, revision: data.revision, id: reportUuid };
      }

      const { error: historyError } = await client.from("project_history").insert({
        project_id: projectUuid,
        user_id: sessionUserId,
        entity_type: "report",
        entity_id: reportUuid,
        revision: expectedRevision,
        change_description: "Saved report changed",
        snapshot: {
          id: current.data.id,
          title: current.data.title,
          objective: current.data.objective,
          content_markdown: current.data.content_markdown,
          summary: current.data.summary,
          revision: current.data.revision,
        },
      });
      if (historyError) return { ok: false, error: historyError.message };

      const { data, error } = await client
        .from("reports")
        .update({ ...values, revision: expectedRevision + 1 })
        .eq("id", reportUuid)
        .eq("user_id", sessionUserId)
        .eq("revision", expectedRevision)
        .select("revision")
        .maybeSingle();
      if (error) return { ok: false, error: error.message };
      if (!data) {
        const remote = await client
          .from("reports")
          .select("*")
          .eq("id", reportUuid)
          .eq("user_id", sessionUserId)
          .maybeSingle();
        return {
          ok: false,
          conflict: true,
          remoteRevision: remote.data?.revision ?? 0,
          ...(remote.data ? { remoteRecord: remote.data } : {}),
          error: "This report changed while it was being saved.",
        };
      }
      return { ok: true, revision: data.revision, id: reportUuid };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Report write error" };
    }
  }

  /**
   * Delete a report from PostgreSQL Cloud.
   */
  public async deleteReportRecord(
    reportId: string,
    userId?: string,
  ): Promise<{ ok: boolean; error?: string }> {
    if (!this.isConfigured()) return { ok: true };
    const client = getSupabaseClientInstance();
    if (!client) return { ok: false, error: "Client not available" };

    const sessionUserId = await this.resolveSessionUserId(userId);
    if (!sessionUserId || (userId && sessionUserId !== userId)) {
      return { ok: false, error: "Authenticated account changed before report deletion." };
    }

    const reportUuid = toValidUuid(reportId);
    try {
      const { error } = await client
        .from("reports")
        .delete()
        .eq("id", reportUuid)
        .eq("user_id", sessionUserId);
      if (error) return { ok: false, error: error.message };
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Delete error" };
    }
  }

  /**
   * Loads reports saved for a given project.
   */
  public async loadReports(projectId: string): Promise<CloudReport[]> {
    if (!this.isConfigured()) return [];
    const client = getSupabaseClientInstance();
    if (!client) return [];

    const projectUuid = toValidUuid(projectId);
    const { data, error } = await client
      .from("reports")
      .select("*")
      .eq("project_id", projectUuid)
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);
    if (!data) return [];
    return data as unknown as CloudReport[];
  }

  /**
   * Explicit Import Workflow for Local Projects.
   *
   * Guarantees:
   * 1. Requires an authenticated user account to associate imported work.
   * 2. Checks remote projects to detect and prevent duplicate imports on retry.
   * 3. Preserves datasets, cleaning steps, saved analyses, and reports.
   * 4. Verifies remote records by reading them back before marking complete.
   * 5. Never deletes local records before verification.
   */
  public async importLocalProjects(
    localProjects: ProjectMeta[],
    getCsvContent: (project: ProjectMeta) => Promise<string | null>,
    options?: {
      onProgress?: (current: number, total: number) => void;
      userId?: string;
      getDatasetVersions?: (project: ProjectMeta) => Promise<StoredDatasetVersion[]>;
    },
  ): Promise<CloudImportResult> {
    const result: CloudImportResult = {
      success: true,
      imported: 0,
      skipped: 0,
      errors: [],
      projects: [],
    };

    if (!this.isConfigured()) {
      result.success = false;
      result.errors.push("Supabase Cloud is not configured.");
      return result;
    }

    const client = getSupabaseClientInstance();
    if (!client) {
      result.success = false;
      result.errors.push("Supabase client is not available.");
      return result;
    }

    let currentUserId = options?.userId ?? null;
    try {
      const { data: userData, error: userErr } = await client.auth.getUser();
      if (!userErr && userData?.user?.id) {
        currentUserId = userData.user.id;
      } else {
        const { data: sessionData } = await client.auth.getSession();
        if (sessionData?.session?.user?.id) {
          currentUserId = sessionData.session.user.id;
        }
      }
    } catch {
      // Unauthenticated
    }

    if (!currentUserId || !isValidUuid(currentUserId)) {
      result.success = false;
      result.errors.push(
        "Authentication required. Please sign in to an authenticated account to import local projects.",
      );
      return result;
    }

    // Fetch existing remote projects to prevent duplicates on retry
    const existingRemote = await this.listProjects(currentUserId);
    const existingNames = new Set(existingRemote.map((p) => p.name.toLowerCase()));
    const existingIds = new Set(existingRemote.map((p) => p.id));

    const total = localProjects.length;
    let index = 0;

    for (const project of localProjects) {
      index++;
      if (options?.onProgress) {
        options.onProgress(index, total);
      }

      const projectUuid = toValidUuid(project.id);
      // Check for duplicate by ID or exact name
      if (existingIds.has(projectUuid) || existingNames.has(project.name.toLowerCase())) {
        result.skipped++;
        continue;
      }

      try {
        const csv = await getCsvContent(project);
        const datasetVersions = await options?.getDatasetVersions?.(project);
        const saveRes = await this.saveProject(project, csv, currentUserId, {
          ...(datasetVersions ? { datasetVersions } : {}),
        });

        if (!saveRes.ok) {
          result.errors.push(`Project "${project.name}": ${saveRes.error || "Save failed"}`);
          result.success = false;
          continue;
        }

        // Strict verification read-back
        const verified = await this.loadProject(projectUuid);
        if (!verified) {
          result.errors.push(
            `Project "${project.name}": Remote verification read-back failed after write.`,
          );
          result.success = false;
          continue;
        }

        result.imported++;
        result.projects.push({
          ...project,
          id: projectUuid,
          userId: currentUserId,
        });
      } catch (err) {
        result.errors.push(
          `Project "${project.name}": ${err instanceof Error ? err.message : "Unexpected error"}`,
        );
        result.success = false;
      }
    }

    return result;
  }

  // --- Safe Local Cloud Vault fallback (keeps records safe in persistent storage) ---
  private saveToLocalCloudVault(record: CloudRecord) {
    if (typeof window === "undefined") return;
    try {
      const vault = this.listLocalCloudVault();
      const idx = vault.findIndex((r) => r.id === record.id);
      if (idx >= 0) {
        vault[idx] = record;
      } else {
        vault.unshift(record);
      }
      try {
        localStorage.setItem(CLOUD_CACHE_KEY, JSON.stringify(vault.slice(0, 50)));
      } catch {
        // If localStorage quota is exceeded, strip large csv_content to preserve metadata safely
        const fallbackVault = vault.slice(0, 50).map(({ csv_content: _, ...rest }) => rest);
        localStorage.setItem(CLOUD_CACHE_KEY, JSON.stringify(fallbackVault));
      }
    } catch (e) {
      console.warn("Could not write to local cloud cache:", e);
    }
  }

  private listLocalCloudVault(): CloudRecord[] {
    if (typeof window === "undefined") return [];
    try {
      const raw = localStorage.getItem(CLOUD_CACHE_KEY);
      if (!raw) return [];
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }

  private loadFromLocalCloudVault(id: string): CloudRecord | null {
    const vault = this.listLocalCloudVault();
    return vault.find((r) => r.id === id) || null;
  }

  private deleteFromLocalCloudVault(id: string) {
    if (typeof window === "undefined") return;
    try {
      const vault = this.listLocalCloudVault().filter((r) => r.id !== id);
      localStorage.setItem(CLOUD_CACHE_KEY, JSON.stringify(vault));
    } catch {
      // Ignore cache write errors
    }
  }
}

let instance: SupabaseService | null = null;

export function getSupabaseClient(): SupabaseService {
  if (!instance) {
    instance = new SupabaseService();
  }
  return instance;
}

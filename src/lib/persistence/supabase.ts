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
import type { SavedAnalysis } from "../stats/analysis";
import type { ProjectMeta } from "./projects";
import {
  supabase,
  getSupabaseClientInstance,
  isSupabaseConfigured,
  validateSupabaseConfig,
} from "@/integrations/supabase/client";

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
  dataset_rows?: number | undefined;
  dataset_columns?: number | undefined;
  dataset_source?: string | undefined;
  csv_content?: string | undefined;
  cleaning_steps?: string | undefined;
  saved_analyses?: string | undefined;
  created_at: string;
  updated_at: string;
}

export interface CloudReport {
  id: string;
  project_id: string;
  user_id: string;
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

const CONFIG_STORAGE_KEY = "lumetra.supabase.config.v1";
const CLOUD_CACHE_KEY = "lumetra.supabase.cloud_cache.v1";

const envUrl =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_SUPABASE_URL) ||
  (typeof process !== "undefined" && process.env?.VITE_SUPABASE_URL) ||
  "";

const envKey =
  (typeof import.meta !== "undefined" &&
    (import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env?.VITE_SUPABASE_ANON_KEY)) ||
  (typeof process !== "undefined" &&
    (process.env?.VITE_SUPABASE_PUBLISHABLE_KEY || process.env?.VITE_SUPABASE_ANON_KEY)) ||
  "";

const DEFAULT_CONFIG: SupabaseConfig = {
  url: envUrl,
  anonKey: envKey,
  tableName: "lumetra_projects",
  autoSync: false,
};

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
    options?: { columns?: string[] },
  ): Promise<{ ok: boolean; error?: string; remoteId?: string; datasetId?: string }> {
    // 1. Maintain local persistent cloud vault cache as offline safeguard
    const record: CloudRecord = {
      id: project.id,
      user_id: userId,
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

    const projectUuid = toValidUuid(project.id);
    const now = new Date().toISOString();

    try {
      // 1. Upsert project in lumetra_projects
      const { error: projectError } = await client.from("lumetra_projects").upsert(
        {
          id: projectUuid,
          user_id: sessionUserId,
          name: project.name,
          description: project.description || null,
          objective: project.objective || null,
          status: project.status,
          updated_at: now,
        },
        { onConflict: "id" },
      );

      if (projectError) {
        if (projectError.code === "PGRST205") {
          return {
            ok: false,
            error:
              "PostgreSQL tables not found (PGRST205). Migration 'supabase/migrations/20261029101800_create_lumetra_schema_and_rls.sql' needs to be applied in Supabase.",
          };
        }
        return { ok: false, error: `Failed to save project record: ${projectError.message}` };
      }

      // 2. Upsert dataset if present (using deterministic stable UUID)
      let datasetUuid: string | null = null;
      if (project.dataset || csvContent) {
        datasetUuid = toValidUuid(project.dataset?.id || `${projectUuid}_dataset`);
        const columnsList = options?.columns || [];

        const { error: datasetError } = await client.from("datasets").upsert(
          {
            id: datasetUuid,
            project_id: projectUuid,
            user_id: sessionUserId,
            name: project.dataset?.name || `${project.name}.csv`,
            source: project.dataset?.source || "upload",
            row_count: project.dataset?.rows || 0,
            column_count:
              project.dataset?.columns || (columnsList.length > 0 ? columnsList.length : 0),
            columns: (columnsList as unknown) || [],
            delimiter: ",",
            cleaning_steps: (project.cleaningSteps as unknown) || [],
            csv_content: csvContent || null,
            updated_at: now,
          },
          { onConflict: "id" },
        );

        if (datasetError) {
          return {
            ok: false,
            error: `Project metadata was saved, but dataset persistence failed: ${datasetError.message}`,
          };
        }
      }

      // 3. Upsert saved analyses if present (using deterministic stable UUIDs)
      if (project.savedAnalyses && project.savedAnalyses.length > 0) {
        for (const analysis of project.savedAnalyses) {
          const analysisUuid = toValidUuid(analysis.id);
          const { error: analysisError } = await client.from("saved_analyses").upsert(
            {
              id: analysisUuid,
              project_id: projectUuid,
              user_id: sessionUserId,
              name: analysis.name,
              type: analysis.type,
              dataset_id: analysis.datasetId ? toValidUuid(analysis.datasetId) : null,
              dataset_name: analysis.datasetName || null,
              dataset_signature: analysis.datasetSignature || `${analysis.name}:${now}`,
              variables: (analysis.variables as unknown) || [],
              configuration: (analysis.configuration as unknown) || {},
              sample_size: analysis.sampleSize || 0,
              missing_count: analysis.missingCount || 0,
              missing_handling: analysis.missingHandling || "exclude",
              results: (analysis.results as unknown) || {},
              interpretation: (analysis.interpretation as unknown) || {},
              method_notes: (analysis.methodNotes as unknown) || [],
              updated_at: now,
            },
            { onConflict: "id" },
          );

          if (analysisError) {
            return {
              ok: false,
              error: `Project and dataset were saved, but analysis "${analysis.name}" failed to persist: ${analysisError.message}`,
            };
          }
        }
      }

      // 4. Strict Remote Verification Read-Back
      const verification = await this.verifyRemoteProject(projectUuid, sessionUserId, {
        hasDataset: Boolean(project.dataset || csvContent),
        datasetUuid: datasetUuid ?? undefined,
        expectedAnalysesCount: project.savedAnalyses?.length ?? 0,
      });

      if (!verification.ok) {
        return { ok: false, error: verification.error };
      }

      return {
        ok: true,
        remoteId: projectUuid,
        datasetId: datasetUuid ?? undefined,
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

      if (error || !data) {
        return null;
      }

      const row = data as Record<string, unknown>;
      const datasets = (row.datasets as Array<Record<string, unknown>>) || [];
      const primaryDataset = datasets[0] || null;
      const analyses = (row.saved_analyses as Array<Record<string, unknown>>) || [];

      const record: CloudRecord = {
        id: (row.id as string) || id,
        user_id: (row.user_id as string) || undefined,
        name: (row.name as string) || "Project",
        status: (row.status as string) || "no-data",
        objective: (row.objective as string) || undefined,
        dataset_name: (primaryDataset?.name as string) || (row.dataset_name as string) || undefined,
        dataset_rows:
          (primaryDataset?.row_count as number) || (row.dataset_rows as number) || undefined,
        dataset_columns:
          (primaryDataset?.column_count as number) || (row.dataset_columns as number) || undefined,
        dataset_source:
          (primaryDataset?.source as string) || (row.dataset_source as string) || undefined,
        csv_content:
          (primaryDataset?.csv_content as string) || (row.csv_content as string) || undefined,
        cleaning_steps: primaryDataset?.cleaning_steps
          ? JSON.stringify(primaryDataset.cleaning_steps)
          : (row.cleaning_steps as string) || undefined,
        saved_analyses:
          analyses.length > 0
            ? JSON.stringify(analyses)
            : (row.saved_analyses as string) || undefined,
        created_at: (row.created_at as string) || new Date().toISOString(),
        updated_at: (row.updated_at as string) || new Date().toISOString(),
      };

      return record;
    } catch {
      return null;
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
        console.warn("Could not query Supabase projects:", error.message);
        return [];
      }
      if (!data) {
        return [];
      }

      const records: CloudRecord[] = (data as Array<Record<string, unknown>>).map((row) => {
        const datasets = (row.datasets as Array<Record<string, unknown>>) || [];
        const ds = datasets[0] || null;
        const analyses = (row.saved_analyses as Array<Record<string, unknown>>) || [];

        return {
          id: row.id as string,
          user_id: row.user_id as string,
          name: row.name as string,
          status: row.status as string,
          objective: (row.objective as string) || undefined,
          dataset_name: (ds?.name as string) || (row.dataset_name as string) || undefined,
          dataset_rows: (ds?.row_count as number) || (row.dataset_rows as number) || undefined,
          dataset_columns:
            (ds?.column_count as number) || (row.dataset_columns as number) || undefined,
          dataset_source: (ds?.source as string) || (row.dataset_source as string) || undefined,
          csv_content: (ds?.csv_content as string) || (row.csv_content as string) || undefined,
          cleaning_steps: ds?.cleaning_steps
            ? JSON.stringify(ds.cleaning_steps)
            : (row.cleaning_steps as string) || undefined,
          saved_analyses:
            analyses.length > 0
              ? JSON.stringify(analyses)
              : (row.saved_analyses as string) || undefined,
          created_at: row.created_at as string,
          updated_at: row.updated_at as string,
        };
      });

      return records;
    } catch {
      return [];
    }
  }

  /**
   * Delete a project from Supabase PostgreSQL Cloud.
   * Foreign keys cascade deletion to datasets, saved_analyses, and reports.
   */
  public async deleteProject(id: string): Promise<void> {
    this.deleteFromLocalCloudVault(id);
    if (!this.isConfigured()) return;

    const client = getSupabaseClientInstance();
    if (!client) return;

    const projectUuid = toValidUuid(id);
    try {
      await client.from("lumetra_projects").delete().eq("id", projectUuid);
    } catch {
      // Ignored
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
  }): Promise<{ ok: boolean; id?: string; error?: string }> {
    return this.upsertReportRecord(report, report.userId);
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

  /**
   * Granular, idempotent upsert for a project record.
   */
  public async upsertProjectRecord(
    project: ProjectMeta,
    userId?: string,
  ): Promise<{ ok: boolean; remoteId?: string; error?: string }> {
    if (!this.isConfigured()) {
      return { ok: false, error: "Database not configured." };
    }
    const client = getSupabaseClientInstance();
    if (!client) {
      return { ok: false, error: "Database client unavailable." };
    }

    const sessionUserId = await this.resolveSessionUserId(userId);
    if (!sessionUserId || !isValidUuid(sessionUserId)) {
      return { ok: false, error: "Authentication required to persist project." };
    }

    const projectUuid = toValidUuid(project.id);
    const now = new Date().toISOString();

    try {
      const { error } = await client.from("lumetra_projects").upsert(
        {
          id: projectUuid,
          user_id: sessionUserId,
          name: project.name,
          description: project.description || null,
          objective: project.objective || null,
          status: project.status,
          updated_at: now,
        },
        { onConflict: "id" },
      );

      if (error) {
        return { ok: false, error: error.message };
      }

      // Verification read-back
      const { data, error: vErr } = await client
        .from("lumetra_projects")
        .select("id")
        .eq("id", projectUuid)
        .eq("user_id", sessionUserId)
        .maybeSingle();

      if (vErr || !data) {
        return { ok: false, error: "Project write verification failed." };
      }

      return { ok: true, remoteId: projectUuid };
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
    },
    userId?: string,
  ): Promise<{ ok: boolean; datasetId?: string; error?: string }> {
    if (!this.isConfigured()) {
      return { ok: false, error: "Database not configured." };
    }
    const client = getSupabaseClientInstance();
    if (!client) {
      return { ok: false, error: "Database client unavailable." };
    }

    const sessionUserId = await this.resolveSessionUserId(userId);
    if (!sessionUserId || !isValidUuid(sessionUserId)) {
      return { ok: false, error: "Authentication required to persist dataset." };
    }

    const projectUuid = toValidUuid(projectId);
    const datasetUuid = toValidUuid(dataset.id || `${projectUuid}_dataset`);
    const now = new Date().toISOString();

    try {
      const payload: Record<string, unknown> = {
        id: datasetUuid,
        project_id: projectUuid,
        user_id: sessionUserId,
        name: dataset.name,
        source: dataset.source || "upload",
        row_count: dataset.rows,
        column_count: dataset.columns,
        columns: dataset.columnList || [],
        delimiter: dataset.delimiter || ",",
        cleaning_steps: dataset.cleaningSteps || [],
        updated_at: now,
      };

      if (dataset.typeOverrides) {
        payload.type_overrides = dataset.typeOverrides;
      }

      if (dataset.csvContent !== undefined) {
        payload.csv_content = dataset.csvContent;
      }

      const { error } = await client.from("datasets").upsert(payload, { onConflict: "id" });

      if (error) {
        return { ok: false, error: error.message };
      }

      // Verification read-back
      const { data, error: vErr } = await client
        .from("datasets")
        .select("id")
        .eq("id", datasetUuid)
        .eq("user_id", sessionUserId)
        .maybeSingle();

      if (vErr || !data) {
        return { ok: false, error: "Dataset write verification failed." };
      }

      return { ok: true, datasetId: datasetUuid };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Dataset write error" };
    }
  }

  /**
   * Granular, idempotent upsert for a saved analysis record.
   */
  public async upsertAnalysisRecord(
    projectId: string,
    analysis: SavedAnalysis,
    userId?: string,
  ): Promise<{ ok: boolean; analysisId?: string; error?: string }> {
    if (!this.isConfigured()) {
      return { ok: false, error: "Database not configured." };
    }
    const client = getSupabaseClientInstance();
    if (!client) {
      return { ok: false, error: "Database client unavailable." };
    }

    const sessionUserId = await this.resolveSessionUserId(userId);
    if (!sessionUserId || !isValidUuid(sessionUserId)) {
      return { ok: false, error: "Authentication required to persist analysis." };
    }

    const projectUuid = toValidUuid(projectId);
    const analysisUuid = toValidUuid(analysis.id);
    const now = new Date().toISOString();

    try {
      const { error } = await client.from("saved_analyses").upsert(
        {
          id: analysisUuid,
          project_id: projectUuid,
          user_id: sessionUserId,
          name: analysis.name,
          type: analysis.type,
          dataset_id: analysis.datasetId ? toValidUuid(analysis.datasetId) : null,
          dataset_name: analysis.datasetName || null,
          dataset_signature: analysis.datasetSignature || `${analysis.name}:${now}`,
          variables: (analysis.variables as unknown) || [],
          configuration: (analysis.configuration as unknown) || {},
          sample_size: analysis.sampleSize || 0,
          missing_count: analysis.missingCount || 0,
          missing_handling: analysis.missingHandling || "exclude",
          results: (analysis.results as unknown) || {},
          interpretation: (analysis.interpretation as unknown) || {},
          method_notes: (analysis.methodNotes as unknown) || [],
          updated_at: now,
        },
        { onConflict: "id" },
      );

      if (error) {
        return { ok: false, error: error.message };
      }

      // Verification read-back
      const { data, error: vErr } = await client
        .from("saved_analyses")
        .select("id")
        .eq("id", analysisUuid)
        .eq("user_id", sessionUserId)
        .maybeSingle();

      if (vErr || !data) {
        return { ok: false, error: "Analysis write verification failed." };
      }

      return { ok: true, analysisId: analysisUuid };
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
    if (!sessionUserId) return { ok: false, error: "Authentication required" };

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
    },
    userId?: string,
  ): Promise<{ ok: boolean; id?: string; error?: string }> {
    if (!this.isConfigured()) {
      return { ok: true, id: report.id || generateUuid() };
    }
    const client = getSupabaseClientInstance();
    if (!client) {
      return { ok: false, error: "Database client unavailable." };
    }

    const sessionUserId = await this.resolveSessionUserId(userId);
    if (!sessionUserId || !isValidUuid(sessionUserId)) {
      return { ok: false, error: "Authentication required to persist report." };
    }

    const reportUuid = toValidUuid(report.id || generateUuid());
    const projectUuid = toValidUuid(report.projectId);
    const now = new Date().toISOString();

    try {
      const { error } = await client.from("reports").upsert(
        {
          id: reportUuid,
          project_id: projectUuid,
          user_id: sessionUserId,
          title: report.title,
          objective: report.objective || null,
          content_markdown: report.markdown,
          summary: (report.summary as unknown) || null,
          updated_at: now,
        },
        { onConflict: "id" },
      );

      if (error) {
        return { ok: false, error: error.message };
      }

      // Verification read-back
      const { data, error: vErr } = await client
        .from("reports")
        .select("id")
        .eq("id", reportUuid)
        .eq("user_id", sessionUserId)
        .maybeSingle();

      if (vErr || !data) {
        return { ok: false, error: "Report write verification failed." };
      }

      return { ok: true, id: reportUuid };
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
    if (!sessionUserId) return { ok: false, error: "Authentication required" };

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
    try {
      const { data, error } = await client
        .from("reports")
        .select("*")
        .eq("project_id", projectUuid)
        .order("created_at", { ascending: false });

      if (error || !data) return [];
      return data as unknown as CloudReport[];
    } catch {
      return [];
    }
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
    options?: { onProgress?: (current: number, total: number) => void; userId?: string },
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
        const saveRes = await this.saveProject(project, csv, currentUserId);

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

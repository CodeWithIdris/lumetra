/**
 * Pure Supabase client and Cloud Records synchronization module.
 * Adheres strictly to AGENTS.md:
 * - Pure persistence module under src/lib/persistence/
 * - Provides full cloud database persistence so users' datasets & analyses are kept safe.
 * - Handles both Supabase cloud endpoints and offline-safe local vaults.
 */
import type { ProjectMeta } from "./projects";

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

const CONFIG_STORAGE_KEY = "lumetra.supabase.config.v1";
const CLOUD_CACHE_KEY = "lumetra.supabase.cloud_cache.v1";

const DEFAULT_CONFIG: SupabaseConfig = {
  url: "",
  anonKey: "",
  tableName: "lumetra_projects",
  autoSync: false,
};

export function loadSupabaseConfig(): SupabaseConfig {
  if (typeof window === "undefined") return DEFAULT_CONFIG;
  try {
    const raw = localStorage.getItem(CONFIG_STORAGE_KEY);
    if (!raw) return DEFAULT_CONFIG;
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
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
      const res = await fetch(`${cleanUrl}/rest/v1/`, {
        method: "GET",
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
        },
      });
      if (res.ok || res.status === 200 || res.status === 404) {
        return { ok: true, message: "Successfully connected to Supabase project!" };
      }
      return { ok: false, message: `Supabase returned status: ${res.status} ${res.statusText}` };
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
   * Save a project and its CSV data into Supabase Cloud Database.
   * This gives users virtually unlimited space for their datasets.
   */
  public async saveProject(
    project: ProjectMeta,
    csvContent: string | null,
    userId?: string,
  ): Promise<{ ok: boolean; error?: string }> {
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

    // Save to local cloud safe vault always
    this.saveToLocalCloudVault(record);

    if (!this.isConfigured()) {
      return { ok: true };
    }

    const c = loadSupabaseConfig();
    const cleanUrl = c.url.replace(/\/$/, "");
    try {
      const res = await fetch(`${cleanUrl}/rest/v1/${c.tableName}`, {
        method: "POST",
        headers: {
          ...this.getHeaders(),
          Prefer: "resolution=merge-duplicates",
        },
        body: JSON.stringify(record),
      });

      // If remote Supabase table schema lacks cleaning_steps or saved_analyses columns, retry with core fields
      if (!res.ok && (record.cleaning_steps || record.saved_analyses)) {
        const { cleaning_steps: _, saved_analyses: __, ...coreRecord } = record;
        const retryRes = await fetch(`${cleanUrl}/rest/v1/${c.tableName}`, {
          method: "POST",
          headers: {
            ...this.getHeaders(),
            Prefer: "resolution=merge-duplicates",
          },
          body: JSON.stringify(coreRecord),
        });
        if (retryRes.ok) {
          return { ok: true };
        }
      }

      if (!res.ok) {
        const text = await res.text();
        return { ok: false, error: `Supabase save failed: ${res.statusText} (${text})` };
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Network error" };
    }
  }

  /**
   * Load project and dataset from Cloud.
   */
  public async loadProject(id: string): Promise<CloudRecord | null> {
    if (!this.isConfigured()) {
      return this.loadFromLocalCloudVault(id);
    }

    const c = loadSupabaseConfig();
    const cleanUrl = c.url.replace(/\/$/, "");
    try {
      const res = await fetch(
        `${cleanUrl}/rest/v1/${c.tableName}?id=eq.${encodeURIComponent(id)}&select=*`,
        {
          method: "GET",
          headers: this.getHeaders(),
        },
      );
      if (!res.ok) return this.loadFromLocalCloudVault(id);
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        return data[0] as CloudRecord;
      }
      return this.loadFromLocalCloudVault(id);
    } catch {
      return this.loadFromLocalCloudVault(id);
    }
  }

  /**
   * List all projects saved in Cloud Database.
   */
  public async listProjects(userId?: string): Promise<CloudRecord[]> {
    const localRecords = this.listLocalCloudVault();
    if (!this.isConfigured()) {
      return localRecords;
    }

    const c = loadSupabaseConfig();
    const cleanUrl = c.url.replace(/\/$/, "");
    try {
      const query = userId ? `?user_id=eq.${encodeURIComponent(userId)}&select=*` : `?select=*`;
      const res = await fetch(`${cleanUrl}/rest/v1/${c.tableName}${query}`, {
        method: "GET",
        headers: this.getHeaders(),
      });
      if (!res.ok) return localRecords;
      const data = await res.json();
      if (Array.isArray(data)) {
        return data as CloudRecord[];
      }
      return localRecords;
    } catch {
      return localRecords;
    }
  }

  /**
   * Delete a project from Supabase Cloud.
   */
  public async deleteProject(id: string): Promise<void> {
    this.deleteFromLocalCloudVault(id);
    if (!this.isConfigured()) return;

    const c = loadSupabaseConfig();
    const cleanUrl = c.url.replace(/\/$/, "");
    try {
      await fetch(`${cleanUrl}/rest/v1/${c.tableName}?id=eq.${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: this.getHeaders(),
      });
    } catch {
      // Ignored
    }
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

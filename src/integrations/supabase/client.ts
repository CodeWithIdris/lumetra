import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types";

/**
 * Supabase client integration for Lumetra.
 * Follows AGENTS.md and Vite environment variable conventions:
 * - Uses VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY (with VITE_SUPABASE_ANON_KEY as fallback alias)
 * - Resolves environment variables first, falling back to local persistent config if user saved in Settings.
 * - Only the public Project URL and Publishable / Anon key are used in the client.
 * - Secret keys (e.g. service_role) must NEVER be exposed to frontend code.
 */

export interface SupabaseConfigStatus {
  isConfigured: boolean;
  missing: string[];
  error: string | null;
  url: string;
  source: "env" | "storage" | "none";
}

/**
 * Safely resolves Supabase credentials from Vite environment variables or saved settings.
 */
export function getEffectiveCredentials(): {
  url: string;
  key: string;
  source: "env" | "storage" | "none";
} {
  const envUrl =
    (typeof import.meta !== "undefined" && import.meta.env?.VITE_SUPABASE_URL) ||
    (typeof process !== "undefined" && process.env?.VITE_SUPABASE_URL) ||
    "";

  const envKey =
    (typeof import.meta !== "undefined" &&
      (import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY ||
        import.meta.env?.VITE_SUPABASE_ANON_KEY)) ||
    (typeof process !== "undefined" &&
      (process.env?.VITE_SUPABASE_PUBLISHABLE_KEY ||
        process.env?.VITE_SUPABASE_ANON_KEY)) ||
    "";

  if (envUrl.trim() && envKey.trim()) {
    return { url: envUrl.trim(), key: envKey.trim(), source: "env" };
  }

  // Fallback: check if the user entered valid credentials in Settings (stored locally)
  if (typeof window !== "undefined") {
    try {
      const raw = localStorage.getItem("lumetra.supabase.config.v1");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (
          parsed.url &&
          parsed.anonKey &&
          typeof parsed.url === "string" &&
          parsed.url.startsWith("http") &&
          typeof parsed.anonKey === "string" &&
          parsed.anonKey.length > 10
        ) {
          return { url: parsed.url.trim(), key: parsed.anonKey.trim(), source: "storage" };
        }
      }
    } catch {
      // Local storage unreadable or unavailable
    }
  }

  return { url: envUrl.trim(), key: envKey.trim(), source: "none" };
}

/**
 * Validates Supabase environment variables and returns status and any missing keys.
 */
export function validateSupabaseConfig(): SupabaseConfigStatus {
  const creds = getEffectiveCredentials();
  const missing: string[] = [];

  if (!creds.url) {
    missing.push("VITE_SUPABASE_URL");
  }
  if (!creds.key) {
    missing.push("VITE_SUPABASE_PUBLISHABLE_KEY");
  }

  if (missing.length > 0) {
    const error =
      `Supabase configuration error: Missing required environment variable(s): ${missing.join(", ")}. ` +
      `Please define ${missing.join(" and ")} in your .env.local file or deployment environment settings. ` +
      `Note: Only use the Supabase project URL and public publishable/anon key. Never expose service_role or secret keys.`;
    return {
      isConfigured: false,
      missing,
      error,
      url: creds.url,
      source: creds.source,
    };
  }

  return {
    isConfigured: true,
    missing: [],
    error: null,
    url: creds.url,
    source: creds.source,
  };
}

export function isSupabaseConfigured(): boolean {
  return validateSupabaseConfig().isConfigured;
}

// Cached client instance for active URL & key
let cachedClient: SupabaseClient<Database> | null = null;
let cachedUrl = "";
let cachedKey = "";

export function getSupabaseClientInstance(): SupabaseClient<Database> | null {
  const creds = getEffectiveCredentials();
  if (!creds.url || !creds.key || !creds.url.startsWith("http")) {
    return null;
  }
  if (!cachedClient || cachedUrl !== creds.url || cachedKey !== creds.key) {
    cachedUrl = creds.url;
    cachedKey = creds.key;
    cachedClient = createClient<Database>(creds.url, creds.key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }
  return cachedClient;
}

/**
 * Returns a configured SupabaseClient or throws a clear error if configuration is missing.
 */
export function getSupabase(): SupabaseClient<Database> {
  const client = getSupabaseClientInstance();
  if (!client) {
    const status = validateSupabaseConfig();
    throw new Error(status.error ?? "Supabase is not configured.");
  }
  return client;
}

/**
 * Supabase client instance.
 * If credentials are missing, attempting to access client operations will throw
 * a descriptive configuration error detailing which environment variables to set.
 */
export const supabase: SupabaseClient<Database> = new Proxy({} as SupabaseClient<Database>, {
  get(_target, prop) {
    if (prop === "then" || prop === Symbol.toStringTag) {
      return undefined;
    }
    const client = getSupabaseClientInstance();
    if (client) {
      const val = (client as unknown as Record<string, unknown>)[prop as string];
      return typeof val === "function" ? (val as (...args: unknown[]) => unknown).bind(client) : val;
    }
    const status = validateSupabaseConfig();
    throw new Error(
      `Cannot execute Supabase operation "${String(prop)}": ${status.error}`
    );
  },
});

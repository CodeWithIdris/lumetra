import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types";

/**
 * Supabase client configuration for Lumetra.
 * Follows AGENTS.md and Vite environment variable conventions:
 * - Uses VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY (with VITE_SUPABASE_ANON_KEY as fallback alias)
 * - Only the public Project URL and Publishable / Anon key are used in the client.
 * - Secret keys (e.g. service_role) must NEVER be exposed to frontend code.
 */

const supabaseUrl: string =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_SUPABASE_URL) ||
  (typeof process !== "undefined" && process.env?.VITE_SUPABASE_URL) ||
  "";

const supabasePublishableKey: string =
  (typeof import.meta !== "undefined" &&
    (import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY ||
      import.meta.env?.VITE_SUPABASE_ANON_KEY)) ||
  (typeof process !== "undefined" &&
    (process.env?.VITE_SUPABASE_PUBLISHABLE_KEY ||
      process.env?.VITE_SUPABASE_ANON_KEY)) ||
  "";

export interface SupabaseConfigStatus {
  isConfigured: boolean;
  missing: string[];
  error: string | null;
  url: string;
}

/**
 * Validates Supabase environment variables and returns status and any missing keys.
 */
export function validateSupabaseConfig(): SupabaseConfigStatus {
  const missing: string[] = [];
  if (!supabaseUrl || !supabaseUrl.trim()) {
    missing.push("VITE_SUPABASE_URL");
  }
  if (!supabasePublishableKey || !supabasePublishableKey.trim()) {
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
      url: supabaseUrl,
    };
  }

  return {
    isConfigured: true,
    missing: [],
    error: null,
    url: supabaseUrl,
  };
}

export const supabaseConfigStatus = validateSupabaseConfig();
export const isSupabaseConfigured = supabaseConfigStatus.isConfigured;

if (!supabaseConfigStatus.isConfigured) {
  // Clear developer warning in browser console
  console.warn(`[Lumetra] ${supabaseConfigStatus.error}`);
}

// Internal raw Supabase client instance
const rawClient: SupabaseClient<Database> | null = isSupabaseConfigured
  ? createClient<Database>(supabaseUrl, supabasePublishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
    })
  : null;

/**
 * Returns a configured SupabaseClient or throws a clear error if configuration is missing.
 */
export function getSupabase(): SupabaseClient<Database> {
  const status = validateSupabaseConfig();
  if (!status.isConfigured || !rawClient) {
    throw new Error(status.error ?? "Supabase is not configured.");
  }
  return rawClient;
}

/**
 * Supabase client instance.
 * If credentials are missing, attempting to access client operations will throw
 * a descriptive configuration error detailing which environment variables to set.
 */
export const supabase: SupabaseClient<Database> =
  rawClient ??
  (new Proxy({} as SupabaseClient<Database>, {
    get(_target, prop) {
      if (prop === "then" || prop === Symbol.toStringTag) {
        return undefined;
      }
      const status = validateSupabaseConfig();
      throw new Error(
        `Cannot execute Supabase operation "${String(prop)}": ${status.error}`
      );
    },
  }));


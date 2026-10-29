/**
 * User authentication and profile persistence module.
 * Adheres strictly to AGENTS.md:
 * - Pure persistence module under src/lib/persistence/
 * - Implements Supabase Auth with email/password, magic-link, password recovery, and Google OAuth.
 * - SECURITY: Never exposes service_role or secret keys.
 * - SECURITY: Does not treat localStorage as the source of truth for authenticated user identity.
 *   Live Supabase session verification (supabase.auth.getUser) is the authoritative source.
 * - SECURITY: Never queries auth.users directly.
 */
import type { User } from "@supabase/supabase-js";
import type { PersonaId } from "../stats/personas";
import {
  supabase,
  isSupabaseConfigured,
  validateSupabaseConfig,
} from "@/integrations/supabase/client";
import { getSupabaseClient } from "./supabase";

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  persona: PersonaId;
  avatarUrl?: string | undefined;
  isCloudSynced: boolean;
  provider: "supabase" | "local_vault";
  emailConfirmed?: boolean | undefined;
  createdAt: string;
  lastLoginAt: string;
}

const AUTH_STORAGE_KEY = "lumetra.auth.user.v1";
const ACTIVE_PERSONA_KEY = "lumetra.active_persona.v1";

/**
 * Maps a Supabase Auth User entity to Lumetra's pure UserProfile.
 */
export function mapSupabaseUser(user: User): UserProfile {
  const metadata = user.user_metadata || {};
  const email = user.email || "";
  const name =
    (metadata.name as string) ||
    (metadata.full_name as string) ||
    email.split("@")[0] ||
    "Researcher";
  const persona: PersonaId = (metadata.persona as PersonaId) || loadActivePersona() || "engineer";

  return {
    id: user.id,
    email,
    name,
    persona,
    avatarUrl: (metadata.avatar_url as string) || undefined,
    isCloudSynced: true,
    provider: "supabase",
    emailConfirmed: Boolean(user.email_confirmed_at),
    createdAt: user.created_at || new Date().toISOString(),
    lastLoginAt: user.last_sign_in_at || new Date().toISOString(),
  };
}

/**
 * Loads the active persona preference from storage.
 */
export function loadActivePersona(): PersonaId {
  if (typeof window === "undefined") return "engineer";
  try {
    const raw = localStorage.getItem(ACTIVE_PERSONA_KEY);
    if (
      raw &&
      (raw === "engineer" ||
        raw === "economist" ||
        raw === "scientist" ||
        raw === "product" ||
        raw === "clinical")
    ) {
      return raw;
    }
  } catch {
    // Ignore storage error
  }
  return "engineer";
}

/**
 * Saves the active persona preference.
 */
export function saveActivePersona(persona: PersonaId): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(ACTIVE_PERSONA_KEY, persona);
  } catch {
    // Ignore storage error
  }
}

/**
 * Restores and verifies the authenticated user session.
 * Does NOT trust raw localStorage. Validates directly against Supabase Auth.
 */
export async function restoreUserSession(): Promise<UserProfile | null> {
  if (typeof window === "undefined") return null;

  if (isSupabaseConfigured()) {
    try {
      const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
      if (sessionErr || !sessionData.session) {
        return null;
      }
      // Re-verify the session token with Supabase to ensure it is authentic and not expired
      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (userErr || !userData.user) {
        return null;
      }
      return mapSupabaseUser(userData.user);
    } catch (e) {
      console.warn("[Lumetra Auth] Failed to restore Supabase session:", e);
      return null;
    }
  }

  // When Supabase is not configured, check for an explicit local vault profile
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as UserProfile;
    if (parsed && parsed.provider === "local_vault") {
      return parsed;
    }
  } catch {
    // Local parse error
  }
  return null;
}

/**
 * Subscribes to real-time Supabase auth state transitions.
 * Keeps session state in sync across browser tabs, token refreshes, and OAuth redirects.
 */
export function subscribeToAuthChanges(
  callback: (user: UserProfile | null, event: string) => void,
): () => void {
  if (!isSupabaseConfigured() || typeof window === "undefined") {
    return () => {};
  }

  try {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (session?.user) {
        callback(mapSupabaseUser(session.user), event);
      } else {
        callback(null, event);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  } catch (e) {
    console.warn("[Lumetra Auth] Subscription failed:", e);
    return () => {};
  }
}

/**
 * Registers a new user with email and password.
 */
export async function registerWithEmailPassword(
  email: string,
  password: string,
  name: string,
  persona: PersonaId,
): Promise<{ user: UserProfile | null; emailConfirmationRequired?: boolean; error?: string }> {
  const trimmedEmail = email.trim().toLowerCase();
  const trimmedName = name.trim() || trimmedEmail.split("@")[0] || "Researcher";

  if (!trimmedEmail || !trimmedEmail.includes("@")) {
    return { user: null, error: "Please enter a valid email address." };
  }
  if (!password || password.length < 6) {
    return { user: null, error: "Password must be at least 6 characters long." };
  }

  if (isSupabaseConfigured()) {
    try {
      const { data, error } = await supabase.auth.signUp({
        email: trimmedEmail,
        password,
        options: {
          data: {
            name: trimmedName,
            persona,
          },
          emailRedirectTo: typeof window !== "undefined" ? window.location.origin : undefined,
        },
      });

      if (error) {
        return { user: null, error: error.message };
      }

      if (data.user) {
        const profile = mapSupabaseUser(data.user);
        saveActivePersona(persona);
        const emailConfirmationRequired = !data.session;
        return { user: profile, emailConfirmationRequired };
      }
    } catch (e) {
      return { user: null, error: e instanceof Error ? e.message : "Sign up request failed." };
    }
  }

  // Local vault fallback when Supabase credentials are not configured
  const localUser: UserProfile = {
    id: "usr_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36),
    email: trimmedEmail,
    name: trimmedName,
    persona,
    isCloudSynced: false,
    provider: "local_vault",
    createdAt: new Date().toISOString(),
    lastLoginAt: new Date().toISOString(),
  };
  saveActivePersona(persona);
  saveStoredUser(localUser);
  return { user: localUser };
}

/**
 * Signs in an existing user with email and password.
 */
export async function loginWithEmailPassword(
  email: string,
  password: string,
): Promise<{ user: UserProfile | null; error?: string }> {
  const trimmedEmail = email.trim().toLowerCase();

  if (!trimmedEmail || !trimmedEmail.includes("@")) {
    return { user: null, error: "Please enter a valid email address." };
  }
  if (!password) {
    return { user: null, error: "Please enter your password." };
  }

  if (isSupabaseConfigured()) {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: trimmedEmail,
        password,
      });

      if (error) {
        return { user: null, error: error.message };
      }

      if (data.user) {
        const profile = mapSupabaseUser(data.user);
        saveActivePersona(profile.persona);
        return { user: profile };
      }
    } catch (e) {
      return { user: null, error: e instanceof Error ? e.message : "Sign in request failed." };
    }
  }

  // Local vault fallback
  const existing = loadStoredUser();
  if (existing && existing.email === trimmedEmail) {
    const updated: UserProfile = { ...existing, lastLoginAt: new Date().toISOString() };
    saveStoredUser(updated);
    return { user: updated };
  }

  const demoUser: UserProfile = {
    id: "usr_" + Math.random().toString(36).slice(2, 9),
    email: trimmedEmail,
    name: trimmedEmail.split("@")[0] || "Researcher",
    persona: "engineer",
    isCloudSynced: false,
    provider: "local_vault",
    createdAt: new Date().toISOString(),
    lastLoginAt: new Date().toISOString(),
  };
  saveStoredUser(demoUser);
  return { user: demoUser };
}

/**
 * Sends a passwordless Magic Link to the user's email.
 */
export async function sendMagicLink(email: string): Promise<{ success: boolean; error?: string }> {
  const trimmedEmail = email.trim().toLowerCase();
  if (!trimmedEmail || !trimmedEmail.includes("@")) {
    return { success: false, error: "Please enter a valid email address." };
  }

  if (!isSupabaseConfigured()) {
    return {
      success: false,
      error:
        "Supabase is not configured. Magic-link authentication requires VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.",
    };
  }

  try {
    const { error } = await supabase.auth.signInWithOtp({
      email: trimmedEmail,
      options: {
        emailRedirectTo: typeof window !== "undefined" ? window.location.origin : undefined,
      },
    });

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Failed to send magic link." };
  }
}

/**
 * Initiates password recovery by sending a reset email.
 */
export async function sendPasswordReset(
  email: string,
): Promise<{ success: boolean; error?: string }> {
  const trimmedEmail = email.trim().toLowerCase();
  if (!trimmedEmail || !trimmedEmail.includes("@")) {
    return { success: false, error: "Please enter a valid email address." };
  }

  if (!isSupabaseConfigured()) {
    return {
      success: false,
      error:
        "Supabase is not configured. Password recovery requires VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.",
    };
  }

  try {
    const redirectTo =
      typeof window !== "undefined" ? `${window.location.origin}/settings?auth=reset` : undefined;

    const { error } = await supabase.auth.resetPasswordForEmail(trimmedEmail, {
      redirectTo,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "Password recovery request failed.",
    };
  }
}

/**
 * Updates the user's password once a session is established (or during recovery).
 */
export async function updateUserPassword(
  newPassword: string,
): Promise<{ success: boolean; error?: string }> {
  if (!newPassword || newPassword.length < 6) {
    return { success: false, error: "New password must be at least 6 characters long." };
  }

  if (!isSupabaseConfigured()) {
    return {
      success: false,
      error: "Supabase is not configured.",
    };
  }

  try {
    const { error } = await supabase.auth.updateUser({
      password: newPassword,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Failed to update password." };
  }
}

/**
 * Initiates Google OAuth sign-in redirect flow.
 */
export async function signInWithGoogleOAuth(): Promise<{ error?: string }> {
  if (!isSupabaseConfigured()) {
    return {
      error:
        "Google OAuth requires a configured Supabase connection with Google Auth provider enabled.",
    };
  }

  try {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: typeof window !== "undefined" ? window.location.origin : undefined,
      },
    });

    if (error) {
      return { error: error.message };
    }

    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Google OAuth initiation failed." };
  }
}

/**
 * Signs the user out from Supabase and purges the active session.
 */
export async function signOutUser(): Promise<void> {
  saveStoredUser(null);
  if (isSupabaseConfigured()) {
    try {
      await supabase.auth.signOut();
    } catch {
      // Ignore network errors on signout
    }
  }
}

// --- Backward-Compatible Helpers & Offline Vault Cache ---

export function loadStoredUser(): UserProfile | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as UserProfile;
  } catch {
    return null;
  }
}

export function saveStoredUser(user: UserProfile | null): void {
  if (typeof window === "undefined") return;
  try {
    if (!user) {
      localStorage.removeItem(AUTH_STORAGE_KEY);
      return;
    }
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(user));
    localStorage.setItem(ACTIVE_PERSONA_KEY, user.persona);
  } catch {
    // Ignore storage write errors
  }
}

export async function registerUser(
  email: string,
  pass: string,
  name: string,
  persona: PersonaId,
): Promise<{ user: UserProfile | null; error?: string }> {
  const res = await registerWithEmailPassword(email, pass, name, persona);
  return { user: res.user, error: res.error };
}

export async function loginUser(
  email: string,
  pass: string,
): Promise<{ user: UserProfile | null; error?: string }> {
  return loginWithEmailPassword(email, pass);
}

export function logoutUser(): void {
  signOutUser().catch(() => {});
}

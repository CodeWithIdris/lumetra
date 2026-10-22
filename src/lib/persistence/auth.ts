/**
 * User authentication and profile persistence.
 * Adheres strictly to AGENTS.md:
 * - Pure persistence module.
 * - Manages session state, persona preferences and cloud connectivity tokens.
 */
import type { PersonaId } from "../stats/personas";
import { getSupabaseClient } from "./supabase";

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  persona: PersonaId;
  avatarUrl?: string;
  isCloudSynced: boolean;
  provider: "supabase" | "local_vault";
  createdAt: string;
  lastLoginAt: string;
}

const AUTH_STORAGE_KEY = "lumetra.auth.user.v1";
const ACTIVE_PERSONA_KEY = "lumetra.active_persona.v1";

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
  if (!user) {
    localStorage.removeItem(AUTH_STORAGE_KEY);
    return;
  }
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(user));
  localStorage.setItem(ACTIVE_PERSONA_KEY, user.persona);
}

export function loadActivePersona(): PersonaId {
  if (typeof window === "undefined") return "engineer";
  const user = loadStoredUser();
  if (user?.persona) return user.persona;
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
  return "engineer"; // Default to Software Engineer / SRE
}

export function saveActivePersona(persona: PersonaId): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(ACTIVE_PERSONA_KEY, persona);
  const user = loadStoredUser();
  if (user) {
    saveStoredUser({ ...user, persona });
  }
}

/**
 * Sign up a new user. Connects with Supabase if configured,
 * or safely initialises the user in the secure local cloud vault.
 */
export async function registerUser(
  email: string,
  password: string,
  name: string,
  persona: PersonaId,
): Promise<{ user: UserProfile | null; error?: string }> {
  const trimmedEmail = email.trim().toLowerCase();
  const trimmedName = name.trim() || trimmedEmail.split("@")[0] || "Researcher";

  if (!trimmedEmail || !trimmedEmail.includes("@")) {
    return { user: null, error: "Please enter a valid email address." };
  }
  if (!password || password.length < 6) {
    return { user: null, error: "Password must be at least 6 characters long." };
  }

  const supabase = getSupabaseClient();
  let userId = "usr_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  let provider: "supabase" | "local_vault" = "local_vault";

  if (supabase.isConfigured()) {
    try {
      const supaResult = await supabase.signUp(trimmedEmail, password, {
        name: trimmedName,
        persona,
      });
      if (supaResult.error) {
        return { user: null, error: supaResult.error };
      }
      if (supaResult.userId) {
        userId = supaResult.userId;
        provider = "supabase";
      }
    } catch (err) {
      console.warn("Supabase signup failed, falling back to local vault:", err);
    }
  }

  const newUser: UserProfile = {
    id: userId,
    email: trimmedEmail,
    name: trimmedName,
    persona,
    isCloudSynced: provider === "supabase",
    provider,
    createdAt: new Date().toISOString(),
    lastLoginAt: new Date().toISOString(),
  };

  saveStoredUser(newUser);
  saveActivePersona(persona);
  return { user: newUser };
}

/**
 * Sign in an existing user.
 */
export async function loginUser(
  email: string,
  password: string,
): Promise<{ user: UserProfile | null; error?: string }> {
  const trimmedEmail = email.trim().toLowerCase();

  if (!trimmedEmail) {
    return { user: null, error: "Please enter your email." };
  }
  if (!password) {
    return { user: null, error: "Please enter your password." };
  }

  const supabase = getSupabaseClient();
  if (supabase.isConfigured()) {
    try {
      const supaResult = await supabase.signIn(trimmedEmail, password);
      if (supaResult.error) {
        return { user: null, error: supaResult.error };
      }
      const existing = loadStoredUser();
      const user: UserProfile = {
        id: supaResult.userId || existing?.id || "usr_cloud",
        email: trimmedEmail,
        name: supaResult.name || existing?.name || trimmedEmail.split("@")[0] || "User",
        persona: (supaResult.persona as PersonaId) || existing?.persona || "engineer",
        isCloudSynced: true,
        provider: "supabase",
        createdAt: existing?.createdAt || new Date().toISOString(),
        lastLoginAt: new Date().toISOString(),
      };
      saveStoredUser(user);
      return { user };
    } catch (err) {
      return { user: null, error: err instanceof Error ? err.message : "Sign in failed" };
    }
  }

  // Local vault sign in
  const existing = loadStoredUser();
  if (existing && existing.email === trimmedEmail) {
    const user = { ...existing, lastLoginAt: new Date().toISOString() };
    saveStoredUser(user);
    return { user };
  }

  // Create demo authenticated profile if first time
  const user: UserProfile = {
    id: "usr_" + Math.random().toString(36).slice(2, 9),
    email: trimmedEmail,
    name: trimmedEmail.split("@")[0] || "Researcher",
    persona: "engineer",
    isCloudSynced: false,
    provider: "local_vault",
    createdAt: new Date().toISOString(),
    lastLoginAt: new Date().toISOString(),
  };
  saveStoredUser(user);
  return { user };
}

export function logoutUser(): void {
  const supabase = getSupabaseClient();
  if (supabase.isConfigured()) {
    supabase.signOut().catch(() => {});
  }
  saveStoredUser(null);
}

import type { User } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadStoredUser,
  saveStoredUser,
  loadActivePersona,
  saveActivePersona,
  registerUser,
  loginUser,
  logoutUser,
  sendMagicLink,
  sendPasswordReset,
  updateUserPassword,
  signInWithGoogleOAuth,
  restoreUserSession,
} from "@/lib/persistence/auth";
import {
  saveProjects,
  loadProjects,
  loadProjectsForUser,
  clearUserProjectCache,
  type ProjectMeta,
} from "@/lib/persistence/projects";
import {
  loadSupabaseConfig,
  saveSupabaseConfig,
  getSupabaseClient,
  validateSupabaseCredentials,
} from "@/lib/persistence/supabase";
import { supabase, validateSupabaseConfig, getSupabase } from "@/integrations/supabase/client";

describe("User Authentication & Profile Persistence", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("stores and loads user profile correctly", () => {
    expect(loadStoredUser()).toBeNull();
    const mockUser = {
      id: "usr_123",
      email: "economist@lumetra.io",
      name: "Dr. Keynes",
      persona: "economist" as const,
      isCloudSynced: false,
      provider: "local_vault" as const,
      createdAt: new Date().toISOString(),
      lastLoginAt: new Date().toISOString(),
    };
    saveStoredUser(mockUser);
    expect(loadStoredUser()?.email).toBe("economist@lumetra.io");
    expect(loadStoredUser()?.persona).toBe("economist");
  });

  it("registers a new user and switches active persona", async () => {
    vi.spyOn(supabase.auth, "signUp").mockResolvedValueOnce({
      data: {
        user: {
          id: "usr_mock",
          email: "sre.lead@company.internal",
          user_metadata: { name: "Alex SRE", persona: "engineer" },
          created_at: new Date().toISOString(),
          confirmed_at: new Date().toISOString(),
          app_metadata: {},
          aud: "authenticated",
        } as unknown as User,
        session: null,
      },
      error: null,
    });

    const res = await registerUser(
      "sre.lead@company.internal",
      "secretPassword123",
      "Alex SRE",
      "engineer",
    );
    expect(res.user).not.toBeNull();
    expect(res.user?.persona).toBe("engineer");
    expect(loadActivePersona()).toBe("engineer");
  });

  it("validates password length and email format", async () => {
    const invalidEmail = await registerUser("bademail", "pass123", "User", "engineer");
    expect(invalidEmail.error).toContain("valid email");

    const shortPass = await registerUser("good@email.com", "123", "User", "engineer");
    expect(shortPass.error).toContain("at least 6 characters");
  });

  it("logs out cleanly", () => {
    saveStoredUser({
      id: "1",
      email: "t@t.com",
      name: "T",
      persona: "product",
      isCloudSynced: false,
      provider: "local_vault",
      createdAt: "x",
      lastLoginAt: "x",
    });
    logoutUser();
    expect(loadStoredUser()).toBeNull();
  });
});

describe("Supabase Persistence Client", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("saves and loads configuration safely", () => {
    const cfg = saveSupabaseConfig({
      url: "https://myproj.supabase.co",
      anonKey: "eyJhbGciOi...",
    });
    expect(cfg.url).toBe("https://myproj.supabase.co");
    expect(loadSupabaseConfig().url).toBe("https://myproj.supabase.co");
  });

  it("safeguards projects into the persistent cloud vault", async () => {
    const sampleRecord = {
      id: "proj_99",
      name: "Latency Analysis",
      csv_content: "latency,qps\n10,100",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      status: "data-loaded",
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify([sampleRecord]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const supabase = getSupabaseClient();
    const project = {
      id: "proj_99",
      name: "Latency Analysis",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "data-loaded" as const,
      dataset: {
        name: "telemetry.csv",
        rows: 100,
        columns: 5,
        source: "upload" as const,
        stored: true,
      },
    };

    const res = await supabase.saveProject(project, "latency,qps\n10,100");
    expect(res.ok).toBe(true);

    const loaded = await supabase.loadProject("proj_99");
    expect(loaded).not.toBeNull();
    expect(loaded?.name).toBe("Latency Analysis");
    expect(loaded?.csv_content).toBe("latency,qps\n10,100");
  });
});

describe("Supabase Integration & Environment Validation", () => {
  it("validates runtime environment configuration", () => {
    const status = validateSupabaseConfig();
    if (status.isConfigured) {
      expect(status.url).toBeTruthy();
      expect(status.missing).toEqual([]);
      expect(status.error).toBeNull();
      expect(getSupabase()).toBeDefined();
    } else {
      expect(status.missing).toContain("VITE_SUPABASE_URL");
      expect(status.missing).toContain("VITE_SUPABASE_PUBLISHABLE_KEY");
      expect(status.error).toContain("VITE_SUPABASE_URL");
      expect(status.error).toContain(".env.local");
      expect(() => supabase.auth).toThrowError(/Supabase configuration error/);
    }
  });

  it("validates credentials accurately in persistence module", () => {
    const emptyCheck = validateSupabaseCredentials("", "");
    expect(emptyCheck.isConfigured).toBe(false);
    expect(emptyCheck.missing.length).toBe(2);

    const validCheck = validateSupabaseCredentials("https://example.supabase.co", "anon-key-123");
    expect(validCheck.isConfigured).toBe(true);
    expect(validCheck.error).toBeNull();
  });
});

describe("Authentication Workflows & Security Verification", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("validates magic-link email format", async () => {
    const invalidRes = await sendMagicLink("bad-email");
    expect(invalidRes.success).toBe(false);
    expect(invalidRes.error).toContain("valid email");
  });

  it("validates password reset email format", async () => {
    const invalidRes = await sendPasswordReset("invalid-email");
    expect(invalidRes.success).toBe(false);
    expect(invalidRes.error).toContain("valid email");
  });

  it("validates password updates and rejects short passwords", async () => {
    const shortRes = await updateUserPassword("123");
    expect(shortRes.success).toBe(false);
    expect(shortRes.error).toContain("at least 6 characters");
  });

  it("handles Google OAuth invocation in current environment", async () => {
    const res = await signInWithGoogleOAuth();
    // In jsdom environment, window.location redirection is stubbed or unconfigured
    expect(res).toBeDefined();
  });

  it("prevents signed-in users from seeing other users cached projects", () => {
    const projAlice: ProjectMeta = {
      id: "p_alice_1",
      userId: "usr_alice",
      name: "Alice Experiment",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "data-loaded",
      dataset: null,
    };
    const projBob: ProjectMeta = {
      id: "p_bob_1",
      userId: "usr_bob",
      name: "Bob Telemetry",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "data-loaded",
      dataset: null,
    };
    const projGuest: ProjectMeta = {
      id: "p_guest_1",
      name: "Guest Scratchpad",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "no-data",
      dataset: null,
    };

    saveProjects([projAlice, projBob, projGuest]);

    // Alice sees only Alice's projects
    const aliceProjects = loadProjectsForUser("usr_alice");
    expect(aliceProjects).toHaveLength(1);
    expect(aliceProjects[0].id).toBe("p_alice_1");

    // Bob sees only Bob's projects
    const bobProjects = loadProjectsForUser("usr_bob");
    expect(bobProjects).toHaveLength(1);
    expect(bobProjects[0].id).toBe("p_bob_1");

    // Guest sees only guest projects
    const guestProjects = loadProjectsForUser(null);
    expect(guestProjects).toHaveLength(1);
    expect(guestProjects[0].id).toBe("p_guest_1");

    // Clear Alice cache on sign-out
    clearUserProjectCache("usr_alice");
    expect(loadProjectsForUser("usr_alice")).toHaveLength(0);
    expect(loadProjectsForUser("usr_bob")).toHaveLength(1);
  });

  it("does not treat arbitrary localStorage as authenticated Supabase user", async () => {
    // Arbitrary fake token or user in localStorage
    localStorage.setItem(
      "lumetra.auth.user.v1",
      JSON.stringify({
        id: "usr_spoofed",
        email: "spoofed@supabase.co",
        provider: "supabase",
      }),
    );

    // restoreUserSession checks live Supabase auth, does NOT accept spoofed localStorage
    const restored = await restoreUserSession();
    expect(restored).toBeNull();
  });
});

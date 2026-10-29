import { beforeEach, describe, expect, it } from "vitest";
import {
  loadStoredUser,
  saveStoredUser,
  loadActivePersona,
  saveActivePersona,
  registerUser,
  loginUser,
  logoutUser,
} from "@/lib/persistence/auth";
import {
  loadSupabaseConfig,
  saveSupabaseConfig,
  getSupabaseClient,
  validateSupabaseCredentials,
} from "@/lib/persistence/supabase";
import {
  supabase,
  validateSupabaseConfig,
  getSupabase,
} from "@/integrations/supabase/client";

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
  it("detects missing environment variables and provides actionable error instructions", () => {
    const status = validateSupabaseConfig();
    expect(status.isConfigured).toBe(false);
    expect(status.missing).toContain("VITE_SUPABASE_URL");
    expect(status.missing).toContain("VITE_SUPABASE_PUBLISHABLE_KEY");
    expect(status.error).toContain("VITE_SUPABASE_URL");
    expect(status.error).toContain("VITE_SUPABASE_PUBLISHABLE_KEY");
    expect(status.error).toContain(".env.local");
  });

  it("throws clear configuration error when unconfigured client is accessed", () => {
    expect(() => supabase.auth).toThrowError(/Supabase configuration error/);
    expect(() => getSupabase()).toThrowError(/Supabase configuration error/);
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


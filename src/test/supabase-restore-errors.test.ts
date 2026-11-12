import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  response: {
    data: null as unknown,
    error: null as { message: string; code: string } | null,
  },
}));

vi.mock("@/integrations/supabase/client", () => {
  const query = {
    select: () => query,
    eq: () => query,
    order: () => query,
    maybeSingle: () => Promise.resolve(mockState.response),
    then: (
      onfulfilled?: (value: typeof mockState.response) => unknown,
      onrejected?: (reason: unknown) => unknown,
    ) => Promise.resolve(mockState.response).then(onfulfilled, onrejected),
  };

  return {
    getSupabaseClientInstance: () => ({ from: () => query }),
    isSupabaseConfigured: () => true,
    validateSupabaseConfig: () => ({ isConfigured: true, missing: [], error: null }),
    supabase: {},
  };
});

import { getSupabaseClient, saveSupabaseConfig } from "@/lib/persistence/supabase";

describe("Cloud project restoration errors", () => {
  beforeEach(() => {
    localStorage.clear();
    saveSupabaseConfig({
      url: "https://restore-errors.supabase.co",
      anonKey: "test-publishable-key",
    });
    mockState.response = {
      data: null,
      error: { code: "NETWORK_ERROR", message: "Temporary database outage" },
    };
  });

  it("propagates project-list failures instead of returning an empty project list", async () => {
    await expect(getSupabaseClient().listProjects()).rejects.toMatchObject({
      message: "Temporary database outage",
    });
  });

  it("distinguishes a failed project lookup from a missing project", async () => {
    await expect(
      getSupabaseClient().loadProject("11111111-1111-4111-8111-111111111111"),
    ).rejects.toMatchObject({
      message: "Temporary database outage",
    });
  });
});

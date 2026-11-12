import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

const mockState = vi.hoisted(() => ({
  client: null as unknown,
  activeUserId: "33333333-3333-4333-8333-333333333333",
  projectRows: [] as Array<{ id: string; user_id: string }>,
  datasets: [] as Array<{ project_id: string; user_id: string; content_path: string | null }>,
  versions: [] as Array<{ project_id: string; user_id: string; content_path: string | null }>,
  files: new Set<string>(),
  events: [] as string[],
  failStorageDeletes: 0,
  failDatabaseDeletes: 0,
  switchAccountOnStorageDelete: false,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {},
  getSupabaseClientInstance: () => mockState.client,
  isSupabaseConfigured: () => true,
  validateSupabaseConfig: () => ({
    isConfigured: true,
    missing: [],
    error: null,
    url: "https://lumetra-test.supabase.co",
    source: "env",
  }),
}));

import { getSupabaseClient } from "@/lib/persistence/supabase";

const USER_A = "33333333-3333-4333-8333-333333333333";
const USER_B = "44444444-4444-4444-8444-444444444444";
const PROJECT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

type QueryResult = { data: unknown; error: { message: string } | null };

function createQuery(table: string) {
  let operation: "select" | "delete" = "select";
  const filters = new Map<string, unknown>();

  const execute = (): QueryResult => {
    mockState.events.push(`${operation}:${table}`);
    if (operation === "select") {
      if (table === "datasets") {
        return {
          data: mockState.datasets.filter(
            (row) =>
              row.project_id === filters.get("project_id") &&
              row.user_id === filters.get("user_id"),
          ),
          error: null,
        };
      }
      if (table === "dataset_versions") {
        return {
          data: mockState.versions.filter(
            (row) =>
              row.project_id === filters.get("project_id") &&
              row.user_id === filters.get("user_id"),
          ),
          error: null,
        };
      }
      return { data: [], error: null };
    }

    if (mockState.failDatabaseDeletes > 0) {
      mockState.failDatabaseDeletes--;
      return { data: null, error: { message: "simulated database failure" } };
    }

    mockState.projectRows = mockState.projectRows.filter(
      (row) => row.id !== filters.get("id") || row.user_id !== filters.get("user_id"),
    );
    mockState.datasets = mockState.datasets.filter(
      (row) => row.project_id !== filters.get("id") || row.user_id !== filters.get("user_id"),
    );
    mockState.versions = mockState.versions.filter(
      (row) => row.project_id !== filters.get("id") || row.user_id !== filters.get("user_id"),
    );
    return { data: [], error: null };
  };

  const builder = {
    select: (_columns: string) => builder,
    delete: () => {
      operation = "delete";
      return builder;
    },
    eq: (column: string, value: unknown) => {
      filters.set(column, value);
      return builder;
    },
    then<TResult1 = QueryResult, TResult2 = never>(
      onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) {
      return Promise.resolve(execute()).then(onfulfilled, onrejected);
    },
  };

  return builder;
}

function seedProject() {
  const datasetPath = `${USER_A}/${PROJECT_A}/datasets/data.csv`;
  const versionPath = `${USER_A}/${PROJECT_A}/versions/v1.json`;
  mockState.projectRows = [
    { id: PROJECT_A, user_id: USER_A },
    { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", user_id: USER_B },
  ];
  mockState.datasets = [{ project_id: PROJECT_A, user_id: USER_A, content_path: datasetPath }];
  mockState.versions = [{ project_id: PROJECT_A, user_id: USER_A, content_path: versionPath }];
  mockState.files = new Set([datasetPath, versionPath]);
}

beforeEach(() => {
  localStorage.clear();
  mockState.activeUserId = USER_A;
  mockState.projectRows = [];
  mockState.datasets = [];
  mockState.versions = [];
  mockState.files.clear();
  mockState.events = [];
  mockState.failStorageDeletes = 0;
  mockState.failDatabaseDeletes = 0;
  mockState.switchAccountOnStorageDelete = false;

  mockState.client = {
    auth: {
      getUser: async () => ({ data: { user: { id: mockState.activeUserId } }, error: null }),
      getSession: async () => ({
        data: { session: { user: { id: mockState.activeUserId } } },
        error: null,
      }),
    },
    from: (table: string) => createQuery(table),
    storage: {
      from: (_bucket: string) => ({
        remove: async (paths: string[]) => {
          mockState.events.push("storage:remove");
          if (mockState.switchAccountOnStorageDelete) mockState.activeUserId = USER_B;
          if (mockState.failStorageDeletes > 0) {
            mockState.failStorageDeletes--;
            const [partialPath] = paths;
            if (partialPath) mockState.files.delete(partialPath);
            return { data: null, error: { message: "simulated storage failure" } };
          }
          paths.forEach((path) => mockState.files.delete(path));
          return { data: [], error: null };
        },
      }),
    },
  } as unknown as SupabaseClient<Database>;

  getSupabaseClient().setConfig({
    url: "https://lumetra-test.supabase.co",
    anonKey: "test-publishable-key-value",
  });
});

describe("project deletion integrity", () => {
  it("removes only this project's files before cascading its database records", async () => {
    seedProject();

    const result = await getSupabaseClient().deleteProject(PROJECT_A, USER_A);

    expect(result).toEqual({ ok: true });
    expect(mockState.files.size).toBe(0);
    expect(mockState.projectRows).toEqual([
      { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", user_id: USER_B },
    ]);
    expect(mockState.events.indexOf("storage:remove")).toBeLessThan(
      mockState.events.indexOf("delete:lumetra_projects"),
    );
  });

  it("keeps database records and returns an actionable failure when storage cleanup fails", async () => {
    seedProject();
    mockState.failStorageDeletes = 1;

    const result = await getSupabaseClient().deleteProject(PROJECT_A, USER_A);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("The project is still saved");
    expect(mockState.projectRows).toHaveLength(2);
    expect(mockState.datasets).toHaveLength(1);
    expect(mockState.versions).toHaveLength(1);
    expect(mockState.events).not.toContain("delete:lumetra_projects");
  });

  it("completes a partial storage cleanup on retry before deleting the project", async () => {
    seedProject();
    mockState.failStorageDeletes = 1;
    const service = getSupabaseClient();

    const first = await service.deleteProject(PROJECT_A, USER_A);
    const retry = await service.deleteProject(PROJECT_A, USER_A);

    expect(first.ok).toBe(false);
    expect(retry).toEqual({ ok: true });
    expect(mockState.files.size).toBe(0);
    expect(mockState.projectRows).toHaveLength(1);
  });

  it("allows database deletion to be retried after storage has already been removed", async () => {
    seedProject();
    mockState.failDatabaseDeletes = 1;
    const service = getSupabaseClient();

    const first = await service.deleteProject(PROJECT_A, USER_A);
    const retry = await service.deleteProject(PROJECT_A, USER_A);

    expect(first.ok).toBe(false);
    expect(first.error).toContain("some project information could not be deleted");
    expect(retry).toEqual({ ok: true });
    expect(mockState.files.size).toBe(0);
    expect(mockState.projectRows).toHaveLength(1);
  });

  it("treats a repeated deletion as a safe no-op", async () => {
    seedProject();
    const service = getSupabaseClient();

    expect((await service.deleteProject(PROJECT_A, USER_A)).ok).toBe(true);
    expect((await service.deleteProject(PROJECT_A, USER_A)).ok).toBe(true);
    expect(mockState.projectRows).toHaveLength(1);
    expect(mockState.files.size).toBe(0);
  });

  it("stops before deleting project records if the account changes during cleanup", async () => {
    seedProject();
    mockState.switchAccountOnStorageDelete = true;

    const result = await getSupabaseClient().deleteProject(PROJECT_A, USER_A);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("active account changed");
    expect(mockState.projectRows).toHaveLength(2);
    expect(mockState.events).not.toContain("delete:lumetra_projects");
  });

  it("refuses to delete an object path outside the authenticated user's project prefix", async () => {
    seedProject();
    mockState.versions[0]!.content_path = `${USER_B}/${PROJECT_A}/versions/foreign.json`;

    const result = await getSupabaseClient().deleteProject(PROJECT_A, USER_A);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("could not be verified");
    expect(mockState.events).not.toContain("storage:remove");
    expect(mockState.events).not.toContain("delete:lumetra_projects");
    expect(mockState.projectRows).toHaveLength(2);
  });
});

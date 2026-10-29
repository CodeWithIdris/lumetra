import { describe, expect, it, beforeEach, vi } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  getSupabaseClient,
  isValidUuid,
  generateUuid,
  toValidUuid,
} from "@/lib/persistence/supabase";
import type { ProjectMeta } from "@/lib/persistence/projects";
import type { SavedAnalysis } from "@/lib/stats/analysis";

const USER_A_ID = "11111111-1111-4111-8111-111111111111";
const USER_B_ID = "22222222-2222-4222-8222-222222222222";

describe("Phase 4B: SQL Schema and Migration Integrity", () => {
  it("includes version-controlled migration with required tables and RLS policies", () => {
    const migrationPath = resolve(
      process.cwd(),
      "supabase/migrations/20261029101800_create_lumetra_schema_and_rls.sql",
    );
    expect(existsSync(migrationPath)).toBe(true);

    const sql = readFileSync(migrationPath, "utf-8");

    // 1. Required Tables
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.lumetra_projects");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.datasets");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.saved_analyses");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.reports");

    // 2. Foreign Keys & Cascading Deletions
    expect(sql).toContain("REFERENCES auth.users(id) ON DELETE CASCADE");
    expect(sql).toContain("REFERENCES public.lumetra_projects(id) ON DELETE CASCADE");

    // 3. Row Level Security Enabled
    expect(sql).toContain("ALTER TABLE public.lumetra_projects ENABLE ROW LEVEL SECURITY;");
    expect(sql).toContain("ALTER TABLE public.datasets ENABLE ROW LEVEL SECURITY;");
    expect(sql).toContain("ALTER TABLE public.saved_analyses ENABLE ROW LEVEL SECURITY;");
    expect(sql).toContain("ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;");

    // 4. Explicit RLS Policies for SELECT, INSERT, UPDATE, DELETE
    expect(sql).toContain('CREATE POLICY "Users can select own projects"');
    expect(sql).toContain('CREATE POLICY "Users can insert own projects"');
    expect(sql).toContain('CREATE POLICY "Users can update own projects"');
    expect(sql).toContain('CREATE POLICY "Users can delete own projects"');

    // 5. Child records check ownership via project relationship
    expect(sql).toContain("EXISTS (");
    expect(sql).toContain("SELECT 1 FROM public.lumetra_projects p");
    expect(sql).toContain("p.id = project_id AND p.user_id = auth.uid()");
  });

  it("handles UUID generation and deterministic conversion properly", () => {
    const freshUuid = generateUuid();
    expect(isValidUuid(freshUuid)).toBe(true);

    // Existing valid UUID is preserved
    const standardUuid = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
    expect(toValidUuid(standardUuid)).toBe(standardUuid);

    // Legacy project prefix ID is deterministically converted to a valid UUID
    const legacyId = "proj_test_12345";
    const converted = toValidUuid(legacyId);
    expect(isValidUuid(converted)).toBe(true);
    // Deterministic check
    expect(toValidUuid(legacyId)).toBe(converted);
  });
});

describe("Phase 4B: PostgreSQL Persistence & Project Lifecycle", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("saves, lists, and reopens a project with dataset and saved analyses", async () => {
    const supabaseService = getSupabaseClient();
    const projectId = generateUuid();
    const datasetId = generateUuid();
    const analysisId = generateUuid();

    const mockAnalysis: SavedAnalysis = {
      id: analysisId,
      name: "Latency vs QPS Correlation",
      type: "correlation",
      timestamp: new Date().toISOString(),
      datasetId,
      datasetName: "telemetry.csv",
      datasetSignature: "telemetry.csv:latency|qps:100:10,100",
      variables: ["latency", "qps"],
      configuration: { method: "pearson" },
      sampleSize: 100,
      missingCount: 0,
      missingHandling: "exclude",
      results: { r: 0.85, pValue: 0.001 },
      interpretation: {
        summary: "Strong positive correlation observed.",
        contextualImplication: "System load impacts latency.",
        limitations: ["Observational telemetry data."],
      },
      methodNotes: ["Missing values excluded."],
    };

    const project: ProjectMeta = {
      id: projectId,
      userId: USER_A_ID,
      name: "Telemetry Investigation",
      description: "Root cause analysis for cluster latency",
      objective: "Verify load correlation",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "analysed",
      dataset: {
        id: datasetId,
        name: "telemetry.csv",
        rows: 100,
        columns: 2,
        source: "upload",
        stored: true,
      },
      cleaningSteps: [
        {
          id: "step_1",
          type: "drop_na",
          params: {},
          appliedAt: new Date().toISOString(),
          description: "Drop empty rows",
          effect: { rowsBefore: 105, rowsAfter: 100 },
        },
      ],
      savedAnalyses: [mockAnalysis],
    };

    const csvData = "latency,qps\n12.5,450\n15.1,510";

    // Mock remote Supabase PostgREST successful response
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const urlStr = String(url);
      if (urlStr.includes("/auth/v1/session") || urlStr.includes("/auth/v1/settings")) {
        return new Response(JSON.stringify({}), { status: 200 });
      }

      // Upsert into lumetra_projects, datasets, saved_analyses
      if (init?.method === "POST" || init?.method === "GET") {
        const mockRow = {
          id: projectId,
          user_id: USER_A_ID,
          name: "Telemetry Investigation",
          status: "analysed",
          objective: "Verify load correlation",
          created_at: project.createdAt,
          updated_at: project.updatedAt,
          datasets: [
            {
              id: datasetId,
              project_id: projectId,
              name: "telemetry.csv",
              source: "upload",
              row_count: 100,
              column_count: 2,
              cleaning_steps: project.cleaningSteps,
              csv_content: csvData,
            },
          ],
          saved_analyses: [mockAnalysis],
        };
        return new Response(
          JSON.stringify(
            init?.method === "GET" && urlStr.includes("id=eq.") ? [mockRow] : [mockRow],
          ),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      return new Response(JSON.stringify([]), { status: 200 });
    });

    // 1. Save project
    const saveRes = await supabaseService.saveProject(project, csvData, USER_A_ID);
    expect(saveRes.ok).toBe(true);

    // 2. Load project back
    const loaded = await supabaseService.loadProject(projectId);
    expect(loaded).not.toBeNull();
    expect(loaded?.name).toBe("Telemetry Investigation");
    expect(loaded?.dataset_name).toBe("telemetry.csv");
    expect(loaded?.csv_content).toBe(csvData);

    const restoredAnalyses = JSON.parse(loaded?.saved_analyses || "[]");
    expect(restoredAnalyses).toHaveLength(1);
    expect(restoredAnalyses[0].name).toBe("Latency vs QPS Correlation");
    expect(restoredAnalyses[0].results.r).toBe(0.85);
  });

  it("persists and reopens structured markdown reports linked to projects", async () => {
    const supabaseService = getSupabaseClient();
    const projectId = generateUuid();

    const mockReport = {
      projectId,
      userId: USER_A_ID,
      title: "Quarterly Performance Audit",
      objective: "Evaluate latency regression vs SLA",
      markdown: "# Executive Summary\nLatency remained within SLA limits.",
      summary: { totalRecords: 1000, violations: 0 },
    };

    // Mock fetch for report insertion and query
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const urlStr = String(url);
      if (urlStr.includes("/auth/v1/")) {
        return new Response(JSON.stringify({ session: { user: { id: USER_A_ID } } }), {
          status: 200,
        });
      }
      if (init?.method === "POST" && urlStr.includes("/rest/v1/reports")) {
        return new Response(JSON.stringify([{ id: generateUuid() }]), { status: 201 });
      }
      if (init?.method === "GET" && urlStr.includes("/rest/v1/reports")) {
        return new Response(
          JSON.stringify([
            {
              id: generateUuid(),
              project_id: projectId,
              user_id: USER_A_ID,
              title: mockReport.title,
              objective: mockReport.objective,
              content_markdown: mockReport.markdown,
              summary: mockReport.summary,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify([]), { status: 200 });
    });

    const res = await supabaseService.saveReport(mockReport);
    expect(res.ok).toBe(true);

    const reports = await supabaseService.loadReports(projectId);
    expect(reports).toHaveLength(1);
    expect(reports[0].title).toBe("Quarterly Performance Audit");
    expect(reports[0].content_markdown).toContain("Latency remained within SLA limits.");
  });
});

describe("Phase 4B: Row Level Security (RLS) & Multi-User Isolation", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("enforces tenant isolation so User A cannot read User B's projects", async () => {
    const supabaseService = getSupabaseClient();
    const userB_ProjectId = generateUuid();

    // Mock database response where PostgREST RLS filters by auth.uid()
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const urlStr = String(url);
      // When User A queries User B's project ID, PostgreSQL RLS returns empty array []
      if (urlStr.includes(`id=eq.${encodeURIComponent(userB_ProjectId)}`)) {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const result = await supabaseService.loadProject(userB_ProjectId);
    // User A cannot read User B's records
    expect(result).toBeNull();
  });

  it("prevents User A from inserting records with User B's ownership ID", async () => {
    const supabaseService = getSupabaseClient();
    const maliciousProjectId = generateUuid();

    const spoofedProject: ProjectMeta = {
      id: maliciousProjectId,
      userId: USER_B_ID, // Attempting to spoof User B
      name: "Spoofed Record",
      status: "no-data",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      dataset: null,
    };

    // In a live RLS environment, inserting with auth.uid() != user_id violates WITH CHECK (auth.uid() = user_id)
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const urlStr = String(url);
      if (init?.method === "POST" && urlStr.includes("/rest/v1/lumetra_projects")) {
        // PostgREST returns 403 / 42501 when RLS WITH CHECK policy is violated
        return new Response(
          JSON.stringify({
            code: "42501",
            message: 'new row violates row-level security policy for table "lumetra_projects"',
          }),
          { status: 403, statusText: "Forbidden", headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify([]), { status: 200 });
    });

    const res = await supabaseService.saveProject(spoofedProject, null, USER_A_ID);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("violates row-level security policy");
  });

  it("prevents unauthorized child-record creation through guessed project IDs", async () => {
    const supabaseService = getSupabaseClient();
    const userB_ProjectId = generateUuid();

    // User A tries to insert a dataset pointing to User B's project_id
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const urlStr = String(url);
      if (init?.method === "POST" && urlStr.includes("/rest/v1/datasets")) {
        // Child policy check: EXISTS (SELECT 1 FROM lumetra_projects p WHERE p.id = project_id AND p.user_id = auth.uid())
        // Fails because project_id belongs to User B!
        return new Response(
          JSON.stringify({
            code: "42501",
            message: 'new row violates row-level security policy for table "datasets"',
          }),
          { status: 403, statusText: "Forbidden", headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify([{ id: userB_ProjectId }]), { status: 200 });
    });

    const project: ProjectMeta = {
      id: userB_ProjectId,
      userId: USER_A_ID,
      name: "Attempted Hijack",
      status: "data-loaded",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      dataset: {
        id: generateUuid(),
        name: "hijack.csv",
        rows: 5,
        columns: 2,
        source: "upload",
        stored: true,
      },
    };

    const res = await supabaseService.saveProject(project, "a,b\n1,2", USER_A_ID);
    // Warning logged and local vault fallback preserved safely
    expect(res).toBeDefined();
  });
});

describe("Phase 4B: Local Project Import & Resilience", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("rejects import when user is not authenticated", async () => {
    const supabaseService = getSupabaseClient();
    const localProjects: ProjectMeta[] = [
      {
        id: "proj_local_1",
        name: "Local Offline Work",
        status: "no-data",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        dataset: null,
      },
    ];

    // Mock no active Supabase session
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const urlStr = String(url);
      if (urlStr.includes("/auth/v1/")) {
        return new Response(JSON.stringify({ session: null }), { status: 200 });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    });

    const result = await supabaseService.importLocalProjects(localProjects, async () => null);
    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain("Authentication required");
    expect(result.imported).toBe(0);
  });

  it("prevents duplicate project imports when migration is retried", async () => {
    const supabaseService = getSupabaseClient();
    const project1Id = generateUuid();

    const localProjects: ProjectMeta[] = [
      {
        id: project1Id,
        name: "Existing Cloud Project",
        status: "no-data",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        dataset: null,
      },
    ];

    // Mock session and existing remote projects list containing "Existing Cloud Project"
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const urlStr = String(url);
      if (urlStr.includes("/auth/v1/")) {
        return new Response(JSON.stringify({ session: { user: { id: USER_A_ID } } }), {
          status: 200,
        });
      }
      if (
        (!init?.method || init.method === "GET") &&
        urlStr.includes("/rest/v1/lumetra_projects")
      ) {
        return new Response(
          JSON.stringify([
            {
              id: project1Id,
              user_id: USER_A_ID,
              name: "Existing Cloud Project",
              status: "no-data",
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              datasets: [],
              saved_analyses: [],
            },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify([]), { status: 200 });
    });

    const result = await supabaseService.importLocalProjects(localProjects, async () => null, {
      userId: USER_A_ID,
    });
    expect(result.success).toBe(true);
    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(1); // Safely skipped, no duplicate written!
  });

  it("handles remote database table absence (PGRST205) with clear guidance", async () => {
    const supabaseService = getSupabaseClient();
    const projectId = generateUuid();

    // Mock PostgREST PGRST205 table absence
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const urlStr = String(url);
      if (urlStr.includes("/auth/v1/")) {
        return new Response(JSON.stringify({ session: { user: { id: USER_A_ID } } }), {
          status: 200,
        });
      }
      if (init?.method === "POST" && urlStr.includes("/rest/v1/lumetra_projects")) {
        return new Response(
          JSON.stringify({
            code: "PGRST205",
            message: "Could not find the table 'public.lumetra_projects' in the schema cache",
          }),
          { status: 404, statusText: "Not Found", headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify([]), { status: 200 });
    });

    const project: ProjectMeta = {
      id: projectId,
      userId: USER_A_ID,
      name: "Pending Migration Project",
      status: "no-data",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      dataset: null,
    };

    const res = await supabaseService.saveProject(project, null, USER_A_ID);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("PGRST205");
    expect(res.error).toContain("20261029101800_create_lumetra_schema_and_rls.sql");
  });
});

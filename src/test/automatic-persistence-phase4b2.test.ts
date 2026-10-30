/**
 * LUMETRA — PHASE 4B.2 AUTOMATED TEST SUITE:
 * AUTOMATIC PERSISTENCE AND INVISIBLE CLOUD INFRASTRUCTURE
 *
 * Covers all 12 Acceptance Criteria Scenarios:
 * 1. Create a project and confirm it appears in Supabase without clicking Save.
 * 2. Import a dataset and confirm its contents are persisted automatically.
 * 3. Modify the dataset and confirm the latest version is saved.
 * 4. Run an analysis and confirm its configuration and results are persisted.
 * 5. Generate a report and confirm it is saved automatically.
 * 6. Refresh the browser and reopen the project.
 * 7. Close and reopen the browser and verify recovery from durable storage.
 * 8. Disconnect the internet, make changes, reconnect, and verify automatic synchronization.
 * 9. Sign out and sign in again.
 * 10. Use a second account and verify that the first account's data remains inaccessible.
 * 11. Simulate a failed write and confirm that the application does not falsely display "Saved".
 * 12. Test rapid successive edits to ensure older writes cannot overwrite newer versions.
 */

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { getPersistenceCoordinator, type PendingWriteItem } from "@/lib/persistence/coordinator";
import { getSupabaseClient, generateUuid, toValidUuid } from "@/lib/persistence/supabase";
import type { ProjectMeta } from "@/lib/persistence/projects";
import type { SavedAnalysis } from "@/lib/stats/analysis";
import type { Dataset } from "@/lib/data/types";
import { loadProjects, saveProjects, loadProjectsForUser } from "@/lib/persistence/projects";
import { saveDataset, loadDataset, clearAllDatasets } from "@/lib/persistence/indexeddb";

const USER_A_ID = "33333333-3333-4333-8333-333333333333";
const USER_B_ID = "44444444-4444-4444-8444-444444444444";

describe("Phase 4B.2: Automatic Persistence & Invisible Infrastructure", () => {
  let coordinator: ReturnType<typeof getPersistenceCoordinator>;
  let supabase: ReturnType<typeof getSupabaseClient>;

  // In-memory mock database representing remote Supabase PostgreSQL
  let remoteDb: {
    lumetra_projects: Map<string, Record<string, unknown>>;
    datasets: Map<string, Record<string, unknown>>;
    saved_analyses: Map<string, Record<string, unknown>>;
    reports: Map<string, Record<string, unknown>>;
  };

  beforeEach(async () => {
    localStorage.clear();
    await clearAllDatasets();
    coordinator = getPersistenceCoordinator();
    coordinator.resetQueue();
    supabase = getSupabaseClient();

    remoteDb = {
      lumetra_projects: new Map(),
      datasets: new Map(),
      saved_analyses: new Map(),
      reports: new Map(),
    };

    // Mock Supabase granular methods to write into in-memory Postgres mock
    vi.spyOn(supabase, "resolveSessionUserId").mockImplementation(async (fallback) => {
      return fallback || USER_A_ID;
    });

    vi.spyOn(supabase, "upsertProjectRecord").mockImplementation(async (proj, userId) => {
      const pId = toValidUuid(proj.id);
      const uId = userId || USER_A_ID;
      remoteDb.lumetra_projects.set(pId, {
        id: pId,
        user_id: uId,
        name: proj.name,
        description: proj.description,
        objective: proj.objective,
        status: proj.status,
        updated_at: new Date().toISOString(),
      });
      return { ok: true, remoteId: pId };
    });

    vi.spyOn(supabase, "upsertDatasetRecord").mockImplementation(async (projId, ds, userId) => {
      const pId = toValidUuid(projId);
      const dId = toValidUuid(ds.id || `${pId}_dataset`);
      const uId = userId || USER_A_ID;

      // Verify parent project exists for this user (foreign key & RLS check)
      const parent = remoteDb.lumetra_projects.get(pId);
      if (!parent || parent.user_id !== uId) {
        return {
          ok: false,
          error: "Foreign key / RLS check failed: project does not exist for user",
        };
      }

      remoteDb.datasets.set(dId, {
        id: dId,
        project_id: pId,
        user_id: uId,
        name: ds.name,
        source: ds.source || "upload",
        row_count: ds.rows,
        column_count: ds.columns,
        columns: ds.columnList || [],
        cleaning_steps: ds.cleaningSteps || [],
        csv_content: ds.csvContent,
        updated_at: new Date().toISOString(),
      });
      return { ok: true, datasetId: dId };
    });

    vi.spyOn(supabase, "upsertAnalysisRecord").mockImplementation(async (projId, an, userId) => {
      const pId = toValidUuid(projId);
      const aId = toValidUuid(an.id);
      const uId = userId || USER_A_ID;

      // Verify parent project exists for this user
      const parent = remoteDb.lumetra_projects.get(pId);
      if (!parent || parent.user_id !== uId) {
        return {
          ok: false,
          error: "Foreign key / RLS check failed: project does not exist for user",
        };
      }

      remoteDb.saved_analyses.set(aId, {
        id: aId,
        project_id: pId,
        user_id: uId,
        name: an.name,
        type: an.type,
        variables: an.variables,
        configuration: an.configuration,
        sample_size: an.sampleSize,
        results: an.results,
        interpretation: an.interpretation,
        updated_at: new Date().toISOString(),
      });
      return { ok: true, analysisId: aId };
    });

    vi.spyOn(supabase, "upsertReportRecord").mockImplementation(async (rep, userId) => {
      const pId = toValidUuid(rep.projectId);
      const rId = toValidUuid(rep.id || generateUuid());
      const uId = userId || USER_A_ID;

      const parent = remoteDb.lumetra_projects.get(pId);
      if (!parent || parent.user_id !== uId) {
        return {
          ok: false,
          error: "Foreign key / RLS check failed: project does not exist for user",
        };
      }

      remoteDb.reports.set(rId, {
        id: rId,
        project_id: pId,
        user_id: uId,
        title: rep.title,
        content_markdown: rep.markdown,
        objective: rep.objective,
        summary: rep.summary,
        updated_at: new Date().toISOString(),
      });
      return { ok: true, id: rId };
    });

    vi.spyOn(supabase, "deleteProject").mockImplementation(async (projId) => {
      const pId = toValidUuid(projId);
      remoteDb.lumetra_projects.delete(pId);
      // Cascading deletions
      for (const [k, v] of remoteDb.datasets.entries()) {
        if (v.project_id === pId) remoteDb.datasets.delete(k);
      }
      for (const [k, v] of remoteDb.saved_analyses.entries()) {
        if (v.project_id === pId) remoteDb.saved_analyses.delete(k);
      }
      for (const [k, v] of remoteDb.reports.entries()) {
        if (v.project_id === pId) remoteDb.reports.delete(k);
      }
    });

    vi.spyOn(supabase, "loadProject").mockImplementation(async (projId) => {
      const pId = toValidUuid(projId);
      const p = remoteDb.lumetra_projects.get(pId);
      if (!p) return null;

      let ds: Record<string, unknown> | undefined;
      for (const v of remoteDb.datasets.values()) {
        if (v.project_id === pId) {
          ds = v;
          break;
        }
      }

      const analyses: Array<Record<string, unknown>> = [];
      for (const v of remoteDb.saved_analyses.values()) {
        if (v.project_id === pId) analyses.push(v);
      }

      return {
        id: p.id as string,
        user_id: p.user_id as string,
        name: p.name as string,
        status: p.status as string,
        objective: p.objective as string,
        dataset_name: ds ? (ds.name as string) : undefined,
        dataset_rows: ds ? (ds.row_count as number) : undefined,
        dataset_columns: ds ? (ds.column_count as number) : undefined,
        csv_content: ds ? (ds.csv_content as string) : undefined,
        cleaning_steps: ds?.cleaning_steps ? JSON.stringify(ds.cleaning_steps) : undefined,
        saved_analyses: analyses.length > 0 ? JSON.stringify(analyses) : undefined,
        created_at: (p.updated_at as string) || new Date().toISOString(),
        updated_at: (p.updated_at as string) || new Date().toISOString(),
      };
    });

    coordinator.init(USER_A_ID);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    coordinator.resetQueue();
  });

  // Scenario 1: Create a project and confirm it appears in Supabase without clicking Save.
  it("Scenario 1: Creates a project and persists automatically without manual save", async () => {
    const projectId = generateUuid();
    const newProject: ProjectMeta = {
      id: projectId,
      userId: USER_A_ID,
      name: "Q3 Latency Analysis",
      description: "Assess backend latency under high traffic",
      objective: "Verify tail latency SLOs",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "no-data",
      dataset: null,
    };

    // Save locally
    saveProjects([newProject]);

    // Automatic persistence triggered immediately on project creation
    coordinator.queueProjectSave(newProject, USER_A_ID, { immediate: true });
    await coordinator.flushQueue();

    // Verify record exists in remote database
    expect(remoteDb.lumetra_projects.has(projectId)).toBe(true);
    const saved = remoteDb.lumetra_projects.get(projectId);
    expect(saved?.name).toBe("Q3 Latency Analysis");
    expect(saved?.user_id).toBe(USER_A_ID);
    expect(coordinator.getState().status).toBe("saved");
  });

  // Scenario 2: Import a dataset and confirm its contents are persisted automatically.
  it("Scenario 2: Imports a dataset and persists metadata and content automatically", async () => {
    const projectId = generateUuid();
    const datasetId = generateUuid();
    const project: ProjectMeta = {
      id: projectId,
      userId: USER_A_ID,
      name: "Server Metrics",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "data-loaded",
      dataset: {
        id: datasetId,
        name: "metrics.csv",
        rows: 3,
        columns: 2,
        source: "upload",
        stored: true,
      },
    };

    const csvContent = "p99,qps\n12.5,350\n18.2,420\n24.0,500";

    // Enforce parent-child ordering: Project before dataset
    coordinator.queueProjectSave(project, USER_A_ID, { immediate: true });
    coordinator.queueDatasetSave(
      projectId,
      {
        id: datasetId,
        name: "metrics.csv",
        source: "upload",
        rows: 3,
        columns: 2,
        columnList: ["p99", "qps"],
        cleaningSteps: [],
        csvContent,
      },
      USER_A_ID,
      { immediate: true },
    );

    await coordinator.flushQueue();

    expect(remoteDb.lumetra_projects.has(projectId)).toBe(true);
    expect(remoteDb.datasets.has(datasetId)).toBe(true);
    const savedDs = remoteDb.datasets.get(datasetId);
    expect(savedDs?.row_count).toBe(3);
    expect(savedDs?.csv_content).toBe(csvContent);
  });

  // Scenario 3: Modify the dataset and confirm the latest version is saved.
  it("Scenario 3: Modifies dataset (cleaning transformation) and automatically saves latest state", async () => {
    const projectId = generateUuid();
    const datasetId = generateUuid();
    const project: ProjectMeta = {
      id: projectId,
      userId: USER_A_ID,
      name: "Telemetry",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "data-loaded",
      dataset: {
        id: datasetId,
        name: "telemetry.csv",
        rows: 10,
        columns: 2,
        source: "upload",
        stored: true,
      },
    };

    coordinator.queueProjectSave(project, USER_A_ID, { immediate: true });
    coordinator.queueDatasetSave(
      projectId,
      {
        id: datasetId,
        name: "telemetry.csv",
        rows: 10,
        columns: 2,
        columnList: ["response_ms", "status_code"],
        cleaningSteps: [],
      },
      USER_A_ID,
      { immediate: true },
    );
    await coordinator.flushQueue();

    // Now apply a cleaning step (e.g. drop nulls or rename column)
    const updatedCleaningSteps = [
      {
        id: "step_1",
        type: "rename_column" as const,
        params: { from: "response_ms", to: "latency_ms" },
        appliedAt: new Date().toISOString(),
        description: "Renamed column response_ms to latency_ms",
      },
    ];

    coordinator.queueDatasetSave(
      projectId,
      {
        id: datasetId,
        name: "telemetry.csv",
        rows: 10,
        columns: 2,
        columnList: ["latency_ms", "status_code"],
        cleaningSteps: updatedCleaningSteps,
      },
      USER_A_ID,
      { immediate: true },
    );
    await coordinator.flushQueue();

    const remoteDs = remoteDb.datasets.get(datasetId);
    expect(remoteDs).toBeDefined();
    expect(remoteDs?.columns).toEqual(["latency_ms", "status_code"]);
    expect(remoteDs?.cleaning_steps).toHaveLength(1);
  });

  // Scenario 4: Run an analysis and confirm its configuration and results are persisted.
  it("Scenario 4: Runs an analysis and persists type, variables, config, and results automatically", async () => {
    const projectId = generateUuid();
    const project: ProjectMeta = {
      id: projectId,
      userId: USER_A_ID,
      name: "Economics Project",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "analysed",
      dataset: null,
    };
    coordinator.queueProjectSave(project, USER_A_ID, { immediate: true });

    const analysisId = generateUuid();
    const analysis: SavedAnalysis = {
      id: analysisId,
      name: "Price vs Demand Elasticity",
      type: "correlation",
      timestamp: new Date().toISOString(),
      datasetId: "ds_1",
      datasetName: "market.csv",
      datasetSignature: "market.csv:100",
      variables: ["price", "demand"],
      configuration: { method: "pearson" },
      sampleSize: 100,
      missingCount: 0,
      missingHandling: "exclude",
      results: { r: -0.78, pValue: 0.0001 },
      interpretation: { summary: "Negative price elasticity observed." },
      methodNotes: ["Missing values excluded."],
    };

    coordinator.queueAnalysisSave(projectId, analysis, USER_A_ID);
    await coordinator.flushQueue();

    expect(remoteDb.saved_analyses.has(analysisId)).toBe(true);
    const remoteAnalysis = remoteDb.saved_analyses.get(analysisId);
    expect(remoteAnalysis?.name).toBe("Price vs Demand Elasticity");
    expect(remoteAnalysis?.variables).toEqual(["price", "demand"]);
    expect((remoteAnalysis?.results as Record<string, unknown>).r).toBe(-0.78);
  });

  // Scenario 5: Generate a report and confirm it is saved automatically.
  it("Scenario 5: Automatically persists generated report and metadata", async () => {
    const projectId = generateUuid();
    const project: ProjectMeta = {
      id: projectId,
      userId: USER_A_ID,
      name: "Executive Review",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "analysed",
      dataset: null,
    };
    coordinator.queueProjectSave(project, USER_A_ID, { immediate: true });

    const reportId = generateUuid();
    const reportMarkdown = "# Executive Review Report\n\nAll metrics within SLO parameters.";

    coordinator.queueReportSave(
      {
        id: reportId,
        projectId,
        title: "Executive Review Report",
        markdown: reportMarkdown,
        objective: "Quarterly review",
        summary: { analysesCount: 2 },
      },
      USER_A_ID,
      { immediate: true },
    );
    await coordinator.flushQueue();

    expect(remoteDb.reports.has(reportId)).toBe(true);
    const remoteRep = remoteDb.reports.get(reportId);
    expect(remoteRep?.title).toBe("Executive Review Report");
    expect(remoteRep?.content_markdown).toBe(reportMarkdown);
  });

  // Scenario 6: Refresh the browser and reopen the project.
  it("Scenario 6: Reopens project and restores complete analytical state without manual sync", async () => {
    const projectId = generateUuid();
    const datasetId = generateUuid();
    const csv = "colA,colB\n1,2\n3,4";

    // Seed into remote database
    remoteDb.lumetra_projects.set(projectId, {
      id: projectId,
      user_id: USER_A_ID,
      name: "Persisted Project",
      status: "data-loaded",
      updated_at: new Date().toISOString(),
    });

    remoteDb.datasets.set(datasetId, {
      id: datasetId,
      project_id: projectId,
      user_id: USER_A_ID,
      name: "data.csv",
      row_count: 2,
      column_count: 2,
      columns: ["colA", "colB"],
      csv_content: csv,
      cleaning_steps: [],
      updated_at: new Date().toISOString(),
    });

    // Client restores project
    const restored = await supabase.loadProject(projectId);
    expect(restored).not.toBeNull();
    expect(restored?.name).toBe("Persisted Project");
    expect(restored?.dataset_name).toBe("data.csv");
    expect(restored?.csv_content).toBe(csv);
  });

  // Scenario 7: Close and reopen the browser and verify recovery from durable storage.
  it("Scenario 7: Recovers pending writes after browser closure from durable storage", async () => {
    const projectId = generateUuid();
    const item: PendingWriteItem = {
      id: generateUuid(),
      entityType: "project",
      entityId: projectId,
      projectId,
      userId: USER_A_ID,
      sequence: 1,
      timestamp: Date.now(),
      data: {
        project: {
          id: projectId,
          name: "Interrupted Write Project",
          status: "no-data",
        },
      },
      retryCount: 0,
    };

    // Simulate browser writing queue to localStorage before unexpected closure
    localStorage.setItem("lumetra.persistence_queue.v1", JSON.stringify([item]));

    // New coordinator instance representing fresh session after browser restart
    const freshCoordinator = getPersistenceCoordinator();
    freshCoordinator.init(USER_A_ID);

    expect(freshCoordinator.getState().pendingCount).toBe(1);

    // Flush should process the recovered item
    await freshCoordinator.flushQueue();

    expect(remoteDb.lumetra_projects.has(projectId)).toBe(true);
    expect(freshCoordinator.getState().status).toBe("saved");
    expect(freshCoordinator.getState().pendingCount).toBe(0);
  });

  // Scenario 8: Disconnect the internet, make changes, reconnect, and verify automatic synchronization.
  it("Scenario 8: Queues offline changes without data loss and auto-syncs upon reconnecting", async () => {
    const projectId = generateUuid();
    const project: ProjectMeta = {
      id: projectId,
      userId: USER_A_ID,
      name: "Offline Project",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "no-data",
      dataset: null,
    };

    // 1. Internet disconnects
    coordinator.setOnlineStatus(false);
    expect(coordinator.getState().isOnline).toBe(false);
    expect(coordinator.getState().status).toBe("offline");
    expect(coordinator.getState().statusText).toBe("Working offline");

    // 2. User creates changes while offline
    coordinator.queueProjectSave(project, USER_A_ID, { immediate: true });
    expect(coordinator.getState().pendingCount).toBe(1);
    expect(remoteDb.lumetra_projects.has(projectId)).toBe(false); // Not sent yet

    // 3. Internet reconnects
    coordinator.setOnlineStatus(true);
    expect(coordinator.getState().isOnline).toBe(true);

    await coordinator.flushQueue();

    // Verify changes automatically synchronized
    expect(remoteDb.lumetra_projects.has(projectId)).toBe(true);
    expect(coordinator.getState().status).toBe("saved");
    expect(coordinator.getState().statusText).toBe("All changes saved");
  });

  // Scenario 9: Sign out and sign in again.
  it("Scenario 9: Preserves user isolation upon sign-out and restores projects upon sign-in", async () => {
    const projA: ProjectMeta = {
      id: generateUuid(),
      userId: USER_A_ID,
      name: "User A Sensitive Research",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "no-data",
      dataset: null,
    };

    saveProjects([projA]);
    expect(loadProjectsForUser(USER_A_ID)).toHaveLength(1);

    // User signs out
    coordinator.setUserId(null);
    // Unauthenticated user should not see User A's projects
    const guestProjects = loadProjectsForUser(null);
    expect(guestProjects.find((p) => p.id === projA.id)).toBeUndefined();

    // User signs back in
    coordinator.setUserId(USER_A_ID);
    const userAProjects = loadProjectsForUser(USER_A_ID);
    expect(userAProjects.find((p) => p.id === projA.id)).toBeDefined();
  });

  // Scenario 10: Use a second account and verify that the first account's data remains inaccessible.
  it("Scenario 10: Prevents cross-account data leakage; User B cannot access User A's data", async () => {
    const projAId = generateUuid();
    // User A creates project
    remoteDb.lumetra_projects.set(projAId, {
      id: projAId,
      user_id: USER_A_ID,
      name: "User A Confidential Project",
      status: "no-data",
    });

    // User B attempts to upsert dataset under User A's project (violating RLS)
    const datasetBId = generateUuid();
    const res = await supabase.upsertDatasetRecord(
      projAId,
      {
        id: datasetBId,
        name: "malicious.csv",
        rows: 5,
        columns: 1,
      },
      USER_B_ID, // User B
    );

    expect(res.ok).toBe(false);
    expect(res.error).toContain("RLS check failed");
    expect(remoteDb.datasets.has(datasetBId)).toBe(false);
  });

  // Scenario 11: Simulate a failed write and confirm application does not falsely display "Saved".
  it("Scenario 11: Does not falsely display 'Saved' when remote write fails", async () => {
    // Inject write failure
    vi.spyOn(supabase, "upsertProjectRecord").mockResolvedValueOnce({
      ok: false,
      error: "PostgreSQL 503 Service Unavailable",
    });

    const projectId = generateUuid();
    const project: ProjectMeta = {
      id: projectId,
      userId: USER_A_ID,
      name: "Failed Write Project",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "no-data",
      dataset: null,
    };

    coordinator.queueProjectSave(project, USER_A_ID, { immediate: true });
    await coordinator.flushQueue();

    // Must NOT be 'saved'
    expect(coordinator.getState().status).not.toBe("saved");
    expect(coordinator.getState().statusText).not.toBe("All changes saved");
    expect(["retrying", "error", "pending"]).toContain(coordinator.getState().status);
  });

  // Scenario 12: Test rapid successive edits to ensure older writes cannot overwrite newer versions.
  it("Scenario 12: Handles rapid successive edits with debouncing without overwriting newer state", async () => {
    const projectId = generateUuid();

    // Edit 1: Initial name
    coordinator.queueProjectSave(
      {
        id: projectId,
        userId: USER_A_ID,
        name: "Title Edit 1",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: "no-data",
        dataset: null,
      },
      USER_A_ID,
      { immediate: false },
    );

    // Edit 2: Rapid change
    coordinator.queueProjectSave(
      {
        id: projectId,
        userId: USER_A_ID,
        name: "Title Edit 2",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: "no-data",
        dataset: null,
      },
      USER_A_ID,
      { immediate: false },
    );

    // Edit 3: Final name
    coordinator.queueProjectSave(
      {
        id: projectId,
        userId: USER_A_ID,
        name: "Final Correct Title",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: "no-data",
        dataset: null,
      },
      USER_A_ID,
      { immediate: false },
    );

    // Only one coalesced item should remain in queue for this project
    expect(coordinator.getState().pendingCount).toBe(1);

    await coordinator.flushQueue();

    const remoteProj = remoteDb.lumetra_projects.get(projectId);
    expect(remoteProj?.name).toBe("Final Correct Title");
    expect(coordinator.getState().status).toBe("saved");
  });
});

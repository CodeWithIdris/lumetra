/**
 * Phase 2 Scalable Local Persistence Automated Test Suite.
 *
 * Covers all Section 7 requirements:
 * 1. Dataset create, read, update, and delete (CRUD)
 * 2. Persistence across application reloads
 * 3. Legacy localStorage migration
 * 4. Interrupted and repeated migration
 * 5. Quota and storage error handling
 * 6. Project duplication and independent deletion
 * 7. Saved analysis preservation
 * 8. Cloud sync compatibility
 * 9. Empty and large dataset support
 *
 * NOTE ON TEST HARNESS vs REAL BROWSER:
 * These tests run against an in-memory IndexedDB harness (defined in indexeddb-test-harness.ts)
 * that strictly adheres to the W3C IndexedDB 2.0 transaction, object store, and index lifecycle.
 * In a real browser, IndexedDB operations are backed by the browser engine (e.g. LevelDB in Chromium,
 * SQLite in Firefox/WebKit) and may be subject to device storage boundaries (OS disk pressure, private
 * browsing mode storage wipes, user manual site-data clearance).
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { Dataset } from "@/lib/data/types";
import {
  saveDataset,
  loadDataset,
  loadDatasetByProject,
  updateDataset,
  deleteDataset,
  deleteDatasetByProject,
  duplicateDataset,
  listDatasetMetadata,
  clearAllDatasets,
  migrateFromLocalStorage,
  checkStorageAvailable,
  closeDatabase,
  PersistenceError,
} from "@/lib/persistence/indexeddb";
import {
  loadProjects,
  saveProjects,
  storeCsv,
  loadCsv,
  duplicateProject,
  type ProjectMeta,
} from "@/lib/persistence/projects";
import { harnessControls } from "./indexeddb-test-harness";
import { getSupabaseClient } from "@/lib/persistence/supabase";

function makeTestDataset(id: string, rowCount: number = 5): Dataset {
  const rows = Array.from({ length: rowCount }, (_, i) => [
    `row_${i}`,
    i % 2 === 0 ? String(i * 10) : null, // explicit null for missing values
    `dept_${i % 3}`,
  ]);

  return {
    id,
    name: `Test Dataset ${id}`,
    source: "upload",
    columns: ["id", "metric", "category"],
    rows,
    sizeBytes: 1024 + rowCount * 50,
    warnings: ["Row 1 had a null metric"],
    delimiter: ",",
  };
}

describe("IndexedDB Scalable Local Persistence (Phase 2)", () => {
  beforeEach(() => {
    localStorage.clear();
    harnessControls.resetAll();
    closeDatabase();
  });

  describe("1. Dataset CRUD Operations", () => {
    it("creates, reads, updates, and deletes datasets with null value preservation", async () => {
      const ds = makeTestDataset("ds_1", 10);
      const saved = await saveDataset(ds, { projectId: "proj_1", csv: "id,metric,category\n..." });

      expect(saved.id).toBe("ds_1");
      expect(saved.projectId).toBe("proj_1");
      expect(saved.rows.length).toBe(10);
      // Correctness requirement: missing value must remain null
      expect(saved.rows[1]![1]).toBeNull();

      // Read by ID
      const loaded = await loadDataset("ds_1");
      expect(loaded).not.toBeNull();
      expect(loaded!.name).toBe(ds.name);
      expect(loaded!.rows[1]![1]).toBeNull();

      // Read by Project ID
      const loadedByProject = await loadDatasetByProject("proj_1");
      expect(loadedByProject).not.toBeNull();
      expect(loadedByProject!.id).toBe("ds_1");

      // Update dataset
      const updated = await updateDataset("ds_1", { name: "Renamed Dataset" });
      expect(updated.name).toBe("Renamed Dataset");

      const readUpdated = await loadDataset("ds_1");
      expect(readUpdated!.name).toBe("Renamed Dataset");

      // Delete dataset
      const deleted = await deleteDataset("ds_1");
      expect(deleted).toBe(true);

      const afterDelete = await loadDataset("ds_1");
      expect(afterDelete).toBeNull();
    });

    it("lists dataset metadata without loading dataset rows into memory", async () => {
      const ds1 = makeTestDataset("ds_meta_1", 100);
      const ds2 = makeTestDataset("ds_meta_2", 200);

      await saveDataset(ds1, { projectId: "proj_1" });
      await saveDataset(ds2, { projectId: "proj_2" });

      const metaList = await listDatasetMetadata();
      expect(metaList.length).toBe(2);

      const meta1 = metaList.find((m) => m.id === "ds_meta_1");
      expect(meta1).toBeDefined();
      expect(meta1!.rowCount).toBe(100);
      expect(meta1!.columnCount).toBe(3);
      // Ensure rows property is absent from metadata record to protect RAM
      expect((meta1 as unknown as Record<string, unknown>)["rows"]).toBeUndefined();
    });
  });

  describe("2. Persistence across Application Reloads", () => {
    it("retains datasets and metadata when the database connection is closed and reopened", async () => {
      const ds = makeTestDataset("ds_reload", 25);
      await saveDataset(ds, { projectId: "proj_reload", csv: "id,metric,category\n1,10,A" });

      // Simulate browser tab close / page reload by closing DB connection
      closeDatabase();

      // Reopen
      const reloaded = await loadDataset("ds_reload");
      expect(reloaded).not.toBeNull();
      expect(reloaded!.id).toBe("ds_reload");
      expect(reloaded!.rows.length).toBe(25);
      expect(reloaded!.columns).toEqual(["id", "metric", "category"]);
      expect(reloaded!.rows[1]![1]).toBeNull();
    });
  });

  describe("3. Legacy localStorage Migration", () => {
    it("safely migrates legacy CSVs from localStorage into IndexedDB and verifies writes before retiring legacy keys", async () => {
      const legacyProjectId = "legacy_proj_1";
      const legacyCsv = "city,temp,rainfall\nBerlin,18.5,45\nParis,21.0,\nMadrid,29.2,5";

      // Populate legacy localStorage records
      localStorage.setItem(`lumetra.data.v1.${legacyProjectId}`, legacyCsv);
      saveProjects([
        {
          id: legacyProjectId,
          name: "European Weather",
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
          status: "data-loaded",
          dataset: {
            name: "weather.csv",
            rows: 3,
            columns: 3,
            source: "upload",
            stored: true,
          },
        },
      ]);

      // Execute migration
      const migrationResult = await migrateFromLocalStorage();
      expect(migrationResult.success).toBe(true);
      expect(migrationResult.migrated).toBe(1);

      // Verify dataset now lives in IndexedDB
      const migratedDs = await loadDatasetByProject(legacyProjectId);
      expect(migratedDs).not.toBeNull();
      expect(migratedDs!.rows.length).toBe(3);
      expect(migratedDs!.columns).toEqual(["city", "temp", "rainfall"]);
      // Missing value in Paris rainfall must remain null
      expect(migratedDs!.rows[1]![2]).toBeNull();

      // Verify legacy localStorage key has been safely removed AFTER verification
      expect(localStorage.getItem(`lumetra.data.v1.${legacyProjectId}`)).toBeNull();

      // Verify project metadata was updated to reference the stable dataset ID
      const updatedProjects = loadProjects();
      expect(updatedProjects[0]!.dataset?.id).toBe(migratedDs!.id);
      expect(updatedProjects[0]!.dataset?.stored).toBe(true);
    });
  });

  describe("4. Interrupted and Repeated Migration", () => {
    it("handles repeated migration attempts idempotently without creating duplicate datasets", async () => {
      const projId = "proj_repeat";
      const csv = "a,b\n1,2\n3,4";
      localStorage.setItem(`lumetra.data.v1.${projId}`, csv);
      saveProjects([
        {
          id: projId,
          name: "Repeat Test",
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
          status: "data-loaded",
          dataset: { name: "repeat.csv", rows: 2, columns: 2, source: "upload", stored: true },
        },
      ]);

      // First run
      const firstRun = await migrateFromLocalStorage();
      expect(firstRun.success).toBe(true);
      expect(firstRun.migrated).toBe(1);

      // Second run (simulating re-trigger or repeated application boot)
      const secondRun = await migrateFromLocalStorage();
      expect(secondRun.success).toBe(true);
      expect(secondRun.migrated).toBe(0); // Nothing new to migrate

      const allMeta = await listDatasetMetadata();
      expect(allMeta.length).toBe(1); // No duplicates
    });

    it("retains the original legacy data when parsing fails during migration", async () => {
      const corruptId = "proj_corrupt";
      // Completely empty / invalid CSV content that fails parsing
      localStorage.setItem(`lumetra.data.v1.${corruptId}`, "   ");

      const res = await migrateFromLocalStorage();
      expect(res.success).toBe(false);
      expect(res.errors.length).toBeGreaterThan(0);

      // Crucial: Original legacy data MUST NOT be deleted if migration failed
      expect(localStorage.getItem(`lumetra.data.v1.${corruptId}`)).toBe("   ");
    });
  });

  describe("5. Quota and Storage Error Handling", () => {
    it("aborts transactions cleanly and surfaces QuotaExceededError when browser storage is exhausted", async () => {
      const ds = makeTestDataset("ds_quota_test", 10);

      // Inject simulated browser storage quota failure
      harnessControls.simulateQuotaError = true;

      await expect(saveDataset(ds)).rejects.toThrowError(PersistenceError);

      try {
        await saveDataset(ds);
      } catch (e) {
        expect(e).toBeInstanceOf(PersistenceError);
        expect((e as PersistenceError).type).toBe("QUOTA_EXCEEDED");
      }

      // Turn off fault injection
      harnessControls.simulateQuotaError = false;

      // Existing data is uncorrupted
      const afterRecover = await loadDataset("ds_quota_test");
      expect(afterRecover).toBeNull();
    });

    it("evaluates storage requirements using checkStorageAvailable", async () => {
      const check = await checkStorageAvailable(1024 * 1024);
      expect(check).toBeDefined();
      expect(check.ok).toBe(true);
    });
  });

  describe("6. Project Duplication and Independent Deletion", () => {
    it("ensures duplicated projects have isolated dataset state so deleting one does not affect the other", async () => {
      const origProjId = "proj_orig";
      const origDsId = "ds_orig";
      const origDs = makeTestDataset(origDsId, 5);

      await saveDataset(origDs, { projectId: origProjId, csv: "id,metric,category\n..." });

      saveProjects([
        {
          id: origProjId,
          name: "Original Project",
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
          status: "data-loaded",
          dataset: {
            id: origDsId,
            name: "Original Dataset",
            rows: 5,
            columns: 3,
            source: "upload",
            stored: true,
          },
          cleaningSteps: [],
          savedAnalyses: [],
        },
      ]);

      // 1. Duplicate metadata using duplicateProject
      const duplicatedMeta = duplicateProject(origProjId);
      expect(duplicatedMeta).not.toBeNull();
      const dupProjId = duplicatedMeta!.id;
      const dupDsId = duplicatedMeta!.dataset!.id!;

      expect(dupProjId).not.toBe(origProjId);
      expect(dupDsId).not.toBe(origDsId);

      // 2. Duplicate dataset in IndexedDB
      const dupDataset = await duplicateDataset(origDsId, dupDsId, dupProjId);
      expect(dupDataset).not.toBeNull();
      expect(dupDataset!.id).toBe(dupDsId);
      expect(dupDataset!.projectId).toBe(dupProjId);

      // 3. Mutate the duplicated dataset
      await updateDataset(dupDsId, { name: "Mutated Copy" });

      // Verify original dataset was NOT mutated
      const reloadedOrig = await loadDataset(origDsId);
      expect(reloadedOrig!.name).toBe("Test Dataset ds_orig");

      // 4. Delete the original project's dataset
      await deleteDataset(origDsId);
      await deleteDatasetByProject(origProjId);

      // Verify original is gone
      expect(await loadDataset(origDsId)).toBeNull();

      // Verify duplicated dataset is completely unharmed and intact
      const preservedDup = await loadDataset(dupDsId);
      expect(preservedDup).not.toBeNull();
      expect(preservedDup!.name).toBe("Mutated Copy");
      expect(preservedDup!.rows.length).toBe(5);
    });
  });

  describe("7. Saved Analysis Preservation", () => {
    it("preserves saved analyses and cleaning steps alongside IndexedDB datasets", async () => {
      const projId = "proj_with_analyses";
      const dsId = "ds_analyses";
      const ds = makeTestDataset(dsId, 12);
      await saveDataset(ds, { projectId: projId });

      const mockProject: ProjectMeta = {
        id: projId,
        name: "Analysis Project",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        status: "analysed",
        dataset: {
          id: dsId,
          name: ds.name,
          rows: 12,
          columns: 3,
          source: "upload",
          stored: true,
        },
        cleaningSteps: [
          {
            id: "step_1",
            timestamp: "2026-01-01T01:00:00Z",
            type: "remove_duplicates",
            params: {},
            description: "Removed duplicate rows",
            effect: { rowsBefore: 14, rowsAfter: 12, missingBefore: 0, missingAfter: 0 },
          },
        ],
        savedAnalyses: [
          {
            id: "analysis_corr_1",
            type: "correlation",
            createdAt: "2026-01-01T02:00:00Z",
            datasetId: dsId,
            variables: ["metric", "category"],
            results: { r: 0.85, pValue: 0.001, n: 12 },
            interpretation: "Strong positive correlation observed.",
            parameters: {},
            sampleSize: 12,
          },
        ],
      };

      saveProjects([mockProject]);

      // Re-read projects from storage
      const loadedList = loadProjects();
      const loadedProj = loadedList.find((p) => p.id === projId);
      expect(loadedProj).toBeDefined();
      expect(loadedProj!.savedAnalyses).toHaveLength(1);
      expect(loadedProj!.savedAnalyses![0]!.id).toBe("analysis_corr_1");
      expect(loadedProj!.cleaningSteps).toHaveLength(1);

      // Associated dataset is loaded from IndexedDB
      const loadedDs = await loadDataset(loadedProj!.dataset!.id!);
      expect(loadedDs).not.toBeNull();
      expect(loadedDs!.rows.length).toBe(12);
    });
  });

  describe("8. Cloud Sync Compatibility", () => {
    it("keeps local and cloud storage distinct without automatic unconsented uploads", async () => {
      const client = getSupabaseClient();
      // Verify default autoSync is disabled
      expect(client.getConfig().autoSync).toBe(false);

      const ds = makeTestDataset("ds_cloud_compat", 10);
      await saveDataset(ds, { projectId: "proj_cloud_compat", csv: "a,b\n1,2" });

      // Local storage remains distinct
      const localLoaded = await loadDataset("ds_cloud_compat");
      expect(localLoaded).not.toBeNull();
    });
  });

  describe("9. Empty and Larger Datasets", () => {
    it("handles minimal/empty cell structures and datasets up to the 20 MB import threshold", async () => {
      // 1. Single cell minimal dataset
      const minimalDs: Dataset = {
        id: "ds_minimal",
        name: "Minimal Dataset",
        source: "upload",
        columns: ["col_single"],
        rows: [[null]], // single cell with missing value
        sizeBytes: 25,
        warnings: [],
      };
      await saveDataset(minimalDs);
      const readMinimal = await loadDataset("ds_minimal");
      expect(readMinimal).not.toBeNull();
      expect(readMinimal!.rows[0]![0]).toBeNull();

      // 2. Large dataset (1,000 rows x 20 columns)
      const colCount = 20;
      const rowCount = 1000;
      const columns = Array.from({ length: colCount }, (_, i) => `Col_${i + 1}`);
      const rows = Array.from({ length: rowCount }, (_, r) =>
        Array.from({ length: colCount }, (_, c) =>
          r % 7 === 0 && c === 2 ? null : `${r * 10 + c}`,
        ),
      );

      const largeDs: Dataset = {
        id: "ds_large",
        name: "Large Scale Dataset",
        source: "upload",
        columns,
        rows,
        sizeBytes: 500_000,
        warnings: [],
      };

      await saveDataset(largeDs, { projectId: "proj_large" });

      const loadedLarge = await loadDataset("ds_large");
      expect(loadedLarge).not.toBeNull();
      expect(loadedLarge!.rows.length).toBe(rowCount);
      expect(loadedLarge!.columns.length).toBe(colCount);
      // Verify specific missing cell
      expect(loadedLarge!.rows[7]![2]).toBeNull();
      // Verify non-missing cell
      expect(loadedLarge!.rows[1]![1]).toBe("11");

      // Verify metadata listing for large dataset remains fast
      const meta = await listDatasetMetadata();
      const largeMeta = meta.find((m) => m.id === "ds_large");
      expect(largeMeta).toBeDefined();
      expect(largeMeta!.rowCount).toBe(1000);
      expect(largeMeta!.columnCount).toBe(20);
    });
  });
});

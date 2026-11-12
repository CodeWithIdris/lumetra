import { beforeEach, describe, expect, it } from "vitest";
import { runDescriptive, computeDatasetSignature, isAnalysisStale } from "@/lib/stats/analysis";
import type { Dataset } from "@/lib/data/types";
import type { SavedAnalysis } from "@/lib/stats/analysis";
import {
  clearAllDatasets,
  closeDatabase,
  hashDataset,
  listDatasetVersions,
  loadDataset,
  loadDatasetVersion,
  saveDataset,
  saveDatasetVersion,
} from "@/lib/persistence/indexeddb";
import { harnessControls } from "./indexeddb-test-harness";

function makeDataset(rows: Dataset["rows"]): Dataset {
  return {
    id: "versioned-dataset",
    name: "measurements.csv",
    source: "upload",
    columns: ["sample", "value"],
    rows,
    sizeBytes: 128,
    warnings: [],
  };
}

describe("Phase 4B.4 dataset recovery", () => {
  beforeEach(async () => {
    harnessControls.resetAll();
    closeDatabase();
    await clearAllDatasets();
  });

  it("creates immutable versions only when content or cleaning history changes", async () => {
    const dataset = makeDataset([
      ["a", "10"],
      ["b", null],
      ["c", "=SUM(A1:A2)"],
    ]);
    const first = await saveDatasetVersion({
      projectId: "versioned-project",
      userId: "owner-a",
      dataset,
      cleaningSteps: [],
      description: "Imported measurements",
    });
    const same = await saveDatasetVersion({
      projectId: "versioned-project",
      userId: "owner-a",
      dataset,
      cleaningSteps: [],
      description: "A minor UI interaction",
    });

    expect(same.id).toBe(first.id);
    expect(first.version).toBe(1);
    expect(first.contentHash).toBe(hashDataset(dataset));
    expect(first.dataset.rows).toEqual(dataset.rows);
    expect(first.dataset.csv).not.toContain("out-of-date");

    const changed = await saveDatasetVersion({
      projectId: "versioned-project",
      userId: "owner-a",
      dataset: makeDataset([
        ["a", "10"],
        ["c", "=SUM(A1:A2)"],
      ]),
      cleaningSteps: [{ id: "drop", type: "drop_na" }],
      description: "Removed rows with missing values",
    });

    expect(changed.version).toBe(2);
    expect(await listDatasetVersions("versioned-project")).toHaveLength(2);
  });

  it("restores the exact structured snapshot without pairing it with stale CSV content", async () => {
    const source = makeDataset([
      ["a", "10"],
      ["b", null],
      ["c", "=SUM(A1:A2)"],
    ]);
    const version = await saveDatasetVersion({
      projectId: "versioned-project",
      userId: "owner-a",
      dataset: source,
      cleaningSteps: [],
      description: "Imported measurements",
    });
    const loadedVersion = await loadDatasetVersion(version.id);
    expect(loadedVersion?.dataset.rows).toEqual(source.rows);
    expect(loadedVersion?.contentHash).toBe(hashDataset(loadedVersion!.dataset));

    await saveDataset(loadedVersion!.dataset, {
      projectId: "versioned-project",
      ...(loadedVersion!.dataset.csv !== undefined ? { csv: loadedVersion!.dataset.csv } : {}),
    });
    const restored = await loadDataset(source.id);
    expect(restored?.rows).toEqual(source.rows);
    expect(restored?.csv).toBe(loadedVersion?.dataset.csv);
  });

  it("keeps an analysis tied to its source version and marks it stale after a later edit", async () => {
    const original = makeDataset([
      ["one", "10"],
      ["two", "20"],
    ]);
    const sourceVersion = await saveDatasetVersion({
      projectId: "versioned-project",
      userId: "owner-a",
      dataset: original,
      cleaningSteps: [],
      description: "Imported measurements",
    });
    const mean = runDescriptive(original).numeric[0]?.summary.mean;
    expect(mean).toBe(15);

    const saved: SavedAnalysis = {
      id: "analysis-1",
      name: "Value summary",
      type: "descriptive",
      timestamp: "2026-01-01T00:00:00.000Z",
      datasetId: original.id,
      datasetVersion: sourceVersion.version,
      datasetVersionId: sourceVersion.id,
      datasetName: original.name,
      datasetSignature: computeDatasetSignature(original),
      variables: ["value"],
      configuration: {},
      sampleSize: 2,
      missingCount: 0,
      missingHandling: "exclude",
      results: { independentlyCalculatedMean: mean },
      interpretation: {
        observedResults: [],
        statisticalInference: [],
        assumptions: [],
        limitations: [],
        recommendations: [],
      },
      methodNotes: [],
    };

    const edited = makeDataset([
      ["one", "100"],
      ["two", "200"],
    ]);
    await saveDatasetVersion({
      projectId: "versioned-project",
      userId: "owner-a",
      dataset: edited,
      cleaningSteps: [],
      description: "Updated measurements",
    });

    expect(saved.datasetVersion).toBe(sourceVersion.version);
    expect(saved.datasetVersionId).toBe(sourceVersion.id);
    expect(saved.results["independentlyCalculatedMean"]).toBe(15);
    expect(isAnalysisStale(saved, edited)).toBe(true);
  });
});

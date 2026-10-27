import { beforeEach, describe, expect, it } from "vitest";
import { parseCsvText, MAX_FILE_BYTES } from "@/lib/data/parse";
import { profileDataset, columnValues } from "@/lib/data/infer";
import {
  applyCleaningStep,
  replayCleaningSteps,
  auditDataset,
  removeDuplicateRows,
  handleMissingValues,
  filterRows,
  recodeCategorical,
} from "@/lib/data/clean";
import {
  runDescriptive,
  createDescriptiveSavedAnalysis,
  createCorrelationSavedAnalysis,
  createTTestSavedAnalysis,
  createCrosstabSavedAnalysis,
  isAnalysisStale,
  computeDatasetSignature,
} from "@/lib/stats/analysis";
import {
  loadProjects,
  saveProjects,
  storeCsv,
  loadCsv,
  deleteCsv,
  duplicateProject,
  replaceCsv,
  MAX_STORED_CSV_BYTES,
  type ProjectMeta,
} from "@/lib/persistence/projects";
import { correlation, welchTTest, crosstab } from "@/lib/stats/advanced";
import { describe as describeStats } from "@/lib/stats/descriptive";

const FIXTURE_CSV = `id,department,salary,performance,start_date
1,Engineering,110000,4.5,2023-01-15
2,Marketing,85000,3.8,2023-03-01
3,Engineering,125000,4.9,2022-11-20
4,Sales,90000,4.0,2024-02-10
5,Marketing,78000,,2023-06-15
6,Engineering,115000,4.2,2023-08-01
7,Sales,95000,4.1,2022-09-05
1,Engineering,110000,4.5,2023-01-15`; // row 8 is an exact duplicate of row 1

describe("End-to-End Data Analysis Workflow", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  // 1. Project creation
  it("1. creates a project with meaningful metadata and optional description", () => {
    const project: ProjectMeta = {
      id: "proj_wf_1",
      name: "Q4 Workforce Compensation & Performance",
      description: "Evaluate department salary disparities and performance ratings.",
      objective: "Evaluate department salary disparities and performance ratings.",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "no-data",
      dataset: null,
      cleaningSteps: [],
      savedAnalyses: [],
    };

    const saved = saveProjects([project]);
    expect(saved).toBe(true);

    const loaded = loadProjects();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.id).toBe("proj_wf_1");
    expect(loaded[0]!.name).toBe("Q4 Workforce Compensation & Performance");
    expect(loaded[0]!.description).toBe(
      "Evaluate department salary disparities and performance ratings.",
    );
    expect(loaded[0]!.status).toBe("no-data");
  });

  // 2. CSV import
  it("2. imports a valid CSV with correct rows, columns, and types without silently coercing nulls", () => {
    const parsed = parseCsvText(FIXTURE_CSV, "workforce.csv");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const ds = parsed.dataset;
    expect(ds.columns).toEqual(["id", "department", "salary", "performance", "start_date"]);
    expect(ds.rows).toHaveLength(8);

    // Performance cell for employee 5 is missing
    expect(ds.rows[4]![3]).toBeNull();
    // Missing is NEVER coerced to 0
    expect(ds.rows[4]![3]).not.toBe("0");
    expect(ds.rows[4]![3]).not.toBe(0);

    const profiles = profileDataset(ds);
    const salProfile = profiles.find((p) => p.name === "salary");
    const deptProfile = profiles.find((p) => p.name === "department");
    const perfProfile = profiles.find((p) => p.name === "performance");

    expect(salProfile?.type).toBe("numeric");
    expect(deptProfile?.type).toBe("categorical");
    expect(perfProfile?.type).toBe("numeric");
    expect(perfProfile?.missing).toBe(1);
  });

  // 3. Invalid file handling
  it("3. rejects invalid or malformed files with clear, actionable errors", () => {
    // Empty file
    const emptyRes = parseCsvText("", "empty.csv");
    expect(emptyRes.ok).toBe(false);
    if (!emptyRes.ok) {
      expect(emptyRes.errors[0]).toContain("empty");
    }

    // Binary file
    const binaryRes = parseCsvText("header\n\u0000binary", "bin.csv");
    expect(binaryRes.ok).toBe(false);
    if (!binaryRes.ok) {
      expect(binaryRes.errors[0]).toContain("binary data");
    }

    // Header only
    const headerOnly = parseCsvText("col1,col2\n", "header_only.csv");
    expect(headerOnly.ok).toBe(false);
    if (!headerOnly.ok) {
      expect(headerOnly.errors[0]).toContain("no data rows");
    }

    // Oversized text beyond 20 MB limit
    const hugeCsv = "a,b\n" + "1,2\n".repeat(MAX_FILE_BYTES / 4 + 10);
    const oversized = parseCsvText(hugeCsv, "huge.csv");
    expect(oversized.ok).toBe(false);
    if (!oversized.ok) {
      expect(oversized.errors[0]).toContain("larger than 20 MB");
    }
  });

  // 4. Data cleaning
  it("4. applies reversible cleaning transformations and preserves raw data integrity", () => {
    const parsed = parseCsvText(FIXTURE_CSV, "workforce.csv");
    if (!parsed.ok) throw new Error();
    const raw = parsed.dataset;

    const initialAudit = auditDataset(raw);
    expect(initialAudit.duplicateRowsCount).toBe(1); // row 8 duplicate of row 1
    expect(initialAudit.missingCells).toBe(1);

    // Step 1: Remove duplicate rows
    const { dataset: afterDedupe, step: step1 } = applyCleaningStep(raw, "remove_duplicates", {});
    expect(afterDedupe.rows).toHaveLength(7);
    expect(step1.effect.rowsBefore).toBe(8);
    expect(step1.effect.rowsAfter).toBe(7);

    // Step 2: Handle missing in performance by median imputation
    const { dataset: afterImpute, step: step2 } = applyCleaningStep(
      afterDedupe,
      "handle_missing",
      { column: "performance", strategy: "fill_median" },
    );
    // Non-missing performances: 4.5, 3.8, 4.9, 4.0, 4.2, 4.1 -> sorted: [3.8, 4.0, 4.1, 4.2, 4.5, 4.9]
    // Median is (4.1 + 4.2) / 2 = 4.15
    const missingRow = afterImpute.rows.find((r) => r[0] === "5");
    expect(missingRow?.[3]).toBe("4.15");
    expect(step2.effect.missingBefore).toBe(1);
    expect(step2.effect.missingAfter).toBe(0);

    // Step 3: Recode department name
    const { dataset: afterRecode, step: step3 } = applyCleaningStep(
      afterImpute,
      "recode_categorical",
      { column: "department", fromValue: "Marketing", toValue: "Growth Marketing" },
    );
    expect(afterRecode.rows.some((r) => r[1] === "Marketing")).toBe(false);
    expect(afterRecode.rows.some((r) => r[1] === "Growth Marketing")).toBe(true);

    // Raw dataset is completely unmutated
    expect(raw.rows).toHaveLength(8);
    expect(raw.rows[4]![3]).toBeNull();
    expect(raw.rows[1]![1]).toBe("Marketing");

    // Replay steps from scratch
    const replayed = replayCleaningSteps(raw, [step1, step2, step3]);
    expect(replayed.dataset.rows).toHaveLength(7);
    expect(replayed.steps).toHaveLength(3);
  });

  // 5. Statistical calculation verification
  it("5. executes valid statistical analyses and verifies numerical correctness", () => {
    // Verified data: salaries [110000, 85000, 125000, 90000, 78000, 115000, 95000] (n = 7)
    const salaries = [110000, 85000, 125000, 90000, 78000, 115000, 95000];
    const desc = describeStats(salaries);

    const sum = 110000 + 85000 + 125000 + 90000 + 78000 + 115000 + 95000;
    const expectedMean = sum / 7;
    expect(desc.mean).toBeCloseTo(expectedMean, 6);
    expect(desc.median).toBe(95000); // sorted: [78k, 85k, 90k, 95k, 110k, 115k, 125k]
    expect(desc.min).toBe(78000);
    expect(desc.max).toBe(125000);

    // Bivariate correlation
    const performances = [4.5, 3.8, 4.9, 4.0, 3.5, 4.2, 4.1];
    const corr = correlation(salaries, performances, "pearson");
    expect(corr.n).toBe(7);
    expect(corr.r).toBeGreaterThan(0.85); // positive correlation between salary and rating
    expect(corr.pValue).toBeLessThan(0.05);

    // Welch's t-test
    const engSalaries = [110000, 125000, 115000]; // mean = 116666.67
    const mktSalaries = [85000, 78000]; // mean = 81500
    const tTest = welchTTest(engSalaries, mktSalaries, ["Engineering", "Marketing"]);
    expect(tTest.difference).toBeCloseTo(116666.67 - 81500, 0);
    expect(tTest.pValue).toBeLessThan(0.05);

    // Crosstab
    const cross = crosstab(["A", "A", "B", "B"], ["Yes", "No", "Yes", "No"]);
    expect(cross.n).toBe(4);
    expect(cross.df).toBe(1);
  });

  // 6. Invalid analysis inputs
  it("6. rejects invalid analysis inputs with clear explanatory errors", () => {
    // Correlation with < 3 pairs
    const smallCorr = correlation([1, 2], [10, 20]);
    expect(smallCorr.r).toBeNull();
    expect(smallCorr.note).toContain("At least 3 complete pairs");

    // Constant predictor
    const constCorr = correlation([5, 5, 5, 5], [10, 20, 30, 40]);
    expect(constCorr.r).toBeNull();
    expect(constCorr.note).toContain("constant");

    // Welch t-test with 1 observation per group
    const smallTTest = welchTTest([10], [20]);
    expect(smallTTest.t).toBeNull();
    expect(smallTTest.note).toContain("at least 2 values");

    // Zero variance in both groups
    const zeroVarTTest = welchTTest([10, 10], [20, 20]);
    expect(zeroVarTTest.t).toBeNull();
    expect(zeroVarTTest.note).toContain("zero variance");
  });

  // 7. Saved analysis reopening
  it("7. saves an analysis in a project, reloads it, and restores its complete state", () => {
    const parsed = parseCsvText(FIXTURE_CSV, "workforce.csv");
    if (!parsed.ok) throw new Error();

    const analysis = createCorrelationSavedAnalysis(
      parsed.dataset,
      "salary",
      "performance",
      "pearson",
    );
    expect(analysis.id).toBeDefined();
    expect(analysis.interpretation.observedResults.length).toBeGreaterThan(0);
    expect(analysis.interpretation.recommendations.length).toBeGreaterThan(0);

    const project: ProjectMeta = {
      id: "p_with_analysis",
      name: "Comp Analysis",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "analysed",
      dataset: {
        name: "workforce.csv",
        rows: 8,
        columns: 5,
        source: "upload",
        stored: true,
      },
      savedAnalyses: [analysis],
    };

    saveProjects([project]);
    storeCsv("p_with_analysis", FIXTURE_CSV);

    const reloaded = loadProjects().find((p) => p.id === "p_with_analysis");
    expect(reloaded).not.toBeNull();
    expect(reloaded!.savedAnalyses).toHaveLength(1);

    const restoredAnalysis = reloaded!.savedAnalyses![0]!;
    expect(restoredAnalysis.name).toContain("salary vs performance");
    expect(restoredAnalysis.results["r"]).toBeCloseTo(analysis.results["r"] as number, 5);
    expect(restoredAnalysis.interpretation.assumptions).toEqual(analysis.interpretation.assumptions);
  });

  // 8. Stale analysis detection
  it("8. detects when dataset changes and marks earlier results as stale without overwriting", () => {
    const parsed = parseCsvText(FIXTURE_CSV, "workforce.csv");
    if (!parsed.ok) throw new Error();
    const ds1 = parsed.dataset;

    const analysis = createCorrelationSavedAnalysis(ds1, "salary", "performance");
    expect(isAnalysisStale(analysis, ds1)).toBe(false);

    // Modify dataset (filter rows)
    const ds2 = filterRows(ds1, "department", "equals", "Engineering");
    expect(isAnalysisStale(analysis, ds2)).toBe(true);

    // Stale analysis still holds its original reproducible values
    expect(analysis.datasetSignature).toBe(computeDatasetSignature(ds1));
    expect(analysis.datasetSignature).not.toBe(computeDatasetSignature(ds2));
  });

  // 9. Report generation correctness
  it("9. generates a report containing correct computed values, cleaning history, and disclosures", () => {
    const parsed = parseCsvText(FIXTURE_CSV, "workforce.csv");
    if (!parsed.ok) throw new Error();

    const report = runDescriptive(parsed.dataset);
    expect(report.rowCount).toBe(8);
    expect(report.columnCount).toBe(5);

    const salReport = report.numeric.find((n) => n.column === "salary");
    expect(salReport).toBeDefined();
    expect(salReport!.summary.n).toBe(8);
    expect(salReport!.summary.mean).toBeCloseTo(808000 / 8, 2);

    const perfReport = report.numeric.find((n) => n.column === "performance");
    expect(perfReport!.summary.missing).toBe(1);
    expect(perfReport!.summary.n).toBe(7);

    // Disclosures in narrative
    expect(report.summary.some((s) => s.includes("Missing values were excluded"))).toBe(true);
  });

  // 10. Persistence failures, duplication, and clean deletion
  it("10. handles project duplication, deletion, and storage edge cases safely", () => {
    const p1: ProjectMeta = {
      id: "orig_project",
      name: "Q3 Retention Study",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "data-loaded",
      dataset: { name: "data.csv", rows: 10, columns: 2, source: "upload", stored: true },
      cleaningSteps: [],
      savedAnalyses: [],
    };
    saveProjects([p1]);
    storeCsv("orig_project", "a,b\n1,2");

    // Duplicate project
    const dup = duplicateProject("orig_project");
    expect(dup).not.toBeNull();
    expect(dup!.id).not.toBe("orig_project");
    expect(dup!.name).toBe("Q3 Retention Study (Copy)");
    expect(loadCsv(dup!.id)).toBe("a,b\n1,2");

    // Delete project
    deleteCsv("orig_project");
    expect(loadCsv("orig_project")).toBeNull();
    // Copy still exists!
    expect(loadCsv(dup!.id)).toBe("a,b\n1,2");

    // Corrupted storage returns [] gracefully
    localStorage.setItem("lumetra.projects.v1", "INVALID_JSON{{");
    expect(loadProjects()).toEqual([]);

    // Storing oversized CSV returns false and removes stale data
    expect(storeCsv("oversized", "x".repeat(MAX_STORED_CSV_BYTES + 100))).toBe(false);
    expect(loadCsv("oversized")).toBeNull();
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { parseCsvText, parseCsvFile, MAX_FILE_BYTES } from "@/lib/data/parse";
import { generateReportMarkdown } from "@/lib/data/export";
import { profileDataset, columnValues } from "@/lib/data/infer";
import {
  applyCleaningStep,
  replayCleaningSteps,
  auditDataset,
  removeDuplicateRows,
  handleMissingValues,
  filterRows,
  recodeCategorical,
  changeColumnType,
  countMissingCells,
} from "@/lib/data/clean";
import {
  runDescriptive,
  createDescriptiveSavedAnalysis,
  createCorrelationSavedAnalysis,
  createTTestSavedAnalysis,
  createCrosstabSavedAnalysis,
  createPersonaSavedAnalysis,
  isAnalysisStale,
  computeDatasetSignature,
} from "@/lib/stats/analysis";
import {
  interpretTailLatency,
  interpretElasticity,
  interpretGini,
  interpretNormality,
  interpretABTest,
  interpretOddsRatio,
} from "@/lib/stats/interpretation";
import { calculateTailLatency, calculateSloBreach } from "@/lib/stats/personas";
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
  it("2. imports a valid CSV with correct rows, columns, and types without silently coercing nulls", async () => {
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

    // Verify file parsing with File object and delimiter detection
    const file = new File([FIXTURE_CSV], "workforce.csv", { type: "text/csv" });
    const fileRes = await parseCsvFile(file);
    expect(fileRes.result.ok).toBe(true);
    if (fileRes.result.ok) {
      expect(fileRes.result.dataset.rows).toHaveLength(8);
      expect(fileRes.result.dataset.delimiter).toBe(",");
    }

    // Verify semicolon-delimited CSV with custom delimiter option
    const semiCsv = "a;b;c\n1;2;3\n4;5;6";
    const semiParsed = parseCsvText(semiCsv, "semi.csv", "upload", { delimiter: ";" });
    expect(semiParsed.ok).toBe(true);
    if (semiParsed.ok) {
      expect(semiParsed.dataset.columns).toEqual(["a", "b", "c"]);
      expect(semiParsed.dataset.rows).toHaveLength(2);
    }
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
    const { dataset: afterImpute, step: step2 } = applyCleaningStep(afterDedupe, "handle_missing", {
      column: "performance",
      strategy: "fill_median",
    });
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

    // Step 4: Change type of salary to numeric explicitly
    const { dataset: afterTypeChange, step: step4 } = applyCleaningStep(
      afterRecode,
      "change_type",
      { column: "salary", targetType: "numeric" },
    );
    expect(afterTypeChange.typeOverrides?.["salary"]).toBe("numeric");

    // Raw dataset is completely unmutated
    expect(raw.rows).toHaveLength(8);
    expect(raw.rows[4]![3]).toBeNull();
    expect(raw.rows[1]![1]).toBe("Marketing");

    // Replay steps from scratch
    const replayed = replayCleaningSteps(raw, [step1, step2, step3, step4]);
    expect(replayed.dataset.rows).toHaveLength(7);
    expect(replayed.steps).toHaveLength(4);
    expect(replayed.dataset.typeOverrides?.["salary"]).toBe("numeric");
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

    // Also create a persona saved analysis
    const salNums = columnValues(parsed.dataset, 2);
    const latStats = calculateTailLatency(salNums);
    const engInterp = interpretTailLatency("salary", latStats);
    const personaAnalysis = createPersonaSavedAnalysis(
      parsed.dataset,
      "engineer",
      "Tail Latency & SLO: salary",
      ["salary"],
      { column: "salary" },
      { n: latStats.n, p50: latStats.p50, p99: latStats.p99, tailRatio: latStats.tailRatio },
      engInterp,
      ["Quantile interpolation", "SLO availability"],
    );

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
      savedAnalyses: [analysis, personaAnalysis],
    };

    saveProjects([project]);
    storeCsv("p_with_analysis", FIXTURE_CSV);

    const reloaded = loadProjects().find((p) => p.id === "p_with_analysis");
    expect(reloaded).not.toBeNull();
    expect(reloaded!.savedAnalyses).toHaveLength(2);

    const restoredAnalysis = reloaded!.savedAnalyses![0]!;
    expect(restoredAnalysis.name).toContain("salary vs performance");
    expect(restoredAnalysis.results["r"]).toBeCloseTo(analysis.results["r"] as number, 5);
    expect(restoredAnalysis.interpretation.assumptions).toEqual(
      analysis.interpretation.assumptions,
    );

    const restoredPersona = reloaded!.savedAnalyses![1]!;
    expect(restoredPersona.type).toBe("persona_engineer");
    expect(restoredPersona.results["p50"]).toBe(latStats.p50);
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

    // Generate full markdown report with saved analyses and cleaning steps
    const corrAnalysis = createCorrelationSavedAnalysis(parsed.dataset, "salary", "performance");
    const tTestAnalysis = createTTestSavedAnalysis(parsed.dataset, "salary", "department");
    const md = generateReportMarkdown({
      projectName: "Q4 Workforce Compensation",
      objective: "Evaluate department salary disparities",
      datasetName: "workforce.csv",
      rawRowCount: 8,
      cleanRowCount: 8,
      columnCount: 5,
      columnsList: parsed.dataset.columns,
      cleaningSteps: [
        {
          description: "Removed duplicate rows",
          effect: { rowsBefore: 8, rowsAfter: 7 },
        },
      ],
      savedAnalyses: [corrAnalysis, tTestAnalysis],
      descriptiveReport: report,
    });

    expect(md).toContain("# Statistical Analysis Report: Q4 Workforce Compensation");
    expect(md).toContain("Evaluate department salary disparities");
    expect(md).toContain("Removed duplicate rows");
    expect(md).toContain("Correlation Coefficient (r)");
    expect(md).toContain("Welch's t-Statistic");
    expect(md).toContain("Group Comparison Table:");
    expect(md).toContain("Missing values are excluded pairwise and never coerced to zero.");
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

  // 11. Complete end-to-end user journey
  it("11. executes the entire user journey: create empty project -> import dataset -> clean data -> run and interpret analyses -> save to project history -> verify report generation -> reopen project and verify full reproducibility", () => {
    // 1. Create empty project with meaningful name and objective
    const project: ProjectMeta = {
      id: "journey_proj_1",
      name: "Q4 Customer Latency & Churn Study",
      description: "Analyze system latency bottlenecks and correlation with customer churn.",
      objective: "Analyze system latency bottlenecks and correlation with customer churn.",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "no-data",
      dataset: null,
      cleaningSteps: [],
      savedAnalyses: [],
    };
    expect(saveProjects([project])).toBe(true);

    // 2. Import a real CSV dataset into the project
    const rawCsv = `user_id,plan,latency_ms,tickets,churned
u1,enterprise,$120.50,1,0
u2,standard,$450.00,4,1
u3,enterprise,$95.20,0,0
u4,standard,$320.00,2,0
u5,starter,,5,1
u6,enterprise,$110.00,0,0
u1,enterprise,$120.50,1,0`; // Row 7 is an exact duplicate of Row 1

    const parsed = parseCsvText(rawCsv, "customers.csv", "upload");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    // Attach dataset to project and store CSV
    storeCsv(project.id, rawCsv);
    project.status = "data-loaded";
    project.dataset = {
      name: "customers.csv",
      rows: parsed.dataset.rows.length,
      columns: parsed.dataset.columns.length,
      source: "upload",
      stored: true,
    };
    saveProjects([project]);

    // 3. Inspect and audit data
    const audit = auditDataset(parsed.dataset);
    expect(audit.rowCount).toBe(7);
    expect(audit.columnCount).toBe(5);
    expect(audit.duplicateRowsCount).toBe(1);
    expect(audit.missingCells).toBe(1);

    // 4. Apply cleaning pipeline
    // Step 1: Remove duplicate rows
    const { dataset: clean1, step: s1 } = applyCleaningStep(
      parsed.dataset,
      "remove_duplicates",
      {},
    );
    expect(clean1.rows).toHaveLength(6);

    // Step 2: Change latency_ms type from currency text to numeric
    const { dataset: clean2, step: s2 } = applyCleaningStep(clean1, "change_type", {
      column: "latency_ms",
      targetType: "numeric",
    });
    expect(clean2.typeOverrides?.["latency_ms"]).toBe("numeric");
    expect(clean2.rows[0]![2]).toBe("120.50");

    // Step 3: Handle missing value in latency_ms via median imputation
    const { dataset: clean3, step: s3 } = applyCleaningStep(clean2, "handle_missing", {
      column: "latency_ms",
      strategy: "fill_median",
    });
    const missingUser = clean3.rows.find((r) => r[0] === "u5");
    expect(missingUser?.[2]).not.toBeNull();
    expect(countMissingCells(clean3)).toBe(0);

    // Persist cleaning steps to project
    project.cleaningSteps = [s1, s2, s3];
    saveProjects([project]);

    // 5. Select analyses, configure variables, and run calculations
    // Analysis A: Bivariate correlation between latency and support tickets
    const corrAnalysis = createCorrelationSavedAnalysis(clean3, "latency_ms", "tickets", "pearson");
    expect(corrAnalysis.interpretation.observedResults.length).toBeGreaterThan(0);
    expect(corrAnalysis.interpretation.statisticalInference.length).toBeGreaterThan(0);
    expect(
      corrAnalysis.interpretation.limitations.some((l) =>
        l.toLowerCase().includes("prove or imply causation"),
      ),
    ).toBe(true);

    // Analysis B: Persona Engineering Tail Latency & SLO
    const latencyValues = columnValues(clean3, clean3.columns.indexOf("latency_ms"));
    const latStats = calculateTailLatency(latencyValues);
    const sloStats = calculateSloBreach(latencyValues, 200, 99.0);
    const engInterp = interpretTailLatency("latency_ms", latStats, sloStats);
    const engAnalysis = createPersonaSavedAnalysis(
      clean3,
      "engineer",
      "Tail Latency & SLO: latency_ms",
      ["latency_ms"],
      { column: "latency_ms", sloThreshold: 200, sloTarget: 99.0 },
      { n: latStats.n, p50: latStats.p50, p99: latStats.p99, tailRatio: latStats.tailRatio },
      engInterp,
      ["Quantile interpolation", "SLO availability"],
    );

    // 6. Save analyses to project history
    project.status = "analysed";
    project.savedAnalyses = [corrAnalysis, engAnalysis];
    saveProjects([project]);

    // 7. Verify report generation reflects cleaned dataset and computed analyses
    const descReport = runDescriptive(clean3);
    expect(descReport.rowCount).toBe(6);
    expect(project.savedAnalyses).toHaveLength(2);

    // 8. Reopen existing project and restore complete state
    const loadedProjects = loadProjects();
    const reopened = loadedProjects.find((p) => p.id === "journey_proj_1");
    expect(reopened).toBeDefined();
    expect(reopened!.name).toBe("Q4 Customer Latency & Churn Study");
    expect(reopened!.status).toBe("analysed");
    expect(reopened!.cleaningSteps).toHaveLength(3);
    expect(reopened!.savedAnalyses).toHaveLength(2);

    // Replay raw data to reconstruct identical analytical dataset
    const storedCsv = loadCsv("journey_proj_1");
    expect(storedCsv).toBe(rawCsv);
    const parsedReopened = parseCsvText(storedCsv!, reopened!.dataset!.name, "upload");
    const replayed = replayCleaningSteps(parsedReopened.dataset!, reopened!.cleaningSteps!);
    expect(replayed.dataset.rows).toHaveLength(6);
    expect(replayed.dataset.typeOverrides?.["latency_ms"]).toBe("numeric");

    // Stale analysis check
    expect(isAnalysisStale(reopened!.savedAnalyses![0]!, replayed.dataset)).toBe(false);

    // If dataset changes (e.g. further filtering), analysis is marked stale
    const modifiedDataset = filterRows(replayed.dataset, "plan", "equals", "enterprise");
    expect(isAnalysisStale(reopened!.savedAnalyses![0]!, modifiedDataset)).toBe(true);

    // 9. Duplicate project safely without mutating original
    const duplicated = duplicateProject("journey_proj_1");
    expect(duplicated).not.toBeNull();
    expect(duplicated!.id).not.toBe("journey_proj_1");
    expect(duplicated!.name).toBe("Q4 Customer Latency & Churn Study (Copy)");
    expect(duplicated!.savedAnalyses).toHaveLength(2);
    expect(loadCsv(duplicated!.id)).toBe(rawCsv);

    // Delete original project
    deleteCsv("journey_proj_1");
    saveProjects(loadProjects().filter((p) => p.id !== "journey_proj_1"));
    expect(loadProjects().find((p) => p.id === "journey_proj_1")).toBeUndefined();
    expect(loadCsv("journey_proj_1")).toBeNull();

    // Duplicated project remains intact
    const remainingCopy = loadProjects().find((p) => p.id === duplicated!.id);
    expect(remainingCopy).toBeDefined();
    expect(loadCsv(duplicated!.id)).toBe(rawCsv);
  });
});

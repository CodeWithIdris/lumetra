import { columnValues, profileDataset, isNumeric } from "../data/infer";
import type { ColumnProfile, Dataset } from "../data/types";
import {
  describe,
  fmt,
  frequencies,
  histogram,
  toNumbers,
  type FrequencyRow,
  type HistogramBin,
  type NumericSummary,
} from "./descriptive";
import {
  correlation,
  welchTTest,
  crosstab,
  linearRegression,
  extractPairedPoints,
  type CorrelationResult,
  type WelchResult,
  type CrosstabResult,
  type RegressionResult,
  type PairedPoint,
} from "./advanced";
import {
  interpretDescriptive,
  interpretCorrelation,
  interpretTTest,
  interpretCrosstab,
  type AnalysisInterpretation,
} from "./interpretation";
import type { PersonaId } from "./personas";

export type AnalysisType =
  | "descriptive"
  | "correlation"
  | "ttest"
  | "crosstab"
  | "persona_engineer"
  | "persona_economist"
  | "persona_scientist"
  | "persona_product"
  | "persona_clinical";

export interface SavedAnalysis {
  id: string;
  name: string;
  type: AnalysisType;
  timestamp: string;
  datasetId: string;
  datasetName: string;
  datasetSignature: string; // Used to detect if the dataset changed since run
  variables: string[];
  configuration: Record<string, unknown>;
  sampleSize: number;
  missingCount: number;
  missingHandling: string;
  results: Record<string, unknown>;
  interpretation: AnalysisInterpretation;
  methodNotes: string[];
}

export function computeDatasetSignature(ds: Dataset): string {
  const headTail =
    ds.rows.length > 0
      ? `${ds.rows[0]?.slice(0, 3).join(",")}:${ds.rows[ds.rows.length - 1]?.slice(0, 3).join(",")}`
      : "empty";
  return `${ds.name || "dataset"}:${ds.columns.join("|")}:${ds.rows.length}:${headTail}`;
}

export function isAnalysisStale(analysis: SavedAnalysis, currentDataset: Dataset): boolean {
  return analysis.datasetSignature !== computeDatasetSignature(currentDataset);
}

export interface NumericResult {
  column: string;
  summary: NumericSummary;
  bins: HistogramBin[];
}

export interface CategoricalResult {
  column: string;
  n: number;
  missing: number;
  rows: FrequencyRow[];
}

export interface DescriptiveReport {
  datasetName: string;
  rowCount: number;
  columnCount: number;
  profiles: ColumnProfile[];
  numeric: NumericResult[];
  categorical: CategoricalResult[];
  summary: string[];
}

export function runDescriptive(ds: Dataset, selected?: string[]): DescriptiveReport {
  const profiles = profileDataset(ds);
  const use = (p: ColumnProfile) => !selected || selected.includes(p.name);
  const numeric = profiles
    .filter((p) => p.type === "numeric" && use(p))
    .map((p) => {
      const { nums, missing, invalid } = toNumbers(columnValues(ds, p.index));
      return { column: p.name, summary: describe(nums, missing, invalid), bins: histogram(nums) };
    });
  const categorical = profiles
    .filter((p) => p.type === "categorical" && use(p))
    .map((p) => {
      const f = frequencies(columnValues(ds, p.index));
      return { column: p.name, n: f.n, missing: f.missing, rows: f.rows };
    });
  const report: DescriptiveReport = {
    datasetName: ds.name,
    rowCount: ds.rows.length,
    columnCount: ds.columns.length,
    profiles,
    numeric,
    categorical,
    summary: [],
  };
  report.summary = summarise(report);
  return report;
}

/** Deterministic, template-based narrative generated only from computed values. */
export function summarise(r: DescriptiveReport): string[] {
  const out: string[] = [];
  out.push(
    `The dataset "${r.datasetName}" contains ${r.rowCount.toLocaleString()} rows and ${r.columnCount} columns.`,
  );
  const withMissing = r.profiles
    .filter((p) => p.missing > 0)
    .sort((a, b) => b.missingPct - a.missingPct);
  if (withMissing.length === 0) out.push("No missing values were detected.");
  else {
    const top = withMissing[0]!;
    out.push(
      `${withMissing.length} column(s) contain missing values; the most affected is "${top.name}" with ${top.missing} missing (${fmt(top.missingPct, 1)}%). Missing values were excluded from calculations, not replaced.`,
    );
  }
  for (const n of r.numeric) {
    const s = n.summary;
    if (s.n === 0) continue;
    let line = `"${n.column}" (n = ${s.n}) has a mean of ${fmt(s.mean)} and a median of ${fmt(s.median)}, ranging from ${fmt(s.min)} to ${fmt(s.max)}`;
    if (s.invalid > 0) line += `; ${s.invalid} invalid numeric value(s) were excluded`;
    line +=
      s.sd === null
        ? "; standard deviation is undefined for a single value."
        : ` (SD ${fmt(s.sd)}).`;
    if (s.mean !== null && s.median !== null && s.sd && s.sd > 0) {
      const gap = (s.mean - s.median) / s.sd;
      if (gap > 0.2)
        line += " The mean exceeds the median, suggesting a right-skewed distribution.";
      else if (gap < -0.2)
        line += " The mean is below the median, suggesting a left-skewed distribution.";
    }
    out.push(line);
  }
  for (const c of r.categorical) {
    if (c.rows.length === 0) continue;
    const top = c.rows[0]!;
    const tied = c.rows.filter((x) => x.count === top.count).length;
    out.push(
      tied > 1
        ? `"${c.column}" has ${c.rows.length} categories; ${tied} are tied as most frequent with ${top.count} entries each.`
        : `"${c.column}" has ${c.rows.length} categories; the most frequent is "${top.value}" (${top.count}, ${fmt(top.pct, 1)}% of non-missing).`,
    );
  }
  return out;
}

export function createDescriptiveSavedAnalysis(
  ds: Dataset,
  selectedColumns?: string[],
): SavedAnalysis {
  const report = runDescriptive(ds, selectedColumns);
  const vars = selectedColumns ?? ds.columns;

  let totalN = 0;
  let totalMissing = 0;
  for (const num of report.numeric) {
    totalN += num.summary.n;
    totalMissing += num.summary.missing;
  }
  for (const cat of report.categorical) {
    totalN += cat.n;
    totalMissing += cat.missing;
  }

  // Primary column interpretation
  const firstNum = report.numeric[0];
  const interpretation = firstNum
    ? interpretDescriptive({
        column: firstNum.column,
        n: firstNum.summary.n,
        mean: firstNum.summary.mean,
        median: firstNum.summary.median,
        min: firstNum.summary.min,
        max: firstNum.summary.max,
        sd: firstNum.summary.sd,
        missing: firstNum.summary.missing,
        invalid: firstNum.summary.invalid,
      })
    : {
        observedResults: report.summary,
        statisticalInference: ["Descriptive distribution metrics computed."],
        assumptions: ["Sample data observed without coercion."],
        limitations: ["No hypothesis testing or causal inference."],
        recommendations: ["Select numeric columns for parametric tests."],
      };

  return {
    id: "analysis_" + Math.random().toString(36).slice(2, 9) + Date.now().toString(36),
    name: `Descriptive Statistics (${vars.length} variables)`,
    type: "descriptive",
    timestamp: new Date().toISOString(),
    datasetId: ds.id,
    datasetName: ds.name,
    datasetSignature: computeDatasetSignature(ds),
    variables: vars,
    configuration: { selectedColumns: vars },
    sampleSize: ds.rows.length,
    missingCount: totalMissing,
    missingHandling: "Excluded from denominator and moments; never coerced to zero.",
    results: { report },
    interpretation,
    methodNotes: [
      "Standard deviation uses Bessel's sample correction (divisor n − 1) via Welford's algorithm.",
      "Median uses exact sorting (middle value for odd n, midpoint of two centres for even n).",
    ],
  };
}

export interface BivariateAnalysisData {
  colX: string;
  colY: string;
  points: PairedPoint[];
  n: number;
  missingCount: number;
  method: "pearson" | "spearman";
  r: number | null;
  pValue: number | null;
  note?: string;
  regression: RegressionResult;
  trendLine: Array<{ x: number; y: number }> | null;
  minX: number | null;
  maxX: number | null;
  minY: number | null;
  maxY: number | null;
}

/** Extract deterministic paired observations and compute correlation + OLS regression */
export function extractBivariateData(
  ds: Dataset,
  colX: string,
  colY: string,
  method: "pearson" | "spearman" = "pearson",
): BivariateAnalysisData {
  const idxX = ds.columns.indexOf(colX);
  const idxY = ds.columns.indexOf(colY);
  if (idxX === -1 || idxY === -1) {
    throw new Error(`Columns "${colX}" and "${colY}" must exist in dataset.`);
  }

  const rawX = columnValues(ds, idxX);
  const rawY = columnValues(ds, idxY);

  const numX = rawX.map((v) => (v !== null && isNumeric(v) ? Number(v) : null));
  const numY = rawY.map((v) => (v !== null && isNumeric(v) ? Number(v) : null));

  const points = extractPairedPoints(numX, numY);
  const pairedX = points.map((p) => p.x);
  const pairedY = points.map((p) => p.y);

  const corr = correlation(pairedX, pairedY, method);
  const regression = linearRegression(pairedX, pairedY);

  let missingCount = 0;
  for (let i = 0; i < ds.rows.length; i++) {
    if (numX[i] === null || numY[i] === null) missingCount++;
  }

  let minX: number | null = null;
  let maxX: number | null = null;
  let minY: number | null = null;
  let maxY: number | null = null;

  if (points.length > 0) {
    minX = Math.min(...pairedX);
    maxX = Math.max(...pairedX);
    minY = Math.min(...pairedY);
    maxY = Math.max(...pairedY);
  }

  let trendLine: Array<{ x: number; y: number }> | null = null;
  if (
    regression.slope !== null &&
    regression.intercept !== null &&
    minX !== null &&
    maxX !== null &&
    minX !== maxX
  ) {
    trendLine = [
      { x: minX, y: regression.intercept + regression.slope * minX },
      { x: maxX, y: regression.intercept + regression.slope * maxX },
    ];
  }

  return {
    colX,
    colY,
    points,
    n: corr.n,
    missingCount,
    method,
    r: corr.r,
    pValue: corr.pValue,
    note: corr.note,
    regression,
    trendLine,
    minX,
    maxX,
    minY,
    maxY,
  };
}

export interface ReconstructedBivariateChartData {
  status: "verified" | "discrepancy" | "stale" | "missing_columns" | "missing_dataset";
  message?: string;
  data: BivariateAnalysisData | null;
}

/** Extract stored paired observations and summary metrics from a saved correlation analysis */
export function getSavedBivariateData(analysis: SavedAnalysis): BivariateAnalysisData | null {
  const points = analysis.results["points"] as PairedPoint[] | undefined;
  if (!points || !Array.isArray(points)) return null;

  const colX = (analysis.configuration["colX"] as string) || analysis.variables[0] || "X";
  const colY = (analysis.configuration["colY"] as string) || analysis.variables[1] || "Y";
  const method = (analysis.configuration["method"] as "pearson" | "spearman") || "pearson";
  const regression = (analysis.results["regression"] as RegressionResult) || {
    n: analysis.sampleSize,
    slope: null,
    intercept: null,
    rSquared: null,
    slopeSE: null,
    slopeP: null,
  };

  return {
    colX,
    colY,
    points,
    n: Number(analysis.results["n"] ?? analysis.sampleSize),
    missingCount: analysis.missingCount,
    method,
    r: typeof analysis.results["r"] === "number" ? (analysis.results["r"] as number) : null,
    pValue:
      typeof analysis.results["pValue"] === "number" ? (analysis.results["pValue"] as number) : null,
    note: typeof analysis.results["note"] === "string" ? (analysis.results["note"] as string) : undefined,
    regression,
    trendLine: (analysis.results["trendLine"] as Array<{ x: number; y: number }>) ?? null,
    minX: typeof analysis.results["minX"] === "number" ? (analysis.results["minX"] as number) : null,
    maxX: typeof analysis.results["maxX"] === "number" ? (analysis.results["maxX"] as number) : null,
    minY: typeof analysis.results["minY"] === "number" ? (analysis.results["minY"] as number) : null,
    maxY: typeof analysis.results["maxY"] === "number" ? (analysis.results["maxY"] as number) : null,
  };
}

/**
 * Reconstructs paired points for a saved correlation analysis and verifies
 * that recalculated results faithfully match the saved analytical record.
 * Never silently substitutes results from an altered or mismatched dataset version.
 */
export function reconstructCorrelationChartData(
  analysis: SavedAnalysis,
  currentDataset: Dataset | null,
): ReconstructedBivariateChartData {
  const savedData = getSavedBivariateData(analysis);

  if (!currentDataset) {
    if (savedData) {
      return {
        status: "verified",
        message: "No active dataset in memory. Displaying observations from saved record.",
        data: savedData,
      };
    }
    return {
      status: "missing_dataset",
      message: "No active dataset loaded in memory.",
      data: null,
    };
  }

  const colX = (analysis.configuration["colX"] as string) || analysis.variables[0];
  const colY = (analysis.configuration["colY"] as string) || analysis.variables[1];
  const method = (analysis.configuration["method"] as "pearson" | "spearman") || "pearson";

  if (!colX || !colY) {
    return {
      status: "missing_columns",
      message: "Analysis configuration missing variable definitions.",
      data: savedData,
    };
  }

  const isDifferentDataset = Boolean(analysis.datasetId && currentDataset.id !== analysis.datasetId);

  if (!currentDataset.columns.includes(colX) || !currentDataset.columns.includes(colY)) {
    if (savedData) {
      return {
        status: "stale",
        message: `Variables "${colX}" and "${colY}" are not both present in active dataset. Displaying saved observations.`,
        data: savedData,
      };
    }
    return {
      status: "missing_columns",
      message: `Variables "${colX}" and "${colY}" are not both present in current dataset schema.`,
      data: null,
    };
  }

  let recalculated: BivariateAnalysisData;
  try {
    recalculated = extractBivariateData(currentDataset, colX, colY, method);
  } catch (err) {
    return {
      status: "missing_columns",
      message: err instanceof Error ? err.message : "Failed to extract variables from dataset.",
      data: savedData,
    };
  }

  const isStale = isAnalysisStale(analysis, currentDataset) || isDifferentDataset;
  const savedR =
    typeof analysis.results["r"] === "number" ? (analysis.results["r"] as number) : null;
  const recalculatedR = recalculated.r;

  const nMatches = recalculated.n === analysis.sampleSize;
  const rMatches =
    (savedR === null && recalculatedR === null) ||
    (savedR !== null && recalculatedR !== null && Math.abs(savedR - recalculatedR) < 1e-5);

  if (nMatches && rMatches && !isStale) {
    return {
      status: "verified",
      data: savedData ?? recalculated,
    };
  }

  if (!nMatches || !rMatches) {
    return {
      status: "discrepancy",
      message: `Recalculated values (r = ${recalculatedR !== null ? recalculatedR.toFixed(3) : "—"}, n = ${recalculated.n}) diverge from saved record (r = ${savedR !== null ? savedR.toFixed(3) : "—"}, n = ${analysis.sampleSize}). Dataset has been modified.`,
      data: savedData ?? recalculated,
    };
  }

  return {
    status: "stale",
    message: isDifferentDataset
      ? `Active dataset ("${currentDataset.name}") differs from the dataset used for this saved analysis ("${analysis.datasetName}").`
      : "Current dataset rows or values have changed since this analysis was saved.",
    data: savedData ?? recalculated,
  };
}

export function createCorrelationSavedAnalysis(
  ds: Dataset,
  colX: string,
  colY: string,
  method: "pearson" | "spearman" = "pearson",
): SavedAnalysis {
  const data = extractBivariateData(ds, colX, colY, method);
  const result: CorrelationResult = {
    method: data.method,
    n: data.n,
    r: data.r,
    pValue: data.pValue,
    note: data.note,
  };
  const interpretation = interpretCorrelation(colX, colY, result);

  return {
    id: "analysis_" + Math.random().toString(36).slice(2, 9) + Date.now().toString(36),
    name: `${method === "spearman" ? "Spearman" : "Pearson"} Correlation: ${colX} vs ${colY}`,
    type: "correlation",
    timestamp: new Date().toISOString(),
    datasetId: ds.id,
    datasetName: ds.name,
    datasetSignature: computeDatasetSignature(ds),
    variables: [colX, colY],
    configuration: { colX, colY, method },
    sampleSize: data.n,
    missingCount: data.missingCount,
    missingHandling: "Pairwise complete deletion: pairs with any missing coordinate excluded.",
    results: {
      r: data.r,
      pValue: data.pValue,
      n: data.n,
      method: data.method,
      note: data.note,
      regression: {
        slope: data.regression.slope,
        intercept: data.regression.intercept,
        rSquared: data.regression.rSquared,
        slopeSE: data.regression.slopeSE,
        slopeP: data.regression.slopeP,
      },
      points: data.points,
      trendLine: data.trendLine,
      minX: data.minX,
      maxX: data.maxX,
      minY: data.minY,
      maxY: data.maxY,
    },
    interpretation,
    methodNotes: [
      method === "pearson"
        ? "Pearson product-moment correlation coefficient r, p-value via Student's t approximation."
        : "Spearman rank correlation coefficient, average ranks used for ties, t approximation for p-value.",
      "Linear regression (OLS) fitted trendline provides reference slope and intercept; does not imply causality.",
    ],
  };
}

export function createTTestSavedAnalysis(
  ds: Dataset,
  numCol: string,
  groupCol: string,
): SavedAnalysis {
  const idxNum = ds.columns.indexOf(numCol);
  const idxGrp = ds.columns.indexOf(groupCol);
  if (idxNum === -1 || idxGrp === -1) {
    throw new Error(`Columns "${numCol}" and "${groupCol}" must exist in dataset.`);
  }

  const numVals = columnValues(ds, idxNum);
  const grpVals = columnValues(ds, idxGrp);

  const groups = new Map<string, number[]>();
  let missingCount = 0;

  for (let i = 0; i < ds.rows.length; i++) {
    const y = numVals[i];
    const g = grpVals[i];
    if (y == null || g == null || !isNumeric(y)) {
      missingCount++;
      continue;
    }
    const arr = groups.get(g) ?? [];
    arr.push(Number(y));
    groups.set(g, arr);
  }

  const distinctGroups = [...groups.keys()];
  if (distinctGroups.length < 2) {
    throw new Error(
      `Grouping column "${groupCol}" needs at least 2 distinct groups (found ${distinctGroups.length}).`,
    );
  }

  const g1Name = distinctGroups[0]!;
  const g2Name = distinctGroups[1]!;
  const vals1 = groups.get(g1Name) ?? [];
  const vals2 = groups.get(g2Name) ?? [];

  const result = welchTTest(vals1, vals2, [g1Name, g2Name]);
  const interpretation = interpretTTest(numCol, groupCol, result);

  return {
    id: "analysis_" + Math.random().toString(36).slice(2, 9) + Date.now().toString(36),
    name: `Two-Sample Welch's t-Test: ${numCol} by ${groupCol}`,
    type: "ttest",
    timestamp: new Date().toISOString(),
    datasetId: ds.id,
    datasetName: ds.name,
    datasetSignature: computeDatasetSignature(ds),
    variables: [numCol, groupCol],
    configuration: { numCol, groupCol, group1: g1Name, group2: g2Name },
    sampleSize: vals1.length + vals2.length,
    missingCount,
    missingHandling: "Pairwise complete deletion: excluded if numeric or group value is missing.",
    results: {
      groups: result.groups,
      difference: result.difference,
      t: result.t,
      df: result.df,
      pValue: result.pValue,
      note: result.note,
    },
    interpretation,
    methodNotes: [
      "Welch's two-sample t-test with unequal variances (Welch–Satterthwaite degrees of freedom).",
      "Two-sided p-value derived via regularised incomplete beta function.",
    ],
  };
}

export function createCrosstabSavedAnalysis(
  ds: Dataset,
  rowCol: string,
  colCol: string,
): SavedAnalysis {
  const idxR = ds.columns.indexOf(rowCol);
  const idxC = ds.columns.indexOf(colCol);
  if (idxR === -1 || idxC === -1) {
    throw new Error(`Columns "${rowCol}" and "${colCol}" must exist in dataset.`);
  }

  const rows = columnValues(ds, idxR);
  const cols = columnValues(ds, idxC);

  let missingCount = 0;
  for (let i = 0; i < ds.rows.length; i++) {
    if (rows[i] === null || cols[i] === null) missingCount++;
  }

  const result = crosstab(rows, cols);
  const interpretation = interpretCrosstab(rowCol, colCol, result);

  return {
    id: "analysis_" + Math.random().toString(36).slice(2, 9) + Date.now().toString(36),
    name: `Cross-Tabulation & Chi-Square: ${rowCol} × ${colCol}`,
    type: "crosstab",
    timestamp: new Date().toISOString(),
    datasetId: ds.id,
    datasetName: ds.name,
    datasetSignature: computeDatasetSignature(ds),
    variables: [rowCol, colCol],
    configuration: { rowCol, colCol },
    sampleSize: result.n,
    missingCount,
    missingHandling: "Pairwise complete deletion: records missing either category excluded.",
    results: {
      rows: result.rows,
      cols: result.cols,
      counts: result.counts,
      chiSquare: result.chiSquare,
      df: result.df,
      pValue: result.pValue,
      cramersV: result.cramersV,
      note: result.note,
    },
    interpretation,
    methodNotes: [
      "Pearson chi-square test of independence for two-way categorical contingency matrix.",
      "Cramer's V association magnitude for tables with dimension > 2.",
    ],
  };
}

export function createPersonaSavedAnalysis(
  ds: Dataset,
  persona: PersonaId,
  name: string,
  variables: string[],
  configuration: Record<string, unknown>,
  results: Record<string, unknown>,
  interpretation: AnalysisInterpretation,
  methodNotes: string[],
): SavedAnalysis {
  const sampleSize = typeof results["n"] === "number" ? (results["n"] as number) : ds.rows.length;
  const missingCount = typeof results["missing"] === "number" ? (results["missing"] as number) : 0;

  return {
    id: "analysis_" + Math.random().toString(36).slice(2, 9) + Date.now().toString(36),
    name,
    type: `persona_${persona}` as AnalysisType,
    timestamp: new Date().toISOString(),
    datasetId: ds.id,
    datasetName: ds.name,
    datasetSignature: computeDatasetSignature(ds),
    variables,
    configuration,
    sampleSize,
    missingCount,
    missingHandling: "Missing values excluded from calculations, never coerced to zero.",
    results,
    interpretation,
    methodNotes,
  };
}

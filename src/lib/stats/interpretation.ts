import { fmt } from "./descriptive";
import type { CorrelationResult, WelchResult, CrosstabResult } from "./advanced";
import type {
  TailLatencyResult,
  SloBreachResult,
  ElasticityResult,
  GiniResult,
  NormalityDiagnosticsResult,
  ABTestResult,
  OddsRatioResult,
} from "./personas";

export interface AnalysisInterpretation {
  observedResults: string[];
  statisticalInference: string[];
  assumptions: string[];
  limitations: string[];
  recommendations: string[];
}

export function interpretDescriptive(summary: {
  column: string;
  n: number;
  mean: number | null;
  median: number | null;
  min: number | null;
  max: number | null;
  sd: number | null;
  missing: number;
  invalid: number;
}): AnalysisInterpretation {
  const { column, n, mean, median, min, max, sd, missing, invalid } = summary;

  const observed: string[] = [
    `Sample size: ${n.toLocaleString()} valid numeric observations in "${column}".`,
    `Range: observed values span from ${fmt(min)} to ${fmt(max)}.`,
    `Central tendency: sample mean is ${fmt(mean)}, median is ${fmt(median)}.`,
    `Dispersion: sample standard deviation (Bessel's correction n-1) is ${fmt(sd)}.`,
  ];

  const inference: string[] = [
    "Descriptive statistics summarize this observed sample directly; no hypothesis test was performed.",
  ];

  if (mean !== null && median !== null && sd && sd > 0) {
    const skewRatio = (mean - median) / sd;
    if (skewRatio > 0.2) {
      inference.push(
        `The mean (${fmt(mean)}) substantially exceeds the median (${fmt(median)}), indicating rightward (positive) skew.`,
      );
    } else if (skewRatio < -0.2) {
      inference.push(
        `The mean (${fmt(mean)}) is notably below the median (${fmt(median)}), indicating leftward (negative) skew.`,
      );
    } else {
      inference.push("Mean and median are closely aligned, consistent with symmetric central distribution.");
    }
  }

  const assumptions: string[] = [
    "Continuous numeric measurement scale.",
    "Equal weighting across all observed data rows.",
  ];

  const limitations: string[] = [
    "Descriptive metrics do not generalize to unobserved populations without probability sampling.",
    missing > 0
      ? `${missing} missing value(s) (${fmt((missing / (n + missing)) * 100, 1)}%) were excluded, which may introduce selection bias if missingness is non-random.`
      : "No missing values were detected in this column.",
    invalid > 0 ? `${invalid} non-numeric cell(s) were excluded as invalid.` : "",
  ].filter(Boolean);

  const recommendations: string[] = [
    "Inspect the histogram for multimodality or extreme outliers before assuming normality.",
    "If comparing across sub-groups, proceed to two-sample hypothesis testing or ANOVA.",
  ];

  return {
    observedResults: observed,
    statisticalInference: inference,
    assumptions,
    limitations,
    recommendations,
  };
}

export function interpretCorrelation(
  colX: string,
  colY: string,
  res: CorrelationResult,
): AnalysisInterpretation {
  const r = res.r;
  const p = res.pValue;
  const n = res.n;
  const method = res.method === "spearman" ? "Spearman rank" : "Pearson linear";

  const observed: string[] = [
    `Analyzed ${n} complete paired observations between "${colX}" and "${colY}".`,
    r !== null
      ? `Calculated ${method} correlation coefficient r = ${r.toFixed(3)}.`
      : "Correlation coefficient is undefined (insufficient variation or constant data).",
  ];

  const inference: string[] = [];
  if (r !== null && p !== null) {
    const absR = Math.abs(r);
    const dir = r > 0 ? "positive" : r < 0 ? "negative" : "zero";
    const strength = absR >= 0.7 ? "strong" : absR >= 0.4 ? "moderate" : absR >= 0.1 ? "weak" : "negligible";
    const sig = p < 0.05 ? "statistically significant (p < 0.05)" : "not statistically significant (p ≥ 0.05)";

    inference.push(
      `Observed a ${strength} ${dir} association (r = ${r.toFixed(3)}, p = ${p < 0.001 ? "< 0.001" : p.toFixed(4)}).`,
    );
    inference.push(
      p < 0.05
        ? `The association is ${sig} under the null hypothesis of zero correlation.`
        : `There is insufficient statistical evidence to reject the null hypothesis of no correlation (p = ${p.toFixed(4)}).`,
    );
  } else {
    inference.push("Statistical inference could not be evaluated.");
  }

  const assumptions: string[] = [
    res.method === "pearson"
      ? "Pearson r assumes linear relationship, continuous scale, and bivariate approximate normality."
      : "Spearman r assumes monotonic relationship between ranked ordinal or continuous variables.",
    "Pairs are assumed to be independently sampled.",
  ];

  const limitations: string[] = [
    "CRITICAL: Correlation measures statistical association only. It DOES NOT prove or imply causation.",
    "Unmeasured confounding variables or reverse causality may account for the observed association.",
    n < 30 ? `Small sample size (n = ${n}) increases standard errors and vulnerability to influential outliers.` : "",
  ].filter(Boolean);

  const recommendations: string[] = [
    "Inspect a bivariate scatter plot to confirm monotonicity and rule out nonlinear curvature.",
    "Perform controlled regression or experimental intervention to test directional causality.",
  ];

  return {
    observedResults: observed,
    statisticalInference: inference,
    assumptions,
    limitations,
    recommendations,
  };
}

export function interpretTTest(
  varName: string,
  groupCol: string,
  res: WelchResult,
): AnalysisInterpretation {
  const [g1, g2] = res.groups;
  const p = res.pValue;
  const t = res.t;
  const df = res.df;
  const diff = res.difference;

  const observed: string[] = [
    `Group "${g1?.name ?? "Group 1"}": n = ${g1?.n ?? 0}, mean = ${fmt(g1?.mean ?? null)}, SD = ${fmt(g1?.sd ?? null)}.`,
    `Group "${g2?.name ?? "Group 2"}": n = ${g2?.n ?? 0}, mean = ${fmt(g2?.mean ?? null)}, SD = ${fmt(g2?.sd ?? null)}.`,
    `Observed mean difference: ${diff !== null ? fmt(diff) : "—"} (${g1?.name ?? "Group 1"} minus ${g2?.name ?? "Group 2"}).`,
  ];

  const inference: string[] = [];
  if (p !== null && t !== null && df !== null && diff !== null) {
    const isSig = p < 0.05;
    inference.push(
      `Welch's two-sample t-test: t(${df.toFixed(1)}) = ${t.toFixed(3)}, p = ${p < 0.001 ? "< 0.001" : p.toFixed(4)}.`,
    );
    inference.push(
      isSig
        ? `Statistically significant difference in group means at the α = 0.05 level.`
        : `No statistically significant difference between group means at the α = 0.05 level (p = ${p.toFixed(4)}). This does not prove equality.`,
    );
  } else {
    inference.push(res.note ?? "Unable to compute two-sample test (insufficient observations or zero variance).");
  }

  const assumptions: string[] = [
    "Independent observations between and within groups.",
    "Welch's formulation does NOT assume equal population variances.",
    "Continuous outcome variable with approximately normal sampling distribution of group means.",
  ];

  const limitations: string[] = [
    "In observational data, mean differences may reflect baseline confounding rather than group effects.",
    "Statistical significance does not necessarily imply practical or economic significance.",
    (g1?.n ?? 0) < 15 || (g2?.n ?? 0) < 15 ? "Small group size may reduce statistical power." : "",
  ].filter(Boolean);

  const recommendations: string[] = [
    "Report effect size (Cohen's d) alongside p-values to communicate practical magnitude.",
    "Check for subgroup covariate balance if this is non-randomized observational data.",
  ];

  return {
    observedResults: observed,
    statisticalInference: inference,
    assumptions,
    limitations,
    recommendations,
  };
}

export function interpretCrosstab(
  rowVar: string,
  colVar: string,
  res: CrosstabResult,
): AnalysisInterpretation {
  const { n, chiSquare, df, pValue, cramersV, note } = res;

  const observed: string[] = [
    `Cross-tabulated ${n.toLocaleString()} complete pairs across ${res.rows.length} rows ("${rowVar}") and ${res.cols.length} columns ("${colVar}").`,
    `Contingency matrix size: ${res.rows.length} × ${res.cols.length} (${df} degrees of freedom).`,
  ];

  const inference: string[] = [];
  if (chiSquare !== null && pValue !== null) {
    const isSig = pValue < 0.05;
    const v = cramersV ?? 0;
    const strength = v >= 0.5 ? "strong" : v >= 0.3 ? "moderate" : v >= 0.1 ? "weak" : "negligible";

    inference.push(
      `Pearson chi-square test: χ²(${df}) = ${chiSquare.toFixed(2)}, p = ${pValue < 0.001 ? "< 0.001" : pValue.toFixed(4)}.`,
    );
    inference.push(
      `Cramer's V = ${v.toFixed(3)}, indicating a ${strength} categorical association.`,
    );
    inference.push(
      isSig
        ? `Statistically significant dependency: categorical distributions differ significantly between levels.`
        : `No statistically significant association detected between "${rowVar}" and "${colVar}" (p = ${pValue.toFixed(4)}).`,
    );
  } else {
    inference.push(note ?? "Chi-square independence test undefined.");
  }

  const assumptions: string[] = [
    "Independent observations.",
    "Mutually exclusive and exhaustive categories.",
    "Adequate expected frequencies (typically ≥ 5 per cell).",
  ];

  const limitations: string[] = [
    "Chi-square tests categorical association only; it indicates presence of dependency, not directional causality.",
    note ? `Warning: ${note}` : "",
  ].filter(Boolean);

  const recommendations: string[] = [
    "Examine standardized residuals to pinpoint which specific cells deviate most from independence.",
    "If cell counts are very small, consider collapsing categories or using exact tests.",
  ];

  return {
    observedResults: observed,
    statisticalInference: inference,
    assumptions,
    limitations,
    recommendations,
  };
}

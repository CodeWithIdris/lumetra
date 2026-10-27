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

// -------------------------------------------------------------
// PERSONA INTERPRETATION FUNCTIONS (Requirement 6)
// -------------------------------------------------------------

export function interpretTailLatency(
  metricName: string,
  res: TailLatencyResult,
  sloRes?: SloBreachResult,
): AnalysisInterpretation {
  const observed: string[] = [
    `Sample size: ${res.n.toLocaleString()} telemetry observations for "${metricName}".`,
    `Percentiles: P50 (median) = ${fmt(res.p50)} ms, P90 = ${fmt(res.p90)} ms, P95 = ${fmt(res.p95)} ms, P99 = ${fmt(res.p99)} ms, P99.9 = ${fmt(res.p999)} ms.`,
    `Tail Ratio (P99/P50): ${res.tailRatio !== null ? `${res.tailRatio.toFixed(2)}×` : "—"}, Average Jitter: ${res.jitter !== null ? `${fmt(res.jitter)} ms` : "—"}.`,
  ];
  if (sloRes && sloRes.status !== "unavailable") {
    observed.push(
      `SLO Compliance: ${sloRes.compliantCount.toLocaleString()} / ${sloRes.n.toLocaleString()} requests (${fmt(sloRes.actualAvailabilityPercent, 2)}% vs ${sloRes.targetPercent}% target, ${sloRes.breachCount} breach(es) > ${sloRes.threshold}ms).`,
    );
  }

  const inference: string[] = [res.assessment];
  if (sloRes && sloRes.status !== "unavailable") {
    inference.push(sloRes.summary);
  }

  const assumptions: string[] = [
    "Continuous non-negative time/latency measurements.",
    "Readings represent steady-state or sampled telemetry under operational workloads.",
  ];

  const limitations: string[] = [
    "Sample percentiles describe the observed window; upstream dependencies or queue spikes outside this sample may alter tail distribution.",
    res.missing > 0 ? `${res.missing} missing values were excluded from percentile calculations.` : "",
  ].filter(Boolean);

  const recommendations: string[] = [
    res.tailRatio !== null && res.tailRatio > 3
      ? "Investigate thread pool saturation, garbage collection pauses, or unindexed database queries contributing to high P99 tail divergence."
      : "Maintain continuous percentile alerting rather than relying solely on mean latency.",
    "Track error budget consumption rate across rolling operational intervals.",
  ];

  return { observedResults: observed, statisticalInference: inference, assumptions, limitations, recommendations };
}

export function interpretElasticity(
  priceCol: string,
  demandCol: string,
  res: ElasticityResult,
): AnalysisInterpretation {
  const observed: string[] = [
    `Analyzed ${res.n.toLocaleString()} complete price-quantity pairs between "${priceCol}" and "${demandCol}".`,
    `Mean Price: ${fmt(res.meanPrice)}, Mean Quantity: ${fmt(res.meanQuantity)}, OLS Slope: ${fmt(res.slope)}.`,
    `Point Elasticity of Demand (Ep): ${res.pointElasticity !== null ? res.pointElasticity.toFixed(3) : "Undefined"}.`,
  ];

  const inference: string[] = [
    `Classification: ${res.classification}.`,
    res.interpretation,
    res.rSquared !== null ? `Coefficient of determination: R² = ${fmt(res.rSquared, 3)}.` : "",
  ].filter(Boolean);

  const assumptions: string[] = [
    "Strictly positive prices and volume demands.",
    "Linear approximation of demand curve around the observed sample mean.",
    "Ceteris paribus (all other exogenous market determinants remain constant).",
  ];

  const limitations: string[] = [
    "Observational data reflect market equilibrium points, confounding simultaneous supply and demand shifts.",
    "Point elasticity varies along the linear demand curve; it applies strictly near the observed mean price.",
  ];

  const recommendations: string[] = [
    res.classification === "Elastic"
      ? "Price decreases may expand total sales revenue due to high volume responsiveness."
      : res.classification === "Inelastic"
        ? "Firm exhibits pricing power; incremental price increases may enhance margins without proportional demand drop."
        : "Conduct randomized pricing experiments or structural modeling to confirm causal elasticity.",
  ];

  return { observedResults: observed, statisticalInference: inference, assumptions, limitations, recommendations };
}

export function interpretGini(valCol: string, res: GiniResult): AnalysisInterpretation {
  const observed: string[] = [
    `Evaluated distribution across ${res.n.toLocaleString()} observations for "${valCol}".`,
    `Calculated Gini Coefficient: ${res.gini !== null ? res.gini.toFixed(3) : "Undefined"} (0 = perfect equality, 1 = maximum inequality).`,
    `Top 10% share: ${fmt(res.top10SharePct, 1)}%, Palma Ratio (Top 10% / Bottom 40%): ${fmt(res.palmaRatio, 2)}.`,
  ];

  const inference: string[] = [
    `Concentration Assessment: ${res.rating}.`,
    res.quintiles.length === 5
      ? `Quintile breakdown: Bottom 20% accounts for ${fmt(res.quintiles[0]?.sharePct, 1)}% of total sum; Top 20% accounts for ${fmt(res.quintiles[4]?.sharePct, 1)}%.`
      : "",
  ].filter(Boolean);

  const assumptions: string[] = [
    "Non-negative numeric measurements.",
    "Lorenz curve ordered summation over the entire observed population.",
  ];

  const limitations: string[] = [
    "Gini measures relative inequality, not absolute standard of living or poverty thresholds.",
    "Different structural distributions can produce identical aggregate Gini values.",
  ];

  const recommendations: string[] = [
    "Examine subgroup Palma ratios to identify whether disparity is driven by upper-decile concentration or lower-tail deficits.",
    "Pair with percentile ratios (P90/P10) for a comprehensive view of distribution spread.",
  ];

  return { observedResults: observed, statisticalInference: inference, assumptions, limitations, recommendations };
}

export function interpretNormality(
  col: string,
  res: NormalityDiagnosticsResult,
): AnalysisInterpretation {
  const observed: string[] = [
    `Observed sample size: ${res.n.toLocaleString()} values for "${col}".`,
    `Sample Mean = ${fmt(res.mean)}, Median = ${fmt(res.median)}, Sample SD = ${fmt(res.sd)}.`,
    `Fisher-Pearson Skewness: ${fmt(res.skewness, 3)}, Excess Kurtosis: ${fmt(res.kurtosis, 3)}.`,
    `Potential outliers: ${res.iqrOutliersCount} observation(s) outside 1.5× IQR fences.`,
  ];

  const inference: string[] = [
    res.momentsNearNormal
      ? "Descriptive skewness and excess kurtosis are near standard Gaussian expectations (|skew| < 0.5, |kurtosis| < 1.0)."
      : "Observable departures from Gaussian symmetry or tail weight are present in the sample.",
    res.recommendation,
  ];

  const assumptions: string[] = [
    "Continuous numeric measurement scale.",
    "Moments computed directly from observed data without arbitrary winsorization.",
  ];

  const limitations: string[] = [
    "Sample moments are descriptive diagnostics, not a formal omnibus hypothesis test.",
    "Higher-order moments (skewness, kurtosis) have high sampling variance in small samples (n < 50).",
  ];

  const recommendations: string[] = [
    !res.momentsNearNormal
      ? "For substantially skewed metrics, report median and IQR rather than mean and standard deviation."
      : "For parametric inference, verify that sample size provides adequate power under central limit approximations.",
  ];

  return { observedResults: observed, statisticalInference: inference, assumptions, limitations, recommendations };
}

export function interpretABTest(
  groupCol: string,
  convCol: string,
  res: ABTestResult,
): AnalysisInterpretation {
  const observed: string[] = [
    `Control: ${res.controlSuccess.toLocaleString()} / ${res.controlCount.toLocaleString()} successes (${fmt(res.controlRate !== null ? res.controlRate * 100 : null, 2)}%).`,
    `Treatment: ${res.testSuccess.toLocaleString()} / ${res.testCount.toLocaleString()} successes (${fmt(res.testRate !== null ? res.testRate * 100 : null, 2)}%).`,
    `Absolute Lift: ${res.absoluteLift !== null ? `${(res.absoluteLift * 100).toFixed(2)} percentage points` : "—"}, Relative Lift: ${res.relativeLiftPct !== null ? `${fmt(res.relativeLiftPct, 2)}%` : "—"}.`,
  ];

  const ciStr = res.confidenceInterval95
    ? `[${(res.confidenceInterval95[0] * 100).toFixed(2)}%, ${(res.confidenceInterval95[1] * 100).toFixed(2)}%]`
    : "—";

  const inference: string[] = [
    `Two-sided pooled score z-test: z = ${res.zScore !== null ? res.zScore.toFixed(3) : "—"}, p = ${res.pValue !== null ? (res.pValue < 0.001 ? "< 0.001" : res.pValue.toFixed(4)) : "—"}.`,
    `95% Confidence Interval for Absolute Lift: ${ciStr}.`,
    res.recommendation,
  ];

  const assumptions: string[] = [
    "Independent Bernoulli user trials with random allocation between variants.",
    "No spillover, network effects, or interference between test and control groups.",
    "Expected success and failure counts ≥ 5 per cell.",
  ];

  const limitations: string[] = [
    "Statistical significance does not prove absence of novelty effects or long-term equilibrium shift.",
    "Interim continuous monitoring ('peeking') inflates Type I false positive rates without alpha spending adjustments.",
  ];

  const recommendations: string[] = [
    res.isSignificant
      ? "Validate that the lift persists across user segments (e.g. platform, new vs returning) prior to full deployment."
      : "Continue collecting data until pre-calculated statistical sample size is achieved, or conclude that treatment effect is negligible.",
  ];

  return { observedResults: observed, statisticalInference: inference, assumptions, limitations, recommendations };
}

export function interpretOddsRatio(
  expCol: string,
  outCol: string,
  res: OddsRatioResult,
): AnalysisInterpretation {
  const observed: string[] = [
    `Analyzed 2×2 contingency table of ${res.n.toLocaleString()} observations for exposure "${expCol}" and outcome "${outCol}".`,
    `Table cell counts: a(exposed cases)=${res.a}, b(exposed non-cases)=${res.b}, c(unexposed cases)=${res.c}, d(unexposed non-cases)=${res.d}.`,
    `Calculated Odds Ratio (OR): ${res.oddsRatio !== null ? res.oddsRatio.toFixed(3) : "Undefined"}, Relative Risk (RR): ${res.relativeRisk !== null ? res.relativeRisk.toFixed(3) : "—"}.`,
  ];

  const ciStr = res.ci95Lower !== null && res.ci95Upper !== null ? `[${res.ci95Lower.toFixed(3)}, ${res.ci95Upper.toFixed(3)}]` : "—";

  const inference: string[] = [
    `Wald 95% Confidence Interval for Odds Ratio: ${ciStr}.`,
    res.chiSquareP !== null ? `Pearson chi-square p-value: ${res.chiSquareP < 0.001 ? "< 0.001" : res.chiSquareP.toFixed(4)}.` : "",
    res.interpretation,
  ].filter(Boolean);

  const assumptions: string[] = [
    "Binary exposure and outcome variables.",
    "Independent observations across study subjects.",
    "Large-sample normal approximation for log(OR) Wald confidence interval.",
  ];

  const limitations: string[] = [
    "CRITICAL: Observational odds ratios DO NOT establish biological or clinical causality.",
    "In retrospective case-control designs, Odds Ratio approximates Relative Risk only under the rare disease assumption.",
    res.note ? `Method note: ${res.note}` : "",
  ].filter(Boolean);

  const recommendations: string[] = [
    res.ci95Lower !== null && res.ci95Lower <= 1 && res.ci95Upper !== null && res.ci95Upper >= 1
      ? "Because the 95% confidence interval spans 1.0, the observed data do not demonstrate a statistically significant risk difference."
      : "Perform multivariable regression to adjust for potential confounding covariates (e.g. age, baseline severity).",
  ];

  return { observedResults: observed, statisticalInference: inference, assumptions, limitations, recommendations };
}

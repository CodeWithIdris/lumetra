/**
 * Pure statistical methods tailored for specific professional backgrounds/personas.
 * Adheres strictly to AGENTS.md:
 * - All computations are deterministic and run client-side.
 * - Missing values (null, undefined, NaN) are strictly excluded, never coerced to zero.
 */
import { describe, mean, median, toNumbers } from "./descriptive";
import { quantile, tTwoSidedP, chiSqUpperP } from "./advanced";

export type PersonaId = "engineer" | "economist" | "scientist" | "product" | "clinical";

export interface PersonaMeta {
  id: PersonaId;
  title: string;
  shortRole: string;
  tagline: string;
  badge: string;
  description: string;
  keyMetrics: string[];
}

export const PERSONAS: Record<PersonaId, PersonaMeta> = {
  engineer: {
    id: "engineer",
    title: "Software Engineer & SRE",
    shortRole: "Software Engineer",
    tagline:
      "Tail latency percentiles (P50/P99), SLO breach rates, error budget burn & system telemetry.",
    badge: "Sys & SRE Telemetry",
    description:
      "Specialized for distributed systems, request latencies, throughput, SLA/SLO budgets, and anomaly detection.",
    keyMetrics: [
      "P50 / P95 / P99 / P99.9 Latency",
      "Tail Ratio (P99/P50)",
      "SLO Breach %",
      "Error Budget Burn",
      "Throughput vs Latency",
    ],
  },
  economist: {
    id: "economist",
    title: "Economist & Financial Analyst",
    shortRole: "Economist",
    tagline:
      "Price elasticity, Gini inequality index, macroeconomic trends, CAGR & econometric metrics.",
    badge: "Econometrics & Macro",
    description:
      "Specialized for economic modeling, demand sensitivity, Lorenz curves, income distribution, and macro indicators.",
    keyMetrics: [
      "Price Elasticity (Ep)",
      "Gini Coefficient (0-1)",
      "Palma Ratio",
      "CAGR %",
      "Lorenz Quintile Distribution",
    ],
  },
  scientist: {
    id: "scientist",
    title: "Data Scientist & ML Engineer",
    shortRole: "Data Scientist",
    tagline:
      "Multivariate correlation matrices, skewness, kurtosis, normality diagnostics & outlier isolation.",
    badge: "Statistical & ML",
    description:
      "Specialized for feature distribution analysis, normality checks, data preprocessing, and multicollinearity.",
    keyMetrics: [
      "Pearson & Spearman r",
      "Skewness & Kurtosis",
      "IQR Outlier Bounds",
      "Normality Assessment",
    ],
  },
  product: {
    id: "product",
    title: "Product Manager & Growth",
    shortRole: "Product Manager",
    tagline:
      "A/B test significance, conversion lift, confidence intervals & cohort segment comparison.",
    badge: "Growth & Experimentation",
    description:
      "Specialized for experimentation, user conversion rates, feature rollouts, and segment performance lift.",
    keyMetrics: [
      "Conversion Lift %",
      "Z-Test p-value",
      "95% Confidence Interval",
      "Cohort Difference",
    ],
  },
  clinical: {
    id: "clinical",
    title: "Clinical Researcher & Bio-statistician",
    shortRole: "Clinical Researcher",
    tagline:
      "Odds ratios, relative risks, 95% Wald confidence intervals, and contingency analysis.",
    badge: "Clinical Epidemiology",
    description:
      "Specialized for clinical trials, epidemiology studies, risk assessment, and observational cohort data.",
    keyMetrics: ["Odds Ratio (OR)", "Relative Risk (RR)", "Wald 95% CI", "Chi-Square Independence"],
  },
};

// ==========================================
// 1. SOFTWARE ENGINEER / SRE METRICS
// ==========================================

export interface TailLatencyResult {
  n: number;
  missing: number;
  invalid: number;
  min: number | null;
  max: number | null;
  mean: number | null;
  p50: number | null;
  p75: number | null;
  p90: number | null;
  p95: number | null;
  p99: number | null;
  p999: number | null;
  tailRatio: number | null; // P99 / P50
  jitter: number | null; // mean absolute difference between successive valid readings
  outlierCount: number;
  assessment: string;
}

export function calculateTailLatency(
  raw: (number | string | null | undefined)[],
): TailLatencyResult {
  const converted = toNumbers(raw);
  const nums = converted.nums.filter((value) => value >= 0);
  const missing = converted.missing;
  const invalid = converted.invalid + converted.nums.length - nums.length;
  const n = nums.length;

  if (n === 0) {
    return {
      n: 0,
      missing,
      invalid,
      min: null,
      max: null,
      mean: null,
      p50: null,
      p75: null,
      p90: null,
      p95: null,
      p99: null,
      p999: null,
      tailRatio: null,
      jitter: null,
      outlierCount: 0,
      assessment: "No numeric values available for latency calculation.",
    };
  }

  const sorted = [...nums].sort((a, b) => a - b);
  const min = sorted[0]!;
  const max = sorted[sorted.length - 1]!;
  let sum = 0;
  for (const v of nums) sum += v;
  const meanVal = sum / n;

  const p50 = quantile(sorted, 0.5);
  const p75 = quantile(sorted, 0.75);
  const p90 = quantile(sorted, 0.9);
  const p95 = quantile(sorted, 0.95);
  const p99 = quantile(sorted, 0.99);
  const p999 = quantile(sorted, 0.999);

  const tailRatio = p50 !== null && p99 !== null && p50 > 0 ? p99 / p50 : null;

  // Jitter is the mean absolute change between successive valid readings.
  let jitter: number | null = null;
  if (nums.length > 1) {
    const diffs: number[] = [];
    for (let i = 1; i < nums.length; i++) {
      diffs.push(Math.abs(nums[i]! - nums[i - 1]!));
    }
    const diffSum = diffs.reduce((a, b) => a + b, 0);
    jitter = diffSum / diffs.length;
  }

  const outlierCount = p99 !== null ? nums.filter((x) => x > p99).length : 0;

  let assessment = "Healthy latency profile.";
  if (tailRatio !== null) {
    if (tailRatio > 5) {
      assessment = `Severe tail degradation: P99 is ${tailRatio.toFixed(1)}x higher than median (P50). High variance under load.`;
    } else if (tailRatio > 2.5) {
      assessment = `Moderate tail divergence: P99 is ${tailRatio.toFixed(1)}x median (P50). Consider reviewing slow query paths.`;
    } else {
      assessment = `Consistent latency: P99 is ${tailRatio.toFixed(1)}x median (P50), showing stable tail performance.`;
    }
  }

  return {
    n,
    missing,
    invalid,
    min,
    max,
    mean: meanVal,
    p50,
    p75,
    p90,
    p95,
    p99,
    p999,
    tailRatio,
    jitter,
    outlierCount,
    assessment,
  };
}

export interface SloBreachResult {
  n: number;
  missing: number;
  invalid: number;
  threshold: number;
  targetPercent: number; // e.g. 99.0% or 99.9%
  compliantCount: number;
  breachCount: number;
  actualAvailabilityPercent: number | null;
  budgetTotalAllowedBreaches: number;
  budgetConsumedPercent: number | null;
  status: "healthy" | "warning" | "breached" | "unavailable";
  summary: string;
}

export function calculateSloBreach(
  raw: (number | string | null | undefined)[],
  threshold: number,
  targetPercent = 99.0,
): SloBreachResult {
  const converted = toNumbers(raw);
  const nums = converted.nums.filter((value) => value >= 0);
  const missing = converted.missing;
  const invalid = converted.invalid + converted.nums.length - nums.length;
  const n = nums.length;

  if (
    n === 0 ||
    !Number.isFinite(threshold) ||
    !Number.isFinite(targetPercent) ||
    targetPercent < 0 ||
    targetPercent > 100
  ) {
    return {
      n,
      missing,
      invalid,
      threshold,
      targetPercent,
      compliantCount: 0,
      breachCount: 0,
      actualAvailabilityPercent: null,
      budgetTotalAllowedBreaches: 0,
      budgetConsumedPercent: null,
      status: "unavailable",
      summary:
        n === 0
          ? "No numeric observations; availability and error-budget consumption are undefined."
          : "Invalid SLO threshold or target. Threshold must be finite and target must be between 0 and 100%.",
    };
  }

  const breachCount = nums.filter((x) => x > threshold).length;
  const compliantCount = n - breachCount;
  const actualAvailabilityPercent = (compliantCount / n) * 100;

  const allowedErrorRate = (100 - targetPercent) / 100;
  const budgetTotalAllowedBreaches = n * allowedErrorRate;
  const budgetConsumedPercent =
    budgetTotalAllowedBreaches === 0
      ? breachCount === 0
        ? 0
        : null
      : (breachCount / budgetTotalAllowedBreaches) * 100;

  let status: SloBreachResult["status"] = "healthy";
  if (budgetTotalAllowedBreaches === 0 && breachCount > 0) {
    status = "breached";
  } else if (budgetConsumedPercent !== null && budgetConsumedPercent > 100) {
    status = "breached";
  } else if (budgetConsumedPercent !== null && budgetConsumedPercent >= 80) {
    status = "warning";
  }

  const summary =
    status === "breached"
      ? `SLO BREACHED: ${breachCount} requests exceeded ${threshold}ms threshold (${actualAvailabilityPercent.toFixed(2)}% availability vs ${targetPercent}% target). Error budget exceeded${budgetConsumedPercent === null ? "." : ` (${budgetConsumedPercent.toFixed(1)}%).`}`
      : status === "warning"
        ? `SLO AT RISK: ${breachCount} breaches consumed ${budgetConsumedPercent!.toFixed(1)}% of error budget. Availability is ${actualAvailabilityPercent.toFixed(2)}%.`
        : `SLO MET: ${actualAvailabilityPercent.toFixed(2)}% availability comfortably meets the ${targetPercent}% target (${breachCount} breaches out of ${budgetTotalAllowedBreaches} allowed).`;

  return {
    n,
    missing,
    invalid,
    threshold,
    targetPercent,
    compliantCount,
    breachCount,
    actualAvailabilityPercent,
    budgetTotalAllowedBreaches,
    budgetConsumedPercent,
    status,
    summary,
  };
}

// ==========================================
// 2. ECONOMIST / FINANCIAL ANALYST METRICS
// ==========================================

export interface ElasticityResult {
  n: number;
  missing: number;
  invalid: number;
  meanPrice: number | null;
  meanQuantity: number | null;
  slope: number | null;
  intercept: number | null;
  rSquared: number | null;
  pointElasticity: number | null; // (dQ/dP) * (P_mean / Q_mean)
  arcElasticity: number | null;
  classification: "Elastic" | "Inelastic" | "Unitary" | "Positive slope" | "Undefined";
  interpretation: string;
}

export function calculateElasticity(
  priceRaw: (number | string | null | undefined)[],
  quantityRaw: (number | string | null | undefined)[],
): ElasticityResult {
  const len = Math.min(priceRaw.length, quantityRaw.length);

  const validPairs: [number, number][] = [];
  let missing = Math.max(priceRaw.length, quantityRaw.length) - len;
  let invalid = 0;
  for (let i = 0; i < len; i++) {
    const rawPrice = priceRaw[i];
    const rawQuantity = quantityRaw[i];
    if (rawPrice == null || rawQuantity == null || rawPrice === "" || rawQuantity === "") {
      missing++;
      continue;
    }
    const p = Number(rawPrice);
    const q = Number(rawQuantity);
    if (Number.isFinite(p) && Number.isFinite(q)) {
      validPairs.push([p, q]);
    } else {
      invalid++;
    }
  }

  const n = validPairs.length;
  if (n < 3) {
    return {
      n,
      missing,
      invalid,
      meanPrice: null,
      meanQuantity: null,
      slope: null,
      intercept: null,
      rSquared: null,
      pointElasticity: null,
      arcElasticity: null,
      classification: "Undefined",
      interpretation:
        "At least 3 complete price-quantity pairs are required for elasticity estimation.",
    };
  }

  if (validPairs.some(([p, q]) => p <= 0 || q <= 0)) {
    return {
      n,
      missing,
      invalid,
      meanPrice: null,
      meanQuantity: null,
      slope: null,
      intercept: null,
      rSquared: null,
      pointElasticity: null,
      arcElasticity: null,
      classification: "Undefined",
      interpretation:
        "Point elasticity requires strictly positive price and quantity observations.",
    };
  }
  const meanPrice = mean(validPairs.map(([p]) => p));
  const meanQuantity = mean(validPairs.map(([, q]) => q));

  let sxx = 0,
    sxy = 0,
    syy = 0;
  for (const [p, q] of validPairs) {
    const dp = p - meanPrice;
    const dq = q - meanQuantity;
    sxx += dp * dp;
    sxy += dp * dq;
    syy += dq * dq;
  }

  if (sxx === 0 || meanQuantity === 0) {
    return {
      n,
      missing,
      invalid,
      meanPrice,
      meanQuantity,
      slope: null,
      intercept: null,
      rSquared: null,
      pointElasticity: null,
      arcElasticity: null,
      classification: "Undefined",
      interpretation: "Price is constant or mean quantity is zero.",
    };
  }

  const slope = sxy / sxx;
  const intercept = meanQuantity - slope * meanPrice;
  const rSquared = syy > 0 ? (sxy * sxy) / (sxx * syy) : null;

  // Point elasticity: E = slope * (meanPrice / meanQuantity)
  const pointElasticity = slope * (meanPrice / meanQuantity);

  let classification: ElasticityResult["classification"] = "Inelastic";
  const absE = Math.abs(pointElasticity);

  if (pointElasticity > 0) {
    classification = "Positive slope";
  } else if (absE > 1.05) {
    classification = "Elastic";
  } else if (absE < 0.95) {
    classification = "Inelastic";
  } else {
    classification = "Unitary";
  }

  let interpretation = "";
  if (classification === "Elastic") {
    interpretation = `Highly price sensitive (|E| = ${absE.toFixed(2)} > 1). A 1% increase in price reduces demand by approximately ${absE.toFixed(2)}%. Price decreases may expand total revenue.`;
  } else if (classification === "Inelastic") {
    interpretation = `Price inelastic (|E| = ${absE.toFixed(2)} < 1). Demand is relatively resistant to price changes. A 1% price increase reduces volume by only ${absE.toFixed(2)}%, implying pricing power.`;
  } else if (classification === "Unitary") {
    interpretation = `Unitary elastic (|E| ≈ 1.00). Percentage change in quantity exactly offsets price change; revenue is near maximum.`;
  } else {
    interpretation = `Positive price-quantity association (E = +${pointElasticity.toFixed(2)}). This descriptive regression does not establish a Veblen/Giffen effect or causation.`;
  }

  return {
    n,
    missing,
    invalid,
    meanPrice,
    meanQuantity,
    slope,
    intercept,
    rSquared,
    pointElasticity,
    arcElasticity: null,
    classification,
    interpretation,
  };
}

export interface GiniResult {
  n: number;
  missing: number;
  invalid: number;
  gini: number | null; // 0 (perfect equality) to 1 (maximum inequality)
  quintiles: { quintile: number; sharePct: number; cumSharePct: number }[];
  top10SharePct: number | null;
  palmaRatio: number | null; // share of top 10% / share of bottom 40%
  rating: string;
}

export function calculateGini(raw: (number | string | null | undefined)[]): GiniResult {
  const { nums, missing, invalid } = toNumbers(raw);
  const n = nums.length;

  if (nums.some((x) => x < 0)) {
    return {
      n,
      missing,
      invalid,
      gini: null,
      quintiles: [],
      top10SharePct: null,
      palmaRatio: null,
      rating:
        "Negative values are present. This implementation supports non-negative incomes only; no normalization or exclusion was applied.",
    };
  }

  if (n < 5) {
    return {
      n,
      missing,
      invalid,
      gini: null,
      quintiles: [],
      top10SharePct: null,
      palmaRatio: null,
      rating:
        "At least 5 complete non-negative observations are required for these grouped inequality summaries.",
    };
  }

  const sorted = [...nums].sort((a, b) => a - b);
  let totalSum = 0;
  for (const v of sorted) totalSum += v;

  if (totalSum === 0) {
    return {
      n,
      missing,
      invalid,
      gini: 0,
      quintiles: Array.from({ length: 5 }, (_, i) => ({
        quintile: i + 1,
        sharePct: 0,
        cumSharePct: 0,
      })),
      top10SharePct: 0,
      palmaRatio: null,
      rating: "All values are zero.",
    };
  }

  // Gini formula: G = (2 * sum(i * y_i) - (n + 1) * sum(y_i)) / (n * sum(y_i))
  let weightedSum = 0;
  for (let i = 0; i < n; i++) {
    weightedSum += (i + 1) * sorted[i]!;
  }
  const gini = (2 * weightedSum - (n + 1) * totalSum) / (n * totalSum);

  // Quintiles
  const quintiles: GiniResult["quintiles"] = [];
  let cumSum = 0;

  for (let q = 1; q <= 5; q++) {
    const qSum = populationSliceSum(sorted, ((q - 1) * n) / 5, (q * n) / 5);
    cumSum += qSum;
    const sharePct = (qSum / totalSum) * 100;
    const cumSharePct = (cumSum / totalSum) * 100;
    quintiles.push({ quintile: q, sharePct, cumSharePct });
  }

  // Top 10% share
  const top10Sum = populationSliceSum(sorted, n * 0.9, n);
  const top10SharePct = (top10Sum / totalSum) * 100;

  // Bottom 40% share (quintiles 1 and 2)
  const bottom40Share = (quintiles[0]?.sharePct ?? 0) + (quintiles[1]?.sharePct ?? 0);
  const palmaRatio = bottom40Share > 0 ? top10SharePct / bottom40Share : null;

  let rating = "Low inequality";
  if (gini > 0.5) rating = "Severe inequality (high concentration in upper distribution)";
  else if (gini > 0.4) rating = "Significant inequality (notable concentration)";
  else if (gini > 0.3) rating = "Moderate concentration / inequality";
  else rating = "Relatively equal distribution";

  return {
    n,
    missing,
    invalid,
    gini: Math.max(0, Math.min(1, gini)),
    quintiles,
    top10SharePct,
    palmaRatio,
    rating,
  };
}

function populationSliceSum(sorted: number[], start: number, end: number): number {
  let sum = 0;
  for (let i = Math.floor(start); i < Math.ceil(end); i++) {
    const overlap = Math.max(0, Math.min(i + 1, end) - Math.max(i, start));
    sum += sorted[i]! * overlap;
  }
  return sum;
}

// ==========================================
// 3. DATA SCIENTIST & ML METRICS
// ==========================================

export interface NormalityDiagnosticsResult {
  n: number;
  missing: number;
  invalid: number;
  mean: number | null;
  median: number | null;
  sd: number | null;
  skewness: number | null;
  kurtosis: number | null;
  momentsNearNormal: boolean;
  iqrOutliersCount: number;
  recommendation: string;
}

export function calculateNormalityDiagnostics(
  raw: (number | string | null | undefined)[],
): NormalityDiagnosticsResult {
  const { nums, missing, invalid } = toNumbers(raw);
  const n = nums.length;

  if (n < 4) {
    return {
      n,
      missing,
      invalid,
      mean: null,
      median: null,
      sd: null,
      skewness: null,
      kurtosis: null,
      momentsNearNormal: false,
      iqrOutliersCount: 0,
      recommendation: "Sample size too small (n < 4) for distribution moments.",
    };
  }

  const d = describe(nums);
  const m = d.mean!;
  const s = d.sd!;

  if (s === 0) {
    return {
      n,
      missing,
      invalid,
      mean: m,
      median: d.median,
      sd: 0,
      skewness: 0,
      kurtosis: 0,
      momentsNearNormal: false,
      iqrOutliersCount: 0,
      recommendation: "Zero variance. Variable is constant.",
    };
  }

  // Biased Fisher-Pearson moment coefficients, using population central moments.
  let m3 = 0,
    m4 = 0;
  for (const x of nums) {
    const diff = x - m;
    m3 += diff ** 3;
    m4 += diff ** 4;
  }
  m3 /= n;
  m4 /= n;
  let m2 = 0;
  for (const x of nums) m2 += (x - m) ** 2;
  m2 /= n;
  const skewness = m3 / m2 ** 1.5;
  const kurtosis = m4 / m2 ** 2 - 3;

  // IQR outliers
  const sorted = [...nums].sort((a, b) => a - b);
  const q25 = quantile(sorted, 0.25)!;
  const q75 = quantile(sorted, 0.75)!;
  const iqr = q75 - q25;
  const lowerFence = q25 - 1.5 * iqr;
  const upperFence = q75 + 1.5 * iqr;
  const iqrOutliersCount = nums.filter((x) => x < lowerFence || x > upperFence).length;

  const momentsNearNormal = Math.abs(skewness) < 0.5 && Math.abs(kurtosis) < 1.0;

  let recommendation = "";
  if (momentsNearNormal) {
    recommendation =
      "Skewness and excess kurtosis are near zero. These are descriptive moment checks, not a normality test and not evidence that parametric-test assumptions hold.";
  } else if (skewness > 1.0) {
    recommendation = `Substantial positive right-skew (skewness = ${skewness.toFixed(2)}). Consider transformations only when appropriate to the data domain, or robust/non-parametric methods. This is not a formal normality test.`;
  } else if (skewness < -1.0) {
    recommendation = `Substantial left-skew (skewness = ${skewness.toFixed(2)}). The mean is pulled toward the lower tail; the median may better represent the center. This is not a formal normality test.`;
  } else {
    recommendation = `Skewness or excess kurtosis departs from zero (excess kurtosis = ${kurtosis.toFixed(2)}). Check influential observations. These descriptive moments are not a formal normality test.`;
  }

  return {
    n,
    missing,
    invalid,
    mean: m,
    median: d.median,
    sd: s,
    skewness,
    kurtosis,
    momentsNearNormal,
    iqrOutliersCount,
    recommendation,
  };
}

// ==========================================
// 4. PRODUCT MANAGER / EXPERIMENTATION METRICS
// ==========================================

export interface ABTestResult {
  controlCount: number;
  controlSuccess: number;
  controlRate: number | null;
  testCount: number;
  testSuccess: number;
  testRate: number | null;
  absoluteLift: number | null;
  relativeLiftPct: number | null;
  zScore: number | null;
  pValue: number | null;
  confidenceInterval95: [number, number] | null;
  isSignificant: boolean;
  recommendation: string;
  note: string | null;
}

export function calculateABTest(
  controlSuccess: number,
  controlTotal: number,
  testSuccess: number,
  testTotal: number,
): ABTestResult {
  if (
    ![controlSuccess, controlTotal, testSuccess, testTotal].every(
      (value) => Number.isFinite(value) && Number.isInteger(value),
    ) ||
    controlTotal <= 0 ||
    testTotal <= 0 ||
    controlSuccess < 0 ||
    testSuccess < 0 ||
    controlSuccess > controlTotal ||
    testSuccess > testTotal
  ) {
    return {
      controlCount: controlTotal,
      controlSuccess,
      controlRate: null,
      testCount: testTotal,
      testSuccess,
      testRate: null,
      absoluteLift: null,
      relativeLiftPct: null,
      zScore: null,
      pValue: null,
      confidenceInterval95: null,
      isSignificant: false,
      recommendation:
        "Counts must be non-negative integers, each denominator must be positive, and conversions cannot exceed visitors.",
      note: "No test was calculated for invalid counts.",
    };
  }

  const p1 = controlSuccess / controlTotal;
  const p2 = testSuccess / testTotal;
  const absoluteLift = p2 - p1;
  const relativeLiftPct = p1 > 0 ? (absoluteLift / p1) * 100 : null;

  // Pooled standard error for two-proportion z-test
  const pooledP = (controlSuccess + testSuccess) / (controlTotal + testTotal);
  const sePooled = Math.sqrt(pooledP * (1 - pooledP) * (1 / controlTotal + 1 / testTotal));

  // Unpooled standard error for 95% Confidence Interval
  const seDiff = Math.sqrt((p1 * (1 - p1)) / controlTotal + (p2 * (1 - p2)) / testTotal);

  if (sePooled === 0) {
    return {
      controlCount: controlTotal,
      controlSuccess,
      controlRate: p1,
      testCount: testTotal,
      testSuccess,
      testRate: p2,
      absoluteLift,
      relativeLiftPct,
      zScore: null,
      pValue: null,
      confidenceInterval95: null,
      isSignificant: false,
      recommendation:
        "The pooled standard error is zero (both groups have identical all-zero or all-one outcomes); the z-test and Wald interval are undefined.",
      note: "A different method, such as an exact test and score-based interval, is needed for this boundary case.",
    };
  }

  const z = absoluteLift / sePooled;
  const pValue = chiSqUpperP(z * z, 1);
  const margin = 1.96 * seDiff;
  const confidenceInterval95: [number, number] = [absoluteLift - margin, absoluteLift + margin];
  const isSignificant = (pValue ?? 1) < 0.05;
  const sparse =
    controlTotal * p1 < 5 ||
    controlTotal * (1 - p1) < 5 ||
    testTotal * p2 < 5 ||
    testTotal * (1 - p2) < 5;

  const caveat =
    " Statistical significance does not establish practical importance or causality; randomization, independence, and the analysis plan must be appropriate.";
  let recommendation = "";
  if (isSignificant && absoluteLift > 0) {
    recommendation = `Statistically significant positive absolute lift (${(absoluteLift * 100).toFixed(2)} percentage points, p = ${pValue.toFixed(4)}).${caveat}`;
  } else if (isSignificant && absoluteLift < 0) {
    recommendation = `Statistically significant negative absolute lift (${(absoluteLift * 100).toFixed(2)} percentage points, p = ${pValue.toFixed(4)}).${caveat}`;
  } else {
    recommendation = `No evidence of a difference at the 0.05 level (p = ${pValue.toFixed(3)}). This is not proof of equivalence.${caveat}`;
  }

  return {
    controlCount: controlTotal,
    controlSuccess,
    controlRate: p1,
    testCount: testTotal,
    testSuccess,
    testRate: p2,
    absoluteLift,
    relativeLiftPct,
    zScore: z,
    pValue,
    confidenceInterval95,
    isSignificant,
    recommendation,
    note: sparse
      ? "At least one expected success/failure count is below 5; the normal approximation may be unreliable."
      : "Two-sided pooled score z-test; confidence interval is the unpooled Wald interval for the absolute difference. Assumes independent Bernoulli observations.",
  };
}

// ==========================================
// 5. CLINICAL / EPIDEMIOLOGY METRICS
// ==========================================

export interface OddsRatioResult {
  n: number;
  a: number; // Exposed Cases
  b: number; // Exposed Non-Cases
  c: number; // Unexposed Cases
  d: number; // Unexposed Non-Cases
  oddsRatio: number | null;
  relativeRisk: number | null;
  ci95Lower: number | null;
  ci95Upper: number | null;
  chiSquareP: number | null;
  interpretation: string;
  note: string;
}

export function calculateOddsRatio(a: number, b: number, c: number, d: number): OddsRatioResult {
  const n = a + b + c + d;
  const validCounts = [a, b, c, d].every(
    (value) => Number.isFinite(value) && Number.isInteger(value) && value >= 0,
  );
  if (!validCounts || n === 0) {
    return {
      n: Number.isFinite(n) ? n : 0,
      a,
      b,
      c,
      d,
      oddsRatio: null,
      relativeRisk: null,
      ci95Lower: null,
      ci95Upper: null,
      chiSquareP: null,
      interpretation: "Invalid cell counts for 2x2 table.",
      note: "Cell counts must be non-negative integers and their total must be positive.",
    };
  }

  if (a + b === 0 || c + d === 0 || a + c === 0 || b + d === 0) {
    return {
      n,
      a,
      b,
      c,
      d,
      oddsRatio: null,
      relativeRisk: null,
      ci95Lower: null,
      ci95Upper: null,
      chiSquareP: null,
      interpretation: "Association estimates are undefined because a row or column margin is zero.",
      note: "The table needs observations in both exposure groups and both outcome categories.",
    };
  }

  // Haldane-Anscombe 0.5 correction if any cell is zero
  const zeroCell = a === 0 || b === 0 || c === 0 || d === 0;
  const ac = zeroCell ? a + 0.5 : a;
  const bc = zeroCell ? b + 0.5 : b;
  const cc = zeroCell ? c + 0.5 : c;
  const dc = zeroCell ? d + 0.5 : d;

  const oddsRatio = (ac * dc) / (bc * cc);
  const logOR = Math.log(oddsRatio);
  const seLogOR = Math.sqrt(1 / ac + 1 / bc + 1 / cc + 1 / dc);

  const ci95Lower = Math.exp(logOR - 1.96 * seLogOR);
  const ci95Upper = Math.exp(logOR + 1.96 * seLogOR);

  // Relative Risk
  const riskExposed = a / (a + b);
  const riskUnexposed = c / (c + d);
  const relativeRisk = riskUnexposed > 0 ? riskExposed / riskUnexposed : null;

  // Pearson chi-square with Yates continuity correction
  const total = a + b + c + d;
  const numerator = total * Math.max(0, Math.abs(a * d - b * c) - total / 2) ** 2;
  const denominator = (a + b) * (c + d) * (a + c) * (b + d);
  const chiSq = denominator > 0 ? numerator / denominator : 0;
  const chiSquareP = chiSqUpperP(chiSq, 1);
  const interpretation = `Exposed-group odds ratio ${oddsRatio.toFixed(2)} (95% corrected-Wald CI [${ci95Lower.toFixed(2)}, ${ci95Upper.toFixed(2)}]); Yates-corrected chi-square p = ${chiSquareP.toFixed(4)}. This is an association, not evidence of causation.`;

  return {
    n,
    a,
    b,
    c,
    d,
    oddsRatio,
    relativeRisk,
    ci95Lower,
    ci95Upper,
    chiSquareP,
    interpretation,
    note: zeroCell
      ? "Haldane–Anscombe 0.5 correction applied to all four cells for the OR and its Wald CI. Relative risk uses uncorrected counts; the p-value is from the Yates-corrected chi-square test."
      : "OR and CI use the uncorrected table with a log-Wald interval; relative risk is uncorrected. The p-value is from the Yates-corrected chi-square test.",
  };
}

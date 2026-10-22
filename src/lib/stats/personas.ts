/**
 * Pure statistical methods tailored for specific professional backgrounds/personas.
 * Adheres strictly to AGENTS.md:
 * - All computations are deterministic and run client-side.
 * - Missing values (null, undefined, NaN) are strictly excluded, never coerced to zero.
 */
import { describe, median, toNumbers } from "./descriptive";
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
  jitter: number | null; // std dev of successive latency variations
  outlierCount: number;
  assessment: string;
}

export function calculateTailLatency(
  raw: (number | string | null | undefined)[],
): TailLatencyResult {
  const { nums, missing } = toNumbers(raw);
  const n = nums.length;

  if (n === 0) {
    return {
      n: 0,
      missing,
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

  const tailRatio = p50 && p99 && p50 > 0 ? p99 / p50 : null;

  // Jitter: standard deviation of adjacent latency differences
  let jitter: number | null = null;
  if (nums.length > 2) {
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
  threshold: number;
  targetPercent: number; // e.g. 99.0% or 99.9%
  compliantCount: number;
  breachCount: number;
  actualAvailabilityPercent: number;
  budgetTotalAllowedBreaches: number;
  budgetConsumedPercent: number;
  status: "healthy" | "warning" | "breached";
  summary: string;
}

export function calculateSloBreach(
  raw: (number | string | null | undefined)[],
  threshold: number,
  targetPercent = 99.0,
): SloBreachResult {
  const { nums } = toNumbers(raw);
  const n = nums.length;

  if (n === 0) {
    return {
      n: 0,
      threshold,
      targetPercent,
      compliantCount: 0,
      breachCount: 0,
      actualAvailabilityPercent: 100,
      budgetTotalAllowedBreaches: 0,
      budgetConsumedPercent: 0,
      status: "healthy",
      summary: "No data available.",
    };
  }

  const breachCount = nums.filter((x) => x > threshold).length;
  const compliantCount = n - breachCount;
  const actualAvailabilityPercent = (compliantCount / n) * 100;

  const allowedErrorRate = (100 - targetPercent) / 100;
  const budgetTotalAllowedBreaches = Math.max(1, Math.floor(n * allowedErrorRate));
  const budgetConsumedPercent = (breachCount / budgetTotalAllowedBreaches) * 100;

  let status: SloBreachResult["status"] = "healthy";
  if (budgetConsumedPercent > 100) {
    status = "breached";
  } else if (budgetConsumedPercent >= 80) {
    status = "warning";
  }

  const summary =
    status === "breached"
      ? `SLO BREACHED: ${breachCount} requests exceeded ${threshold}ms threshold (${actualAvailabilityPercent.toFixed(2)}% availability vs ${targetPercent}% target). Error budget exhausted (${budgetConsumedPercent.toFixed(1)}%).`
      : status === "warning"
        ? `SLO AT RISK: ${breachCount} breaches consumed ${budgetConsumedPercent.toFixed(1)}% of error budget. Availability is ${actualAvailabilityPercent.toFixed(2)}%.`
        : `SLO MET: ${actualAvailabilityPercent.toFixed(2)}% availability comfortably meets the ${targetPercent}% target (${breachCount} breaches out of ${budgetTotalAllowedBreaches} allowed).`;

  return {
    n,
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
  meanPrice: number | null;
  meanQuantity: number | null;
  slope: number | null;
  intercept: number | null;
  rSquared: number | null;
  pointElasticity: number | null; // (dQ/dP) * (P_mean / Q_mean)
  arcElasticity: number | null;
  classification: "Elastic" | "Inelastic" | "Unitary" | "Veblen/Giffen" | "Undefined";
  interpretation: string;
}

export function calculateElasticity(
  priceRaw: (number | string | null | undefined)[],
  quantityRaw: (number | string | null | undefined)[],
): ElasticityResult {
  const pNums = toNumbers(priceRaw).nums;
  const qNums = toNumbers(quantityRaw).nums;
  const len = Math.min(priceRaw.length, quantityRaw.length);

  const validPairs: [number, number][] = [];
  for (let i = 0; i < len; i++) {
    const p = priceRaw[i] != null && priceRaw[i] !== "" ? Number(priceRaw[i]) : NaN;
    const q = quantityRaw[i] != null && quantityRaw[i] !== "" ? Number(quantityRaw[i]) : NaN;
    if (Number.isFinite(p) && Number.isFinite(q)) {
      validPairs.push([p, q]);
    }
  }

  const n = validPairs.length;
  if (n < 3) {
    return {
      n,
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

  let sumP = 0,
    sumQ = 0;
  for (const [p, q] of validPairs) {
    sumP += p;
    sumQ += q;
  }
  const meanPrice = sumP / n;
  const meanQuantity = sumQ / n;

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
  const rSquared = syy > 0 ? (sxy * sxy) / (sxx * syy) : 0;

  // Point elasticity: E = slope * (meanPrice / meanQuantity)
  const pointElasticity = slope * (meanPrice / meanQuantity);

  let classification: ElasticityResult["classification"] = "Inelastic";
  const absE = Math.abs(pointElasticity);

  if (pointElasticity > 0.05) {
    classification = "Veblen/Giffen";
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
    interpretation = `Positive slope detected (E = +${pointElasticity.toFixed(2)}). Demand rises with price (potential luxury/Veblen good or upward trend confounding).`;
  }

  return {
    n,
    meanPrice,
    meanQuantity,
    slope,
    intercept,
    rSquared,
    pointElasticity,
    arcElasticity: pointElasticity,
    classification,
    interpretation,
  };
}

export interface GiniResult {
  n: number;
  gini: number | null; // 0 (perfect equality) to 1 (maximum inequality)
  quintiles: { quintile: number; sharePct: number; cumSharePct: number }[];
  top10SharePct: number | null;
  palmaRatio: number | null; // share of top 10% / share of bottom 40%
  rating: string;
}

export function calculateGini(raw: (number | string | null | undefined)[]): GiniResult {
  const { nums } = toNumbers(raw);
  const positiveNums = nums.filter((x) => x >= 0);
  const n = positiveNums.length;

  if (n < 5) {
    return {
      n,
      gini: null,
      quintiles: [],
      top10SharePct: null,
      palmaRatio: null,
      rating: "Need at least 5 positive data points to compute Gini and Lorenz distributions.",
    };
  }

  const sorted = [...positiveNums].sort((a, b) => a - b);
  let totalSum = 0;
  for (const v of sorted) totalSum += v;

  if (totalSum === 0) {
    return {
      n,
      gini: 0,
      quintiles: [],
      top10SharePct: 0,
      palmaRatio: 0,
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
  const quintileSize = Math.floor(n / 5);
  const quintiles: GiniResult["quintiles"] = [];
  let cumSum = 0;

  for (let q = 1; q <= 5; q++) {
    const startIdx = (q - 1) * quintileSize;
    const endIdx = q === 5 ? n : q * quintileSize;
    let qSum = 0;
    for (let i = startIdx; i < endIdx; i++) qSum += sorted[i]!;
    cumSum += qSum;
    const sharePct = (qSum / totalSum) * 100;
    const cumSharePct = (cumSum / totalSum) * 100;
    quintiles.push({ quintile: q, sharePct, cumSharePct });
  }

  // Top 10% share
  const top10Start = Math.floor(n * 0.9);
  let top10Sum = 0;
  for (let i = top10Start; i < n; i++) top10Sum += sorted[i]!;
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
    gini: Math.max(0, Math.min(1, gini)),
    quintiles,
    top10SharePct,
    palmaRatio,
    rating,
  };
}

// ==========================================
// 3. DATA SCIENTIST & ML METRICS
// ==========================================

export interface NormalityDiagnosticsResult {
  n: number;
  mean: number | null;
  median: number | null;
  sd: number | null;
  skewness: number | null;
  kurtosis: number | null;
  isNormalCandidate: boolean;
  iqrOutliersCount: number;
  recommendation: string;
}

export function calculateNormalityDiagnostics(
  raw: (number | string | null | undefined)[],
): NormalityDiagnosticsResult {
  const { nums } = toNumbers(raw);
  const n = nums.length;

  if (n < 4) {
    return {
      n,
      mean: null,
      median: null,
      sd: null,
      skewness: null,
      kurtosis: null,
      isNormalCandidate: false,
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
      mean: m,
      median: d.median,
      sd: 0,
      skewness: 0,
      kurtosis: 0,
      isNormalCandidate: false,
      iqrOutliersCount: 0,
      recommendation: "Zero variance. Variable is constant.",
    };
  }

  // Moments for skewness & excess kurtosis
  let m3 = 0,
    m4 = 0;
  for (const x of nums) {
    const diff = x - m;
    m3 += diff ** 3;
    m4 += diff ** 4;
  }
  m3 /= n;
  m4 /= n;

  const skewness = m3 / s ** 3;
  const kurtosis = m4 / s ** 4 - 3; // Excess kurtosis

  // IQR outliers
  const sorted = [...nums].sort((a, b) => a - b);
  const q25 = quantile(sorted, 0.25)!;
  const q75 = quantile(sorted, 0.75)!;
  const iqr = q75 - q25;
  const lowerFence = q25 - 1.5 * iqr;
  const upperFence = q75 + 1.5 * iqr;
  const iqrOutliersCount = nums.filter((x) => x < lowerFence || x > upperFence).length;

  const isNormalCandidate = Math.abs(skewness) < 0.5 && Math.abs(kurtosis) < 1.0;

  let recommendation = "";
  if (isNormalCandidate) {
    recommendation =
      "Distribution is approximately symmetric and bell-shaped. Suitable for standard parametric tests (ANOVA, Pearson r, OLS).";
  } else if (skewness > 1.0) {
    recommendation = `Substantial positive right-skew (skewness = ${skewness.toFixed(2)}). Consider logarithmic transformation (log(x)) or non-parametric tests (Spearman, Mann-Whitney).`;
  } else if (skewness < -1.0) {
    recommendation = `Substantial left-skew (skewness = ${skewness.toFixed(2)}). Mean is pulled down by lower tail; median represents central tendency more reliably.`;
  } else {
    recommendation = `Moderate skew or heavy tails (kurtosis = ${kurtosis.toFixed(2)}). Check for influential outliers.`;
  }

  return {
    n,
    mean: m,
    median: d.median,
    sd: s,
    skewness,
    kurtosis,
    isNormalCandidate,
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
  controlRate: number;
  testCount: number;
  testSuccess: number;
  testRate: number;
  absoluteLift: number;
  relativeLiftPct: number;
  zScore: number | null;
  pValue: number | null;
  confidenceInterval95: [number, number] | null;
  isSignificant: boolean;
  recommendation: string;
}

export function calculateABTest(
  controlSuccess: number,
  controlTotal: number,
  testSuccess: number,
  testTotal: number,
): ABTestResult {
  if (controlTotal <= 0 || testTotal <= 0) {
    return {
      controlCount: controlTotal,
      controlSuccess,
      controlRate: 0,
      testCount: testTotal,
      testSuccess,
      testRate: 0,
      absoluteLift: 0,
      relativeLiftPct: 0,
      zScore: null,
      pValue: null,
      confidenceInterval95: null,
      isSignificant: false,
      recommendation: "Sample sizes must be greater than zero.",
    };
  }

  const p1 = controlSuccess / controlTotal;
  const p2 = testSuccess / testTotal;
  const absoluteLift = p2 - p1;
  const relativeLiftPct = p1 > 0 ? (absoluteLift / p1) * 100 : 0;

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
      zScore: 0,
      pValue: 1,
      confidenceInterval95: [absoluteLift, absoluteLift],
      isSignificant: false,
      recommendation: "No variation observed across groups.",
    };
  }

  const z = absoluteLift / sePooled;
  // Approximation for standard normal two-tailed p-value
  const pValue = tTwoSidedP(z, 10000); // z is t with high df
  const margin = 1.96 * seDiff;
  const confidenceInterval95: [number, number] = [absoluteLift - margin, absoluteLift + margin];
  const isSignificant = (pValue ?? 1) < 0.05;

  let recommendation = "";
  if (isSignificant && absoluteLift > 0) {
    recommendation = `Statistically significant positive lift (+${relativeLiftPct.toFixed(1)}%, p = ${(pValue ?? 0).toFixed(4)} < 0.05). Variant out-performed control. Safe to roll out.`;
  } else if (isSignificant && absoluteLift < 0) {
    recommendation = `Statistically significant negative impact (${relativeLiftPct.toFixed(1)}%, p = ${(pValue ?? 0).toFixed(4)} < 0.05). Variant degraded conversion; recommend rollback.`;
  } else {
    recommendation = `Inconclusive (p = ${(pValue ?? 0).toFixed(3)} ≥ 0.05). Difference could easily be chance. Continue gathering sample size.`;
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
  };
}

// ==========================================
// 5. CLINICAL / EPIDEMIOLOGY METRICS
// ==========================================

export interface OddsRatioResult {
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
}

export function calculateOddsRatio(a: number, b: number, c: number, d: number): OddsRatioResult {
  if (a < 0 || b < 0 || c < 0 || d < 0 || a + b + c + d === 0) {
    return {
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
  const riskExposed = ac / (ac + bc);
  const riskUnexposed = cc / (cc + dc);
  const relativeRisk = riskUnexposed > 0 ? riskExposed / riskUnexposed : null;

  // Pearson chi-square with Yates continuity correction
  const total = a + b + c + d;
  const numerator = total * Math.max(0, Math.abs(a * d - b * c) - total / 2) ** 2;
  const denominator = (a + b) * (c + d) * (a + c) * (b + d);
  const chiSq = denominator > 0 ? numerator / denominator : 0;
  const chiSquareP = chiSqUpperP(chiSq, 1);

  let interpretation = "";
  if (oddsRatio > 1.2 && ci95Lower > 1.0) {
    interpretation = `Significant association: Exposed group has ${oddsRatio.toFixed(2)}x higher odds (95% CI [${ci95Lower.toFixed(2)}, ${ci95Upper.toFixed(2)}], p < 0.05).`;
  } else if (oddsRatio < 0.8 && ci95Upper < 1.0) {
    interpretation = `Significant protective effect: Exposed group has ${oddsRatio.toFixed(2)}x odds (95% CI [${ci95Lower.toFixed(2)}, ${ci95Upper.toFixed(2)}], p < 0.05).`;
  } else {
    interpretation = `No statistically significant association (95% CI includes 1.0: [${ci95Lower.toFixed(2)}, ${ci95Upper.toFixed(2)}]).`;
  }

  return {
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
  };
}

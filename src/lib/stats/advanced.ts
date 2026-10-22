/* eslint-disable no-loss-of-precision */
/**
 * Deterministic inferential and multivariate statistics.
 * Every function is pure and excludes missing values (pairwise for two-variable methods).
 */
import { describe, median } from "./descriptive";

export function mean(xs: number[]): number {
  let m = 0;
  for (let i = 0; i < xs.length; i++) m += (xs[i]! - m) / (i + 1);
  return m;
}

/** Linear-interpolated quantile (Hyndman & Fan type 7, the R/Excel default). */
export function quantile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const h = (sorted.length - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  return sorted[lo]! + (h - lo) * (sorted[hi]! - sorted[lo]!);
}

// ---------- special functions (Numerical Recipes style) ----------
function logGamma(x: number): number {
  const c = [
    76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155,
    0.1208650973866179e-2, -0.5395239384953e-5,
  ];
  let y = x;
  const tmp = x + 5.5 - (x + 0.5) * Math.log(x + 5.5);
  let ser = 1.000000000190015;
  for (const ci of c) ser += ci / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}
function betacf(a: number, b: number, x: number): number {
  const MAXIT = 300,
    EPS = 3e-14,
    FPMIN = 1e-300;
  let c = 1,
    d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((a - 1 + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + 1 + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}
/** Regularised incomplete beta I_x(a, b). */
export function incBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(
    logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x),
  );
  return x < (a + 1) / (a + b + 2)
    ? (bt * betacf(a, b, x)) / a
    : 1 - (bt * betacf(b, a, 1 - x)) / b;
}
/** Two-sided p-value for Student's t with df degrees of freedom. */
export function tTwoSidedP(t: number, df: number): number {
  return incBeta(df / (df + t * t), df / 2, 0.5);
}
/** Upper-tail p-value of the F distribution. */
export function fUpperP(f: number, d1: number, d2: number): number {
  return incBeta(d2 / (d2 + d1 * f), d2 / 2, d1 / 2);
}
function gammaP(a: number, x: number): number {
  if (x <= 0) return 0;
  if (x < a + 1) {
    let sum = 1 / a,
      del = sum,
      ap = a;
    for (let n = 0; n < 500; n++) {
      ap++;
      del *= x / ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * 3e-14) break;
    }
    return sum * Math.exp(-x + a * Math.log(x) - logGamma(a));
  }
  let b = x + 1 - a,
    c = 1e300,
    d = 1 / b,
    h = d;
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c;
    if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 3e-14) break;
  }
  return 1 - Math.exp(-x + a * Math.log(x) - logGamma(a)) * h;
}
/** Upper-tail p-value of the chi-square distribution. */
export function chiSqUpperP(x: number, df: number): number {
  return 1 - gammaP(df / 2, x / 2);
}

// ---------- methods ----------
export interface CorrelationResult {
  method: "pearson" | "spearman";
  n: number;
  r: number | null;
  pValue: number | null;
  note?: string;
}

function ranks(xs: number[]): number[] {
  const idx = xs.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const r = new Array<number>(xs.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1]![0] === idx[i]![0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k]![1]] = avg;
    i = j + 1;
  }
  return r;
}

function pearsonRaw(x: number[], y: number[]): number | null {
  const mx = mean(x),
    my = mean(y);
  let sxy = 0,
    sxx = 0,
    syy = 0;
  for (let i = 0; i < x.length; i++) {
    const dx = x[i]! - mx,
      dy = y[i]! - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  return sxx === 0 || syy === 0 ? null : sxy / Math.sqrt(sxx * syy);
}

/** Pairs where both values are present. */
export function pairs(a: (number | null)[], b: (number | null)[]): [number[], number[]] {
  const x: number[] = [],
    y: number[] = [];
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const u = a[i],
      v = b[i];
    if (u != null && v != null && Number.isFinite(u) && Number.isFinite(v)) {
      x.push(u);
      y.push(v);
    }
  }
  return [x, y];
}

export function correlation(
  x: number[],
  y: number[],
  method: "pearson" | "spearman" = "pearson",
): CorrelationResult {
  const n = x.length;
  if (n < 3)
    return { method, n, r: null, pValue: null, note: "At least 3 complete pairs are needed." };
  const r = method === "pearson" ? pearsonRaw(x, y) : pearsonRaw(ranks(x), ranks(y));
  if (r === null)
    return {
      method,
      n,
      r: null,
      pValue: null,
      note: "One variable is constant, so correlation is undefined.",
    };
  const rc = Math.max(-1, Math.min(1, r));
  const p = Math.abs(rc) === 1 ? 0 : tTwoSidedP(rc * Math.sqrt((n - 2) / (1 - rc * rc)), n - 2);
  return {
    method,
    n,
    r: rc,
    pValue: p,
    ...(method === "spearman" ? { note: "p-value uses the t approximation." } : {}),
  };
}

export interface RegressionResult {
  n: number;
  slope: number | null;
  intercept: number | null;
  rSquared: number | null;
  slopeSE: number | null;
  slopeP: number | null;
  note?: string;
}

/** Simple ordinary least squares y = a + b·x. */
export function linearRegression(x: number[], y: number[]): RegressionResult {
  const n = x.length;
  const empty = { n, slope: null, intercept: null, rSquared: null, slopeSE: null, slopeP: null };
  if (n < 3) return { ...empty, note: "At least 3 complete pairs are needed." };
  const mx = mean(x),
    my = mean(y);
  let sxx = 0,
    sxy = 0,
    syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i]! - mx,
      dy = y[i]! - my;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  if (sxx === 0) return { ...empty, note: "The predictor is constant." };
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  const sse = Math.max(0, syy - slope * sxy);
  const rSquared = syy === 0 ? null : 1 - sse / syy;
  const se = Math.sqrt(sse / (n - 2) / sxx);
  const slopeP = se === 0 ? 0 : tTwoSidedP(slope / se, n - 2);
  return { n, slope, intercept, rSquared, slopeSE: se, slopeP };
}

export interface WelchResult {
  groups: { name: string; n: number; mean: number | null; sd: number | null }[];
  difference: number | null;
  t: number | null;
  df: number | null;
  pValue: number | null;
  note?: string;
}

/** Welch's two-sample t-test (unequal variances). */
export function welchTTest(
  a: number[],
  b: number[],
  names: [string, string] = ["A", "B"],
): WelchResult {
  const da = describe(a),
    db = describe(b);
  const groups = [
    { name: names[0], n: da.n, mean: da.mean, sd: da.sd },
    { name: names[1], n: db.n, mean: db.mean, sd: db.sd },
  ];
  if (da.n < 2 || db.n < 2 || da.sd === null || db.sd === null) {
    return {
      groups,
      difference: null,
      t: null,
      df: null,
      pValue: null,
      note: "Each group needs at least 2 values.",
    };
  }
  const va = da.sd ** 2 / da.n,
    vb = db.sd ** 2 / db.n;
  const diff = da.mean! - db.mean!;
  if (va + vb === 0)
    return {
      groups,
      difference: diff,
      t: null,
      df: null,
      pValue: null,
      note: "Both groups have zero variance.",
    };
  const t = diff / Math.sqrt(va + vb);
  const df = (va + vb) ** 2 / (va ** 2 / (da.n - 1) + vb ** 2 / (db.n - 1));
  return { groups, difference: diff, t, df, pValue: tTwoSidedP(t, df) };
}

export interface AnovaResult {
  groups: { name: string; n: number; mean: number }[];
  f: number | null;
  dfBetween: number;
  dfWithin: number;
  pValue: number | null;
  etaSquared: number | null;
  note?: string;
}

/** One-way ANOVA across groups. */
export function oneWayAnova(groups: { name: string; values: number[] }[]): AnovaResult {
  const g = groups.filter((x) => x.values.length > 0);
  const all = g.flatMap((x) => x.values);
  const k = g.length,
    N = all.length;
  const summary = g.map((x) => ({ name: x.name, n: x.values.length, mean: mean(x.values) }));
  if (k < 2 || N - k < 1)
    return {
      groups: summary,
      f: null,
      dfBetween: k - 1,
      dfWithin: N - k,
      pValue: null,
      etaSquared: null,
      note: "Need at least 2 groups and more values than groups.",
    };
  const gm = mean(all);
  let ssb = 0,
    ssw = 0;
  g.forEach((x, i) => {
    const m = summary[i]!.mean;
    ssb += x.values.length * (m - gm) ** 2;
    for (const v of x.values) ssw += (v - m) ** 2;
  });
  const dfb = k - 1,
    dfw = N - k;
  if (ssw === 0)
    return {
      groups: summary,
      f: null,
      dfBetween: dfb,
      dfWithin: dfw,
      pValue: null,
      etaSquared: null,
      note: "No variation within groups.",
    };
  const f = ssb / dfb / (ssw / dfw);
  return {
    groups: summary,
    f,
    dfBetween: dfb,
    dfWithin: dfw,
    pValue: fUpperP(f, dfb, dfw),
    etaSquared: ssb / (ssb + ssw),
  };
}

export interface CrosstabResult {
  rows: string[];
  cols: string[];
  counts: number[][];
  n: number;
  chiSquare: number | null;
  df: number;
  pValue: number | null;
  cramersV: number | null;
  note?: string;
}

/** Contingency table with Pearson chi-square test of independence. */
export function crosstab(a: (string | null)[], b: (string | null)[]): CrosstabResult {
  const pairsAB: [string, string][] = [];
  for (let i = 0; i < Math.min(a.length, b.length); i++)
    if (a[i] != null && b[i] != null) pairsAB.push([a[i]!, b[i]!]);
  const rows = [...new Set(pairsAB.map((p) => p[0]))].sort();
  const cols = [...new Set(pairsAB.map((p) => p[1]))].sort();
  const counts = rows.map(() => cols.map(() => 0));
  for (const [r, c] of pairsAB) counts[rows.indexOf(r)]![cols.indexOf(c)]!++;
  const n = pairsAB.length;
  const df = (rows.length - 1) * (cols.length - 1);
  if (df < 1 || n === 0)
    return {
      rows,
      cols,
      counts,
      n,
      chiSquare: null,
      df,
      pValue: null,
      cramersV: null,
      note: "Each variable needs at least 2 categories.",
    };
  const rt = counts.map((r) => r.reduce((s, v) => s + v, 0));
  const ct = cols.map((_, j) => counts.reduce((s, r) => s + r[j]!, 0));
  let chi = 0,
    lowExpected = 0;
  for (let i = 0; i < rows.length; i++)
    for (let j = 0; j < cols.length; j++) {
      const e = (rt[i]! * ct[j]!) / n;
      if (e < 5) lowExpected++;
      chi += (counts[i]![j]! - e) ** 2 / e;
    }
  const v = Math.sqrt(chi / (n * Math.min(rows.length - 1, cols.length - 1)));
  const cells = rows.length * cols.length;
  return {
    rows,
    cols,
    counts,
    n,
    chiSquare: chi,
    df,
    pValue: chiSqUpperP(chi, df),
    cramersV: v,
    ...(lowExpected / cells > 0.2
      ? {
          note: `${lowExpected} of ${cells} cells have expected counts below 5; the chi-square approximation may be unreliable.`,
        }
      : {}),
  };
}

export type Agg = "count" | "mean" | "median" | "sum" | "min" | "max" | "sd";

export function aggregate(values: number[], agg: Agg): number | null {
  if (agg === "count") return values.length;
  if (values.length === 0) return null;
  const s = describe(values);
  switch (agg) {
    case "mean":
      return s.mean;
    case "median":
      return median([...values].sort((a, b) => a - b));
    case "sum":
      return values.reduce((a, b) => a + b, 0);
    case "min":
      return s.min;
    case "max":
      return s.max;
    case "sd":
      return s.sd;
  }
}

export function percentiles(values: number[], ps: number[]): { p: number; value: number | null }[] {
  const sorted = [...values].sort((a, b) => a - b);
  return ps.map((p) => ({ p, value: quantile(sorted, p) }));
}

/** Tukey fences: values beyond Q1 − k·IQR or Q3 + k·IQR. */
export function outliersIQR(values: number[], k = 1.5) {
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = quantile(sorted, 0.25),
    q3 = quantile(sorted, 0.75);
  if (q1 === null || q3 === null)
    return { q1, q3, lower: null, upper: null, count: 0, examples: [] as number[] };
  const iqr = q3 - q1;
  const lower = q1 - k * iqr,
    upper = q3 + k * iqr;
  const out = values.filter((v) => v < lower || v > upper);
  return { q1, q3, lower, upper, count: out.length, examples: out.slice(0, 10) };
}

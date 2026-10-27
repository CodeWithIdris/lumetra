/**
 * Deterministic descriptive statistics.
 * Standard deviation uses the SAMPLE convention (divisor n − 1), computed with
 * Welford's online algorithm for numerical stability. It is undefined (null) for n < 2.
 */

export interface NumericSummary {
  n: number;
  missing: number;
  invalid: number;
  mean: number | null;
  median: number | null;
  min: number | null;
  max: number | null;
  sd: number | null;
}

export function toNumbers(
  values: (number | string | null | undefined)[],
): { nums: number[]; missing: number; invalid: number } {
  const nums: number[] = [];
  let missing = 0;
  let invalid = 0;
  for (const v of values) {
    if (v == null) {
      missing++;
      continue;
    }
    if (typeof v === "string" && v.trim() === "") {
      missing++;
      continue;
    }
    const text = String(v).trim();
    if (!/^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(text)) {
      invalid++;
      continue;
    }
    const n = Number(text);
    if (Number.isFinite(n)) nums.push(n);
    else invalid++;
  }
  return { nums, missing, invalid };
}

export function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  let m = 0;
  for (let i = 0; i < xs.length; i++) m += (xs[i]! - m) / (i + 1);
  return m;
}

export function median(sorted: number[]): number | null {
  const n = sorted.length;
  if (n === 0) return null;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function describe(nums: number[], missing = 0, invalid = 0): NumericSummary {
  const n = nums.length;
  if (n === 0)
    return { n: 0, missing, invalid, mean: null, median: null, min: null, max: null, sd: null };
  let mean = 0;
  let m2 = 0;
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = nums[i]!;
    const delta = x - mean;
    mean += delta / (i + 1);
    m2 += delta * (x - mean);
    if (x < min) min = x;
    if (x > max) max = x;
  }
  const sorted = [...nums].sort((a, b) => a - b);
  return {
    n,
    missing,
    invalid,
    mean,
    median: median(sorted),
    min,
    max,
    sd: n < 2 ? null : Math.sqrt(m2 / (n - 1)),
  };
}

export interface FrequencyRow {
  value: string;
  count: number;
  pct: number; // of non-missing
}

export function frequencies(values: (string | null)[]): {
  rows: FrequencyRow[];
  missing: number;
  n: number;
} {
  const counts = new Map<string, number>();
  let missing = 0;
  for (const v of values) {
    if (v === null) missing++;
    else counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  const n = values.length - missing;
  const rows = [...counts.entries()]
    .map(([value, count]) => ({ value, count, pct: n === 0 ? 0 : (count / n) * 100 }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  return { rows, missing, n };
}

export interface HistogramBin {
  lower: number;
  upper: number;
  count: number;
  label: string;
}

export const MAX_DISCRETE_BINS = 30;

/**
 * Histogram.
 * - Whole-number data spanning at most MAX_DISCRETE_BINS distinct integers gets one bar per
 *   integer (e.g. a 1–5 rating scale), so no artificial empty bins appear between values.
 * - Otherwise equal-width bins, count by Sturges' rule. Bins are [lower, upper), the last is [lower, upper].
 */
export function histogram(nums: number[], binCount?: number): HistogramBin[] {
  if (nums.length === 0) return [];
  let min = Infinity;
  let max = -Infinity;
  for (const x of nums) {
    if (x < min) min = x;
    if (x > max) max = x;
  }
  if (min === max) return [{ lower: min, upper: max, count: nums.length, label: fmt(min) }];
  if (
    binCount === undefined &&
    nums.every(Number.isInteger) &&
    max - min + 1 <= MAX_DISCRETE_BINS
  ) {
    const bins: HistogramBin[] = [];
    for (let v = min; v <= max; v++) bins.push({ lower: v, upper: v, count: 0, label: fmt(v) });
    for (const x of nums) bins[x - min]!.count++;
    return bins;
  }
  const k = binCount ?? Math.max(1, Math.ceil(Math.log2(nums.length)) + 1);
  const width = (max - min) / k;
  const bins: HistogramBin[] = Array.from({ length: k }, (_, i) => {
    const lower = min + i * width;
    const upper = i === k - 1 ? max : min + (i + 1) * width;
    return { lower, upper, count: 0, label: `${fmt(lower)}–${fmt(upper)}` };
  });
  for (const x of nums) {
    let i = Math.floor((x - min) / width);
    if (i >= k) i = k - 1;
    bins[i]!.count++;
  }
  return bins;
}

export function fmt(x: number | null, digits = 2): string {
  if (x === null || !Number.isFinite(x)) return "—";
  if (Number.isInteger(x) && Math.abs(x) < 1e15) return x.toLocaleString("en-US");
  const abs = Math.abs(x);
  if (abs !== 0 && (abs >= 1e9 || abs < 1e-3)) return x.toExponential(digits);
  return x.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

import { columnValues, profileDataset } from "../data/infer";
import type { ColumnProfile, Dataset } from "../data/types";
import { describe, fmt, frequencies, histogram, toNumbers, type FrequencyRow, type HistogramBin, type NumericSummary } from "./descriptive";

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
      const { nums, missing } = toNumbers(columnValues(ds, p.index));
      return { column: p.name, summary: describe(nums, missing), bins: histogram(nums) };
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
  out.push(`The dataset "${r.datasetName}" contains ${r.rowCount.toLocaleString()} rows and ${r.columnCount} columns.`);
  const withMissing = r.profiles.filter((p) => p.missing > 0).sort((a, b) => b.missingPct - a.missingPct);
  if (withMissing.length === 0) out.push("No missing values were detected.");
  else {
    const top = withMissing[0];
    out.push(
      `${withMissing.length} column(s) contain missing values; the most affected is "${top.name}" with ${top.missing} missing (${fmt(top.missingPct, 1)}%). Missing values were excluded from calculations, not replaced.`,
    );
  }
  for (const n of r.numeric) {
    const s = n.summary;
    if (s.n === 0) continue;
    let line = `"${n.column}" (n = ${s.n}) has a mean of ${fmt(s.mean)} and a median of ${fmt(s.median)}, ranging from ${fmt(s.min)} to ${fmt(s.max)}`;
    line += s.sd === null ? "; standard deviation is undefined for a single value." : ` (SD ${fmt(s.sd)}).`;
    if (s.mean !== null && s.median !== null && s.sd && s.sd > 0) {
      const gap = (s.mean - s.median) / s.sd;
      if (gap > 0.2) line += " The mean exceeds the median, suggesting a right-skewed distribution.";
      else if (gap < -0.2) line += " The mean is below the median, suggesting a left-skewed distribution.";
    }
    out.push(line);
  }
  for (const c of r.categorical) {
    if (c.rows.length === 0) continue;
    const top = c.rows[0];
    const tied = c.rows.filter((x) => x.count === top.count).length;
    out.push(
      tied > 1
        ? `"${c.column}" has ${c.rows.length} categories; ${tied} are tied as most frequent with ${top.count} entries each.`
        : `"${c.column}" has ${c.rows.length} categories; the most frequent is "${top.value}" (${top.count}, ${fmt(top.pct, 1)}% of non-missing).`,
    );
  }
  return out;
}

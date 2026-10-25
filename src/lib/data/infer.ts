import { NUMBER_RE } from "./parse";
import type { ColumnProfile, Dataset } from "./types";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

export function isNumeric(v: string): boolean {
  return NUMBER_RE.test(v) && Number.isFinite(Number(v));
}

export function isIsoDate(v: string): boolean {
  if (!ISO_DATE_RE.test(v)) return false;
  const [y = 0, m = 0, d = 0] = v.slice(0, 10).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function columnValues(ds: Dataset, index: number): (string | null)[] {
  return ds.rows.map((r) => r[index] ?? null);
}

export function profileColumn(
  name: string,
  index: number,
  values: (string | null)[],
): ColumnProfile {
  const present = values.filter((v): v is string => v !== null);
  const total = values.length;
  const missing = total - present.length;
  const distinct = new Set(present).size;
  const base = {
    name,
    index,
    total,
    missing,
    missingPct: total === 0 ? 0 : (missing / total) * 100,
    nonMissing: present.length,
    distinct,
  };

  if (present.length === 0) {
    return { ...base, type: "empty", reason: "Every value in this column is missing." };
  }

  const numericCount = present.filter(isNumeric).length;
  if (numericCount === present.length) {
    return {
      ...base,
      type: "numeric",
      reason: `All ${present.length} non-missing values are numbers.`,
    };
  }

  const dateCount = present.filter(isIsoDate).length;
  if (dateCount === present.length) {
    return {
      ...base,
      type: "date",
      reason: `All ${present.length} non-missing values are valid ISO dates (YYYY-MM-DD).`,
    };
  }

  const mixedNote =
    numericCount > 0
      ? ` ${numericCount} of ${present.length} values are numbers, but ${present.length - numericCount} are not (e.g. "${present.find((v) => !isNumeric(v))}"), so it is not treated as numeric.`
      : "";

  const ratio = distinct / present.length;
  if (distinct <= 20 || ratio <= 0.5) {
    return {
      ...base,
      type: "categorical",
      reason: `${distinct} distinct value(s) across ${present.length} entries — few enough to treat as categories.${mixedNote}`,
    };
  }
  return {
    ...base,
    type: "text",
    reason: `${distinct} distinct values across ${present.length} entries — mostly unique, so treated as free text.${mixedNote}`,
  };
}

export function profileDataset(ds: Dataset): ColumnProfile[] {
  return ds.columns.map((c, i) => profileColumn(c, i, columnValues(ds, i)));
}

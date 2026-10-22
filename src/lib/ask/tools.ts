/**
 * Analysis tools the AI assistant can request. Tool *specs* are shared with the server
 * (so the model knows what exists); tool *execution* happens only in the browser,
 * against the local dataset, using the deterministic stats modules.
 */
import { columnValues, isNumeric, profileDataset } from "../data/infer";
import type { Cell, Dataset } from "../data/types";
import { describe, frequencies } from "../stats/descriptive";
import {
  aggregate,
  correlation,
  crosstab,
  linearRegression,
  oneWayAnova,
  outliersIQR,
  pairs,
  percentiles,
  welchTTest,
  type Agg,
} from "../stats/advanced";

type JSONSchema = Record<string, unknown>;
const str = { type: "string" } as const;
const nullable = (s: JSONSchema): JSONSchema => ({ ...s, type: [s["type"] as string, "null"] });
const FILTER: JSONSchema = {
  type: ["array", "null"],
  description: "Optional row filters, all combined with AND. Use null for no filter.",
  items: {
    type: "object",
    additionalProperties: false,
    required: ["column", "op", "value"],
    properties: {
      column: str,
      op: {
        type: "string",
        enum: ["eq", "neq", "gt", "gte", "lt", "lte", "contains", "is_missing", "not_missing"],
      },
      value: {
        type: ["string", "null"],
        description: "Comparison value; null for is_missing/not_missing.",
      },
    },
  },
};
const obj = (properties: Record<string, JSONSchema>): JSONSchema => ({
  type: "object",
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});

export const TOOL_SPECS = {
  count_rows: { description: "Count rows matching filters.", schema: obj({ filter: FILTER }) },
  describe_columns: {
    description:
      "Descriptive statistics (n, missing, mean, median, min, max, sample SD) for numeric columns, and type/missing info for all.",
    schema: obj({
      columns: {
        type: ["array", "null"],
        items: str,
        description: "Column names, or null for all.",
      },
      filter: FILTER,
    }),
  },
  frequency: {
    description: "Frequency table (counts and % of non-missing) for one column.",
    schema: obj({
      column: str,
      limit: { type: ["integer", "null"], description: "Max categories (default 20)." },
      filter: FILTER,
    }),
  },
  percentiles: {
    description: "Quantiles of a numeric column (type-7 linear interpolation).",
    schema: obj({
      column: str,
      percentiles: {
        type: ["array", "null"],
        items: { type: "number" },
        description: "Values in 0–1; null for 0, .05, .25, .5, .75, .95, 1.",
      },
      filter: FILTER,
    }),
  },
  group_aggregate: {
    description:
      "Group rows by a column and aggregate a numeric column (count, mean, median, sum, min, max, sd).",
    schema: obj({
      group_by: str,
      value_column: nullable(str),
      agg: { type: "string", enum: ["count", "mean", "median", "sum", "min", "max", "sd"] },
      filter: FILTER,
    }),
  },
  correlation: {
    description:
      "Pearson or Spearman correlation between two numeric columns with two-sided p-value (pairwise complete).",
    schema: obj({
      x: str,
      y: str,
      method: { type: "string", enum: ["pearson", "spearman"] },
      filter: FILTER,
    }),
  },
  correlation_matrix: {
    description: "Pairwise correlation matrix across numeric columns.",
    schema: obj({
      columns: { type: ["array", "null"], items: str },
      method: { type: "string", enum: ["pearson", "spearman"] },
    }),
  },
  linear_regression: {
    description: "Simple OLS regression y = intercept + slope·x with R² and slope p-value.",
    schema: obj({ x: str, y: str, filter: FILTER }),
  },
  compare_groups: {
    description:
      "Compare a numeric column across groups of a categorical column. 2 groups → Welch's t-test; 3+ → one-way ANOVA.",
    schema: obj({
      value_column: str,
      group_column: str,
      groups: {
        type: ["array", "null"],
        items: str,
        description: "Restrict to these group values, or null for all.",
      },
      filter: FILTER,
    }),
  },
  crosstab: {
    description:
      "Contingency table of two categorical columns with chi-square test and Cramér's V.",
    schema: obj({ row: str, column: str, filter: FILTER }),
  },
  outliers: {
    description: "Tukey IQR outlier detection (1.5×IQR fences) for a numeric column.",
    schema: obj({ column: str, filter: FILTER }),
  },
  get_rows: {
    description: "Return up to 20 matching rows (raw values) to inspect specific records.",
    schema: obj({
      columns: { type: ["array", "null"], items: str },
      filter: FILTER,
      limit: { type: ["integer", "null"] },
    }),
  },
} as const satisfies Record<string, { description: string; schema: JSONSchema }>;

export type ToolName = keyof typeof TOOL_SPECS;
export const TOOL_NAMES = Object.keys(TOOL_SPECS) as ToolName[];

interface Filter {
  column: string;
  op: string;
  value: string | null;
}

class ToolError extends Error {}

function col(ds: Dataset, name: unknown): number {
  if (typeof name !== "string") throw new ToolError("A column name is required.");
  let i = ds.columns.indexOf(name);
  if (i < 0) i = ds.columns.findIndex((c) => c.toLowerCase() === name.toLowerCase());
  if (i < 0) throw new ToolError(`Unknown column "${name}". Available: ${ds.columns.join(", ")}.`);
  return i;
}

function rowsMatching(ds: Dataset, filter: unknown): Cell[][] {
  if (!Array.isArray(filter) || filter.length === 0) return ds.rows;
  const fs = (filter as Filter[]).map((f) => ({ ...f, i: col(ds, f.column) }));
  return ds.rows.filter((r) =>
    fs.every((f) => {
      const v = r[f.i] ?? null;
      if (f.op === "is_missing") return v === null;
      if (f.op === "not_missing") return v !== null;
      if (v === null || f.value === null) return false;
      const both = isNumeric(v) && isNumeric(f.value);
      const a = both ? Number(v) : v.toLowerCase();
      const b = both ? Number(f.value) : f.value.toLowerCase();
      switch (f.op) {
        case "eq":
          return a === b;
        case "neq":
          return a !== b;
        case "gt":
          return a > b;
        case "gte":
          return a >= b;
        case "lt":
          return a < b;
        case "lte":
          return a <= b;
        case "contains":
          return String(v).toLowerCase().includes(String(f.value).toLowerCase());
        default:
          throw new ToolError(`Unknown filter operator "${f.op}".`);
      }
    }),
  );
}

function nums(rows: Cell[][], i: number): (number | null)[] {
  return rows.map((r) => {
    const v = r[i] ?? null;
    return v !== null && isNumeric(v) ? Number(v) : null;
  });
}
const present = (xs: (number | null)[]) => xs.filter((x): x is number => x !== null);

function requireNumeric(ds: Dataset, i: number) {
  const p = profileDataset(ds)[i]!;
  if (p.type !== "numeric")
    throw new ToolError(`"${p.name}" is ${p.type}, not numeric. ${p.reason}`);
}

const round = (x: number | null, d = 6) =>
  x === null || !Number.isFinite(x) ? null : Number(x.toPrecision(d + 4));

export function runTool(ds: Dataset, name: string, input: Record<string, unknown>): unknown {
  try {
    return execute(ds, name, input);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Tool failed." };
  }
}

function execute(ds: Dataset, name: string, a: Record<string, unknown>): unknown {
  const rows = rowsMatching(ds, a["filter"]);
  const base = { rows_considered: rows.length, filter: a["filter"] ?? null };
  switch (name as ToolName) {
    case "count_rows":
      return { ...base, count: rows.length, total_rows: ds.rows.length };
    case "describe_columns": {
      const sub = { ...ds, rows };
      const profiles = profileDataset(sub);
      const wanted = Array.isArray(a["columns"])
        ? (a["columns"] as string[]).map((c) => col(ds, c))
        : profiles.map((p) => p.index);
      return {
        ...base,
        columns: wanted.map((i) => {
          const p = profiles[i]!;
          const out: Record<string, unknown> = {
            column: p.name,
            type: p.type,
            missing: p.missing,
            missing_pct: round(p.missingPct, 3),
            distinct: p.distinct,
          };
          if (p.type === "numeric") {
            const s = describe(present(nums(rows, i)));
            Object.assign(out, {
              n: s.n,
              mean: round(s.mean),
              median: round(s.median),
              min: s.min,
              max: s.max,
              sd_sample: round(s.sd),
            });
          }
          return out;
        }),
      };
    }
    case "frequency": {
      const i = col(ds, a["column"]);
      const f = frequencies(rows.map((r) => r[i] ?? null));
      const limit = typeof a["limit"] === "number" ? Math.min(100, a["limit"]) : 20;
      return {
        ...base,
        column: ds.columns[i],
        n_non_missing: f.n,
        missing: f.missing,
        categories: f.rows.length,
        top: f.rows
          .slice(0, limit)
          .map((r) => ({ value: r.value, count: r.count, pct: round(r.pct, 4) })),
      };
    }
    case "percentiles": {
      const i = col(ds, a["column"]);
      requireNumeric(ds, i);
      const ps = Array.isArray(a["percentiles"])
        ? (a["percentiles"] as number[])
        : [0, 0.05, 0.25, 0.5, 0.75, 0.95, 1];
      const v = present(nums(rows, i));
      return {
        ...base,
        column: ds.columns[i],
        n: v.length,
        method: "type 7 linear interpolation",
        percentiles: percentiles(v, ps).map((x) => ({ p: x.p, value: round(x.value) })),
      };
    }
    case "group_aggregate": {
      const g = col(ds, a["group_by"]);
      const agg = (a["agg"] as Agg) ?? "count";
      const vi = a["value_column"] ? col(ds, a["value_column"]) : null;
      if (vi === null && agg !== "count")
        throw new ToolError("value_column is required unless agg is count.");
      if (vi !== null) requireNumeric(ds, vi);
      const groups = new Map<string, number[]>();
      let missingGroup = 0;
      for (const r of rows) {
        const k = r[g] ?? null;
        if (k === null) {
          missingGroup++;
          continue;
        }
        const arr = groups.get(k) ?? [];
        if (vi === null) arr.push(1);
        else {
          const v = r[vi] ?? null;
          if (v !== null && isNumeric(v)) arr.push(Number(v));
        }
        groups.set(k, arr);
      }
      const out = [...groups.entries()]
        .map(([k, v]) => ({ group: k, n: v.length, value: round(aggregate(v, agg)) }))
        .sort((x, y) => (y.value ?? -Infinity) - (x.value ?? -Infinity));
      return {
        ...base,
        group_by: ds.columns[g],
        value_column: vi === null ? null : ds.columns[vi],
        agg,
        rows_with_missing_group: missingGroup,
        groups: out.slice(0, 50),
        total_groups: out.length,
      };
    }
    case "correlation": {
      const x = col(ds, a["x"]),
        y = col(ds, a["y"]);
      requireNumeric(ds, x);
      requireNumeric(ds, y);
      const [px, py] = pairs(nums(rows, x), nums(rows, y));
      const r = correlation(px, py, (a["method"] as "pearson" | "spearman") ?? "pearson");
      return {
        ...base,
        x: ds.columns[x],
        y: ds.columns[y],
        ...r,
        r: round(r.r),
        pValue: round(r.pValue),
      };
    }
    case "correlation_matrix": {
      const profiles = profileDataset(ds);
      const idx = Array.isArray(a["columns"])
        ? (a["columns"] as string[]).map((c) => col(ds, c))
        : profiles.filter((p) => p.type === "numeric").map((p) => p.index);
      idx.forEach((i) => requireNumeric(ds, i));
      const method = (a["method"] as "pearson" | "spearman") ?? "pearson";
      const out: { x: string; y: string; n: number; r: number | null; pValue: number | null }[] =
        [];
      for (let i = 0; i < idx.length; i++)
        for (let j = i + 1; j < idx.length; j++) {
          const [px, py] = pairs(nums(rows, idx[i]!), nums(rows, idx[j]!));
          const r = correlation(px, py, method);
          out.push({
            x: ds.columns[idx[i]!]!,
            y: ds.columns[idx[j]!]!,
            n: r.n,
            r: round(r.r),
            pValue: round(r.pValue),
          });
        }
      return { ...base, method, pairs: out };
    }
    case "linear_regression": {
      const x = col(ds, a["x"]),
        y = col(ds, a["y"]);
      requireNumeric(ds, x);
      requireNumeric(ds, y);
      const [px, py] = pairs(nums(rows, x), nums(rows, y));
      const r = linearRegression(px, py);
      return {
        ...base,
        x: ds.columns[x],
        y: ds.columns[y],
        n: r.n,
        slope: round(r.slope),
        intercept: round(r.intercept),
        r_squared: round(r.rSquared),
        slope_se: round(r.slopeSE),
        slope_p: round(r.slopeP),
        note: r.note ?? null,
      };
    }
    case "compare_groups": {
      const v = col(ds, a["value_column"]),
        g = col(ds, a["group_column"]);
      requireNumeric(ds, v);
      const map = new Map<string, number[]>();
      for (const r of rows) {
        const k = r[g] ?? null,
          x = r[v] ?? null;
        if (k === null || x === null || !isNumeric(x)) continue;
        (map.get(k) ?? map.set(k, []).get(k)!).push(Number(x));
      }
      const only = Array.isArray(a["groups"]) ? (a["groups"] as string[]) : null;
      const entries = [...map.entries()].filter(
        ([k]) => !only || only.some((o) => o.toLowerCase() === k.toLowerCase()),
      );
      if (entries.length < 2) throw new ToolError("Need at least 2 groups with numeric values.");
      if (entries.length === 2) {
        const [[n1, v1], [n2, v2]] = entries as [[string, number[]], [string, number[]]];
        const r = welchTTest(v1, v2, [n1, n2]);
        return {
          ...base,
          test: "Welch two-sample t-test (two-sided)",
          value_column: ds.columns[v],
          group_column: ds.columns[g],
          groups: r.groups.map((x) => ({ ...x, mean: round(x.mean), sd: round(x.sd) })),
          difference: round(r.difference),
          t: round(r.t),
          df: round(r.df),
          pValue: round(r.pValue),
          note: r.note ?? null,
        };
      }
      const r = oneWayAnova(entries.map(([name, values]) => ({ name, values })));
      return {
        ...base,
        test: "One-way ANOVA",
        value_column: ds.columns[v],
        group_column: ds.columns[g],
        groups: r.groups.map((x) => ({ ...x, mean: round(x.mean) })),
        f: round(r.f),
        df_between: r.dfBetween,
        df_within: r.dfWithin,
        pValue: round(r.pValue),
        eta_squared: round(r.etaSquared),
        note: r.note ?? null,
      };
    }
    case "crosstab": {
      const ri = col(ds, a["row"]),
        ci = col(ds, a["column"]);
      const r = crosstab(
        rows.map((x) => x[ri] ?? null),
        rows.map((x) => x[ci] ?? null),
      );
      if (r.rows.length * r.cols.length > 400)
        throw new ToolError("Too many category combinations (over 400 cells).");
      return {
        ...base,
        row: ds.columns[ri],
        column: ds.columns[ci],
        ...r,
        chiSquare: round(r.chiSquare),
        pValue: round(r.pValue),
        cramersV: round(r.cramersV),
      };
    }
    case "outliers": {
      const i = col(ds, a["column"]);
      requireNumeric(ds, i);
      const r = outliersIQR(present(nums(rows, i)));
      return {
        ...base,
        column: ds.columns[i],
        method: "Tukey fences, 1.5×IQR",
        ...r,
        q1: round(r.q1),
        q3: round(r.q3),
        lower: round(r.lower),
        upper: round(r.upper),
      };
    }
    case "get_rows": {
      const idx = Array.isArray(a["columns"])
        ? (a["columns"] as string[]).map((c) => col(ds, c))
        : ds.columns.map((_, i) => i);
      const limit = Math.min(20, typeof a["limit"] === "number" ? a["limit"] : 10);
      return {
        ...base,
        columns: idx.map((i) => ds.columns[i]),
        rows: rows.slice(0, limit).map((r) => idx.map((i) => r[i] ?? null)),
      };
    }
    default:
      throw new ToolError(`Unknown tool "${name}".`);
  }
}

/** Dataset context sent with each question: schema + up to 20 sample rows (user-approved). */
export function datasetContext(ds: Dataset) {
  return {
    name: ds.name,
    source: ds.source,
    rows: ds.rows.length,
    columns: profileDataset(ds).map((p) => ({
      name: p.name,
      type: p.type,
      missing: p.missing,
      distinct: p.distinct,
    })),
    sample_rows: ds.rows.slice(0, 20),
  };
}

export { columnValues };

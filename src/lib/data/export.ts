import { isFormulaLike } from "./parse";
import type { DescriptiveReport } from "../stats/analysis";

/** Escape a value for CSV, neutralising spreadsheet formula injection. */
export function csvCell(v: string | number | null): string {
  if (v === null) return "";
  let s = typeof v === "number" ? (Number.isFinite(v) ? String(v) : "") : v;
  if (typeof v === "string" && isFormulaLike(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: (string | number | null)[][]): string {
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
}

export function descriptiveToCsv(r: DescriptiveReport): string {
  const rows: (string | number | null)[][] = [
    ["section", "column", "statistic_or_value", "value", "percent"],
  ];
  for (const n of r.numeric) {
    const s = n.summary;
    for (const [k, v] of [
      ["n", s.n],
      ["missing", s.missing],
      ["mean", s.mean],
      ["median", s.median],
      ["min", s.min],
      ["max", s.max],
      ["sd_sample", s.sd],
    ] as const) {
      rows.push(["numeric", n.column, k, v, null]);
    }
  }
  for (const c of r.categorical) {
    for (const f of c.rows)
      rows.push(["frequency", c.column, f.value, f.count, Number(f.pct.toFixed(4))]);
    if (c.missing) rows.push(["frequency", c.column, "(missing)", c.missing, null]);
  }
  return toCsv(rows);
}

export function downloadText(filename: string, text: string, mime = "text/csv;charset=utf-8") {
  const blob = new Blob(["\uFEFF" + text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

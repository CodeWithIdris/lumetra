/** A single cell after parsing. `null` means missing — never coerced to zero. */
export type Cell = string | null;

export type ColumnType = "numeric" | "categorical" | "date" | "text" | "empty";

export interface Dataset {
  id: string;
  name: string;
  source: "upload" | "sample";
  columns: string[];
  rows: Cell[][];
  sizeBytes: number;
  warnings: string[];
}

export interface ColumnProfile {
  name: string;
  index: number;
  type: ColumnType;
  /** Plain-language explanation of why the type was inferred. */
  reason: string;
  total: number;
  missing: number;
  missingPct: number;
  nonMissing: number;
  distinct: number;
}

export type ParseResult = { ok: true; dataset: Dataset } | { ok: false; errors: string[] };

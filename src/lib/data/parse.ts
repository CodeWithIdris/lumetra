import Papa from "papaparse";
import type { Cell, ParseResult } from "./types";

export const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20 MB
export const MAX_ROWS = 200_000;

/** Tokens treated as missing (case-sensitive, after trimming). Blank cells are always missing. */
export const MISSING_TOKENS = new Set(["", "NA", "N/A", "n/a", "NULL", "null", "NaN", "#N/A"]);

const NUMBER_RE = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;

/** A value that a spreadsheet could execute as a formula when re-opened. */
export function isFormulaLike(value: string): boolean {
  if (!/^[=+\-@\t\r]/.test(value)) return false;
  return !NUMBER_RE.test(value.trim());
}

export function normaliseCell(raw: unknown): Cell {
  if (raw === undefined || raw === null) return null;
  const v = String(raw).trim();
  return MISSING_TOKENS.has(v) ? null : v;
}

function makeId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export interface ParseCsvOptions {
  delimiter?: string;
  hasHeader?: boolean;
  encodingWarning?: string;
}

/** Parse CSV text into a Dataset. Pure: no I/O, never executes content. */
export function parseCsvText(
  text: string,
  name: string,
  source: "upload" | "sample" = "upload",
  options?: ParseCsvOptions,
): ParseResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const sizeBytes = new Blob([text]).size;

  if (sizeBytes > MAX_FILE_BYTES) {
    return { ok: false, errors: [`The file is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB.`] };
  }
  const body = text.replace(/^\uFEFF/, "");
  if (body.trim().length === 0) return { ok: false, errors: ["The file is empty."] };
  if (body.includes("\u0000")) {
    return { ok: false, errors: ["The file contains binary data. Is it really a CSV text file?"] };
  }
  if (options?.encodingWarning) {
    warnings.push(options.encodingWarning);
  }
  if (body.includes("\uFFFD")) {
    warnings.push(
      "Some characters could not be read as UTF-8 and were replaced with '�'. Re-save the file as UTF-8 for accurate text.",
    );
  }

  const papaOptions: Papa.ParseConfig = {
    skipEmptyLines: "greedy",
    header: false,
  };
  if (options?.delimiter) {
    papaOptions.delimiter = options.delimiter;
  }

  const parsed = Papa.parse<string[]>(body, papaOptions);
  const data = parsed.data;
  if (data.length === 0) return { ok: false, errors: ["No rows were found in the file."] };

  const detectedDelimiter = parsed.meta.delimiter || options?.delimiter || ",";

  let columns: string[];
  let bodyRows: string[][];

  if (options?.hasHeader === false) {
    const colCount = Math.max(...data.map((r) => r.length), 1);
    columns = Array.from({ length: colCount }, (_, i) => `Column ${i + 1}`);
    bodyRows = data;
  } else {
    const header = data[0]!.map((h) => String(h ?? "").trim());
    if (header.length < 1 || header.every((h) => h === "")) {
      return { ok: false, errors: ["The first row must contain column names."] };
    }

    // Fill blank and duplicate column names deterministically.
    const seen = new Map<string, number>();
    columns = header.map((h, i) => {
      let base = h === "" ? `Column ${i + 1}` : h;
      if (h === "") warnings.push(`Column ${i + 1} had no name and was called "${base}".`);
      const count = seen.get(base) ?? 0;
      seen.set(base, count + 1);
      if (count > 0) {
        const renamed = `${base} (${count + 1})`;
        warnings.push(`Duplicate column name "${base}" was renamed to "${renamed}".`);
        base = renamed;
      }
      return base;
    });

    bodyRows = data.slice(1);
    if (bodyRows.length === 0)
      return { ok: false, errors: ["The file has column names but no data rows."] };
  }
  if (bodyRows.length > MAX_ROWS) {
    return {
      ok: false,
      errors: [
        `The file has more than ${MAX_ROWS.toLocaleString()} rows, which is not yet supported.`,
      ],
    };
  }

  let malformed = 0;
  const firstMalformed: number[] = [];
  let formulaCells = 0;
  const rows: Cell[][] = bodyRows.map((r, idx) => {
    if (r.length !== columns.length) {
      malformed++;
      if (firstMalformed.length < 5) firstMalformed.push(idx + 2);
    }
    const out: Cell[] = [];
    for (let c = 0; c < columns.length; c++) {
      const cell = normaliseCell(r[c]);
      if (cell !== null && isFormulaLike(cell)) formulaCells++;
      out.push(cell);
    }
    return out;
  });

  const seenRows = new Set<string>();
  let duplicates = 0;
  for (const r of rows) {
    const key = JSON.stringify(r);
    if (seenRows.has(key)) duplicates++;
    else seenRows.add(key);
  }
  if (duplicates > 0) {
    warnings.push(
      `${duplicates} row(s) are exact duplicates of an earlier row. They are kept and counted; remove them before importing if they are errors.`,
    );
  }

  if (malformed > 0) {
    warnings.push(
      `${malformed} row(s) had a different number of fields than the header (e.g. line ${firstMalformed.join(", ")}). Missing fields were treated as missing values; extra fields were ignored.`,
    );
  }
  if (formulaCells > 0) {
    warnings.push(
      `${formulaCells} cell(s) start with =, +, - or @ and could be interpreted as spreadsheet formulas. They are shown as plain text and escaped on export.`,
    );
  }
  for (const e of parsed.errors.slice(0, 3)) {
    if (e.type === "Quotes")
      warnings.push(
        `Unbalanced quotes near data row ${(e.row ?? 0) + 1}. Everything after it may have been merged into one cell — check the file.`,
      );
  }

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    dataset: {
      id: makeId(),
      name,
      source,
      columns,
      rows,
      sizeBytes,
      warnings,
      delimiter: detectedDelimiter,
    },
  };
}

async function readFileText(file: File): Promise<string> {
  if (typeof file.text === "function") {
    try {
      return await file.text();
    } catch {
      // fallback to FileReader
    }
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string) || "");
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

async function readFileBuffer(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === "function") {
    try {
      return await file.arrayBuffer();
    } catch {
      // fallback to FileReader
    }
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as ArrayBuffer) || new ArrayBuffer(0));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

export async function parseCsvFile(
  file: File,
  options?: ParseCsvOptions,
): Promise<{ result: ParseResult; text: string }> {
  const fail = (msg: string) => ({ result: { ok: false as const, errors: [msg] }, text: "" });
  if (file.size === 0) return fail(`"${file.name}" is empty.`);
  if (file.size > MAX_FILE_BYTES) {
    return fail(
      `"${file.name}" is ${(file.size / 1024 / 1024).toFixed(1)} MB; the limit is 20 MB.`,
    );
  }
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
    return fail(
      "Excel files are not supported yet. Save the sheet as CSV (UTF-8) and upload that instead.",
    );
  }
  if (!lower.endsWith(".csv") && !lower.endsWith(".txt") && file.type !== "text/csv") {
    return fail(
      `"${file.name}" does not look like a CSV file. Only .csv and .txt files are accepted.`,
    );
  }
  let text = "";
  let encodingWarning: string | undefined;
  try {
    try {
      const buffer = await readFileBuffer(file);
      try {
        const utf8Decoder = new TextDecoder("utf-8", { fatal: true });
        text = utf8Decoder.decode(buffer);
      } catch {
        try {
          const winDecoder = new TextDecoder("windows-1252", { fatal: true });
          text = winDecoder.decode(buffer);
          encodingWarning =
            "Detected non-UTF8 encoding (Windows-1252). Successfully converted for analysis.";
        } catch {
          text = new TextDecoder("utf-8").decode(buffer);
          encodingWarning =
            "File contained non-standard byte sequences and was decoded with UTF-8 character replacement.";
        }
      }
    } catch {
      text = await readFileText(file);
    }
  } catch {
    return fail(`"${file.name}" could not be read.`);
  }
  try {
    const effectiveOptions: ParseCsvOptions = {
      ...options,
      encodingWarning: options?.encodingWarning ?? encodingWarning,
    };
    return { result: parseCsvText(text, file.name, "upload", effectiveOptions), text };
  } catch (e) {
    return fail(
      `The file could not be parsed: ${e instanceof Error ? e.message : "unknown error"}.`,
    );
  }
}

export { NUMBER_RE };

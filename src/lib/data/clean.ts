import type { Cell, ColumnProfile, ColumnType, Dataset } from "./types";
import { profileDataset, columnValues, isNumeric, isIsoDate } from "./infer";
import { describe, median } from "../stats/descriptive";

export type CleaningStepType =
  | "rename_column"
  | "change_type"
  | "remove_columns"
  | "filter_rows"
  | "remove_duplicates"
  | "handle_missing"
  | "recode_categorical";

export interface CleaningStep {
  id: string;
  timestamp: string;
  type: CleaningStepType;
  params: Record<string, unknown>;
  description: string;
  effect: {
    rowsBefore: number;
    rowsAfter: number;
    missingBefore: number;
    missingAfter: number;
  };
}

export interface DataAudit {
  rowCount: number;
  columnCount: number;
  totalCells: number;
  missingCells: number;
  missingPct: number;
  duplicateRowsCount: number;
  inconsistentValuesCount: number;
  profiles: ColumnProfile[];
}

export function countMissingCells(dataset: Dataset): number {
  let missing = 0;
  for (const row of dataset.rows) {
    for (const cell of row) {
      if (cell === null) missing++;
    }
  }
  return missing;
}

export function countDuplicateRows(dataset: Dataset): number {
  const seen = new Set<string>();
  let duplicates = 0;
  for (const row of dataset.rows) {
    const key = JSON.stringify(row);
    if (seen.has(key)) duplicates++;
    else seen.add(key);
  }
  return duplicates;
}

export function countInconsistentValues(dataset: Dataset, profiles: ColumnProfile[]): number {
  let count = 0;
  for (const p of profiles) {
    if (p.type === "numeric") {
      const values = columnValues(dataset, p.index);
      for (const v of values) {
        if (v !== null && !isNumeric(v)) count++;
      }
    }
  }
  return count;
}

export function auditDataset(dataset: Dataset): DataAudit {
  const profiles = profileDataset(dataset);
  const rowCount = dataset.rows.length;
  const columnCount = dataset.columns.length;
  const totalCells = rowCount * columnCount;
  const missingCells = countMissingCells(dataset);
  const missingPct = totalCells === 0 ? 0 : (missingCells / totalCells) * 100;
  const duplicateRowsCount = countDuplicateRows(dataset);
  const inconsistentValuesCount = countInconsistentValues(dataset, profiles);

  return {
    rowCount,
    columnCount,
    totalCells,
    missingCells,
    missingPct,
    duplicateRowsCount,
    inconsistentValuesCount,
    profiles,
  };
}

function cloneDataset(ds: Dataset): Dataset {
  return {
    ...ds,
    columns: [...ds.columns],
    rows: ds.rows.map((r) => [...r]),
    warnings: [...ds.warnings],
    typeOverrides: ds.typeOverrides ? { ...ds.typeOverrides } : undefined,
  };
}

export function renameColumn(dataset: Dataset, oldName: string, newName: string): Dataset {
  const trimmed = newName.trim();
  if (!trimmed || trimmed === oldName) return dataset;
  const idx = dataset.columns.indexOf(oldName);
  if (idx === -1) return dataset;

  const nextCols = [...dataset.columns];
  // Ensure uniqueness
  let finalName = trimmed;
  let counter = 2;
  while (nextCols.some((c, i) => i !== idx && c.toLowerCase() === finalName.toLowerCase())) {
    finalName = `${trimmed} (${counter++})`;
  }
  nextCols[idx] = finalName;

  return {
    ...dataset,
    columns: nextCols,
    rows: dataset.rows.map((r) => [...r]),
  };
}

export function removeColumns(dataset: Dataset, columnsToRemove: string[]): Dataset {
  const toRemoveSet = new Set(columnsToRemove);
  const keepIndices: number[] = [];
  const nextCols: string[] = [];

  dataset.columns.forEach((col, idx) => {
    if (!toRemoveSet.has(col)) {
      keepIndices.push(idx);
      nextCols.push(col);
    }
  });

  if (nextCols.length === 0) {
    throw new Error("Cannot remove all columns from the dataset.");
  }

  const nextRows = dataset.rows.map((row) => keepIndices.map((i) => row[i] ?? null));

  return {
    ...dataset,
    columns: nextCols,
    rows: nextRows,
  };
}

export function removeDuplicateRows(dataset: Dataset): Dataset {
  const seen = new Set<string>();
  const nextRows: Cell[][] = [];

  for (const row of dataset.rows) {
    const key = JSON.stringify(row);
    if (!seen.has(key)) {
      seen.add(key);
      nextRows.push([...row]);
    }
  }

  return {
    ...dataset,
    rows: nextRows,
  };
}

export type FilterOperator =
  | "equals"
  | "not_equals"
  | "greater_than"
  | "less_than"
  | "greater_or_equal"
  | "less_or_equal"
  | "contains"
  | "not_contains"
  | "is_null"
  | "not_null";

export function filterRows(
  dataset: Dataset,
  column: string,
  operator: FilterOperator,
  targetValue?: string,
): Dataset {
  const colIdx = dataset.columns.indexOf(column);
  if (colIdx === -1) return dataset;

  const target = targetValue !== undefined ? targetValue.trim() : "";
  const numTarget = Number(target);
  const isTargetNumeric = target !== "" && Number.isFinite(numTarget);

  const nextRows = dataset.rows.filter((row) => {
    const cell = row[colIdx] ?? null;

    switch (operator) {
      case "is_null":
        return cell === null;
      case "not_null":
        return cell !== null;
      case "equals":
        if (cell === null) return false;
        if (isTargetNumeric && isNumeric(cell)) {
          return Number(cell) === numTarget;
        }
        return cell.toLowerCase() === target.toLowerCase();
      case "not_equals":
        if (cell === null) return true;
        if (isTargetNumeric && isNumeric(cell)) {
          return Number(cell) !== numTarget;
        }
        return cell.toLowerCase() !== target.toLowerCase();
      case "contains":
        return cell !== null && cell.toLowerCase().includes(target.toLowerCase());
      case "not_contains":
        return cell === null || !cell.toLowerCase().includes(target.toLowerCase());
      case "greater_than":
        return cell !== null && isNumeric(cell) && isTargetNumeric && Number(cell) > numTarget;
      case "less_than":
        return cell !== null && isNumeric(cell) && isTargetNumeric && Number(cell) < numTarget;
      case "greater_or_equal":
        return cell !== null && isNumeric(cell) && isTargetNumeric && Number(cell) >= numTarget;
      case "less_or_equal":
        return cell !== null && isNumeric(cell) && isTargetNumeric && Number(cell) <= numTarget;
      default:
        return true;
    }
  });

  return {
    ...dataset,
    rows: nextRows.map((r) => [...r]),
  };
}

export type MissingStrategy =
  | "drop_rows"
  | "fill_mean"
  | "fill_median"
  | "fill_mode"
  | "fill_custom";

export function handleMissingValues(
  dataset: Dataset,
  column: string, // or "all_columns"
  strategy: MissingStrategy,
  customValue?: string,
): Dataset {
  if (column === "all_columns" && strategy === "drop_rows") {
    // Drop any row containing any null cell
    const nextRows = dataset.rows.filter((row) => row.every((c) => c !== null));
    return {
      ...dataset,
      rows: nextRows.map((r) => [...r]),
    };
  }

  const colIdx = dataset.columns.indexOf(column);
  if (colIdx === -1) return dataset;

  if (strategy === "drop_rows") {
    const nextRows = dataset.rows.filter((row) => row[colIdx] !== null);
    return {
      ...dataset,
      rows: nextRows.map((r) => [...r]),
    };
  }

  const values = columnValues(dataset, colIdx);
  const presentValues = values.filter((v): v is string => v !== null);

  let replacement: string | null = null;

  if (strategy === "fill_custom") {
    replacement = customValue !== undefined && customValue !== "" ? customValue.trim() : null;
  } else if (strategy === "fill_mean" || strategy === "fill_median") {
    const numbers = presentValues.filter(isNumeric).map(Number);
    if (numbers.length > 0) {
      if (strategy === "fill_mean") {
        const sum = numbers.reduce((a, b) => a + b, 0);
        replacement = (sum / numbers.length).toFixed(2);
      } else {
        const med = median([...numbers].sort((a, b) => a - b));
        replacement = med !== null ? med.toString() : null;
      }
    }
  } else if (strategy === "fill_mode") {
    const freq = new Map<string, number>();
    for (const v of presentValues) {
      freq.set(v, (freq.get(v) ?? 0) + 1);
    }
    let maxCount = -1;
    let modeVal: string | null = null;
    for (const [v, count] of freq.entries()) {
      if (count > maxCount) {
        maxCount = count;
        modeVal = v;
      }
    }
    replacement = modeVal;
  }

  if (replacement === null) return dataset;

  const nextRows = dataset.rows.map((row) => {
    const nextRow = [...row];
    if (nextRow[colIdx] === null) {
      nextRow[colIdx] = replacement;
    }
    return nextRow;
  });

  return {
    ...dataset,
    rows: nextRows,
  };
}

export function recodeCategorical(
  dataset: Dataset,
  column: string,
  fromValue: string,
  toValue: string,
): Dataset {
  const colIdx = dataset.columns.indexOf(column);
  if (colIdx === -1) return dataset;

  const from = fromValue.trim();
  const to = toValue.trim();

  const nextRows = dataset.rows.map((row) => {
    const nextRow = [...row];
    if (nextRow[colIdx] !== null && nextRow[colIdx]!.toLowerCase() === from.toLowerCase()) {
      nextRow[colIdx] = to;
    }
    return nextRow;
  });

  return {
    ...dataset,
    rows: nextRows,
  };
}

export function changeColumnType(
  dataset: Dataset,
  column: string,
  targetType: ColumnType,
): Dataset {
  const colIdx = dataset.columns.indexOf(column);
  if (colIdx === -1) return dataset;

  const nextRows = dataset.rows.map((row) => {
    const nextRow = [...row];
    const cell = nextRow[colIdx];
    if (cell === null) return nextRow;

    if (targetType === "numeric") {
      const cleaned = cell.replace(/[$,\s]/g, "");
      if (isNumeric(cleaned)) {
        nextRow[colIdx] = cleaned;
      } else {
        nextRow[colIdx] = null;
      }
    } else if (targetType === "date") {
      if (isIsoDate(cell)) {
        nextRow[colIdx] = cell.slice(0, 10);
      } else {
        const parsedTime = Date.parse(cell);
        if (!isNaN(parsedTime)) {
          nextRow[colIdx] = new Date(parsedTime).toISOString().slice(0, 10);
        } else {
          nextRow[colIdx] = null;
        }
      }
    } else {
      nextRow[colIdx] = String(cell);
    }
    return nextRow;
  });

  const nextOverrides = {
    ...(dataset.typeOverrides ?? {}),
    [column]: targetType,
  };

  return {
    ...dataset,
    rows: nextRows,
    typeOverrides: nextOverrides,
  };
}

export function executeCleaningStep(
  dataset: Dataset,
  type: CleaningStepType,
  params: Record<string, unknown>,
): { dataset: Dataset; description: string } {
  let nextDs = cloneDataset(dataset);
  let description = "";

  switch (type) {
    case "rename_column": {
      const from = String(params["from"] ?? "");
      const to = String(params["to"] ?? "");
      nextDs = renameColumn(nextDs, from, to);
      description = `Renamed column "${from}" to "${to}"`;
      break;
    }
    case "remove_columns": {
      const cols = (params["columns"] as string[]) ?? [];
      nextDs = removeColumns(nextDs, cols);
      description = `Removed ${cols.length} column(s): ${cols.join(", ")}`;
      break;
    }
    case "remove_duplicates": {
      nextDs = removeDuplicateRows(nextDs);
      description = "Removed exact duplicate rows";
      break;
    }
    case "filter_rows": {
      const col = String(params["column"] ?? "");
      const op = params["operator"] as FilterOperator;
      const val = params["value"] !== undefined ? String(params["value"]) : undefined;
      nextDs = filterRows(nextDs, col, op, val);
      description = `Filtered rows where "${col}" ${op}${val ? ` "${val}"` : ""}`;
      break;
    }
    case "handle_missing": {
      const col = String(params["column"] ?? "");
      const strategy = params["strategy"] as MissingStrategy;
      const customVal = params["customValue"] !== undefined ? String(params["customValue"]) : undefined;
      nextDs = handleMissingValues(nextDs, col, strategy, customVal);
      description = `Missing value handling on "${col}": ${strategy}${customVal ? ` ("${customVal}")` : ""}`;
      break;
    }
    case "recode_categorical": {
      const col = String(params["column"] ?? "");
      const fromVal = String(params["fromValue"] ?? "");
      const toVal = String(params["toValue"] ?? "");
      nextDs = recodeCategorical(nextDs, col, fromVal, toVal);
      description = `Recoded "${fromVal}" to "${toVal}" in column "${col}"`;
      break;
    }
    case "change_type": {
      const col = String(params["column"] ?? "");
      const targetType = params["targetType"] as ColumnType;
      if (col && targetType) {
        nextDs = changeColumnType(nextDs, col, targetType);
        description = `Changed column "${col}" type to ${targetType}`;
      } else {
        description = `Asserted type of "${col}" as ${targetType}`;
      }
      break;
    }
    default:
      description = `Applied operation: ${type}`;
  }

  return { dataset: nextDs, description };
}

export function applyCleaningStep(
  dataset: Dataset,
  type: CleaningStepType,
  params: Record<string, unknown>,
): { dataset: Dataset; step: CleaningStep } {
  const rowsBefore = dataset.rows.length;
  const missingBefore = countMissingCells(dataset);

  const { dataset: nextDs, description } = executeCleaningStep(dataset, type, params);

  const rowsAfter = nextDs.rows.length;
  const missingAfter = countMissingCells(nextDs);

  const step: CleaningStep = {
    id: "step_" + Math.random().toString(36).slice(2, 9) + Date.now().toString(36),
    timestamp: new Date().toISOString(),
    type,
    params,
    description,
    effect: {
      rowsBefore,
      rowsAfter,
      missingBefore,
      missingAfter,
    },
  };

  return { dataset: nextDs, step };
}

export function replayCleaningSteps(
  rawDataset: Dataset,
  steps: CleaningStep[],
): { dataset: Dataset; steps: CleaningStep[] } {
  let currentDs = cloneDataset(rawDataset);
  const replayedSteps: CleaningStep[] = [];

  for (const s of steps) {
    const { dataset: nextDs, step } = applyCleaningStep(currentDs, s.type, s.params);
    currentDs = nextDs;
    // preserve original id and timestamp
    replayedSteps.push({
      ...step,
      id: s.id,
      timestamp: s.timestamp,
    });
  }

  return { dataset: currentDs, steps: replayedSteps };
}

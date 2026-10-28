import { describe, expect, it } from "vitest";
import { parseCsvText } from "@/lib/data/parse";
import {
  auditDataset,
  renameColumn,
  removeColumns,
  removeDuplicateRows,
  filterRows,
  handleMissingValues,
  recodeCategorical,
  changeColumnType,
  applyCleaningStep,
  replayCleaningSteps,
} from "@/lib/data/clean";

const SAMPLE_CSV = `name,score,group,status
Alice,85,A,Active
Bob,90,B,Active
Charlie,,A,Pending
David,75,B,Inactive
Eve,85,A,Active
Alice,85,A,Active`;

describe("Data Cleaning Operations", () => {
  it("audits dataset correctly (missing cells, duplicates, profiles)", () => {
    const parse = parseCsvText(SAMPLE_CSV, "test.csv");
    if (!parse.ok) throw new Error("parse failed");
    const audit = auditDataset(parse.dataset);

    expect(audit.rowCount).toBe(6);
    expect(audit.columnCount).toBe(4);
    expect(audit.missingCells).toBe(1); // Charlie has missing score
    expect(audit.duplicateRowsCount).toBe(1); // Second Alice row is duplicate
  });

  it("renames column without modifying original dataset", () => {
    const parse = parseCsvText(SAMPLE_CSV, "test.csv");
    if (!parse.ok) throw new Error("parse failed");

    const cleaned = renameColumn(parse.dataset, "score", "exam_score");
    expect(cleaned.columns).toEqual(["name", "exam_score", "group", "status"]);
    expect(parse.dataset.columns).toEqual(["name", "score", "group", "status"]);
  });

  it("removes selected columns", () => {
    const parse = parseCsvText(SAMPLE_CSV, "test.csv");
    if (!parse.ok) throw new Error("parse failed");

    const cleaned = removeColumns(parse.dataset, ["status", "group"]);
    expect(cleaned.columns).toEqual(["name", "score"]);
    expect(cleaned.rows[0]).toEqual(["Alice", "85"]);
  });

  it("removes duplicate rows and retains distinct entries", () => {
    const parse = parseCsvText(SAMPLE_CSV, "test.csv");
    if (!parse.ok) throw new Error("parse failed");

    const cleaned = removeDuplicateRows(parse.dataset);
    expect(cleaned.rows.length).toBe(5);
  });

  it("filters rows by numeric comparison and string equality", () => {
    const parse = parseCsvText(SAMPLE_CSV, "test.csv");
    if (!parse.ok) throw new Error("parse failed");

    const highScores = filterRows(parse.dataset, "score", "greater_than", "80");
    expect(highScores.rows.length).toBe(4); // 85, 90, 85, 85

    const activeUsers = filterRows(parse.dataset, "status", "equals", "Active");
    expect(activeUsers.rows.length).toBe(4);

    const nonNullScores = filterRows(parse.dataset, "score", "not_null");
    expect(nonNullScores.rows.length).toBe(5);
  });

  it("handles missing values: drops rows with nulls", () => {
    const parse = parseCsvText(SAMPLE_CSV, "test.csv");
    if (!parse.ok) throw new Error("parse failed");

    const dropped = handleMissingValues(parse.dataset, "score", "drop_rows");
    expect(dropped.rows.length).toBe(5);
    expect(dropped.rows.some((r) => r[0] === "Charlie")).toBe(false);
  });

  it("handles missing values: imputes with median", () => {
    const parse = parseCsvText(SAMPLE_CSV, "test.csv");
    if (!parse.ok) throw new Error("parse failed");

    // Scores are 85, 90, 75, 85, 85 -> sorted: 75, 85, 85, 85, 90 -> median is 85
    const imputed = handleMissingValues(parse.dataset, "score", "fill_median");
    const charlieRow = imputed.rows.find((r) => r[0] === "Charlie");
    expect(charlieRow?.[1]).toBe("85");
  });

  it("recodes categorical values", () => {
    const parse = parseCsvText(SAMPLE_CSV, "test.csv");
    if (!parse.ok) throw new Error("parse failed");

    const recoded = recodeCategorical(parse.dataset, "status", "Pending", "In Review");
    const charlieRow = recoded.rows.find((r) => r[0] === "Charlie");
    expect(charlieRow?.[3]).toBe("In Review");
  });

  it("changes column type explicitly and treats unparseable values as null", () => {
    const csv = `id,amount\n1,$120.50\n2,invalid\n3,300`;
    const parse = parseCsvText(csv, "data.csv");
    if (!parse.ok) throw new Error("parse failed");

    const changed = changeColumnType(parse.dataset, "amount", "numeric");
    expect(changed.rows[0]![1]).toBe("120.50");
    // Invalid becomes null, NEVER 0!
    expect(changed.rows[1]![1]).toBeNull();
    expect(changed.rows[2]![1]).toBe("300");
    expect(changed.typeOverrides?.["amount"]).toBe("numeric");
  });

  it("applies cleaning step, records effect, and replays history deterministically", () => {
    const parse = parseCsvText(SAMPLE_CSV, "test.csv");
    if (!parse.ok) throw new Error("parse failed");

    const { dataset: d1, step: s1 } = applyCleaningStep(parse.dataset, "remove_duplicates", {});
    expect(s1.effect.rowsBefore).toBe(6);
    expect(s1.effect.rowsAfter).toBe(5);

    const { dataset: d2, step: s2 } = applyCleaningStep(d1, "handle_missing", {
      column: "score",
      strategy: "drop_rows",
    });
    expect(s2.effect.rowsBefore).toBe(5);
    expect(s2.effect.rowsAfter).toBe(4);

    // Replay from raw dataset
    const replayed = replayCleaningSteps(parse.dataset, [s1, s2]);
    expect(replayed.dataset.rows.length).toBe(4);
    expect(replayed.steps.length).toBe(2);
  });
});

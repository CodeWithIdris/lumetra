import { beforeEach, describe, expect, it } from "vitest";
import {
  loadCsv,
  replaceCsv,
  storeCsv,
  MAX_STORED_CSV_BYTES,
  loadProjects,
  saveProjects,
  duplicateProject,
} from "@/lib/persistence/projects";

describe("project persistence", () => {
  beforeEach(() => localStorage.clear());
  it("stores and reloads CSV", () => {
    expect(storeCsv("p1", "a\n1")).toBe(true);
    expect(loadCsv("p1")).toBe("a\n1");
  });
  it("replacing with an oversized file removes the old data instead of leaving it stale", () => {
    storeCsv("p1", "a\n1");
    expect(replaceCsv("p1", "x".repeat(MAX_STORED_CSV_BYTES + 1))).toBe(false);
    expect(loadCsv("p1")).toBeNull();
  });
  it("ignores corrupt project metadata", () => {
    localStorage.setItem("lumetra.projects.v1", "{not json");
    expect(loadProjects()).toEqual([]);
    saveProjects([
      { id: "1", name: "n", createdAt: "x", updatedAt: "x", status: "no-data", dataset: null },
    ]);
    expect(loadProjects()).toHaveLength(1);
  });
  it("duplicates a project without sharing mutable analysis or data state", () => {
    saveProjects([
      {
        id: "orig",
        name: "Quarterly Analysis",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        status: "data-loaded",
        dataset: { name: "sales.csv", rows: 10, columns: 3, source: "upload", stored: true },
        cleaningSteps: [
          {
            id: "step1",
            timestamp: "2026-01-01T00:00:00Z",
            type: "remove_duplicates",
            params: {},
            description: "Removed duplicate rows",
            effect: { rowsBefore: 12, rowsAfter: 10, missingBefore: 0, missingAfter: 0 },
          },
        ],
      },
    ]);
    storeCsv("orig", "col1,col2\n1,2");

    const copy = duplicateProject("orig");
    expect(copy).not.toBeNull();
    expect(copy!.id).not.toBe("orig");
    expect(copy!.name).toBe("Quarterly Analysis (Copy)");
    expect(copy!.cleaningSteps).toHaveLength(1);

    // Verify CSV was cloned under the new ID
    expect(loadCsv(copy!.id)).toBe("col1,col2\n1,2");

    // Mutating copy's cleaning steps does not mutate source
    copy!.cleaningSteps!.push({
      id: "step2",
      timestamp: "2026-01-02T00:00:00Z",
      type: "remove_columns",
      params: { columns: ["col2"] },
      description: "Removed col2",
      effect: { rowsBefore: 10, rowsAfter: 10, missingBefore: 0, missingAfter: 0 },
    });
    saveProjects(loadProjects().map((p) => (p.id === copy!.id ? copy! : p)));

    const freshOriginal = loadProjects().find((p) => p.id === "orig");
    expect(freshOriginal!.cleaningSteps).toHaveLength(1);
  });
});

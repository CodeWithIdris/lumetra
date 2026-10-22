import { beforeEach, describe, expect, it } from "vitest";
import {
  loadCsv,
  replaceCsv,
  storeCsv,
  MAX_STORED_CSV_BYTES,
  loadProjects,
  saveProjects,
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
});

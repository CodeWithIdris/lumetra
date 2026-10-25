import { describe, expect, it } from "vitest";
import { parseCsvText, isFormulaLike } from "@/lib/data/parse";
import { profileColumn, profileDataset } from "@/lib/data/infer";
import {
  describe as stats,
  frequencies,
  histogram,
  median,
  toNumbers,
} from "@/lib/stats/descriptive";
import { runDescriptive } from "@/lib/stats/analysis";
import { csvCell } from "@/lib/data/export";
import { sampleCsv } from "@/lib/data/sample";

const CSV = `name,score,group,joined
a,2,x,2026-01-01
b,4,y,2026-01-02
c,4,x,
d,4,,2026-01-04
e,5,x,2026-01-05
f,5,y,2026-01-06
g,7,x,2026-01-07
h,9,y,2026-01-08
i,,x,2026-01-09`;

describe("parsing", () => {
  it("parses rows and treats blanks as missing (never zero)", () => {
    const r = parseCsvText(CSV, "t.csv");
    if (!r.ok) throw new Error("parse failed");
    expect(r.dataset.columns).toEqual(["name", "score", "group", "joined"]);
    expect(r.dataset.rows.length).toBe(9);
    expect(r.dataset.rows[8]![1]).toBeNull();
  });
  it("rejects empty files and header-only files", () => {
    expect(parseCsvText("", "e.csv").ok).toBe(false);
    expect(parseCsvText("a,b\n", "h.csv").ok).toBe(false);
  });
  it("renames duplicate and blank headers", () => {
    const r = parseCsvText("a,a,\n1,2,3", "d.csv");
    if (!r.ok) throw new Error();
    expect(r.dataset.columns).toEqual(["a", "a (2)", "Column 3"]);
  });
  it("warns about malformed rows and pads with missing", () => {
    const r = parseCsvText("a,b,c\n1,2\n1,2,3", "m.csv");
    if (!r.ok) throw new Error();
    expect(r.dataset.rows[0]![2]).toBeNull();
    expect(r.dataset.warnings.some((w) => w.includes("1 row(s)"))).toBe(true);
  });
  it("flags formula-like cells but not negative numbers", () => {
    expect(isFormulaLike("=SUM(A1)")).toBe(true);
    expect(isFormulaLike("@cmd")).toBe(true);
    expect(isFormulaLike("-3.5")).toBe(false);
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
  });
  it("treats NA tokens as missing", () => {
    const r = parseCsvText("x\nNA\n1\nN/A", "n.csv");
    if (!r.ok) throw new Error();
    expect(r.dataset.rows.map((x) => x[0])).toEqual([null, "1", null]);
  });
});

describe("type inference", () => {
  it("classifies numeric, categorical, date and text", () => {
    const r = parseCsvText(CSV, "t.csv");
    if (!r.ok) throw new Error();
    const types = profileDataset(r.dataset).map((p) => p.type);
    expect(types).toEqual(["categorical", "numeric", "categorical", "date"]);
  });
  it("does not treat mixed numeric columns as numeric", () => {
    expect(profileColumn("x", 0, ["1", "2", "abc"]).type).toBe("categorical");
  });
  it("marks all-missing columns as empty with correct missing %", () => {
    const p = profileColumn("x", 0, [null, null]);
    expect(p.type).toBe("empty");
    expect(p.missingPct).toBe(100);
  });
  it("rejects invalid calendar dates", () => {
    expect(profileColumn("d", 0, ["2026-02-30"]).type).not.toBe("date");
  });
});

describe("descriptive statistics", () => {
  it("matches known values for [2,4,4,4,5,5,7,9]", () => {
    const s = stats([2, 4, 4, 4, 5, 5, 7, 9]);
    expect(s.mean).toBe(5);
    expect(s.median).toBe(4.5);
    expect(s.min).toBe(2);
    expect(s.max).toBe(9);
    expect(s.sd).toBeCloseTo(Math.sqrt(32 / 7), 12); // sample SD, n-1
  });
  it("odd-length median", () => expect(median([1, 3, 10])).toBe(3));
  it("single value: SD undefined", () => expect(stats([3]).sd).toBeNull());
  it("empty input returns nulls", () => expect(stats([]).mean).toBeNull());
  it("is stable for large offsets", () => {
    const s = stats([1e9 + 4, 1e9 + 7, 1e9 + 13, 1e9 + 16]);
    expect(s.sd).toBeCloseTo(Math.sqrt(30), 6);
  });
  it("excludes missing from numeric conversion", () => {
    expect(toNumbers(["1", null, "3"])).toEqual({ nums: [1, 3], missing: 1, invalid: 0 });
  });
  it("keeps blanks missing and separately counts invalid or non-finite numeric values", () => {
    expect(toNumbers(["1", null, " ", "abc", "1e999"])).toEqual({
      nums: [1],
      missing: 2,
      invalid: 2,
    });
    expect(profileColumn("overflow", 0, ["1e999"]).type).not.toBe("numeric");
  });
  it("frequencies use non-missing denominator", () => {
    const f = frequencies(["a", "b", "a", null]);
    expect(f.rows[0]).toEqual({ value: "a", count: 2, pct: (2 / 3) * 100 });
    expect(f.missing).toBe(1);
  });
  it("histogram counts sum to n and include the maximum", () => {
    const xs = [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 10];
    const bins = histogram(xs);
    expect(bins.reduce((a, b) => a + b.count, 0)).toBe(10);
    expect(bins.length).toBe(Math.ceil(Math.log2(10)) + 1);
    expect(histogram([5, 5, 5])).toHaveLength(1);
  });
  it("end-to-end report on fixture", () => {
    const r = parseCsvText(CSV, "t.csv");
    if (!r.ok) throw new Error();
    const rep = runDescriptive(r.dataset);
    const score = rep.numeric.find((n) => n.column === "score")!;
    expect(score.summary.n).toBe(8);
    expect(score.summary.missing).toBe(1);
    expect(score.summary.mean).toBe(5);
    const group = rep.categorical.find((c) => c.column === "group")!;
    expect(group.rows[0]).toMatchObject({ value: "x", count: 5 });
    expect(group.missing).toBe(1);
  });
  it("sample dataset is deterministic", () => expect(sampleCsv()).toBe(sampleCsv()));
});

describe("import edge cases", () => {
  it("handles quoted fields, embedded commas, newlines and Unicode", () => {
    const r = parseCsvText(
      'city,note\n"São Paulo","a, b"\n"Zürich","line1\nline2"\n東京,"say ""hi"""',
      "u.csv",
    );
    if (!r.ok) throw new Error();
    expect(r.dataset.rows).toEqual([
      ["São Paulo", "a, b"],
      ["Zürich", "line1\nline2"],
      ["東京", 'say "hi"'],
    ]);
  });
  it("strips a UTF-8 BOM from the first header", () => {
    const r = parseCsvText("\uFEFFid,x\n1,2", "b.csv");
    if (!r.ok) throw new Error();
    expect(r.dataset.columns[0]).toBe("id");
  });
  it("counts exact duplicate rows but keeps them", () => {
    const r = parseCsvText("a,b\n1,2\n1,2\n3,4", "d.csv");
    if (!r.ok) throw new Error();
    expect(r.dataset.rows).toHaveLength(3);
    expect(r.dataset.warnings.some((w) => w.startsWith("1 row(s) are exact duplicates"))).toBe(
      true,
    );
  });
  it("rejects binary content", () => expect(parseCsvText("a\u0000b", "x.csv").ok).toBe(false));
  it("warns on unreadable characters", () => {
    const r = parseCsvText("a\n\uFFFD", "x.csv");
    expect(r.ok && r.dataset.warnings.some((w) => w.includes("UTF-8"))).toBe(true);
  });
  it("parses 50,000 rows within limits", () => {
    const lines = ["id,v,g"];
    for (let i = 0; i < 50000; i++) lines.push(`${i},${i % 97},${i % 3 ? "a" : "b"}`);
    const r = parseCsvText(lines.join("\n"), "big.csv");
    if (!r.ok) throw new Error();
    expect(r.dataset.rows).toHaveLength(50000);
    const v = runDescriptive(r.dataset).numeric.find((n) => n.column === "v")!;
    expect(v.summary.n).toBe(50000);
  });
});

describe("statistics edge cases", () => {
  it("constant values: SD 0, single histogram bin", () => {
    const s = stats([3, 3, 3]);
    expect(s.sd).toBe(0);
    expect(s.mean).toBe(3);
    expect(histogram([3, 3, 3])).toEqual([{ lower: 3, upper: 3, count: 3, label: "3" }]);
  });
  it("whole-number scales get one bar per value", () => {
    const bins = histogram([1, 1, 2, 5, 5, 5]);
    expect(bins.map((b) => [b.label, b.count])).toEqual([
      ["1", 2],
      ["2", 1],
      ["3", 0],
      ["4", 0],
      ["5", 3],
    ]);
  });
  it("missing % uses all rows as denominator", () => {
    expect(profileColumn("x", 0, ["1", null, null, "4"]).missingPct).toBe(50);
  });
  it("empty column is not analysed numerically", () => {
    const r = parseCsvText("a,b\n1,\n2,", "e.csv");
    if (!r.ok) throw new Error();
    const rep = runDescriptive(r.dataset);
    expect(rep.numeric.map((n) => n.column)).toEqual(["a"]);
    expect(rep.profiles[1]!.type).toBe("empty");
  });
  it("chart bins sum to the reported n", () => {
    const r = parseCsvText(sampleCsv(), "s.csv", "sample");
    if (!r.ok) throw new Error();
    for (const n of runDescriptive(r.dataset).numeric) {
      expect(n.bins.reduce((a, b) => a + b.count, 0)).toBe(n.summary.n);
    }
  });
  it("frequency percentages sum to 100", () => {
    const f = frequencies(["a", "b", "c", null]);
    expect(f.rows.reduce((a, r) => a + r.pct, 0)).toBeCloseTo(100, 10);
  });
});

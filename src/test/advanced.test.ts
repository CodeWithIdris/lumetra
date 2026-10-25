import { describe, expect, it } from "vitest";
import {
  chiSqUpperP,
  correlation,
  crosstab,
  fUpperP,
  linearRegression,
  oneWayAnova,
  outliersIQR,
  quantile,
  tTwoSidedP,
  welchTTest,
} from "@/lib/stats/advanced";
import { runTool } from "@/lib/ask/tools";
import { parseCsvText } from "@/lib/data/parse";

describe("distribution functions match published tables", () => {
  it("t distribution", () => {
    expect(tTwoSidedP(2.228, 10)).toBeCloseTo(0.05, 3);
    expect(tTwoSidedP(2.0, 10)).toBeCloseTo(0.0734, 3);
    expect(tTwoSidedP(0, 5)).toBeCloseTo(1, 10);
  });
  it("chi-square", () => {
    expect(chiSqUpperP(3.841, 1)).toBeCloseTo(0.05, 3);
    expect(chiSqUpperP(5.991, 2)).toBeCloseTo(0.05, 3);
  });
  it("F distribution", () => expect(fUpperP(4.965, 1, 10)).toBeCloseTo(0.05, 3));
});

describe("methods", () => {
  const x = [1, 2, 3, 4, 5],
    y = [2, 4, 5, 4, 5];
  it("Pearson r = √0.6, p ≈ 0.124", () => {
    const r = correlation(x, y);
    expect(r.r).toBeCloseTo(Math.sqrt(0.6), 10);
    expect(r.pValue).toBeCloseTo(0.124, 3);
  });
  it("Spearman handles ties with average ranks", () => {
    expect(correlation([1, 2, 3, 4], [1, 2, 2, 3], "spearman").r).toBeCloseTo(0.9486833, 6);
  });
  it("correlation undefined for constant input", () =>
    expect(correlation([1, 2, 3], [5, 5, 5]).r).toBeNull());
  it("OLS slope 0.6, intercept 2.2, R² 0.6", () => {
    const r = linearRegression(x, y);
    expect(r.slope).toBeCloseTo(0.6, 10);
    expect(r.intercept).toBeCloseTo(2.2, 10);
    expect(r.rSquared).toBeCloseTo(0.6, 10);
  });
  it("Welch t-test", () => {
    const r = welchTTest([1, 2, 3, 4, 5], [2, 4, 6, 8, 10]);
    expect(r.t).toBeCloseTo(-3 / Math.sqrt(2.5), 10);
    expect(r.df).toBeCloseTo(6.25 / 1.0625, 10);
    expect(r.pValue).toBeGreaterThan(0.1);
    expect(r.pValue).toBeLessThan(0.12);
  });
  it("one-way ANOVA F = 13.5", () => {
    const r = oneWayAnova([
      { name: "a", values: [1, 2, 3] },
      { name: "b", values: [4, 5, 6] },
    ]);
    expect(r.f).toBeCloseTo(13.5, 10);
    expect(r.etaSquared).toBeCloseTo(13.5 / 17.5, 10);
  });
  it("crosstab perfect association: χ² = 20, V = 1", () => {
    const a = [...Array(10).fill("x"), ...Array(10).fill("y")];
    const b = [...Array(10).fill("p"), ...Array(10).fill("q")];
    const r = crosstab(a, b);
    expect(r.chiSquare).toBeCloseTo(20, 10);
    expect(r.cramersV).toBeCloseTo(1, 10);
  });
  it("type-7 quantiles", () => {
    expect(quantile([1, 2, 3, 4], 0.25)).toBe(1.75);
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantile([1, 2, 3, 4], 0)).toBe(1);
    expect(quantile([], 0.5)).toBeNull();
    expect(quantile([1, 2], -0.01)).toBeNull();
    expect(quantile([1, 2], 1.01)).toBeNull();
  });
  it("correlation uses paired finite observations and reports the effective n", () => {
    expect(correlation([1, 2, 3, Number.NaN], [2, 4, 6, 8])).toMatchObject({
      n: 3,
      r: 1,
      pValue: 0,
    });
    expect(correlation([1, 2], [2, 4, 6])).toMatchObject({ n: 2, r: null, pValue: null });
    expect(correlation([1, 2, 3], [6, 4, 2]).r).toBe(-1);
  });
  it("IQR outliers", () => expect(outliersIQR([1, 2, 3, 4, 5, 100]).count).toBe(1));
});

describe("assistant tools run on local data", () => {
  const r = parseCsvText("g,v,w\na,1,2\na,2,4\nb,3,5\nb,,4\nb,5,5", "t.csv");
  if (!r.ok) throw new Error();
  const ds = r.dataset;
  it("group mean excludes missing values", () => {
    const out = runTool(ds, "group_aggregate", {
      group_by: "g",
      value_column: "v",
      agg: "mean",
      filter: null,
    }) as { groups: { group: string; n: number; value: number }[] };
    expect(out.groups.find((g) => g.group === "b")).toEqual({ group: "b", n: 2, value: 4 });
  });
  it("filters apply numerically", () => {
    expect(
      runTool(ds, "count_rows", { filter: [{ column: "v", op: "gte", value: "2" }] }),
    ).toMatchObject({ count: 3 });
  });
  it("unknown columns return an error instead of throwing", () => {
    expect(runTool(ds, "frequency", { column: "nope", limit: null, filter: null })).toHaveProperty(
      "error",
    );
  });
  it("non-numeric columns are rejected for numeric methods", () => {
    expect(
      runTool(ds, "percentiles", { column: "g", percentiles: null, filter: null }),
    ).toHaveProperty("error");
  });
});

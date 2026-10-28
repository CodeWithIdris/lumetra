import { describe, expect, it, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { parseCsvText } from "@/lib/data/parse";
import {
  extractBivariateData,
  createCorrelationSavedAnalysis,
  reconstructCorrelationChartData,
  getSavedBivariateData,
  isAnalysisStale,
  computeDatasetSignature,
} from "@/lib/stats/analysis";
import { correlation, extractPairedPoints, linearRegression } from "@/lib/stats/advanced";
import { generateReportMarkdown } from "@/lib/data/export";
import { ScatterPlotChart } from "@/components/Charts";
import type { Dataset } from "@/lib/data/types";

// Polyfill ResizeObserver for JSDOM ResponsiveContainer
beforeAll(() => {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

// Anscombe's Quartet I fixture (independently verified benchmark)
// Mean X = 9, Mean Y = 7.5, Var X = 11, Var Y = 4.127, r ≈ 0.816, OLS y = 3.00 + 0.500x
const ANSCOMBE_I_CSV = `x,y
10,8.04
8,6.95
13,7.58
9,8.81
11,8.33
14,9.96
6,7.24
4,4.26
12,10.84
7,4.82
5,5.68`;

// Dirty bivariate dataset with nulls, missing markers, invalid strings, and non-finite values
const MESSY_BIVARIATE_CSV = `id,marketing_spend,revenue,notes
1,100,500,Normal
2,200,850,Normal
3,,1200,Missing spend
4,400,,Missing revenue
5,NA,1400,String NA
6,600,NULL,String NULL
7,invalid,invalid,Invalid tokens
8,800,2100,Normal
9,900,2400,Normal
10,1000,2650,Normal`;

describe("Visual Analytics: Scatter Plot Point Selection & Pair Extraction", () => {
  it("extracts only valid, finite paired observations preserving exact row indices", () => {
    const parsed = parseCsvText(MESSY_BIVARIATE_CSV, "messy.csv");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const data = extractBivariateData(parsed.dataset, "marketing_spend", "revenue", "pearson");

    // Out of 10 rows:
    // Row 0: 100, 500 -> Valid
    // Row 1: 200, 850 -> Valid
    // Row 2: null, 1200 -> Excluded (missing X)
    // Row 3: 400, null -> Excluded (missing Y)
    // Row 4: NA, 1400 -> Excluded (non-numeric X)
    // Row 5: 600, NULL -> Excluded (non-numeric Y)
    // Row 6: invalid, invalid -> Excluded (both non-numeric)
    // Row 7: 800, 2100 -> Valid
    // Row 8: 900, 2400 -> Valid
    // Row 9: 1000, 2650 -> Valid
    expect(data.points).toHaveLength(5);
    expect(data.n).toBe(5);
    expect(data.missingCount).toBe(5);

    // Verify row indices correspond to original CSV row positions
    expect(data.points.map((p) => p.rowIndex)).toEqual([0, 1, 7, 8, 9]);
    expect(data.points[0]).toEqual({ x: 100, y: 500, rowIndex: 0 });
    expect(data.points[1]).toEqual({ x: 200, y: 850, rowIndex: 1 });
    expect(data.points[2]).toEqual({ x: 800, y: 2100, rowIndex: 7 });
    expect(data.points[4]).toEqual({ x: 1000, y: 2650, rowIndex: 9 });
  });

  it("handles non-finite values (NaN, Infinity) safely without coercing to zero", () => {
    const rawX = [10, Number.NaN, 30, Number.POSITIVE_INFINITY, 50];
    const rawY = [100, 200, Number.NEGATIVE_INFINITY, 400, 500];

    const pairs = extractPairedPoints(rawX, rawY);
    expect(pairs).toHaveLength(2);
    expect(pairs[0]).toEqual({ x: 10, y: 100, rowIndex: 0 });
    expect(pairs[1]).toEqual({ x: 50, y: 500, rowIndex: 4 });

    // Missing values are never zero
    expect(pairs.some((p) => p.x === 0 || p.y === 0)).toBe(false);
  });

  it("maps axes correctly and inverts slope when swapping X and Y variables", () => {
    const parsed = parseCsvText(ANSCOMBE_I_CSV, "anscombe.csv");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const dataXY = extractBivariateData(parsed.dataset, "x", "y");
    const dataYX = extractBivariateData(parsed.dataset, "y", "x");

    // Correlation coefficient r is symmetric between X and Y
    expect(dataXY.r).toBeCloseTo(dataYX.r!, 6);
    expect(dataXY.r).toBeCloseTo(0.8164, 4);

    // Coordinate points are properly swapped
    expect(dataXY.points[0]).toEqual({ x: 10, y: 8.04, rowIndex: 0 });
    expect(dataYX.points[0]).toEqual({ x: 8.04, y: 10, rowIndex: 0 });

    // OLS slope for y = a + bx is ~0.5
    expect(dataXY.regression.slope).toBeCloseTo(0.5, 3);
    // OLS slope for x = a' + b'y is ~1.33 (since b' = r * (SD_x / SD_y))
    expect(dataYX.regression.slope).toBeCloseTo(1.333, 3);
  });
});

describe("Visual Analytics: Agreement Between Displayed Observations & Calculations", () => {
  it("strictly aligns plotted observations with Anscombe's Quartet I benchmark statistics", () => {
    const parsed = parseCsvText(ANSCOMBE_I_CSV, "anscombe1.csv");
    if (!parsed.ok) throw new Error();

    const data = extractBivariateData(parsed.dataset, "x", "y", "pearson");

    // Anscombe Quartet I published values:
    // n = 11
    // r = 0.8164
    // slope = 0.500
    // intercept = 3.000
    // R^2 = 0.667
    expect(data.n).toBe(11);
    expect(data.r).toBeCloseTo(0.81642, 4);
    expect(data.regression.slope).toBeCloseTo(0.50009, 4);
    expect(data.regression.intercept).toBeCloseTo(3.0001, 3);
    expect(data.regression.rSquared).toBeCloseTo(0.6665, 3);

    // Verify recalculating from data.points reproduces the exact same statistics
    const xs = data.points.map((p) => p.x);
    const ys = data.points.map((p) => p.y);
    const recalcCorr = correlation(xs, ys, "pearson");
    const recalcReg = linearRegression(xs, ys);

    expect(recalcCorr.r).toBe(data.r);
    expect(recalcCorr.n).toBe(data.n);
    expect(recalcReg.slope).toBe(data.regression.slope);
    expect(recalcReg.intercept).toBe(data.regression.intercept);
  });

  it("handles non-linear monotonic data with Spearman rank correlation", () => {
    // y is strictly monotonic exponential y = 2^x
    const csv = `x,y
1,2
2,4
3,8
4,16
5,32
6,64`;
    const parsed = parseCsvText(csv, "exponential.csv");
    if (!parsed.ok) throw new Error();

    const spearmanData = extractBivariateData(parsed.dataset, "x", "y", "spearman");
    const pearsonData = extractBivariateData(parsed.dataset, "x", "y", "pearson");

    // Perfect monotonic relationship -> Spearman rho = 1.0
    expect(spearmanData.r).toBeCloseTo(1.0, 10);
    // Non-linear relationship -> Pearson r < 1.0 (~0.88)
    expect(pearsonData.r).toBeLessThan(0.95);
    expect(pearsonData.r).toBeGreaterThan(0.85);
  });

  it("handles identical values safely without crashing or dividing by zero", () => {
    // Constant predictor (all x = 7)
    const csv = `x,y
7,10
7,20
7,30
7,40`;
    const parsed = parseCsvText(csv, "constant.csv");
    if (!parsed.ok) throw new Error();

    const data = extractBivariateData(parsed.dataset, "x", "y");
    expect(data.minX).toBe(7);
    expect(data.maxX).toBe(7);
    // Undefined correlation and regression slope because variance of x is 0
    expect(data.r).toBeNull();
    expect(data.regression.slope).toBeNull();
    expect(data.trendLine).toBeNull(); // No trendline constructed when minX === maxX
  });

  it("handles small datasets (n < 3) safely", () => {
    const csv = `x,y
1,2
3,4`;
    const parsed = parseCsvText(csv, "small.csv");
    if (!parsed.ok) throw new Error();

    const data = extractBivariateData(parsed.dataset, "x", "y");
    expect(data.points).toHaveLength(2);
    expect(data.n).toBe(2);
    expect(data.r).toBeNull();
    expect(data.note).toContain("At least 3 complete pairs are needed");
    expect(data.regression.slope).toBeNull();
    expect(data.trendLine).toBeNull();
  });
});

describe("Visual Analytics: Saved Analysis Reopening & Full Fidelity", () => {
  it("persists paired observations, regression results, and extents in saved analysis", () => {
    const parsed = parseCsvText(ANSCOMBE_I_CSV, "anscombe.csv");
    if (!parsed.ok) throw new Error();

    const saved = createCorrelationSavedAnalysis(parsed.dataset, "x", "y", "pearson");

    expect(saved.type).toBe("correlation");
    expect(saved.sampleSize).toBe(11);
    expect(saved.datasetSignature).toBe(computeDatasetSignature(parsed.dataset));
    expect(saved.variables).toEqual(["x", "y"]);
    expect(saved.configuration).toEqual({ colX: "x", colY: "y", method: "pearson" });

    // Stored results must include points and trendline
    expect(saved.results["points"]).toBeDefined();
    expect(Array.isArray(saved.results["points"])).toBe(true);
    expect((saved.results["points"] as unknown[]).length).toBe(11);
    expect(saved.results["trendLine"]).toBeDefined();
    expect(saved.results["minX"]).toBe(4);
    expect(saved.results["maxX"]).toBe(14);

    // Reconstruct directly from saved record
    const restored = getSavedBivariateData(saved);
    expect(restored).not.toBeNull();
    expect(restored!.points).toHaveLength(11);
    expect(restored!.r).toBeCloseTo(0.8164, 4);
    expect(restored!.regression.slope).toBeCloseTo(0.5, 3);
  });

  it("verifies chart data when reopening analysis on the exact same dataset", () => {
    const parsed = parseCsvText(ANSCOMBE_I_CSV, "anscombe.csv");
    if (!parsed.ok) throw new Error();

    const saved = createCorrelationSavedAnalysis(parsed.dataset, "x", "y", "pearson");
    const recon = reconstructCorrelationChartData(saved, parsed.dataset);

    expect(recon.status).toBe("verified");
    expect(recon.data).not.toBeNull();
    expect(recon.data!.n).toBe(11);
    expect(recon.data!.r).toBeCloseTo(0.8164, 4);
  });
});

describe("Visual Analytics: Dataset Version Changes & Discrepancy Reporting", () => {
  it("detects dataset changes and marks analysis as stale when rows are modified", () => {
    const parsed = parseCsvText(ANSCOMBE_I_CSV, "anscombe.csv");
    if (!parsed.ok) throw new Error();

    const saved = createCorrelationSavedAnalysis(parsed.dataset, "x", "y", "pearson");

    // Create modified dataset by appending a new row
    const modifiedDataset: Dataset = {
      ...parsed.dataset,
      rows: [...parsed.dataset.rows, ["15", "11.2"]],
    };

    expect(isAnalysisStale(saved, modifiedDataset)).toBe(true);

    const recon = reconstructCorrelationChartData(saved, modifiedDataset);
    // Because n and r changed, it detects a discrepancy!
    expect(recon.status).toBe("discrepancy");
    expect(recon.message).toContain("diverge from saved record");
    // Crucially: saved data is preserved rather than silently overwritten
    expect(saved.sampleSize).toBe(11);
    expect(saved.results["n"]).toBe(11);
  });

  it("does not silently substitute results from a different dataset version", () => {
    const dsA = parseCsvText("a,b\n1,2\n2,4\n3,6", "datasetA.csv");
    const dsB = parseCsvText("a,b\n1,10\n2,20\n3,50", "datasetB.csv");
    if (!dsA.ok || !dsB.ok) throw new Error();

    const savedA = createCorrelationSavedAnalysis(dsA.dataset, "a", "b", "pearson");
    expect(savedA.results["r"]).toBe(1);

    // Reconstruct with dsB (different dataset with different values)
    const recon = reconstructCorrelationChartData(savedA, dsB.dataset);
    expect(recon.status).toBe("discrepancy");
    expect(recon.message).toContain("diverge from saved record");

    // The saved analysis record remains completely unchanged
    expect(savedA.results["r"]).toBe(1);
    expect(savedA.sampleSize).toBe(3);
  });

  it("reports missing columns if active dataset schema no longer contains variables", () => {
    const parsed = parseCsvText(ANSCOMBE_I_CSV, "anscombe.csv");
    if (!parsed.ok) throw new Error();

    const saved = createCorrelationSavedAnalysis(parsed.dataset, "x", "y", "pearson");

    // Dataset missing column "y"
    const missingColDataset: Dataset = {
      id: "diff_id",
      name: "altered.csv",
      source: "upload",
      columns: ["x", "unrelated"],
      rows: [["1", "2"]],
      warnings: [],
    };

    const recon = reconstructCorrelationChartData(saved, missingColDataset);
    // Since savedData is present, it returns stale with a note rather than throwing
    expect(recon.status).toBe("stale");
    expect(recon.message).toContain("not both present in active dataset");
    expect(recon.data).not.toBeNull();
    expect(recon.data!.n).toBe(11);
  });
});

describe("Visual Analytics: Markdown Report & Visual Analytics Summary", () => {
  it("includes comprehensive scatter plot description, regression equation, and causal disclosures", () => {
    const parsed = parseCsvText(ANSCOMBE_I_CSV, "anscombe.csv");
    if (!parsed.ok) throw new Error();

    const saved = createCorrelationSavedAnalysis(parsed.dataset, "x", "y", "pearson");
    const md = generateReportMarkdown({
      projectName: "Anscombe Test Project",
      objective: "Verify bivariate visual analytics export",
      datasetName: "anscombe.csv",
      rawRowCount: 11,
      cleanRowCount: 11,
      columnCount: 2,
      columnsList: ["x", "y"],
      savedAnalyses: [saved],
    });

    // Verify presence of numerical metrics
    expect(md).toContain("Correlation Coefficient (r)");
    expect(md).toContain("0.816");
    expect(md).toContain("Linear Fit (OLS)");
    expect(md).toContain("Coefficient of Determination (R²)");

    // Verify presence of Visual Analytics Bivariate Scatter Plot Description
    expect(md).toContain("## 4. Analytical Findings & Saved Analyses");
    expect(md).toContain("Visual Analytics — Bivariate Scatter Plot Description:");
    expect(md).toContain(
      'Variable X ("x") on the horizontal axis and Variable Y ("y") on the vertical axis',
    );
    expect(md).toContain(
      'Coordinate Extents: "x" ranges from 4 to 14; "y" ranges from 4.26 to 10.84',
    );
    expect(md).toContain(
      "Fitted Reference Trendline (OLS): Estimated slope b = 0.5001, intercept a = 3.0001",
    );
    expect(md).toContain("Strong positive linear association");

    // Verify essential scientific causal disclosure
    expect(md).toContain(
      "Linear reference trendline is fitted solely to describe sample covariance; correlation does not establish causation.",
    );
  });
});

describe("Visual Analytics: ScatterPlotChart Component Rendering", () => {
  it("renders scatter plot with variables, sample size, r-value, and causal disclosure", () => {
    const points = [
      { x: 10, y: 20, rowIndex: 0 },
      { x: 20, y: 40, rowIndex: 1 },
      { x: 30, y: 60, rowIndex: 2 },
    ];
    render(
      <ScatterPlotChart
        xLabel="Advertising"
        yLabel="Sales"
        points={points}
        totalPairs={3}
        r={1.0}
        pValue={0.0001}
        method="pearson"
        regression={{ slope: 2, intercept: 0, rSquared: 1.0 }}
      />,
    );

    // Title and axes
    expect(screen.getByText("Sales vs Advertising")).toBeInTheDocument();
    expect(screen.getByText("Pearson r")).toBeInTheDocument();
    expect(screen.getByText(/n = 3 complete pairs/i)).toBeInTheDocument();
    expect(screen.getAllByText(/r = 1\.000/i).length).toBeGreaterThanOrEqual(1);

    // Causal disclaimer
    expect(
      screen.getAllByText(/correlation does not imply causation/i).length,
    ).toBeGreaterThanOrEqual(1);

    // Accessible description
    expect(
      screen.getByText(/Bivariate scatter plot comparing Sales against Advertising/i),
    ).toBeInTheDocument();
  });

  it("renders empty state gracefully when no complete paired points exist", () => {
    render(<ScatterPlotChart xLabel="Marketing" yLabel="Revenue" points={[]} />);

    expect(screen.getByText("No complete paired observations")).toBeInTheDocument();
    expect(
      screen.getByText(/Neither variable has paired non-missing numeric coordinates/i),
    ).toBeInTheDocument();
  });

  it("displays small sample warning when complete pairs are fewer than 3", () => {
    render(
      <ScatterPlotChart
        xLabel="Height"
        yLabel="Weight"
        points={[
          { x: 170, y: 65, rowIndex: 0 },
          { x: 180, y: 75, rowIndex: 1 },
        ]}
      />,
    );

    expect(
      screen.getByText(
        /Correlation and regression require at least 3 complete pairs \(found n = 2\)/i,
      ),
    ).toBeInTheDocument();
  });

  it("displays discrepancy and stale notices when underlying dataset changes", () => {
    render(
      <ScatterPlotChart
        xLabel="Hours"
        yLabel="Score"
        points={[
          { x: 1, y: 50, rowIndex: 0 },
          { x: 2, y: 60, rowIndex: 1 },
          { x: 3, y: 70, rowIndex: 2 },
        ]}
        staleNotice="Earlier dataset version"
        discrepancyNotice="Recalculated values diverge from saved record."
      />,
    );

    expect(screen.getByText("Earlier dataset version")).toBeInTheDocument();
    expect(screen.getByText("Recalculated values diverge from saved record.")).toBeInTheDocument();
  });
});

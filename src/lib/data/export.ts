import { isFormulaLike } from "./parse";
import type { DescriptiveReport, SavedAnalysis } from "../stats/analysis";
import { fmt } from "../stats/descriptive";

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

export interface ReportMarkdownOptions {
  projectName: string;
  objective?: string;
  datasetName: string;
  rawRowCount: number;
  cleanRowCount: number;
  columnCount: number;
  columnsList: string[];
  cleaningSteps?: Array<{ description: string; effect: { rowsBefore: number; rowsAfter: number } }>;
  savedAnalyses?: SavedAnalysis[];
  descriptiveReport?: DescriptiveReport | null;
}

export function generateReportMarkdown(opts: ReportMarkdownOptions): string {
  const {
    projectName,
    objective = "",
    datasetName,
    rawRowCount,
    cleanRowCount,
    columnCount,
    columnsList,
    cleaningSteps = [],
    savedAnalyses = [],
    descriptiveReport,
  } = opts;

  const lines: string[] = [];
  lines.push(`# Statistical Analysis Report: ${projectName}`);
  lines.push(`Generated: ${new Date().toISOString()} • Lumetra Analytical Engine\n`);

  lines.push(`## 1. Objective & Analytical Hypothesis`);
  lines.push(objective.trim() || "No formal research objective specified.\n");

  lines.push(`## 2. Dataset Inventory`);
  lines.push(`- Dataset: ${datasetName}`);
  lines.push(
    `- Dimensions: ${cleanRowCount.toLocaleString()} analytical rows × ${columnCount} columns (Original: ${rawRowCount.toLocaleString()} rows)`,
  );
  lines.push(`- Schema: ${columnsList.join(", ")}\n`);

  if (cleaningSteps.length > 0) {
    lines.push(`## 3. Data Cleaning & Transformation History`);
    cleaningSteps.forEach((s, idx) => {
      lines.push(
        `${idx + 1}. ${s.description} (Rows: ${s.effect.rowsBefore} → ${s.effect.rowsAfter})`,
      );
    });
    lines.push("");
  }

  lines.push(`## 4. Analytical Findings & Saved Analyses`);
  if (savedAnalyses.length === 0) {
    lines.push(
      "No specific parametric or domain analyses saved yet. Baseline descriptive statistics provided below.\n",
    );
  } else {
    savedAnalyses.forEach((a, idx) => {
      lines.push(`### 4.${idx + 1} ${a.name}`);
      lines.push(`- Type: ${a.type.toUpperCase()}`);
      lines.push(`- Effective Sample Size: n = ${a.sampleSize.toLocaleString()}`);
      lines.push(`- Missing Data Policy: ${a.missingHandling}`);

      // Computed outputs tables
      if (a.type === "correlation") {
        const colX = (a.configuration["colX"] as string) || a.variables[0] || "X";
        const colY = (a.configuration["colY"] as string) || a.variables[1] || "Y";
        const rVal = typeof a.results["r"] === "number" ? (a.results["r"] as number) : null;
        const pVal =
          typeof a.results["pValue"] === "number" ? (a.results["pValue"] as number) : null;
        const reg = a.results["regression"] as
          | {
              slope: number | null;
              intercept: number | null;
              rSquared: number | null;
            }
          | undefined;
        const minX = typeof a.results["minX"] === "number" ? (a.results["minX"] as number) : null;
        const maxX = typeof a.results["maxX"] === "number" ? (a.results["maxX"] as number) : null;
        const minY = typeof a.results["minY"] === "number" ? (a.results["minY"] as number) : null;
        const maxY = typeof a.results["maxY"] === "number" ? (a.results["maxY"] as number) : null;

        lines.push(`\n**Computed Outputs:**`);
        lines.push(`| Metric | Value |`);
        lines.push(`| :--- | :--- |`);
        lines.push(`| Correlation Coefficient (r) | ${rVal !== null ? rVal.toFixed(3) : "—"} |`);
        lines.push(
          `| Two-Sided p-Value | ${pVal !== null ? (pVal < 0.001 ? "< 0.001" : pVal.toFixed(4)) : "—"} |`,
        );
        lines.push(`| Method | ${String(a.results["method"] ?? "pearson")} |`);
        lines.push(`| Complete Pairs (n) | ${a.results["n"] ?? a.sampleSize} |`);
        lines.push(`| Excluded Incomplete Rows | ${a.missingCount} |`);
        if (reg && reg.slope !== null && reg.intercept !== null) {
          lines.push(
            `| Linear Fit (OLS) | y = ${fmt(reg.intercept, 3)} + ${fmt(reg.slope, 3)}·x |`,
          );
          if (reg.rSquared !== null) {
            lines.push(`| Coefficient of Determination (R²) | ${fmt(reg.rSquared, 3)} |`);
          }
        }

        lines.push(`\n**Visual Analytics — Bivariate Scatter Plot Description:**`);
        lines.push(
          `- Paired Observations: ${Number(a.results["n"] ?? a.sampleSize).toLocaleString()} complete coordinates plotted with Variable X ("${colX}") on the horizontal axis and Variable Y ("${colY}") on the vertical axis.`,
        );
        if (minX !== null && maxX !== null && minY !== null && maxY !== null) {
          lines.push(
            `- Coordinate Extents: "${colX}" ranges from ${fmt(minX, 2)} to ${fmt(maxX, 2)}; "${colY}" ranges from ${fmt(minY, 2)} to ${fmt(maxY, 2)}.`,
          );
        }
        if (reg && reg.slope !== null && reg.intercept !== null) {
          lines.push(
            `- Fitted Reference Trendline (OLS): Estimated slope b = ${fmt(reg.slope, 4)}, intercept a = ${fmt(reg.intercept, 4)}.`,
          );
        }
        lines.push(
          `- Association Assessment: ${rVal !== null ? (Math.abs(rVal) >= 0.7 ? "Strong" : Math.abs(rVal) >= 0.4 ? "Moderate" : Math.abs(rVal) >= 0.1 ? "Weak" : "Negligible") : "Undefined"} ${rVal !== null && rVal >= 0 ? "positive" : "negative"} ${a.results["method"] === "spearman" ? "monotonic rank" : "linear"} association.`,
        );
        lines.push(
          `- Causal Disclosure: Linear reference trendline is fitted solely to describe sample covariance; correlation does not establish causation.`,
        );
      } else if (a.type === "ttest") {
        lines.push(`\n**Computed Outputs:**`);
        lines.push(`| Metric | Value |`);
        lines.push(`| :--- | :--- |`);
        lines.push(`| Mean Difference | ${fmt(a.results["difference"] as number | null)} |`);
        lines.push(
          `| Welch's t-Statistic | ${typeof a.results["t"] === "number" ? (a.results["t"] as number).toFixed(3) : "—"} |`,
        );
        lines.push(
          `| Degrees of Freedom (df) | ${typeof a.results["df"] === "number" ? (a.results["df"] as number).toFixed(1) : "—"} |`,
        );
        lines.push(
          `| p-Value | ${typeof a.results["pValue"] === "number" ? ((a.results["pValue"] as number) < 0.001 ? "< 0.001" : (a.results["pValue"] as number).toFixed(4)) : "—"} |`,
        );
        const groups = a.results["groups"] as
          Array<{ name: string; n: number; mean: number | null; sd: number | null }> | undefined;
        if (groups && groups.length > 0) {
          lines.push(`\n**Group Comparison Table:**`);
          lines.push(`| Group Level | n | Mean | Std Dev |`);
          lines.push(`| :--- | :---: | :---: | :---: |`);
          groups.forEach((g) => {
            lines.push(`| ${g.name} | ${g.n} | ${fmt(g.mean)} | ${fmt(g.sd)} |`);
          });
        }
      } else if (a.type === "crosstab") {
        lines.push(`\n**Computed Outputs:**`);
        lines.push(`| Metric | Value |`);
        lines.push(`| :--- | :--- |`);
        lines.push(
          `| Pearson Chi-Square (χ²) | ${typeof a.results["chiSquare"] === "number" ? (a.results["chiSquare"] as number).toFixed(2) : "—"} |`,
        );
        lines.push(`| Degrees of Freedom (df) | ${String(a.results["df"] ?? "—")} |`);
        lines.push(
          `| p-Value | ${typeof a.results["pValue"] === "number" ? ((a.results["pValue"] as number) < 0.001 ? "< 0.001" : (a.results["pValue"] as number).toFixed(4)) : "—"} |`,
        );
        lines.push(
          `| Cramer's V | ${typeof a.results["cramersV"] === "number" ? (a.results["cramersV"] as number).toFixed(3) : "—"} |`,
        );
        const rows = a.results["rows"] as string[] | undefined;
        const cols = a.results["cols"] as string[] | undefined;
        const counts = a.results["counts"] as number[][] | undefined;
        if (rows && cols && counts) {
          lines.push(`\n**Contingency Matrix:**`);
          lines.push(
            `| ${a.variables[0] ?? "Row"} \\ ${a.variables[1] ?? "Col"} | ${cols.join(" | ")} |`,
          );
          lines.push(`| :--- | ${cols.map(() => ":---:").join(" | ")} |`);
          rows.forEach((r, rIdx) => {
            const rowVals = cols.map((_, cIdx) => (counts[rIdx]?.[cIdx] ?? 0).toLocaleString());
            lines.push(`| ${r} | ${rowVals.join(" | ")} |`);
          });
        }
      } else if (a.type === "persona_engineer") {
        lines.push(`\n**Computed Outputs:**`);
        lines.push(`| Metric | Value |`);
        lines.push(`| :--- | :--- |`);
        lines.push(`| P50 Latency (Median) | ${fmt(a.results["p50"] as number | null)} ms |`);
        lines.push(`| P99 Latency (Tail) | ${fmt(a.results["p99"] as number | null)} ms |`);
        lines.push(
          `| Tail Ratio (P99/P50) | ${typeof a.results["tailRatio"] === "number" ? `${(a.results["tailRatio"] as number).toFixed(2)}×` : "—"} |`,
        );
        if ("actualAvailabilityPercent" in a.results) {
          lines.push(
            `| SLO Availability | ${typeof a.results["actualAvailabilityPercent"] === "number" ? `${(a.results["actualAvailabilityPercent"] as number).toFixed(2)}%` : "—"} (Target: ${String(a.results["sloTarget"] ?? "99")}%) |`,
          );
          lines.push(
            `| SLO Breaches | ${Number(a.results["breachCount"] ?? 0).toLocaleString()} |`,
          );
        }
      } else if (a.type === "persona_economist") {
        lines.push(`\n**Computed Outputs:**`);
        lines.push(`| Metric | Value |`);
        lines.push(`| :--- | :--- |`);
        if ("pointElasticity" in a.results) {
          lines.push(
            `| Price Elasticity of Demand (Ep) | ${typeof a.results["pointElasticity"] === "number" ? (a.results["pointElasticity"] as number).toFixed(3) : "—"} (${String(a.results["classification"] ?? "")}) |`,
          );
          lines.push(`| Marginal Slope (dQ/dP) | ${fmt(a.results["slope"] as number | null, 4)} |`);
        }
        if ("gini" in a.results) {
          lines.push(
            `| Gini Concentration Index | ${typeof a.results["gini"] === "number" ? (a.results["gini"] as number).toFixed(3) : "—"} |`,
          );
        }
      } else if (a.type === "persona_scientist") {
        lines.push(`\n**Computed Outputs:**`);
        lines.push(`| Metric | Value |`);
        lines.push(`| :--- | :--- |`);
        lines.push(
          `| Shapiro-Wilk Statistic (W) | ${typeof a.results["shapiroWilkW"] === "number" ? (a.results["shapiroWilkW"] as number).toFixed(3) : "—"} |`,
        );
        lines.push(
          `| Skewness | ${typeof a.results["skewness"] === "number" ? (a.results["skewness"] as number).toFixed(3) : "—"} |`,
        );
        lines.push(
          `| Excess Kurtosis | ${typeof a.results["kurtosis"] === "number" ? (a.results["kurtosis"] as number).toFixed(3) : "—"} |`,
        );
      } else if (a.type === "persona_product") {
        lines.push(`\n**Computed Outputs:**`);
        lines.push(`| Metric | Value |`);
        lines.push(`| :--- | :--- |`);
        lines.push(
          `| Control Conversion Rate | ${typeof a.results["controlRate"] === "number" ? `${(a.results["controlRate"] as number).toFixed(2)}%` : "—"} |`,
        );
        lines.push(
          `| Treatment Conversion Rate | ${typeof a.results["treatmentRate"] === "number" ? `${(a.results["treatmentRate"] as number).toFixed(2)}%` : "—"} |`,
        );
        lines.push(
          `| Relative Lift | ${typeof a.results["relativeLift"] === "number" ? `${(a.results["relativeLift"] as number).toFixed(2)}%` : "—"} |`,
        );
        lines.push(
          `| p-Value | ${typeof a.results["pValue"] === "number" ? ((a.results["pValue"] as number) < 0.001 ? "< 0.001" : (a.results["pValue"] as number).toFixed(4)) : "—"} |`,
        );
      } else if (a.type === "persona_clinical") {
        lines.push(`\n**Computed Outputs:**`);
        lines.push(`| Metric | Value |`);
        lines.push(`| :--- | :--- |`);
        lines.push(
          `| Odds Ratio (OR) | ${typeof a.results["oddsRatio"] === "number" ? (a.results["oddsRatio"] as number).toFixed(2) : "—"} |`,
        );
        lines.push(
          `| 95% Confidence Interval | [${typeof a.results["ciLower"] === "number" ? (a.results["ciLower"] as number).toFixed(2) : "—"}, ${typeof a.results["ciUpper"] === "number" ? (a.results["ciUpper"] as number).toFixed(2) : "—"}] |`,
        );
        lines.push(
          `| p-Value | ${typeof a.results["pValue"] === "number" ? ((a.results["pValue"] as number) < 0.001 ? "< 0.001" : (a.results["pValue"] as number).toFixed(4)) : "—"} |`,
        );
      }

      lines.push(`\n**Interpretation:**`);
      lines.push(`- Observed Results: ${a.interpretation.observedResults.join(" ")}`);
      lines.push(`- Statistical Inference: ${a.interpretation.statisticalInference.join(" ")}`);
      lines.push(`- Assumptions: ${a.interpretation.assumptions.join(" ")}`);
      lines.push(`- Limitations: ${a.interpretation.limitations.join(" ")}`);
      lines.push(`- Recommendations: ${a.interpretation.recommendations.join(" ")}\n`);
    });
  }

  if (descriptiveReport) {
    lines.push(`## 5. Descriptive Statistics Summary`);
    descriptiveReport.numeric.forEach((num) => {
      const s = num.summary;
      lines.push(
        `- **${num.column}** (n = ${s.n}): Mean = ${fmt(s.mean)}, Median = ${fmt(s.median)}, SD = ${fmt(s.sd)}, Range = [${fmt(s.min)}, ${fmt(s.max)}]`,
      );
    });
    lines.push("");
  }

  lines.push(`## 6. Limitations & Data Quality Audit`);
  lines.push("- Missing values are excluded pairwise and never coerced to zero.");
  lines.push(
    "- Statistical associations summarize observed data and do not establish causal relationships.",
  );

  return lines.join("\n");
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

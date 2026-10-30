import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, PageHeader } from "@/components/AppShell";
import { MethodNote, ResultsView } from "@/components/ResultsView";
import { ScatterPlotChart } from "@/components/Charts";
import { useStore } from "@/lib/store";
import {
  runDescriptive,
  isAnalysisStale,
  reconstructCorrelationChartData,
  type DescriptiveReport,
  type SavedAnalysis,
} from "@/lib/stats/analysis";
import { fmt } from "@/lib/stats/descriptive";
import { descriptiveToCsv, downloadText, generateReportMarkdown } from "@/lib/data/export";
import { pageMeta } from "@/lib/meta";
import {
  Printer,
  Download,
  FileText,
  Wand2,
  Layers,
  AlertTriangle,
  FileCode,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/reports")({
  head: () =>
    pageMeta(
      "Reports",
      "A structured analytical report preview of your dataset, methods, results and limitations.",
    ),
  component: Reports,
});

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="break-inside-avoid border-t border-slate-200 pt-4">
      <h2 className="mb-2.5 flex items-baseline gap-2 text-sm font-semibold text-slate-900">
        <span className="text-blue-600 font-mono text-xs">0{n}.</span>
        <span>{title}</span>
      </h2>
      {children}
    </section>
  );
}

function AnalysisResultsSummary({ analysis }: { analysis: SavedAnalysis }) {
  const { type, results, variables } = analysis;

  if (type === "correlation") {
    return (
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 text-xs font-mono">
        <div className="rounded border border-slate-200 bg-slate-50 p-2">
          <div className="text-[10px] text-slate-500 font-sans">Correlation (r)</div>
          <div className="text-base font-bold text-slate-900 mt-0.5">
            {typeof results["r"] === "number" ? (results["r"] as number).toFixed(3) : "—"}
          </div>
          <div className="text-[9px] text-slate-400 font-sans">
            {String(results["method"] ?? "pearson")}
          </div>
        </div>
        <div className="rounded border border-slate-200 bg-slate-50 p-2">
          <div className="text-[10px] text-slate-500 font-sans">p-Value</div>
          <div className="text-base font-bold text-slate-900 mt-0.5">
            {typeof results["pValue"] === "number"
              ? (results["pValue"] as number) < 0.001
                ? "< 0.001"
                : (results["pValue"] as number).toFixed(4)
              : "—"}
          </div>
          <div className="text-[9px] text-slate-400 font-sans">Two-sided</div>
        </div>
        <div className="rounded border border-slate-200 bg-slate-50 p-2">
          <div className="text-[10px] text-slate-500 font-sans">Pairs (n)</div>
          <div className="text-base font-bold text-slate-900 mt-0.5">
            {Number(results["n"] ?? analysis.sampleSize).toLocaleString()}
          </div>
          <div className="text-[9px] text-slate-400 font-sans">Complete pairs</div>
        </div>
        <div className="rounded border border-slate-200 bg-slate-50 p-2">
          <div className="text-[10px] text-slate-500 font-sans">Variables</div>
          <div className="text-xs font-semibold text-slate-800 mt-0.5 truncate">
            {variables.join(" × ")}
          </div>
        </div>
      </div>
    );
  }

  if (type === "ttest") {
    const groups = results["groups"] as
      Array<{ name: string; n: number; mean: number | null; sd: number | null }> | undefined;
    return (
      <div className="space-y-2.5 text-xs font-mono">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded border border-slate-200 bg-slate-50 p-2">
            <div className="text-[10px] text-slate-500 font-sans">Mean Difference</div>
            <div className="text-base font-bold text-slate-900 mt-0.5">
              {fmt(results["difference"] as number | null)}
            </div>
          </div>
          <div className="rounded border border-slate-200 bg-slate-50 p-2">
            <div className="text-[10px] text-slate-500 font-sans">Welch's t</div>
            <div className="text-base font-bold text-slate-900 mt-0.5">
              {typeof results["t"] === "number" ? (results["t"] as number).toFixed(3) : "—"}
            </div>
            <div className="text-[9px] text-slate-400 font-sans">
              df = {typeof results["df"] === "number" ? (results["df"] as number).toFixed(1) : "—"}
            </div>
          </div>
          <div className="rounded border border-slate-200 bg-slate-50 p-2">
            <div className="text-[10px] text-slate-500 font-sans">p-Value</div>
            <div className="text-base font-bold text-slate-900 mt-0.5">
              {typeof results["pValue"] === "number"
                ? (results["pValue"] as number) < 0.001
                  ? "< 0.001"
                  : (results["pValue"] as number).toFixed(4)
                : "—"}
            </div>
          </div>
          <div className="rounded border border-slate-200 bg-slate-50 p-2">
            <div className="text-[10px] text-slate-500 font-sans">Method</div>
            <div className="text-xs font-semibold text-emerald-700 mt-0.5 font-sans">
              Welch's unequal var
            </div>
          </div>
        </div>

        {groups && groups.length > 0 && (
          <div className="border border-slate-200 rounded overflow-hidden">
            <table className="w-full text-[11px] text-left">
              <thead className="bg-slate-50 text-slate-600 font-medium border-b border-slate-200 font-sans">
                <tr>
                  <th className="px-2.5 py-1.5">Group Level</th>
                  <th className="px-2.5 py-1.5 text-right">Sample (n)</th>
                  <th className="px-2.5 py-1.5 text-right">Mean</th>
                  <th className="px-2.5 py-1.5 text-right">Std Dev (s)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {groups.map((g) => (
                  <tr key={g.name}>
                    <td className="px-2.5 py-1.5 font-semibold text-slate-900">{g.name}</td>
                    <td className="px-2.5 py-1.5 text-right text-slate-700">{g.n}</td>
                    <td className="px-2.5 py-1.5 text-right text-slate-900 font-semibold">
                      {fmt(g.mean)}
                    </td>
                    <td className="px-2.5 py-1.5 text-right text-slate-600">{fmt(g.sd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  if (type === "crosstab") {
    const rows = results["rows"] as string[] | undefined;
    const cols = results["cols"] as string[] | undefined;
    const counts = results["counts"] as number[][] | undefined;

    return (
      <div className="space-y-2.5 text-xs font-mono">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded border border-slate-200 bg-slate-50 p-2">
            <div className="text-[10px] text-slate-500 font-sans">Chi-Square (χ²)</div>
            <div className="text-base font-bold text-slate-900 mt-0.5">
              {typeof results["chiSquare"] === "number"
                ? (results["chiSquare"] as number).toFixed(2)
                : "—"}
            </div>
            <div className="text-[9px] text-slate-400 font-sans">
              df = {String(results["df"] ?? "—")}
            </div>
          </div>
          <div className="rounded border border-slate-200 bg-slate-50 p-2">
            <div className="text-[10px] text-slate-500 font-sans">p-Value</div>
            <div className="text-base font-bold text-slate-900 mt-0.5">
              {typeof results["pValue"] === "number"
                ? (results["pValue"] as number) < 0.001
                  ? "< 0.001"
                  : (results["pValue"] as number).toFixed(4)
                : "—"}
            </div>
          </div>
          <div className="rounded border border-slate-200 bg-slate-50 p-2">
            <div className="text-[10px] text-slate-500 font-sans">Cramer's V</div>
            <div className="text-base font-bold text-slate-900 mt-0.5">
              {typeof results["cramersV"] === "number"
                ? (results["cramersV"] as number).toFixed(3)
                : "—"}
            </div>
          </div>
          <div className="rounded border border-slate-200 bg-slate-50 p-2">
            <div className="text-[10px] text-slate-500 font-sans">Pairs (n)</div>
            <div className="text-base font-bold text-slate-900 mt-0.5">
              {Number(results["n"] ?? analysis.sampleSize).toLocaleString()}
            </div>
          </div>
        </div>

        {rows && cols && counts && (
          <div className="border border-slate-200 rounded overflow-x-auto">
            <table className="w-full text-[11px] text-left">
              <thead className="bg-slate-50 text-slate-600 font-medium border-b border-slate-200 font-sans">
                <tr>
                  <th className="px-2.5 py-1.5 bg-slate-100">
                    {variables[0] ?? "Row"} \ {variables[1] ?? "Col"}
                  </th>
                  {cols.map((c) => (
                    <th key={c} className="px-2.5 py-1.5 text-right">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r, rIdx) => (
                  <tr key={r}>
                    <td className="px-2.5 py-1.5 font-semibold text-slate-900 bg-slate-50/50">
                      {r}
                    </td>
                    {cols.map((_, cIdx) => (
                      <td key={cIdx} className="px-2.5 py-1.5 text-right text-slate-800">
                        {(counts[rIdx]?.[cIdx] ?? 0).toLocaleString()}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  if (type.startsWith("persona_")) {
    return (
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 text-xs font-mono">
        {type === "persona_engineer" && (
          <>
            <div className="rounded border border-slate-200 bg-slate-50 p-2">
              <div className="text-[10px] text-slate-500 font-sans">P50 / P99 Latency</div>
              <div className="text-sm font-bold text-slate-900 mt-0.5">
                {fmt(results["p50"] as number | null)} / {fmt(results["p99"] as number | null)} ms
              </div>
            </div>
            <div className="rounded border border-slate-200 bg-slate-50 p-2">
              <div className="text-[10px] text-slate-500 font-sans">Tail Ratio</div>
              <div className="text-sm font-bold text-slate-900 mt-0.5">
                {typeof results["tailRatio"] === "number"
                  ? `${(results["tailRatio"] as number).toFixed(2)}×`
                  : "—"}
              </div>
            </div>
            {"actualAvailabilityPercent" in results && (
              <>
                <div className="rounded border border-slate-200 bg-slate-50 p-2">
                  <div className="text-[10px] text-slate-500 font-sans">SLO Compliance</div>
                  <div className="text-sm font-bold text-emerald-700 mt-0.5">
                    {typeof results["actualAvailabilityPercent"] === "number"
                      ? `${(results["actualAvailabilityPercent"] as number).toFixed(2)}%`
                      : "—"}
                  </div>
                </div>
                <div className="rounded border border-slate-200 bg-slate-50 p-2">
                  <div className="text-[10px] text-slate-500 font-sans">Breaches</div>
                  <div className="text-sm font-bold text-slate-900 mt-0.5">
                    {Number(results["breachCount"] ?? 0).toLocaleString()}
                  </div>
                </div>
              </>
            )}
          </>
        )}
        {type === "persona_economist" && (
          <>
            {"pointElasticity" in results && (
              <>
                <div className="rounded border border-slate-200 bg-slate-50 p-2">
                  <div className="text-[10px] text-slate-500 font-sans">Elasticity (Ep)</div>
                  <div className="text-sm font-bold text-slate-900 mt-0.5">
                    {typeof results["pointElasticity"] === "number"
                      ? (results["pointElasticity"] as number).toFixed(3)
                      : "—"}
                  </div>
                </div>
                <div className="rounded border border-slate-200 bg-slate-50 p-2">
                  <div className="text-[10px] text-slate-500 font-sans">Classification</div>
                  <div className="text-xs font-semibold text-slate-800 mt-0.5 font-sans">
                    {String(results["classification"] ?? "")}
                  </div>
                </div>
              </>
            )}
            {"gini" in results && (
              <div className="rounded border border-slate-200 bg-slate-50 p-2">
                <div className="text-[10px] text-slate-500 font-sans">Gini Index</div>
                <div className="text-sm font-bold text-slate-900 mt-0.5">
                  {typeof results["gini"] === "number"
                    ? (results["gini"] as number).toFixed(3)
                    : "—"}
                </div>
              </div>
            )}
          </>
        )}
        {type === "persona_scientist" && (
          <>
            <div className="rounded border border-slate-200 bg-slate-50 p-2">
              <div className="text-[10px] text-slate-500 font-sans">Shapiro-Wilk W</div>
              <div className="text-sm font-bold text-slate-900 mt-0.5">
                {typeof results["shapiroWilkW"] === "number"
                  ? (results["shapiroWilkW"] as number).toFixed(3)
                  : "—"}
              </div>
            </div>
            <div className="rounded border border-slate-200 bg-slate-50 p-2">
              <div className="text-[10px] text-slate-500 font-sans">Skewness</div>
              <div className="text-sm font-bold text-slate-900 mt-0.5">
                {typeof results["skewness"] === "number"
                  ? (results["skewness"] as number).toFixed(3)
                  : "—"}
              </div>
            </div>
            <div className="rounded border border-slate-200 bg-slate-50 p-2">
              <div className="text-[10px] text-slate-500 font-sans">Excess Kurtosis</div>
              <div className="text-sm font-bold text-slate-900 mt-0.5">
                {typeof results["kurtosis"] === "number"
                  ? (results["kurtosis"] as number).toFixed(3)
                  : "—"}
              </div>
            </div>
          </>
        )}
        {type === "persona_product" && (
          <>
            <div className="rounded border border-slate-200 bg-slate-50 p-2">
              <div className="text-[10px] text-slate-500 font-sans">Relative Lift</div>
              <div className="text-sm font-bold text-emerald-700 mt-0.5">
                {typeof results["relativeLift"] === "number"
                  ? `${(results["relativeLift"] as number).toFixed(2)}%`
                  : "—"}
              </div>
            </div>
            <div className="rounded border border-slate-200 bg-slate-50 p-2">
              <div className="text-[10px] text-slate-500 font-sans">p-Value</div>
              <div className="text-sm font-bold text-slate-900 mt-0.5">
                {typeof results["pValue"] === "number"
                  ? (results["pValue"] as number) < 0.001
                    ? "< 0.001"
                    : (results["pValue"] as number).toFixed(4)
                  : "—"}
              </div>
            </div>
          </>
        )}
        {type === "persona_clinical" && (
          <>
            <div className="rounded border border-slate-200 bg-slate-50 p-2">
              <div className="text-[10px] text-slate-500 font-sans">Odds Ratio</div>
              <div className="text-sm font-bold text-slate-900 mt-0.5">
                {typeof results["oddsRatio"] === "number"
                  ? (results["oddsRatio"] as number).toFixed(2)
                  : "—"}
              </div>
            </div>
            <div className="rounded border border-slate-200 bg-slate-50 p-2">
              <div className="text-[10px] text-slate-500 font-sans">95% CI</div>
              <div className="text-xs font-semibold text-slate-800 mt-0.5">
                [
                {typeof results["ciLower"] === "number"
                  ? (results["ciLower"] as number).toFixed(2)
                  : "—"}
                ,{" "}
                {typeof results["ciUpper"] === "number"
                  ? (results["ciUpper"] as number).toFixed(2)
                  : "—"}
                ]
              </div>
            </div>
          </>
        )}
      </div>
    );
  }

  return null;
}

function Reports() {
  const {
    active,
    activeProject,
    setObjective,
    rawDataset,
    cleaningSteps,
    savedAnalyses,
    user,
    saveReport,
    loadProjectReports,
  } = useStore();
  const navigate = useNavigate();
  const ds = active?.dataset;
  const report = useMemo(() => (ds ? runDescriptive(ds) : null), [ds]);
  const [objective, setObj] = useState("");
  const [savedReportsList, setSavedReportsList] = useState<Array<{ id: string; title: string; created_at: string }>>([]);

  useEffect(() => {
    setObj(activeProject?.objective || activeProject?.description || "");
  }, [activeProject?.id, activeProject?.objective, activeProject?.description]);

  // Load project reports history if active
  useEffect(() => {
    if (activeProject?.id) {
      loadProjectReports(activeProject.id)
        .then((reps) => {
          setSavedReportsList(reps.map((r) => ({ id: r.id, title: r.title, created_at: r.created_at })));
        })
        .catch(() => {});
    }
  }, [activeProject?.id, loadProjectReports]);

  // Automatic report persistence whenever dataset, objective, cleaning, or analyses change
  useEffect(() => {
    if (activeProject && ds && report) {
      const timer = setTimeout(() => {
        const md = generateReportMarkdown({
          projectName: activeProject.name,
          objective,
          datasetName: ds.name,
          rawRowCount: rawDataset?.rows.length ?? ds.rows.length,
          cleanRowCount: ds.rows.length,
          columnCount: ds.columns.length,
          columnsList: ds.columns,
          cleaningSteps,
          savedAnalyses,
          descriptiveReport: report,
        });

        saveReport({
          projectId: activeProject.id,
          title: `${activeProject.name} Analytical Report`,
          markdown: md,
          objective,
          summary: {
            rawRows: rawDataset?.rows.length ?? ds.rows.length,
            cleanRows: ds.rows.length,
            columns: ds.columns.length,
            analysesCount: savedAnalyses.length,
          },
        }).catch(() => {});
      }, 500);

      return () => clearTimeout(timer);
    }
  }, [
    activeProject?.id,
    objective,
    ds,
    report,
    rawDataset?.rows.length,
    cleaningSteps,
    savedAnalyses,
    saveReport,
  ]);

  if (!ds || !report) {
    return (
      <>
        <PageHeader title="Reports" />
        <EmptyState
          title="Nothing to report yet"
          action={
            <Button
              className="bg-blue-600 text-xs text-white hover:bg-blue-700"
              onClick={() => navigate({ to: "/workspace" })}
            >
              Go to Data Workspace
            </Button>
          }
        >
          A report is assembled deterministically from the loaded dataset, data cleaning history,
          and saved analytical results.
        </EmptyState>
      </>
    );
  }

  const withMissing = report.profiles.filter((p) => p.missing > 0);
  const excluded = report.profiles.filter(
    (p) => p.type === "text" || p.type === "date" || p.type === "empty",
  );

  const handleExportMarkdown = () => {
    const md = generateReportMarkdown({
      projectName: activeProject?.name ?? ds.name,
      objective,
      datasetName: ds.name,
      rawRowCount: rawDataset?.rows.length ?? ds.rows.length,
      cleanRowCount: ds.rows.length,
      columnCount: ds.columns.length,
      columnsList: ds.columns,
      cleaningSteps,
      savedAnalyses,
      descriptiveReport: report,
    });
    downloadText(`${(activeProject?.name ?? ds.name).replace(/\.[^.]+$/, "")}-report.md`, md);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description="Structured analytical summary generated across dataset inventory, cleaning transformations, and completed analyses."
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 border-slate-300 text-xs text-slate-700 hover:bg-slate-50 font-medium"
              onClick={handleExportMarkdown}
            >
              <FileCode className="mr-1.5 size-3.5 text-slate-500" />
              Export Markdown
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 border-slate-300 text-xs text-slate-700 hover:bg-slate-50 font-medium"
              onClick={() =>
                downloadText(
                  `${ds.name.replace(/\.[^.]+$/, "")}-report.csv`,
                  descriptiveToCsv(report),
                )
              }
            >
              <Download className="mr-1.5 size-3.5 text-slate-500" />
              Export Descriptives CSV
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 border-slate-300 text-xs text-slate-700 hover:bg-slate-50 font-medium"
              onClick={() => window.print()}
            >
              <Printer className="mr-1.5 size-3.5 text-slate-500" />
              Print / Save as PDF
            </Button>
          </div>
        }
      />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 border-slate-300 text-xs text-slate-700 hover:bg-slate-50 font-medium"
              onClick={() =>
                downloadText(
                  `${ds.name.replace(/\.[^.]+$/, "")}-report.csv`,
                  descriptiveToCsv(report),
                )
              }
            >
              <Download className="mr-1.5 size-3.5 text-slate-500" />
              Export Descriptives CSV
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 border-slate-300 text-xs text-slate-700 hover:bg-slate-50 font-medium"
              onClick={() => window.print()}
            >
              <Printer className="mr-1.5 size-3.5 text-slate-500" />
              Print / Save as PDF
            </Button>
          </div>
        }
      />

      <article className="rounded-md border border-slate-200 bg-white p-6 md:p-8 space-y-6 shadow-2xs print:border-none print:shadow-none print:p-0">
        <header className="border-b border-slate-200 pb-3">
          <div className="text-[11px] font-medium text-slate-400">Statistical Analysis Report</div>
          <h1 className="mt-1 text-xl font-bold tracking-tight text-slate-900">
            {activeProject?.name ?? ds.name}
          </h1>
          <div className="num mt-1 text-[11px] font-mono text-slate-500">
            Generated {new Date().toLocaleString()} • Lumetra Client-Side Engine • Project Status:{" "}
            <span className="font-semibold text-slate-700">
              {activeProject?.status ?? "Active Workspace Session"}
            </span>
          </div>
        </header>

        {/* SECTION 1: OBJECTIVE & HYPOTHESIS */}
        <Section n={1} title="Objective & Hypothesis">
          <Textarea
            aria-label="Research question or analysis objective"
            className="no-print h-20 text-xs border-slate-300 text-slate-900 bg-white"
            placeholder="State the research hypothesis or analytical question this report addresses…"
            value={objective}
            onChange={(e) => setObj(e.target.value)}
            onBlur={() => setObjective(objective)}
          />
          <p className="hidden whitespace-pre-wrap text-xs text-slate-800 leading-relaxed print:block">
            {objective || "No formal research objective specified."}
          </p>
          {!activeProject && (
            <p className="no-print mt-1 text-[11px] text-slate-500">
              Save the dataset as a project to persist this analytical note.
            </p>
          )}
        </Section>

        {/* SECTION 2: DATASET INVENTORY */}
        <Section n={2} title="Dataset Inventory & Provenance">
          <p className="text-xs text-slate-700 leading-relaxed">
            Source: <strong>“{ds.name}”</strong> (
            {ds.source === "sample" ? "synthetic benchmark dataset" : "user-supplied CSV file"})
            comprising <strong>{report.rowCount.toLocaleString()}</strong> analytical observations
            and <strong>{report.columnCount}</strong> variables:{" "}
            <span className="font-mono text-[11px] text-slate-600">
              {report.profiles.map((p) => `${p.name} (${p.type})`).join(", ")}
            </span>
            .
            {rawDataset && rawDataset.rows.length !== ds.rows.length && (
              <span className="block mt-1 text-[11px] text-slate-500">
                (Imported with {rawDataset.rows.length.toLocaleString()} raw rows before cleaning
                transformations).
              </span>
            )}
          </p>
        </Section>

        {/* SECTION 3: DATA CLEANING HISTORY */}
        {cleaningSteps.length > 0 && (
          <Section n={3} title="Data Cleaning & Transformation History">
            <div className="space-y-2 text-xs">
              <p className="text-slate-600 text-[11px]">
                {cleaningSteps.length} cleaning transformation(s) were applied sequentially. The
                original raw data remains intact.
              </p>
              <div className="divide-y divide-slate-100 border border-slate-200 rounded overflow-hidden">
                {cleaningSteps.map((s, idx) => (
                  <div
                    key={s.id}
                    className="p-2.5 bg-slate-50/50 flex items-center justify-between"
                  >
                    <div>
                      <span className="font-semibold text-slate-900 text-xs">
                        {idx + 1}. {s.description}
                      </span>
                      <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                        Rows: {s.effect.rowsBefore.toLocaleString()} →{" "}
                        {s.effect.rowsAfter.toLocaleString()} | Nulls:{" "}
                        {s.effect.missingBefore.toLocaleString()} →{" "}
                        {s.effect.missingAfter.toLocaleString()}
                      </div>
                    </div>
                    <span className="text-[10px] text-slate-400 font-mono">
                      {new Date(s.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </Section>
        )}

        {/* SECTION 4: COMPUTATIONAL METHODOLOGY */}
        <Section n={cleaningSteps.length > 0 ? 4 : 3} title="Computational Methodology">
          <MethodNote />
        </Section>

        {/* SECTION 5: SAVED PROJECT ANALYSES */}
        {savedAnalyses.length > 0 && (
          <Section n={cleaningSteps.length > 0 ? 5 : 4} title="Completed Project Analyses">
            <div className="space-y-6">
              {savedAnalyses.map((a, idx) => {
                const stale = isAnalysisStale(a, ds);
                return (
                  <div
                    key={a.id}
                    className="rounded border border-slate-200 bg-white p-4 space-y-4"
                  >
                    <div className="flex flex-wrap items-center justify-between border-b border-slate-100 pb-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-blue-50 text-blue-800 border border-blue-200">
                            {a.type.toUpperCase()}
                          </span>
                          <h3 className="font-bold text-slate-900 text-xs">{a.name}</h3>
                          {stale && (
                            <span className="text-[10px] font-mono font-bold bg-amber-100 text-amber-800 px-1.5 py-0.2 rounded">
                              Based on earlier dataset version
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="text-right text-[11px] font-mono text-slate-500">
                        Sample size: n = {a.sampleSize.toLocaleString()}
                      </div>
                    </div>

                    {/* Computed Numerical Outputs & Comparison Tables */}
                    <AnalysisResultsSummary analysis={a} />

                    {/* Bivariate Scatter Plot for Correlation Analyses */}
                    {a.type === "correlation" &&
                      (() => {
                        const recon = reconstructCorrelationChartData(a, ds);
                        return (
                          <div className="space-y-2 break-inside-avoid">
                            {recon.status === "discrepancy" && (
                              <div className="rounded border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900">
                                <div className="font-semibold flex items-center gap-1.5">
                                  <AlertTriangle className="size-3.5 text-amber-600 shrink-0" />
                                  Dataset Discrepancy Notice
                                </div>
                                <p className="mt-0.5 text-[11px] text-amber-800">{recon.message}</p>
                              </div>
                            )}

                            {recon.data ? (
                              <ScatterPlotChart
                                xLabel={recon.data.colX}
                                yLabel={recon.data.colY}
                                points={recon.data.points}
                                totalPairs={recon.data.n}
                                r={
                                  typeof a.results["r"] === "number"
                                    ? (a.results["r"] as number)
                                    : recon.data.r
                                }
                                pValue={
                                  typeof a.results["pValue"] === "number"
                                    ? (a.results["pValue"] as number)
                                    : recon.data.pValue
                                }
                                method={recon.data.method}
                                regression={recon.data.regression}
                                trendLine={recon.data.trendLine}
                                missingCount={a.missingCount}
                                staleNotice={
                                  recon.status === "stale"
                                    ? "Earlier dataset version"
                                    : recon.status === "discrepancy"
                                      ? "Discrepancy with active data"
                                      : undefined
                                }
                                caption={`Report Figure: Paired observations of ${recon.data.colY} versus ${recon.data.colX} with fitted OLS reference line.`}
                              />
                            ) : (
                              <div className="rounded border border-dashed border-slate-200 bg-slate-50/50 p-3 text-xs text-slate-500">
                                <span className="font-medium text-slate-700">
                                  Scatter plot not available:{" "}
                                </span>
                                <span>
                                  {recon.message ?? "Observations cannot be reconstructed."}
                                </span>
                              </div>
                            )}
                          </div>
                        );
                      })()}

                    {/* Interpretation Grid */}
                    <div className="grid gap-2.5 sm:grid-cols-2 text-xs">
                      <div className="bg-slate-50 p-2.5 rounded border border-slate-100 space-y-1">
                        <strong className="text-[11px] text-slate-900">Observed Results:</strong>
                        <ul className="list-disc pl-4 text-[11px] text-slate-700 space-y-0.5">
                          {a.interpretation.observedResults.map((line, i) => (
                            <li key={i}>{line}</li>
                          ))}
                        </ul>
                      </div>
                      <div className="bg-slate-50 p-2.5 rounded border border-slate-100 space-y-1">
                        <strong className="text-[11px] text-slate-900">
                          Statistical Inference:
                        </strong>
                        <ul className="list-disc pl-4 text-[11px] text-slate-700 space-y-0.5">
                          {a.interpretation.statisticalInference.map((line, i) => (
                            <li key={i}>{line}</li>
                          ))}
                        </ul>
                      </div>
                    </div>

                    <div className="text-[11px] text-slate-500 space-y-1 border-t border-slate-100 pt-2">
                      <p>
                        • <strong>Assumptions:</strong> {a.interpretation.assumptions.join("; ")}
                      </p>
                      <p>
                        • <strong>Limitations:</strong> {a.interpretation.limitations.join("; ")}
                      </p>
                      <p>
                        • <strong>Recommendations:</strong>{" "}
                        {a.interpretation.recommendations.join("; ")}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>
        )}

        {/* SECTION 6: BASELINE DESCRIPTIVE RESULTS */}
        <Section
          n={
            cleaningSteps.length > 0
              ? savedAnalyses.length > 0
                ? 6
                : 5
              : savedAnalyses.length > 0
                ? 5
                : 4
          }
          title="Descriptive Results"
        >
          <ResultsView report={report} />
        </Section>

        {/* SECTION 7: LIMITATIONS & DATA QUALITY AUDIT */}
        <Section
          n={
            cleaningSteps.length > 0
              ? savedAnalyses.length > 0
                ? 7
                : 6
              : savedAnalyses.length > 0
                ? 6
                : 5
          }
          title="Limitations & Data Quality Audit"
        >
          <ul className="list-disc space-y-1.5 pl-5 text-xs text-slate-600 leading-relaxed">
            {withMissing.length === 0 ? (
              <li>Zero missing values detected; all rows completely observed.</li>
            ) : (
              withMissing.map((p) => (
                <li key={p.name}>
                  Column <strong>“{p.name}”</strong> contains {p.missing.toLocaleString()} missing
                  values ({fmt(p.missingPct, 1)}%), excluded from calculations.
                </li>
              ))
            )}
            {excluded.length > 0 && (
              <li>
                Excluded from descriptive tables:{" "}
                {excluded.map((p) => `“${p.name}” (${p.type})`).join(", ")}.
              </li>
            )}
            <li>
              Descriptive statistics summarize this observed sample. They do not infer causal
              relationships or generalize to broader populations without a randomized sampling
              design.
            </li>
            {ds.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Section>
      </article>
    </div>
  );
}

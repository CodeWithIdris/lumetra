import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, PageHeader } from "@/components/AppShell";
import { MethodNote, ResultsView } from "@/components/ResultsView";
import { useStore } from "@/lib/store";
import { runDescriptive, isAnalysisStale, type DescriptiveReport, type SavedAnalysis } from "@/lib/stats/analysis";
import { fmt } from "@/lib/stats/descriptive";
import { descriptiveToCsv, downloadText } from "@/lib/data/export";
import { pageMeta } from "@/lib/meta";
import { Printer, Download, FileText, Wand2, Layers, AlertTriangle, FileCode } from "lucide-react";

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

function generateReportMarkdown(
  projectName: string,
  objective: string,
  dsName: string,
  rawRows: number,
  cleanRows: number,
  colsCount: number,
  colsList: string[],
  cleaningSteps: Array<{ description: string; effect: { rowsBefore: number; rowsAfter: number } }>,
  savedAnalyses: SavedAnalysis[],
  descriptiveReport: DescriptiveReport,
): string {
  const lines: string[] = [];
  lines.push(`# Statistical Analysis Report: ${projectName}`);
  lines.push(`Generated: ${new Date().toISOString()} • Lumetra Analytical Engine\n`);

  lines.push(`## 1. Objective & Analytical Hypothesis`);
  lines.push(objective || "No formal research objective specified.\n");

  lines.push(`## 2. Dataset Inventory`);
  lines.push(`- Dataset: ${dsName}`);
  lines.push(`- Dimensions: ${cleanRows.toLocaleString()} analytical rows × ${colsCount} columns (Original: ${rawRows.toLocaleString()} rows)`);
  lines.push(`- Schema: ${colsList.join(", ")}\n`);

  if (cleaningSteps.length > 0) {
    lines.push(`## 3. Data Cleaning & Transformation History`);
    cleaningSteps.forEach((s, idx) => {
      lines.push(`${idx + 1}. ${s.description} (Rows: ${s.effect.rowsBefore} → ${s.effect.rowsAfter})`);
    });
    lines.push("");
  }

  lines.push(`## 4. Analytical Findings & Saved Analyses`);
  if (savedAnalyses.length === 0) {
    lines.push("No specific parametric or domain analyses saved yet. Baseline descriptive statistics provided below.\n");
  } else {
    savedAnalyses.forEach((a, idx) => {
      lines.push(`### 4.${idx + 1} ${a.name}`);
      lines.push(`- Type: ${a.type.toUpperCase()}`);
      lines.push(`- Effective Sample Size: n = ${a.sampleSize.toLocaleString()}`);
      lines.push(`- Missing Data Policy: ${a.missingHandling}`);
      lines.push(`\n**Interpretation:**`);
      lines.push(`- Observed Results: ${a.interpretation.observedResults.join(" ")}`);
      lines.push(`- Statistical Inference: ${a.interpretation.statisticalInference.join(" ")}`);
      lines.push(`- Assumptions: ${a.interpretation.assumptions.join(" ")}`);
      lines.push(`- Limitations: ${a.interpretation.limitations.join(" ")}`);
      lines.push(`- Recommendations: ${a.interpretation.recommendations.join(" ")}\n`);
    });
  }

  lines.push(`## 5. Descriptive Statistics Summary`);
  descriptiveReport.numeric.forEach((num) => {
    const s = num.summary;
    lines.push(`- **${num.column}** (n = ${s.n}): Mean = ${fmt(s.mean)}, Median = ${fmt(s.median)}, SD = ${fmt(s.sd)}, Range = [${fmt(s.min)}, ${fmt(s.max)}]`);
  });
  lines.push("");

  lines.push(`## 6. Limitations & Data Quality Audit`);
  lines.push("- Missing values are excluded pairwise and never coerced to zero.");
  lines.push("- Statistical associations summarize observed data and do not establish causal relationships.");

  return lines.join("\n");
}

function Reports() {
  const { active, activeProject, setObjective, rawDataset, cleaningSteps, savedAnalyses } = useStore();
  const navigate = useNavigate();
  const ds = active?.dataset;
  const report = useMemo(() => (ds ? runDescriptive(ds) : null), [ds]);
  const [objective, setObj] = useState("");

  useEffect(() => {
    setObj(activeProject?.objective || activeProject?.description || "");
  }, [activeProject?.id]);

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
    const md = generateReportMarkdown(
      activeProject?.name ?? ds.name,
      objective,
      ds.name,
      rawDataset?.rows.length ?? ds.rows.length,
      ds.rows.length,
      ds.columns.length,
      ds.columns,
      cleaningSteps,
      savedAnalyses,
      report,
    );
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

      <article className="rounded-md border border-slate-200 bg-white p-6 md:p-8 space-y-6 shadow-2xs print:border-none print:shadow-none print:p-0">
        <header className="border-b border-slate-200 pb-3">
          <div className="text-[11px] font-medium text-slate-400">
            Statistical Analysis Report
          </div>
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
            comprising <strong>{report.rowCount.toLocaleString()}</strong> analytical observations and{" "}
            <strong>{report.columnCount}</strong> variables:{" "}
            <span className="font-mono text-[11px] text-slate-600">
              {report.profiles.map((p) => `${p.name} (${p.type})`).join(", ")}
            </span>
            .
            {rawDataset && rawDataset.rows.length !== ds.rows.length && (
              <span className="block mt-1 text-[11px] text-slate-500">
                (Imported with {rawDataset.rows.length.toLocaleString()} raw rows before cleaning transformations).
              </span>
            )}
          </p>
        </Section>

        {/* SECTION 3: DATA CLEANING HISTORY */}
        {cleaningSteps.length > 0 && (
          <Section n={3} title="Data Cleaning & Transformation History">
            <div className="space-y-2 text-xs">
              <p className="text-slate-600 text-[11px]">
                {cleaningSteps.length} cleaning transformation(s) were applied sequentially. The original raw data remains intact.
              </p>
              <div className="divide-y divide-slate-100 border border-slate-200 rounded overflow-hidden">
                {cleaningSteps.map((s, idx) => (
                  <div key={s.id} className="p-2.5 bg-slate-50/50 flex items-center justify-between">
                    <div>
                      <span className="font-semibold text-slate-900 text-xs">
                        {idx + 1}. {s.description}
                      </span>
                      <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                        Rows: {s.effect.rowsBefore.toLocaleString()} → {s.effect.rowsAfter.toLocaleString()} |
                        Nulls: {s.effect.missingBefore.toLocaleString()} → {s.effect.missingAfter.toLocaleString()}
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
                        <strong className="text-[11px] text-slate-900">Statistical Inference:</strong>
                        <ul className="list-disc pl-4 text-[11px] text-slate-700 space-y-0.5">
                          {a.interpretation.statisticalInference.map((line, i) => (
                            <li key={i}>{line}</li>
                          ))}
                        </ul>
                      </div>
                    </div>

                    <div className="text-[11px] text-slate-500 space-y-1 border-t border-slate-100 pt-2">
                      <p>• <strong>Assumptions:</strong> {a.interpretation.assumptions.join("; ")}</p>
                      <p>• <strong>Limitations:</strong> {a.interpretation.limitations.join("; ")}</p>
                      <p>• <strong>Recommendations:</strong> {a.interpretation.recommendations.join("; ")}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>
        )}

        {/* SECTION 6: BASELINE DESCRIPTIVE RESULTS */}
        <Section n={cleaningSteps.length > 0 ? (savedAnalyses.length > 0 ? 6 : 5) : (savedAnalyses.length > 0 ? 5 : 4)} title="Descriptive Results">
          <ResultsView report={report} />
        </Section>

        {/* SECTION 7: LIMITATIONS & DATA QUALITY AUDIT */}
        <Section n={cleaningSteps.length > 0 ? (savedAnalyses.length > 0 ? 7 : 6) : (savedAnalyses.length > 0 ? 6 : 5)} title="Limitations & Data Quality Audit">
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
              relationships or generalize to broader populations without a randomized sampling design.
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

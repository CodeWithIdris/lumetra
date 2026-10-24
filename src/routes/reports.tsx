import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, PageHeader } from "@/components/AppShell";
import { MethodNote, ResultsView } from "@/components/ResultsView";
import { useStore } from "@/lib/store";
import { runDescriptive } from "@/lib/stats/analysis";
import { fmt } from "@/lib/stats/descriptive";
import { descriptiveToCsv, downloadText } from "@/lib/data/export";
import { pageMeta } from "@/lib/meta";
import { Printer, Download, FileText } from "lucide-react";

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

function Reports() {
  const { active, activeProject, setObjective } = useStore();
  const navigate = useNavigate();
  const ds = active?.dataset;
  const report = useMemo(() => (ds ? runDescriptive(ds) : null), [ds]);
  const [objective, setObj] = useState("");
  useEffect(() => setObj(activeProject?.objective ?? ""), [activeProject?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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
          A report is assembled deterministically from the loaded dataset and its computed
          descriptive statistics.
        </EmptyState>
      </>
    );
  }

  const withMissing = report.profiles.filter((p) => p.missing > 0);
  const excluded = report.profiles.filter(
    (p) => p.type === "text" || p.type === "date" || p.type === "empty",
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description="Structured analytical summary generated across all numeric and categorical dimensions."
        actions={
          <div className="flex items-center gap-2">
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
              Export CSV
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
            Generated {new Date().toLocaleString()} • Lumetra Deterministic Engine v0.1
          </div>
        </header>

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
              Save the dataset as a project to persist this text note.
            </p>
          )}
        </Section>

        <Section n={2} title="Dataset Inventory">
          <p className="text-xs text-slate-700 leading-relaxed">
            Source: <strong>“{ds.name}”</strong> (
            {ds.source === "sample" ? "synthetic benchmark dataset" : "user-supplied CSV file"})
            comprising <strong>{report.rowCount.toLocaleString()}</strong> rows and{" "}
            <strong>{report.columnCount}</strong> columns:{" "}
            <span className="font-mono text-[11px] text-slate-600">
              {report.profiles.map((p) => `${p.name} (${p.type})`).join(", ")}
            </span>
            .
          </p>
        </Section>

        <Section n={3} title="Computational Methodology">
          <MethodNote />
        </Section>

        <Section n={4} title="Descriptive Results">
          <ResultsView report={report} />
        </Section>

        <Section n={5} title="Limitations & Data Quality Audit">
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

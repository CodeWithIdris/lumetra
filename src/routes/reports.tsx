import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, PageHeader } from "@/components/AppShell";
import { MethodNote, ResultsView } from "@/components/ResultsView";
import { useStore } from "@/lib/store";
import { runDescriptive } from "@/lib/stats/analysis";
import { fmt } from "@/lib/stats/descriptive";
import { pageMeta } from "@/lib/meta";

export const Route = createFileRoute("/reports")({
  head: () => pageMeta("Reports", "A structured report preview of your dataset, methods, results and limitations."),
  component: Reports,
});

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="break-inside-avoid border-t pt-5">
      <h2 className="mb-3 flex items-baseline gap-3 text-[15px] font-semibold">
        <span className="num text-[12px] text-primary">{n}.</span>{title}
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
        <EmptyState title="Nothing to report yet" action={<Button onClick={() => navigate({ to: "/workspace" })}>Load data</Button>}>
          A report is assembled from the loaded dataset and its computed results.
        </EmptyState>
      </>
    );
  }

  const withMissing = report.profiles.filter((p) => p.missing > 0);
  const excluded = report.profiles.filter((p) => p.type === "text" || p.type === "date" || p.type === "empty");

  return (
    <>
      <PageHeader
        title="Reports"
        description="Preview generated from all numeric and categorical columns. PDF and Word export are planned; use your browser's print dialog to save a PDF for now."
        actions={<Button variant="outline" onClick={() => window.print()}>Print / save as PDF</Button>}
      />
      <article className="panel space-y-6 p-6 md:p-8">
        <header>
          <div className="eyebrow">Descriptive report</div>
          <h1 className="mt-1 text-lg font-semibold">{activeProject?.name ?? ds.name}</h1>
          <div className="num text-[12px] text-muted-foreground">Generated {new Date().toLocaleString()} with Lumetra v0.1</div>
        </header>
        <Section n={1} title="Objective">
          <Textarea
            aria-label="Research question or analysis objective"
            className="no-print"
            placeholder="State the question this analysis is meant to answer…"
            value={objective}
            onChange={(e) => setObj(e.target.value)}
            onBlur={() => setObjective(objective)}
          />
          <p className="hidden whitespace-pre-wrap text-[13px] print:block">{objective || "Not stated."}</p>
          {!activeProject && <p className="no-print mt-1 text-[12px] text-muted-foreground">Save the dataset as a project to keep this text.</p>}
        </Section>
        <Section n={2} title="Dataset">
          <p className="text-[13px]">
            “{ds.name}” ({ds.source === "sample" ? "synthetic sample data" : "user-supplied file"}) with{" "}
            {report.rowCount.toLocaleString()} rows and {report.columnCount} columns:{" "}
            {report.profiles.map((p) => `${p.name} (${p.type})`).join(", ")}.
          </p>
        </Section>
        <Section n={3} title="Methods"><MethodNote /></Section>
        <Section n={4} title="Results"><ResultsView report={report} /></Section>
        <Section n={5} title="Limitations and missing data">
          <ul className="list-disc space-y-1 pl-5 text-[13px]">
            {withMissing.length === 0 ? <li>No missing values were detected.</li> : withMissing.map((p) => (
              <li key={p.name}>“{p.name}”: {p.missing} missing ({fmt(p.missingPct, 1)}%), excluded from calculations.</li>
            ))}
            {excluded.length > 0 && <li>Not analysed: {excluded.map((p) => `“${p.name}” (${p.type})`).join(", ")}.</li>}
            <li>Descriptive statistics summarise this sample only; they do not establish causes or generalise to a population without an appropriate sampling design.</li>
            {ds.warnings.map((w) => <li key={w}>{w}</li>)}
          </ul>
        </Section>
      </article>
    </>
  );
}

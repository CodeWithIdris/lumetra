import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState, Notice, PageHeader } from "@/components/AppShell";
import { MethodNote, ResultsView } from "@/components/ResultsView";
import { useStore } from "@/lib/store";
import { profileDataset } from "@/lib/data/infer";
import { runDescriptive, type DescriptiveReport } from "@/lib/stats/analysis";
import { descriptiveToCsv, downloadText } from "@/lib/data/export";
import { pageMeta } from "@/lib/meta";

export const Route = createFileRoute("/analyses")({
  head: () => pageMeta("Analyses", "Compute descriptive statistics, frequency tables and distributions from your dataset."),
  component: Analyses,
});

const CATALOGUE = [
  { id: "descriptive", name: "Descriptive statistics", desc: "Mean, median, range, SD, frequencies and distributions.", ready: true },
  { id: "crosstab", name: "Cross-tabulation", desc: "Counts across two categorical variables.", ready: false },
  { id: "correlation", name: "Correlation", desc: "Pearson and Spearman coefficients.", ready: false },
  { id: "ttest", name: "Group comparison", desc: "t-tests and non-parametric alternatives.", ready: false },
] as const;

function Analyses() {
  const { active, setStatus } = useStore();
  const navigate = useNavigate();
  const ds = active?.dataset;
  const profiles = useMemo(() => (ds ? profileDataset(ds) : []), [ds]);
  const eligible = profiles.filter((p) => p.type === "numeric" || p.type === "categorical");
  const [selected, setSelected] = useState<string[] | null>(null);
  const [report, setReport] = useState<DescriptiveReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reportFor, setReportFor] = useState<string | null>(null);

  // Selections never outlive the dataset they were made for.
  useEffect(() => setSelected(null), [ds?.id]);
  const sel = (selected ?? eligible.map((p) => p.name)).filter((n) => eligible.some((p) => p.name === n));
  const stale = report && reportFor !== ds?.id;

  function run() {
    if (!ds) return;
    setError(null);
    if (sel.length === 0) return setError("Select at least one column.");
    try {
      setReport(runDescriptive(ds, sel));
      setReportFor(ds.id);
      setStatus("analysed");
    } catch (e) {
      setError(e instanceof Error ? e.message : "The analysis failed.");
    }
  }

  if (!ds) {
    return (
      <>
        <PageHeader title="Analyses" />
        <EmptyState title="No dataset loaded" action={<Button onClick={() => navigate({ to: "/workspace" })}>Go to Data Workspace</Button>}>
          Load a CSV file or the synthetic sample first.
        </EmptyState>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Analyses"
        description={`Dataset: ${ds.name} · ${ds.rows.length.toLocaleString()} rows`}
        actions={report && !stale && (
          <Button variant="outline" onClick={() => downloadText(`${ds.name.replace(/\.[^.]+$/, "")}-descriptives.csv`, descriptiveToCsv(report))}>
            Export results (CSV)
          </Button>
        )}
      />
      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <aside className="space-y-4">
          <section>
            <h2 className="eyebrow mb-2">Catalogue</h2>
            <ul className="space-y-1.5">
              {CATALOGUE.map((a) => (
                <li key={a.id} className={`rounded-md border px-3 py-2 ${a.ready ? "border-primary bg-accent" : "opacity-60"}`} aria-disabled={!a.ready}>
                  <div className="flex items-center justify-between text-[13px] font-medium">
                    {a.name}
                    {!a.ready && <span className="eyebrow">Planned</span>}
                  </div>
                  <div className="text-[12px] text-muted-foreground">{a.desc}</div>
                </li>
              ))}
            </ul>
          </section>
          <section className="panel p-3">
            <h2 className="eyebrow mb-2">Columns</h2>
            {eligible.length === 0 ? (
              <p className="text-[12.5px] text-muted-foreground">No numeric or categorical columns were found.</p>
            ) : (
              <ul className="space-y-1.5">
                {eligible.map((p) => (
                  <li key={p.name}>
                    <label className="flex cursor-pointer items-center gap-2 text-[13px]">
                      <Checkbox
                        checked={sel.includes(p.name)}
                        onCheckedChange={(c) => setSelected(c ? [...sel, p.name] : sel.filter((x) => x !== p.name))}
                      />
                      <span className="truncate">{p.name}</span>
                      <span className="num ml-auto text-[11px] text-muted-foreground">{p.type}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
            {profiles.length > eligible.length && (
              <p className="mt-2 text-[11.5px] text-muted-foreground">Text, date and empty columns are not included in descriptive statistics yet.</p>
            )}
            <Button className="mt-3 w-full" onClick={run} disabled={eligible.length === 0}>Run analysis</Button>
          </section>
          <section className="panel p-3">
            <h2 className="eyebrow mb-2">Method</h2>
            <MethodNote />
          </section>
        </aside>
        <div className="min-w-0 space-y-4">
          {error && <Notice tone="error">{error}</Notice>}
          {stale && <Notice tone="warning">The dataset changed. Run the analysis again to update results.</Notice>}
          {report && !stale ? (
            <ResultsView report={report} />
          ) : (
            <EmptyState title="No results yet">Choose columns and select “Run analysis”. Results are computed from the loaded data only.</EmptyState>
          )}
        </div>
      </div>
    </>
  );
}

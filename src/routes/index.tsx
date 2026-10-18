import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/AppShell";
import { useStore } from "@/lib/store";
import { pageMeta } from "@/lib/meta";

export const Route = createFileRoute("/")({
  head: () => pageMeta("Overview", "Start a new analysis, open a sample project, or continue recent work in Lumetra."),
  component: Overview,
});

const STEPS = [
  ["Import", "Upload a CSV file. It is read in your browser and never sent to a server."],
  ["Inspect", "Check column types, missing values and rows before analysing."],
  ["Analyse", "Compute descriptive statistics, frequencies and distributions."],
  ["Report", "Review the findings, method notes and limitations, then export."],
] as const;

function Overview() {
  const { projects, ready, loadSample, openProject } = useStore();
  const navigate = useNavigate();
  const recent = [...projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 5);

  return (
    <div className="space-y-10">
      <section className="border-b pb-8">
        <p className="eyebrow mb-3">Overview</p>
        <h1 className="max-w-2xl text-2xl font-semibold tracking-tight md:text-[28px] md:leading-tight">
          Welcome to Lumetra. Turn a raw dataset into results you can explain and defend.
        </h1>
        <p className="mt-3 max-w-xl text-[13.5px] text-muted-foreground">
          Every number shown is computed from your data with a stated method. Processing happens on this device.
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          <Button onClick={() => navigate({ to: "/workspace" })}>Start a new analysis</Button>
          <Button
            variant="outline"
            onClick={() => {
              loadSample();
              navigate({ to: "/workspace" });
            }}
          >
            Open a sample project
          </Button>
        </div>
        <p className="mt-3 text-[12px] text-muted-foreground">
          The sample is a synthetic survey of 60 fictional respondents, generated for demonstration only.
        </p>
      </section>

      <section>
        <h2 className="eyebrow mb-3">Getting started</h2>
        <ol className="grid gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map(([t, d], i) => (
            <li key={t} className="bg-surface p-4">
              <div className="num text-[11px] text-primary">0{i + 1}</div>
              <div className="mt-1 font-medium">{t}</div>
              <p className="mt-1 text-[12.5px] text-muted-foreground">{d}</p>
            </li>
          ))}
        </ol>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="eyebrow">Recent projects</h2>
          {recent.length > 0 && <Link to="/projects" className="text-[12.5px] text-primary hover:underline">All projects</Link>}
        </div>
        {!ready ? null : recent.length === 0 ? (
          <EmptyState title="No saved projects yet">
            Load a dataset in the Data Workspace and choose “Save as project” to keep it on this device.
          </EmptyState>
        ) : (
          <ul className="panel divide-y">
            {recent.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <div className="truncate font-medium">{p.name}</div>
                  <div className="text-[12px] text-muted-foreground">
                    {p.dataset ? `${p.dataset.name} · ${p.dataset.rows.toLocaleString()} rows` : "No dataset"} · updated{" "}
                    {new Date(p.updatedAt).toLocaleDateString()}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const r = openProject(p.id);
                    navigate({ to: "/workspace", search: r.error ? { notice: r.error } : {} });
                  }}
                >
                  Open
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

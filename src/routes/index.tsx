import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/AppShell";
import { useStore } from "@/lib/store";
import { pageMeta } from "@/lib/meta";
import { PERSONAS, type PersonaId } from "@/lib/stats/personas";
import {
  Sparkles,
  Database,
  ArrowRight,
  TrendingUp,
  Cpu,
  Boxes,
  Target,
  HeartPulse,
  Shield,
  Layers,
} from "lucide-react";

export const Route = createFileRoute("/")({
  head: () =>
    pageMeta(
      "Overview",
      "Personalized data intelligence workspace with ThreeUI aesthetics, client-side statistics, and Supabase cloud records.",
    ),
  component: Overview,
});

const ROLE_ICONS: Record<PersonaId, typeof Cpu> = {
  engineer: Cpu,
  economist: TrendingUp,
  scientist: Boxes,
  product: Target,
  clinical: HeartPulse,
};

const STEPS = [
  [
    "01",
    "Import Data",
    "Upload any CSV or load your role-tailored benchmark. Processed purely in-browser.",
  ],
  [
    "02",
    "Inspect & Clean",
    "Audit column distributions, zero coercion prevention, and missing value boundaries.",
  ],
  [
    "03",
    "Personalized Analysis",
    "Run tailored statistical engines (P99 latencies, price elasticity, Gini, or A/B lift).",
  ],
  [
    "04",
    "Supabase Safe Records",
    "Safeguard your project datasets and findings permanently with Supabase Cloud DB.",
  ],
] as const;

function Overview() {
  const {
    projects,
    ready,
    loadSample,
    loadPersonaSample,
    openProject,
    startNew,
    persona,
    setPersona,
    user,
  } = useStore();
  const navigate = useNavigate();
  const recent = [...projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 5);
  const currentPersona = PERSONAS[persona];

  return (
    <div className="space-y-12">
      {/* ThreeUI Hero Section */}
      <section className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-b from-indigo-950/30 via-slate-900/60 to-slate-950/80 p-6 md:p-10 shadow-[0_16px_50px_rgba(0,0,0,0.6)] backdrop-blur-2xl">
        <div className="absolute -top-24 left-1/2 -translate-x-1/2 size-96 rounded-full bg-indigo-500/15 blur-3xl pointer-events-none" />

        <div className="relative z-10">
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3 py-1 text-xs font-mono text-indigo-300 shadow-[0_0_15px_rgba(99,102,241,0.25)]">
              <Sparkles className="size-3.5 text-indigo-400" />
              <span>ThreeUI Interface · Client-Side Pure Stats</span>
            </span>

            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-mono text-emerald-300">
              <Database className="size-3.5" />
              <span>Supabase Cloud Safe</span>
            </span>
          </div>

          <h1 className="max-w-3xl text-3xl font-extrabold tracking-tight text-white md:text-5xl md:leading-tight gradient-heading">
            Data intelligence tailored to your exact professional background.
          </h1>

          <p className="mt-4 max-w-2xl text-[14.5px] leading-relaxed text-slate-300">
            An economist doesn't look at P99 tail latency, and an SRE engineer doesn't calculate
            price elasticity. Lumetra personalizes statistical tooling and visual diagnostics
            strictly based on your role, with zero server computation and safe Supabase database
            persistence.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <Button
              className="bg-indigo-600 hover:bg-indigo-500 text-white font-medium shadow-[0_0_25px_rgba(99,102,241,0.45)] px-5 py-2.5 text-sm"
              onClick={() => {
                startNew();
                navigate({ to: "/workspace" });
              }}
            >
              Start New Analysis
            </Button>
            <Button
              variant="outline"
              className="border-white/15 bg-white/5 hover:bg-white/10 text-white text-sm"
              onClick={() => {
                startNew();
                loadPersonaSample(persona);
                navigate({ to: "/workspace" });
              }}
            >
              Open {currentPersona.shortRole} Sample Dataset
            </Button>
          </div>

          <p className="mt-3 text-xs text-slate-400 font-mono">
            Active persona:{" "}
            <span className="text-indigo-300 font-semibold">{currentPersona.title}</span> — Sample
            dataset contains real-world deterministic benchmarks.
          </p>
        </div>
      </section>

      {/* Choose Your Background / Personalize Toolkit Section */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="eyebrow text-indigo-400">Personalize Your Toolkit</h2>
            <p className="text-base font-semibold text-white mt-0.5">
              Select your role to adapt all analyses, metrics & interpretation guides:
            </p>
          </div>
          <span className="text-xs text-slate-400 font-mono hidden sm:inline">1-Click Adapt</span>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(Object.keys(PERSONAS) as PersonaId[]).map((pId) => {
            const p = PERSONAS[pId];
            const Icon = ROLE_ICONS[pId];
            const isSelected = pId === persona;
            return (
              <button
                key={pId}
                onClick={() => setPersona(pId)}
                className={`glass-card p-4 text-left transition-all relative overflow-hidden group ${
                  isSelected
                    ? "border-indigo-500/60 bg-indigo-950/30 shadow-[0_0_25px_rgba(99,102,241,0.25)]"
                    : "border-white/10 hover:border-white/20 hover:bg-slate-900/60"
                }`}
              >
                {isSelected && (
                  <div className="absolute top-2 right-2 flex items-center gap-1 rounded-full bg-indigo-500/20 border border-indigo-500/30 px-2 py-0.5 text-[10px] font-mono text-indigo-300">
                    <span className="size-1.5 rounded-full bg-indigo-400 animate-pulse" />
                    <span>ACTIVE</span>
                  </div>
                )}
                <div className="flex size-9 items-center justify-center rounded-xl bg-indigo-500/20 text-indigo-300 mb-3 group-hover:scale-105 transition-transform">
                  <Icon className="size-4" />
                </div>
                <div className="font-semibold text-white text-[14px]">{p.title}</div>
                <p className="text-xs text-slate-400 mt-1 line-clamp-2">{p.description}</p>
                <div className="mt-3 flex flex-wrap gap-1">
                  {p.keyMetrics.slice(0, 2).map((km) => (
                    <span
                      key={km}
                      className="rounded-md border border-white/5 bg-slate-900/60 px-2 py-0.5 text-[10px] font-mono text-slate-300"
                    >
                      {km}
                    </span>
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* How Lumetra Works */}
      <section className="space-y-4">
        <h2 className="eyebrow text-slate-400">Guaranteed Workflow</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map(([step, title, desc]) => (
            <div
              key={step}
              className="glass-card p-4 relative group hover:border-indigo-500/30 transition-all"
            >
              <div className="num text-xs text-indigo-400 font-mono font-bold">{step}</div>
              <div className="mt-2 font-semibold text-white text-sm">{title}</div>
              <p className="mt-1 text-xs text-slate-400 leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Recent Projects with Supabase Cloud Safe Indicator */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="eyebrow text-slate-400">Recent Projects & Records</h2>
            <span className="flex items-center gap-1 text-[11px] font-mono text-emerald-400">
              <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span>Supabase Safe</span>
            </span>
          </div>
          {recent.length > 0 && (
            <Link
              to="/projects"
              className="text-xs text-indigo-400 hover:text-indigo-300 hover:underline"
            >
              View all projects →
            </Link>
          )}
        </div>

        {!ready ? null : recent.length === 0 ? (
          <EmptyState title="No saved projects yet">
            Upload your CSV file in the Data Workspace or click “Open Sample Dataset” above. Every
            project is safely preserved in Supabase Cloud.
          </EmptyState>
        ) : (
          <div className="glass-card divide-y divide-white/5 overflow-hidden">
            {recent.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between gap-4 p-4 hover:bg-white/5 transition-colors"
              >
                <div className="min-w-0">
                  <div className="font-semibold text-white text-sm truncate">{p.name}</div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    {p.dataset
                      ? `${p.dataset.name} · ${p.dataset.rows.toLocaleString()} rows`
                      : "No dataset"}{" "}
                    · Updated {new Date(p.updatedAt).toLocaleDateString()}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="hidden sm:inline rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 text-[10px] font-mono text-emerald-300">
                    Cloud Synced
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-white/10 text-xs hover:bg-white/10"
                    onClick={() => {
                      const r = openProject(p.id);
                      navigate({ to: "/workspace", search: r.error ? { notice: r.error } : {} });
                    }}
                  >
                    Open
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

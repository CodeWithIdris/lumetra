import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useStore } from "@/lib/store";
import { pageMeta } from "@/lib/meta";
import { PERSONAS, type PersonaId } from "@/lib/stats/personas";
import {
  Trash2,
  Cpu,
  TrendingUp,
  Boxes,
  Target,
  HeartPulse,
  ArrowRight,
  FileSpreadsheet,
  LineChart,
  FileText,
  MessageSquareCode,
  CheckCircle2,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { ProjectMeta } from "@/lib/persistence/projects";
import { toast } from "sonner";

export const Route = createFileRoute("/")({
  head: () =>
    pageMeta(
      "Overview",
      "Production-grade analytical workspace with client-side computation and automatic persistence.",
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

// Persona-tailored analytical tool shortcuts
const PERSONA_ROUTINES: Record<PersonaId, { name: string; desc: string; metric: string }[]> = {
  engineer: [
    {
      name: "Tail Latency & Percentiles",
      desc: "P50, P90, P99 and P99.9 degradation multipliers with request jitter variance.",
      metric: "P99 / P50 ratio",
    },
    {
      name: "SLO Error Budget Simulator",
      desc: "Breach frequency, availability compliance, and error budget burn tracking.",
      metric: "Target % availability",
    },
  ],
  economist: [
    {
      name: "Price Elasticity of Demand",
      desc: "Point elasticity estimation via OLS regression slope with R² goodness of fit.",
      metric: "Ep = (dQ/dP)·(P̄/Q̄)",
    },
    {
      name: "Gini Coefficient & Inequality",
      desc: "Lorenz curve quintiles, top 10% income concentration, and Palma ratio.",
      metric: "0 (equal) to 1 (concentrated)",
    },
  ],
  scientist: [
    {
      name: "Feature Moments & Normality",
      desc: "Skewness, excess kurtosis, 1.5× IQR outlier detection, and Gaussian viability.",
      metric: "g1 skewness & g2 kurtosis",
    },
    {
      name: "Pairwise Correlation Matrix",
      desc: "Pearson correlation matrix across all numeric features in the dataset.",
      metric: "r-coefficient & p-values",
    },
  ],
  product: [
    {
      name: "A/B Experiment Conversion Lift",
      desc: "Two-proportion z-test, absolute & relative lift %, and 95% confidence bounds.",
      metric: "Relative lift % (z-score)",
    },
    {
      name: "Decision Rule Evaluation",
      desc: "Statistically significant determination against 0.05 critical threshold.",
      metric: "p < 0.05 cutoff",
    },
  ],
  clinical: [
    {
      name: "2×2 Contingency Odds Ratio",
      desc: "Wald 95% confidence intervals, relative risk (RR), and Yates-corrected chi-square.",
      metric: "Odds Ratio (OR)",
    },
    {
      name: "Clinical Evidence Summary",
      desc: "Exposure effect size interpretation and clinical outcome significance.",
      metric: "Chi-square p-value",
    },
  ],
};

function Overview() {
  const {
    projects,
    ready,
    loadPersonaSample,
    openProject,
    deleteProject,
    startNew,
    loadFile,
    persona,
    active,
  } = useStore();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [toDelete, setToDelete] = useState<ProjectMeta | null>(null);

  const currentPersona = PERSONAS[persona];
  const PersonaIcon = ROLE_ICONS[persona] || Cpu;
  const recent = [...projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 8);
  const routines = PERSONA_ROUTINES[persona] || [];

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const r = await loadFile(file);
    if (r.errors.length > 0) {
      toast.error(`Error loading dataset: ${r.errors.join(", ")}`);
    } else {
      toast.success(`Loaded dataset “${file.name}”.`);
      navigate({ to: "/workspace" });
    }
  };

  return (
    <div className="space-y-5">
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,text/csv,.txt"
        className="sr-only"
        onChange={handleFileSelect}
      />

      {/* Overview Top Header: Title, Subtitle and Actions on a Single Clean Row */}
      <div className="flex flex-col gap-2.5 border-b border-slate-200 pb-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-baseline gap-2 min-w-0">
          <h1 className="text-lg font-semibold tracking-tight text-slate-900">Overview</h1>
          <span className="hidden text-slate-300 sm:inline">•</span>
          <p className="text-xs text-slate-500">Your data, analyses and recent work.</p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button
            className="h-7.5 bg-blue-600 text-xs font-medium text-white hover:bg-blue-700 px-3 shadow-2xs"
            onClick={() => {
              startNew();
              navigate({ to: "/workspace" });
            }}
          >
            New analysis
          </Button>

          <Button
            variant="outline"
            className="h-7.5 border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-50 px-3"
            onClick={() => {
              if (fileInputRef.current) {
                fileInputRef.current.click();
              } else {
                navigate({ to: "/workspace" });
              }
            }}
          >
            Open dataset
          </Button>
        </div>
      </div>

      {/* Recent Projects Table Section */}
      <section className="space-y-2.5">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold text-slate-800">Recent Projects</h2>
          {recent.length > 0 && (
            <Link
              to="/projects"
              className="text-xs text-blue-600 hover:text-blue-700 hover:underline font-medium"
            >
              View all ({projects.length}) →
            </Link>
          )}
        </div>

        {!ready ? (
          <div className="h-28 rounded border border-slate-200 bg-white animate-pulse" />
        ) : recent.length === 0 ? (
          /* Getting Started Section - Shown Only When No Projects Exist */
          <div className="rounded border border-slate-200 bg-white p-5 shadow-2xs space-y-3.5">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Getting Started with Lumetra</h3>
              <p className="mt-1 text-xs text-slate-600 max-w-xl leading-relaxed">
                Lumetra is an in-browser statistical workspace. All computations run
                deterministically on client-side engines. Missing values are never coerced to zero.
              </p>
            </div>

            <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4 pt-1">
              {[
                {
                  step: "01",
                  title: "Load Dataset",
                  desc: "Import any local CSV file or load a role-specific benchmark sample.",
                },
                {
                  step: "02",
                  title: "Audit Schema & Nulls",
                  desc: "Inspect inferred types and missing values. Nulls are strictly excluded.",
                },
                {
                  step: "03",
                  title: "Run Analytical Engines",
                  desc: "Execute tailored routines: elasticity, latency P99s, Gini, or descriptives.",
                },
                {
                  step: "04",
                  title: "Reports & Findings",
                  desc: "Generate structured reports with automatic persistence and seamless export.",
                },
              ].map((s) => (
                <div key={s.step} className="rounded border border-slate-200 bg-slate-50/70 p-3">
                  <span className="font-mono text-xs font-bold text-blue-600">{s.step}</span>
                  <div className="mt-1 text-xs font-semibold text-slate-900">{s.title}</div>
                  <p className="mt-1 text-[11px] text-slate-500 leading-relaxed">{s.desc}</p>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-100">
              <Button
                size="sm"
                className="h-7.5 bg-blue-600 text-xs text-white hover:bg-blue-700 font-medium px-3"
                onClick={() => {
                  startNew();
                  loadPersonaSample(persona);
                  navigate({ to: "/workspace" });
                }}
              >
                Load {currentPersona.shortRole} Sample Dataset
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7.5 border-slate-300 text-xs text-slate-700 hover:bg-slate-50 font-medium px-3"
                onClick={() => fileInputRef.current?.click()}
              >
                Upload CSV File
              </Button>
            </div>
          </div>
        ) : (
          <div className="rounded border border-slate-200 bg-white overflow-hidden shadow-2xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="border-b border-slate-200 bg-slate-50/90 text-slate-600 font-medium">
                  <tr>
                    <th className="w-[36%] px-3.5 py-2">Project Name</th>
                    <th className="w-[26%] px-3 py-2">Dataset</th>
                    <th className="w-[12%] px-3 py-2 text-right">Rows</th>
                    <th className="w-[14%] px-3 py-2">Last Modified</th>
                    <th className="w-[12%] px-3.5 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {recent.map((p) => (
                    <tr key={p.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="px-3.5 py-2.5 align-middle">
                        <button
                          onClick={async () => {
                            await openProject(p.id);
                            navigate({ to: "/workspace" });
                          }}
                          className="font-semibold text-slate-900 hover:text-blue-600 text-left block truncate max-w-sm"
                        >
                          {p.name}
                        </button>
                        {p.objective && (
                          <div className="text-[11px] text-slate-500 truncate max-w-sm mt-0.5">
                            {p.objective}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 align-middle text-slate-600">
                        {p.dataset ? (
                          <span className="truncate block font-mono text-[11px]">
                            {p.dataset.name}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 align-middle text-right font-mono text-[11px] text-slate-600">
                        {p.dataset ? p.dataset.rows.toLocaleString() : "—"}
                      </td>
                      <td className="px-3 py-2.5 align-middle text-[11px] text-slate-500 font-mono">
                        {new Date(p.updatedAt).toLocaleDateString()}
                      </td>
                      <td className="px-3.5 py-2.5 align-middle text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6.5 text-xs text-blue-600 hover:text-blue-700 hover:bg-blue-50 px-2"
                            onClick={async () => {
                              await openProject(p.id);
                              navigate({ to: "/analyses" });
                            }}
                          >
                            Analyses
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6.5 text-xs text-slate-600 hover:text-slate-900 px-2"
                            onClick={async () => {
                              await openProject(p.id);
                              navigate({ to: "/workspace" });
                            }}
                          >
                            Workspace
                          </Button>
                          <button
                            className="p-1 text-slate-300 hover:text-red-600 transition-colors rounded"
                            onClick={() => setToDelete(p)}
                            aria-label={`Delete ${p.name}`}
                            title={`Delete ${p.name}`}
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* Purposeful Analytical Workbench Section (Utilizes Space Intentionally) */}
      <section className="grid gap-3.5 sm:grid-cols-2 pt-1">
        {/* Panel 1: Domain Analytical Capabilities */}
        <div className="rounded border border-slate-200 bg-white p-4 shadow-2xs space-y-3">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <div className="flex items-center gap-2">
              <PersonaIcon className="size-4 text-blue-600" />
              <h2 className="text-xs font-semibold text-slate-900">
                {currentPersona.shortRole} Analytical Routines
              </h2>
            </div>
            <Link
              to="/analyses"
              className="text-[11px] text-blue-600 hover:text-blue-700 hover:underline font-medium"
            >
              Open toolkit →
            </Link>
          </div>

          <div className="space-y-2">
            {routines.map((r) => (
              <div
                key={r.name}
                className="flex items-start justify-between gap-3 rounded border border-slate-100 bg-slate-50/60 p-2.5 hover:bg-slate-50 transition-colors"
              >
                <div className="min-w-0">
                  <div className="text-xs font-medium text-slate-900">{r.name}</div>
                  <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">{r.desc}</p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6.5 text-[11px] border-slate-200 bg-white text-slate-700 hover:bg-slate-50 px-2 shrink-0 font-medium"
                  onClick={() => navigate({ to: "/analyses" })}
                >
                  Run
                </Button>
              </div>
            ))}
          </div>

          <div className="pt-1 text-[11px] text-slate-500 flex items-center justify-between">
            <span>Deterministic client-side calculation</span>
            <Link to="/settings" className="text-slate-400 hover:text-slate-600 underline">
              Change context
            </Link>
          </div>
        </div>

        {/* Panel 2: Analytical Operations & Workspace Navigation */}
        <div className="rounded border border-slate-200 bg-white p-4 shadow-2xs space-y-3">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <h2 className="text-xs font-semibold text-slate-900">Analytical Workflow Operations</h2>
            <span className="text-[11px] font-mono text-slate-400">
              {active ? "Active dataset ready" : "Awaiting data"}
            </span>
          </div>

          <div className="space-y-2">
            <button
              onClick={() => navigate({ to: "/workspace" })}
              className="w-full flex items-center justify-between rounded border border-slate-100 bg-slate-50/60 p-2.5 text-left hover:bg-slate-50 transition-colors group"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <FileSpreadsheet className="size-4 text-slate-500 shrink-0 group-hover:text-blue-600" />
                <div className="min-w-0">
                  <div className="text-xs font-medium text-slate-900">
                    Tabular Schema & Quality Audit
                  </div>
                  <div className="text-[11px] text-slate-500 truncate mt-0.5">
                    Inspect column inferred types, missing counts, and null distributions.
                  </div>
                </div>
              </div>
              <ArrowRight className="size-3.5 text-slate-400 shrink-0 group-hover:translate-x-0.5 transition-transform" />
            </button>

            <button
              onClick={() => navigate({ to: "/reports" })}
              className="w-full flex items-center justify-between rounded border border-slate-100 bg-slate-50/60 p-2.5 text-left hover:bg-slate-50 transition-colors group"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <FileText className="size-4 text-slate-500 shrink-0 group-hover:text-blue-600" />
                <div className="min-w-0">
                  <div className="text-xs font-medium text-slate-900">
                    Publication Report Preview
                  </div>
                  <div className="text-[11px] text-slate-500 truncate mt-0.5">
                    Structured findings with methodology notes, results tables, and PDF print
                    controls.
                  </div>
                </div>
              </div>
              <ArrowRight className="size-3.5 text-slate-400 shrink-0 group-hover:translate-x-0.5 transition-transform" />
            </button>

            <button
              onClick={() => navigate({ to: "/ask" })}
              className="w-full flex items-center justify-between rounded border border-slate-100 bg-slate-50/60 p-2.5 text-left hover:bg-slate-50 transition-colors group"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <MessageSquareCode className="size-4 text-slate-500 shrink-0 group-hover:text-blue-600" />
                <div className="min-w-0">
                  <div className="text-xs font-medium text-slate-900">
                    Ask Analyst (Client-Side)
                  </div>
                  <div className="text-[11px] text-slate-500 truncate mt-0.5">
                    Natural-language query routing backed by deterministic mathematical code.
                  </div>
                </div>
              </div>
              <ArrowRight className="size-3.5 text-slate-400 shrink-0 group-hover:translate-x-0.5 transition-transform" />
            </button>
          </div>

          <div className="pt-1 text-[11px] text-slate-400">
            All algorithms execute in browser memory; raw data is never exposed.
          </div>
        </div>
      </section>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent className="bg-white text-slate-900 border-slate-200">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete project “{toDelete?.name}”?</AlertDialogTitle>
            <AlertDialogDescription className="text-xs text-slate-600">
              This action cannot be undone. All stored session states and cached analyses for this
              project will be removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-slate-300 text-xs text-slate-700 hover:bg-slate-50">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-xs text-white hover:bg-red-700"
              onClick={() => {
                if (toDelete) {
                  deleteProject(toDelete.id);
                  setToDelete(null);
                  toast.success("Project deleted.");
                }
              }}
            >
              Delete Project
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

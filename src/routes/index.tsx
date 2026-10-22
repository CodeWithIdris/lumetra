import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/AppShell";
import { useStore } from "@/lib/store";
import { pageMeta } from "@/lib/meta";
import { PERSONAS, type PersonaId } from "@/lib/stats/personas";
import {
  FolderKanban,
  Table2,
  LineChart,
  ArrowRight,
  Database,
  Trash2,
  Upload,
  Cpu,
  TrendingUp,
  Boxes,
  Target,
  HeartPulse,
  Check,
  ChevronDown,
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

export const Route = createFileRoute("/")({
  head: () =>
    pageMeta(
      "Overview",
      "Production-grade analytical workspace with client-side computation and cloud persistence.",
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

function Overview() {
  const {
    projects,
    ready,
    loadPersonaSample,
    openProject,
    deleteProject,
    startNew,
    persona,
    setPersona,
  } = useStore();
  const navigate = useNavigate();
  const [toDelete, setToDelete] = useState<ProjectMeta | null>(null);
  const [personaOpen, setPersonaOpen] = useState(false);

  const currentPersona = PERSONAS[persona];
  const PersonaIcon = ROLE_ICONS[persona] || Cpu;
  const recent = [...projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 10);

  return (
    <div className="space-y-8">
      {/* Overview Header & Actions */}
      <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">Overview</h1>
          <p className="mt-1 text-[13px] text-slate-600">Your data, analyses and recent work.</p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <Button
            className="bg-blue-600 text-xs text-white hover:bg-blue-700 font-medium h-8 px-3"
            onClick={() => {
              startNew();
              navigate({ to: "/workspace" });
            }}
          >
            New analysis
          </Button>

          <Button
            variant="outline"
            className="border-slate-300 text-xs text-slate-700 hover:bg-slate-50 font-medium h-8 px-3"
            onClick={() => {
              startNew();
              loadPersonaSample(persona);
              navigate({ to: "/workspace" });
            }}
          >
            Open dataset
          </Button>
        </div>
      </div>

      {/* Professional Context Bar */}
      <div className="flex flex-col gap-2 rounded-md border border-slate-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between shadow-2xs">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-medium text-slate-500">Professional Context:</span>
          <div className="relative">
            <button
              onClick={() => setPersonaOpen(!personaOpen)}
              className="flex items-center gap-1.5 rounded border border-slate-300 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-800 hover:bg-slate-100 transition-colors"
            >
              <PersonaIcon className="size-3.5 text-blue-600" />
              <span>{currentPersona.title}</span>
              <ChevronDown className="size-3 text-slate-400" />
            </button>

            {personaOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setPersonaOpen(false)} />
                <div className="absolute left-0 top-full z-50 mt-1 w-72 rounded-md border border-slate-200 bg-white p-1 shadow-lg">
                  <div className="px-2 py-1.5 text-[10px] font-mono uppercase tracking-wider text-slate-400 font-semibold border-b border-slate-100">
                    Select Context
                  </div>
                  {(Object.keys(PERSONAS) as PersonaId[]).map((pId) => {
                    const p = PERSONAS[pId];
                    const Icon = ROLE_ICONS[pId];
                    const isCurrent = pId === persona;
                    return (
                      <button
                        key={pId}
                        onClick={() => {
                          setPersona(pId);
                          setPersonaOpen(false);
                        }}
                        className={`flex w-full items-start gap-2.5 rounded px-2.5 py-2 text-left text-xs transition-colors ${
                          isCurrent
                            ? "bg-blue-50 text-blue-900 font-semibold"
                            : "text-slate-700 hover:bg-slate-50 hover:text-slate-900"
                        }`}
                      >
                        <Icon
                          className={`mt-0.5 size-3.5 shrink-0 ${isCurrent ? "text-blue-600" : "text-slate-400"}`}
                        />
                        <div className="min-w-0">
                          <div>{p.title}</div>
                          <div className="text-[11px] font-normal text-slate-500 truncate">
                            {p.tagline}
                          </div>
                        </div>
                        {isCurrent && <Check className="mt-0.5 size-3.5 text-blue-600 shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>
        <div className="text-[11px] text-slate-500">
          Adapts statistical diagnostics, interpretation guides and benchmark samples.
        </div>
      </div>

      {/* Recent Projects Table */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-700 font-mono">
            Recent Projects
          </h2>
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
          <div className="h-32 rounded-md border border-slate-200 bg-white animate-pulse" />
        ) : recent.length === 0 ? (
          /* Getting Started Section - Shown Only When No Projects Exist */
          <div className="rounded-md border border-slate-200 bg-white p-6 shadow-2xs space-y-6">
            <div>
              <h3 className="text-base font-semibold text-slate-900">
                Getting Started with Lumetra
              </h3>
              <p className="mt-1 text-xs text-slate-600 max-w-xl leading-relaxed">
                Lumetra is a deterministic statistical analysis application. Computations execute
                purely in-browser using client-side mathematical engines. Projects can optionally be
                synced to Supabase Cloud for persistent record keeping.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 pt-1">
              {[
                {
                  step: "01",
                  title: "Load Dataset",
                  desc: "Import any local CSV file (up to 50 MB) or load a role-specific benchmark dataset.",
                },
                {
                  step: "02",
                  title: "Audit Schema & Nulls",
                  desc: "Inspect inferred types, distinct counts, and missing values. Null values are never coerced to zero.",
                },
                {
                  step: "03",
                  title: "Run Analytical Engines",
                  desc: "Execute tailored statistical routines: latency P99s, elasticity, Gini, or descriptive statistics.",
                },
                {
                  step: "04",
                  title: "Reports & Persistence",
                  desc: "Generate structured, printable reports and preserve your findings safely in Supabase Cloud.",
                },
              ].map((s) => (
                <div key={s.step} className="rounded border border-slate-200 bg-slate-50/70 p-3.5">
                  <span className="font-mono text-xs font-bold text-blue-600">{s.step}</span>
                  <div className="mt-1.5 text-xs font-semibold text-slate-900">{s.title}</div>
                  <p className="mt-1 text-[11px] text-slate-500 leading-relaxed">{s.desc}</p>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap gap-2.5 pt-2 border-t border-slate-100">
              <Button
                size="sm"
                className="bg-blue-600 text-xs text-white hover:bg-blue-700"
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
                className="border-slate-300 text-xs text-slate-700 hover:bg-slate-50"
                onClick={() => {
                  startNew();
                  navigate({ to: "/workspace" });
                }}
              >
                Upload CSV File
              </Button>
            </div>
          </div>
        ) : (
          <div className="rounded-md border border-slate-200 bg-white overflow-hidden shadow-2xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50 text-slate-600 font-medium">
                  <tr>
                    <th className="px-4 py-2.5">Project Name</th>
                    <th className="px-4 py-2.5">Dataset</th>
                    <th className="px-4 py-2.5">Status</th>
                    <th className="px-4 py-2.5">Last Modified</th>
                    <th className="px-4 py-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {recent.map((p) => (
                    <tr key={p.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="px-4 py-3">
                        <button
                          onClick={() => {
                            openProject(p.id);
                            navigate({ to: "/workspace" });
                          }}
                          className="font-semibold text-slate-900 hover:text-blue-600 text-left"
                        >
                          {p.name}
                        </button>
                        {p.objective && (
                          <div className="text-[11px] text-slate-500 truncate max-w-sm">
                            {p.objective}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-[11px] text-slate-600">
                        {p.dataset ? (
                          <span>
                            {p.dataset.name} ({p.dataset.rows.toLocaleString()} rows)
                          </span>
                        ) : (
                          <span className="text-slate-400">No data</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono ${
                            p.status === "analysed"
                              ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                              : p.status === "data-loaded"
                                ? "bg-blue-50 text-blue-700 border border-blue-200"
                                : "bg-slate-100 text-slate-600 border border-slate-200"
                          }`}
                        >
                          {p.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[11px] text-slate-500 font-mono">
                        {new Date(p.updatedAt).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs text-blue-600 hover:text-blue-700 hover:bg-blue-50 px-2"
                            onClick={() => {
                              openProject(p.id);
                              navigate({ to: "/analyses" });
                            }}
                          >
                            Analyses
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs text-slate-600 hover:text-slate-900 px-2"
                            onClick={() => {
                              openProject(p.id);
                              navigate({ to: "/workspace" });
                            }}
                          >
                            Workspace
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 size-7 p-0 text-slate-400 hover:text-red-600"
                            onClick={() => setToDelete(p)}
                            aria-label={`Delete ${p.name}`}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
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

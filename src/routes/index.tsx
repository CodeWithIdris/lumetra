import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useStore } from "@/lib/store";
import { pageMeta } from "@/lib/meta";
import { Trash2 } from "lucide-react";
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
      "Production-grade analytical workspace with client-side computation and cloud persistence.",
    ),
  component: Overview,
});

function Overview() {
  const { projects, ready, loadPersonaSample, openProject, deleteProject, startNew, loadFile, persona } =
    useStore();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [toDelete, setToDelete] = useState<ProjectMeta | null>(null);

  const recent = [...projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 8);

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
    <div className="space-y-6">
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,text/csv,.txt"
        className="sr-only"
        onChange={handleFileSelect}
      />

      <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">Overview</h1>
          <p className="mt-0.5 text-xs text-slate-600">Your data, analyses and recent work.</p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            className="h-8 bg-blue-600 text-xs text-white hover:bg-blue-700 font-medium px-3"
            onClick={() => {
              startNew();
              navigate({ to: "/workspace" });
            }}
          >
            New analysis
          </Button>

          <Button
            variant="outline"
            className="h-8 border-slate-300 text-xs text-slate-700 hover:bg-slate-50 font-medium px-3"
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

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-700 font-mono">
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
          <div className="h-32 rounded border border-slate-200 bg-white animate-pulse" />
        ) : recent.length === 0 ? (
          <div className="rounded border border-slate-200 bg-white p-5 shadow-2xs">
            <h3 className="text-sm font-semibold text-slate-900">No projects yet</h3>
            <p className="mt-1 max-w-xl text-xs text-slate-600 leading-relaxed">
              Lumetra runs statistical analysis deterministically in your browser. To begin:
            </p>
            <ol className="mt-3 max-w-xl list-decimal space-y-1 pl-5 text-xs text-slate-600 leading-relaxed">
              <li>Open a CSV dataset, or load the built-in sample for your professional context.</li>
              <li>Audit the schema and missing values — blanks are never treated as zero.</li>
              <li>Run analyses, then save the project to keep your results.</li>
            </ol>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                size="sm"
                className="h-8 bg-blue-600 text-xs text-white hover:bg-blue-700 font-medium px-3"
                onClick={() => {
                  startNew();
                  loadPersonaSample(persona);
                  navigate({ to: "/workspace" });
                }}
              >
                Load sample dataset
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 border-slate-300 text-xs text-slate-700 hover:bg-slate-50 font-medium px-3"
                onClick={() => fileInputRef.current?.click()}
              >
                Upload CSV file
              </Button>
            </div>
          </div>
        ) : (
          <div className="rounded border border-slate-200 bg-white overflow-hidden shadow-2xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50 text-slate-600 font-medium">
                  <tr>
                    <th className="px-4 py-2.5">Project Name</th>
                    <th className="px-4 py-2.5">Dataset</th>
                    <th className="px-4 py-2.5 text-right">Rows</th>
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
                          <div className="text-[11px] text-slate-500 truncate max-w-sm mt-0.5">
                            {p.objective}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-[11px] text-slate-600">
                        {p.dataset ? (
                          p.dataset.name
                        ) : (
                          <span className="text-slate-400">No data</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-[11px] text-slate-600">
                        {p.dataset ? p.dataset.rows.toLocaleString() : "—"}
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

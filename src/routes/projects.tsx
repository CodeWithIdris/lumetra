import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState, PageHeader } from "@/components/AppShell";
import { useStore } from "@/lib/store";
import { pageMeta } from "@/lib/meta";
import type { ProjectMeta } from "@/lib/persistence/projects";
import {
  Search,
  ArrowUpDown,
  HardDrive,
  Trash2,
  Edit2,
  Copy,
  Plus,
  AlertCircle,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { AuthModal } from "@/components/AuthModal";

export const Route = createFileRoute("/projects")({
  head: () =>
    pageMeta(
      "My Projects",
      "Manage analysis projects and datasets in Lumetra.",
    ),
  component: Projects,
});

const STATUS_LABELS: Record<ProjectMeta["status"], { label: string; cls: string }> = {
  "no-data": { label: "No data", cls: "bg-slate-100 text-slate-600 border-slate-200" },
  "data-loaded": { label: "Data loaded", cls: "bg-blue-50 text-blue-700 border-blue-200" },
  analysed: { label: "Analysed", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
};

function Projects() {
  const {
    projects,
    ready,
    openProject,
    renameProject,
    deleteProject,
    duplicateProject,
    createProject,
    saveAsProject,
    active,
    activeProject,
    user,
    persistenceState,
  } = useStore();

  const navigate = useNavigate();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [toDelete, setToDelete] = useState<ProjectMeta | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [unsavedDialogOpen, setUnsavedDialogOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"updatedAt" | "name" | "rows">("updatedAt");
  const [sortAsc, setSortAsc] = useState(false);

  // Create Project dialog state
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createDesc, setCreateDesc] = useState("");
  const [createBusy, setCreateBusy] = useState(false);

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createName.trim() || createBusy) return;

    setCreateBusy(true);
    try {
      const p = createProject(createName.trim(), createDesc.trim());
      setCreateBusy(false);
      if (p) {
        toast.success(`Project "${p.name}" created.`);
        setCreateOpen(false);
        setCreateName("");
        setCreateDesc("");
        // Open the newly created project and navigate to workspace for data import
        await openProject(p.id);
        navigate({ to: "/workspace" });
      } else {
        toast.error("Failed to create project. Please verify storage permissions.");
      }
    } catch {
      setCreateBusy(false);
      toast.error("An error occurred while creating project.");
    }
  };

  const handleDuplicate = (p: ProjectMeta) => {
    const copy = duplicateProject(p.id);
    if (copy) {
      toast.success(`Project duplicated as "${copy.name}".`);
    } else {
      toast.error("Could not duplicate project.");
    }
  };

  // Filter & sort projects
  const filteredProjects = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = projects.filter((p) => {
      if (!q) return true;
      const matchName = p.name.toLowerCase().includes(q);
      const matchDataset = p.dataset?.name.toLowerCase().includes(q);
      const matchObjective =
        p.objective?.toLowerCase().includes(q) || p.description?.toLowerCase().includes(q);
      return matchName || matchDataset || matchObjective;
    });

    list.sort((a, b) => {
      let comp = 0;
      if (sortBy === "name") {
        comp = a.name.localeCompare(b.name);
      } else if (sortBy === "rows") {
        const rowsA = a.dataset?.rows ?? 0;
        const rowsB = b.dataset?.rows ?? 0;
        comp = rowsA - rowsB;
      } else {
        comp = a.updatedAt.localeCompare(b.updatedAt);
      }
      return sortAsc ? comp : -comp;
    });

    return list;
  }, [projects, search, sortBy, sortAsc]);

  const toggleSort = (field: "updatedAt" | "name" | "rows") => {
    if (sortBy === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortBy(field);
      setSortAsc(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Projects"
        description="Structured records of your analytical datasets, parameters, and findings."
        actions={
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              className="h-8 bg-blue-600 text-xs text-white hover:bg-blue-700 font-medium px-3"
              onClick={() => {
                setCreateName("");
                setCreateDesc("");
                setCreateOpen(true);
              }}
            >
              <Plus className="mr-1.5 size-3.5" />
              New Project
            </Button>
          </div>
        }
      />

      {/* Guest Mode Informational Banner */}
      {!user && (
        <div className="rounded-md border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-700 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <HardDrive className="size-4 text-slate-500 shrink-0" />
            <span>
              Your work is currently saved on this device. Sign in to enable automatic cloud backup and access across devices.
            </span>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs border-blue-300 bg-white text-blue-700 hover:bg-blue-50 shrink-0"
            onClick={() => setAuthOpen(true)}
          >
            Sign In
          </Button>
        </div>
      )}

      {/* Save Status / Error Notification */}
      {persistenceState.status === "error" && persistenceState.error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-900 flex items-center gap-2">
          <AlertCircle className="size-4 text-red-600 shrink-0" />
          <span>{persistenceState.error}</span>
        </div>
      )}

      {/* Active Unsaved Session Alert */}
      {active && !activeProject && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-900 flex items-center justify-between gap-3">
          <span>
            You have an active session with <strong>{active.dataset.name}</strong>. Save it as a project to record it permanently.
          </span>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs border-amber-300 bg-white text-amber-900 hover:bg-amber-100/50"
              onClick={() => {
                const p = saveAsProject(active.dataset.name);
                if (p) toast.success(`Project "${p.name}" saved.`);
              }}
            >
              Save as Project
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs border-amber-300 bg-white text-amber-900 hover:bg-amber-100/50"
              onClick={() => navigate({ to: "/workspace" })}
            >
              Go to Workspace
            </Button>
          </div>
        </div>
      )}

      {/* Unified Projects Container */}
      <div className="rounded border border-slate-200 bg-white overflow-hidden shadow-2xs">
        {/* Search and Sorting Toolbar */}
        <div className="flex flex-col gap-2 border-b border-slate-200 bg-slate-50/50 p-2.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative flex-1 sm:max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-slate-400" />
            <Input
              aria-label="Search projects"
              placeholder="Search projects or datasets…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-7.5 pl-8 text-xs border-slate-300 text-slate-900 bg-white"
            />
          </div>

          <div className="flex items-center gap-1.5 text-xs text-slate-600">
            <span className="text-[11px] text-slate-400">Sort:</span>
            <button
              onClick={() => toggleSort("updatedAt")}
              className={`flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors ${
                sortBy === "updatedAt"
                  ? "bg-slate-200/70 text-slate-900 font-semibold"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              }`}
            >
              <span>Date</span>
              <ArrowUpDown className="size-3 text-slate-400" />
            </button>
            <button
              onClick={() => toggleSort("name")}
              className={`flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors ${
                sortBy === "name"
                  ? "bg-slate-200/70 text-slate-900 font-semibold"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              }`}
            >
              <span>Name</span>
              <ArrowUpDown className="size-3 text-slate-400" />
            </button>
            <button
              onClick={() => toggleSort("rows")}
              className={`flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors ${
                sortBy === "rows"
                  ? "bg-slate-200/70 text-slate-900 font-semibold"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              }`}
            >
              <span>Rows</span>
              <ArrowUpDown className="size-3 text-slate-400" />
            </button>
          </div>
        </div>

        {/* Projects Table */}
        {!ready ? (
          <div className="h-40 animate-pulse bg-white" />
        ) : projects.length === 0 ? (
          <EmptyState
            title="No saved projects yet"
            action={
              <Button
                className="bg-blue-600 text-xs text-white hover:bg-blue-700"
                onClick={() => {
                  setCreateName("");
                  setCreateDesc("");
                  setCreateOpen(true);
                }}
              >
                Create Project
              </Button>
            }
          >
            Create a project or import a dataset in the Data Workspace to begin. All changes are
            saved automatically.
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-600 font-medium">
                <tr>
                  <th className="px-4 py-2.5">Project</th>
                  <th className="px-4 py-2.5">Dataset</th>
                  <th className="px-4 py-2.5">Rows</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">Last Modified</th>
                  <th className="px-4 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredProjects.map((p) => {
                  const statusInfo = STATUS_LABELS[p.status];
                  return (
                    <tr key={p.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="px-4 py-3">
                        {editing === p.id ? (
                          <form
                            className="flex items-center gap-1.5"
                            onSubmit={(e) => {
                              e.preventDefault();
                              renameProject(p.id, draft);
                              setEditing(null);
                            }}
                          >
                            <Input
                              aria-label="Project name"
                              value={draft}
                              onChange={(e) => setDraft(e.target.value)}
                              className="h-7 border-slate-300 bg-white text-xs text-slate-900 w-44"
                              autoFocus
                            />
                            <Button
                              size="sm"
                              type="submit"
                              className="h-7 bg-blue-600 text-xs text-white px-2.5"
                            >
                              Save
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              type="button"
                              className="h-7 text-xs text-slate-500 px-2"
                              onClick={() => setEditing(null)}
                            >
                              Cancel
                            </Button>
                          </form>
                        ) : (
                          <div>
                            <button
                              onClick={async () => {
                                const r = await openProject(p.id);
                                navigate({
                                  to: "/workspace",
                                  search: r.error
                                    ? { notice: r.error }
                                    : r.notice
                                      ? { notice: r.notice }
                                      : {},
                                });
                              }}
                              className="font-semibold text-slate-900 hover:text-blue-600 text-left"
                            >
                              {p.name}
                            </button>
                            {(p.description || p.objective) && (
                              <div className="text-[11px] text-slate-500 truncate max-w-sm mt-0.5">
                                {p.description || p.objective}
                              </div>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {p.dataset ? (
                          <div>
                            <div className="font-medium text-slate-900">{p.dataset.name}</div>
                            <div className="num text-[11px] font-mono text-slate-500">
                              {p.dataset.columns} column{p.dataset.columns === 1 ? "" : "s"}
                              {p.cleaningSteps && p.cleaningSteps.length > 0 && (
                                <span className="ml-1 text-blue-600">
                                  ({p.cleaningSteps.length} transformation
                                  {p.cleaningSteps.length > 1 ? "s" : ""})
                                </span>
                              )}
                            </div>
                          </div>
                        ) : (
                          <span className="text-slate-400 font-mono">No dataset loaded</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-700 font-mono">
                        {p.dataset ? p.dataset.rows.toLocaleString() : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono border ${statusInfo.cls}`}
                        >
                          {statusInfo.label}
                        </span>
                      </td>
                      <td className="num px-4 py-3 text-[11px] font-mono text-slate-500">
                        {new Date(p.updatedAt).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs text-blue-600 hover:text-blue-700 hover:bg-blue-50 px-2"
                            onClick={async () => {
                              await openProject(p.id);
                              navigate({ to: "/analyses" });
                            }}
                          >
                            Analyses
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs text-slate-600 hover:text-slate-900 px-2"
                            onClick={async () => {
                              const r = await openProject(p.id);
                              navigate({
                                to: "/workspace",
                                search: r.error ? { notice: r.error } : {},
                              });
                            }}
                          >
                            Workspace
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 size-7 p-0 text-slate-400 hover:text-blue-600"
                            onClick={() => handleDuplicate(p)}
                            aria-label={`Duplicate ${p.name}`}
                            title="Duplicate Project"
                          >
                            <Copy className="size-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 size-7 p-0 text-slate-400 hover:text-slate-700"
                            onClick={() => {
                              setEditing(p.id);
                              setDraft(p.name);
                            }}
                            aria-label={`Rename ${p.name}`}
                            title="Rename Project"
                          >
                            <Edit2 className="size-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 size-7 p-0 text-slate-400 hover:text-red-600"
                            onClick={() => setToDelete(p)}
                            aria-label={`Delete ${p.name}`}
                            title="Delete Project"
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {filteredProjects.length === 0 && (
              <div className="py-10 text-center text-xs text-slate-500">
                No projects matched “{search}”.
              </div>
            )}
          </div>
        )}

        {/* Persistence Status Footnote */}
        <div className="flex flex-wrap items-center justify-between border-t border-slate-200/80 bg-slate-50/50 px-3.5 py-2 text-[11px] text-slate-500">
          <div className="flex items-center gap-1.5">
            {persistenceState.status === "saving" ? (
              <Loader2 className="size-3 animate-spin text-blue-600" />
            ) : persistenceState.status === "error" ? (
              <AlertCircle className="size-3 text-red-600" />
            ) : (
              <CheckCircle2 className="size-3 text-emerald-600" />
            )}
            <span>{persistenceState.statusText}</span>
          </div>
          <span>
            {projects.length} project{projects.length === 1 ? "" : "s"}
          </span>
        </div>
      </div>

      {/* Create Project Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="bg-white text-slate-900 border-slate-200 sm:max-w-md">
          <form onSubmit={handleCreateProject} className="space-y-4">
            <DialogHeader>
              <DialogTitle className="text-sm font-semibold">Create New Project</DialogTitle>
              <DialogDescription className="text-xs text-slate-600">
                Set up a data analysis project. You can load or import your CSV dataset right after.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 py-1">
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-700">
                  Project Name <span className="text-red-500">*</span>
                </label>
                <Input
                  required
                  placeholder="e.g. Q3 Sales Analysis"
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  className="h-8 text-xs border-slate-300 bg-white"
                  autoFocus
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-700">
                  Description / Analytical Objective (optional)
                </label>
                <Textarea
                  placeholder="State the analytical question, hypothesis, or context for this project…"
                  value={createDesc}
                  onChange={(e) => setCreateDesc(e.target.value)}
                  className="h-20 text-xs border-slate-300 bg-white"
                />
              </div>
            </div>

            <DialogFooter className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 text-xs border-slate-300 text-slate-700"
                onClick={() => setCreateOpen(false)}
                disabled={createBusy}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                className="h-8 bg-blue-600 text-xs text-white hover:bg-blue-700"
                disabled={!createName.trim() || createBusy}
              >
                {createBusy ? "Creating..." : "Create Project"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Alert */}
      <AlertDialog open={toDelete !== null} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent className="bg-white text-slate-900 border-slate-200">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete project “{toDelete?.name}”?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-600 text-xs">
              This will remove the project metadata, dataset, and saved analysis sessions.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-slate-300 text-xs text-slate-700 hover:bg-slate-50">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white text-xs hover:bg-red-700"
              onClick={() => {
                if (toDelete) {
                  deleteProject(toDelete.id);
                  toast.success(`Project "${toDelete.name}" deleted.`);
                }
                setToDelete(null);
              }}
            >
              Delete Project
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Active Session Prompt Dialog */}
      <AlertDialog open={unsavedDialogOpen} onOpenChange={setUnsavedDialogOpen}>
        <AlertDialogContent className="bg-white text-slate-900 border-slate-200">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-sm font-semibold">
              Save Active Dataset as Project
            </AlertDialogTitle>
            <AlertDialogDescription className="text-xs text-slate-600 leading-relaxed">
              You have an active dataset session for{" "}
              <strong>{active?.dataset.name || "dataset.csv"}</strong>. Would you like to
              save it as a project now to keep your work organized?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex flex-col sm:flex-row gap-2 sm:justify-end">
            <AlertDialogCancel className="h-8 text-xs border-slate-300 text-slate-700">
              Cancel
            </AlertDialogCancel>
            <Button
              size="sm"
              onClick={() => {
                setUnsavedDialogOpen(false);
                if (active) {
                  saveAsProject(active.dataset.name);
                }
              }}
              className="h-8 text-xs bg-blue-600 text-white hover:bg-blue-700 font-medium"
            >
              Save as Project
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Auth Modal */}
      <AuthModal open={authOpen} onOpenChange={setAuthOpen} defaultTab="login" />
    </div>
  );
}

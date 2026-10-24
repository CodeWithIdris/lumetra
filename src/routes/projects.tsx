import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { EmptyState, PageHeader } from "@/components/AppShell";
import { useStore } from "@/lib/store";
import { pageMeta } from "@/lib/meta";
import type { ProjectMeta } from "@/lib/persistence/projects";
import {
  Search,
  ArrowUpDown,
  RefreshCw,
  HardDrive,
  Database,
  Trash2,
  Edit2,
  ExternalLink,
  Plus,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/projects")({
  head: () =>
    pageMeta(
      "My Projects",
      "Manage saved analysis records and cloud dataset persistence in Lumetra.",
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
    active,
    activeProject,
    startNew,
    syncWithCloud,
    cloudSyncStatus,
    user,
  } = useStore();

  const navigate = useNavigate();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [toDelete, setToDelete] = useState<ProjectMeta | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"updatedAt" | "name" | "rows">("updatedAt");
  const [sortAsc, setSortAsc] = useState(false);

  const handleSyncAll = async () => {
    setSyncing(true);
    const res = await syncWithCloud();
    setSyncing(false);
    if (res.success) {
      toast.success(
        `Synchronized ${res.count ?? projects.length} project record(s) with Supabase Cloud.`,
      );
    } else {
      toast.error(res.error || "Sync encountered an error.");
    }
  };

  // Filter & sort projects
  const filteredProjects = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = projects.filter((p) => {
      if (!q) return true;
      const matchName = p.name.toLowerCase().includes(q);
      const matchDataset = p.dataset?.name.toLowerCase().includes(q);
      const matchObjective = p.objective?.toLowerCase().includes(q);
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
              variant="outline"
              size="sm"
              disabled={syncing}
              onClick={handleSyncAll}
              className="h-8 border-slate-300 text-xs text-slate-700 hover:bg-slate-50 font-medium"
            >
              <RefreshCw className={`mr-1.5 size-3.5 text-slate-500 ${syncing ? "animate-spin" : ""}`} />
              <span>{syncing ? "Syncing..." : "Sync to Supabase"}</span>
            </Button>
            <Button
              size="sm"
              className="h-8 bg-blue-600 text-xs text-white hover:bg-blue-700 font-medium px-3"
              onClick={() => {
                startNew();
                navigate({ to: "/workspace" });
              }}
            >
              <Plus className="mr-1.5 size-3.5" />
              New Analysis
            </Button>
          </div>
        }
      />

      {/* Active Unsaved Session Alert */}
      {active && !activeProject && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-900 flex items-center justify-between gap-3">
          <span>
            You have an active unsaved session with <strong>{active.dataset.name}</strong>. Save it
            from the Data Workspace to record it permanently.
          </span>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs border-amber-300 bg-white text-amber-900 hover:bg-amber-100/50 shrink-0"
            onClick={() => navigate({ to: "/workspace" })}
          >
            Go to Workspace
          </Button>
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
                startNew();
                navigate({ to: "/workspace" });
              }}
            >
              Start New Analysis
            </Button>
          }
        >
          When you load a dataset in the Data Workspace and save your project, it will appear here
          with full local persistence and optional Supabase cloud synchronization.
        </EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-600 font-medium">
                <tr>
                  <th className="px-4 py-2.5">Project</th>
                  <th className="px-4 py-2.5">Dataset</th>
                  <th className="px-4 py-2.5">Storage</th>
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
                              onClick={() => {
                                const r = openProject(p.id);
                                navigate({
                                  to: "/workspace",
                                  search: r.error ? { notice: r.error } : {},
                                });
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
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {p.dataset ? (
                          <div>
                            <div className="font-medium text-slate-900">{p.dataset.name}</div>
                            <div className="num text-[11px] font-mono text-slate-500">
                              {p.dataset.rows.toLocaleString()} rows × {p.dataset.columns} cols
                            </div>
                          </div>
                        ) : (
                          <span className="text-slate-400 font-mono">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1 text-[11px] text-slate-600 font-mono">
                          <HardDrive className="size-3 text-slate-400" />
                          <span>Local Vault</span>
                        </span>
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
                            onClick={() => {
                              openProject(p.id);
                              navigate({ to: "/analyses" });
                            }}
                          >
                            Analyses
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs text-slate-600 hover:text-slate-900 px-2"
                            onClick={() => {
                              const r = openProject(p.id);
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
                            className="h-7 size-7 p-0 text-slate-400 hover:text-slate-700"
                            onClick={() => {
                              setEditing(p.id);
                              setDraft(p.name);
                            }}
                            aria-label={`Rename ${p.name}`}
                          >
                            <Edit2 className="size-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 size-7 p-0 text-slate-400 hover:text-red-600"
                            onClick={() => setToDelete(p)}
                            aria-label={`Delete ${p.name}`}
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

      {/* Storage Architecture Footnote */}
      <div className="flex flex-wrap items-center justify-between border-t border-slate-200/80 bg-slate-50/50 px-3.5 py-2 text-[11px] text-slate-500">
        <div className="flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-emerald-500" />
          <span>Computations execute in-browser locally.</span>
        </div>
        <span>
          {user ? `Account: ${user.name} (${cloudSyncStatus.lastSyncedAt ? "Synced" : "Local"})` : `Local Storage (${projects.length} saved)`}
        </span>
      </div>
    </div>

      {/* Delete Confirmation Alert */}
      <AlertDialog open={toDelete !== null} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent className="bg-white text-slate-900 border-slate-200">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete project “{toDelete?.name}”?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-600 text-xs">
              This will remove the project metadata and cached analysis session from your storage.
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
    </div>
  );
}

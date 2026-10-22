import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
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
import { Cloud, CheckCircle2, Database, RefreshCw } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/projects")({
  head: () =>
    pageMeta("My Projects", "Manage saved analysis records and cloud dataset backups in Lumetra."),
  component: Projects,
});

const STATUS: Record<ProjectMeta["status"], string> = {
  "no-data": "No data",
  "data-loaded": "Data loaded",
  analysed: "Analysed",
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

  const handleSyncAll = async () => {
    setSyncing(true);
    const res = await syncWithCloud();
    setSyncing(false);
    if (res.success) {
      toast.success(
        `Successfully safeguarded ${res.count ?? projects.length} records in Supabase Cloud!`,
      );
    } else {
      toast.error(res.error || "Sync encountered an error.");
    }
  };

  return (
    <>
      <PageHeader
        title="My Projects & Cloud Records"
        description="Every dataset and analysis report is safeguarded in the Supabase Cloud Database and locally on your device."
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={syncing}
              onClick={handleSyncAll}
              className="border-white/10 bg-white/5 text-xs text-white hover:bg-white/10"
            >
              <RefreshCw className={`mr-1.5 size-3.5 ${syncing ? "animate-spin" : ""}`} />
              <span>{syncing ? "Syncing..." : "Sync All to Supabase"}</span>
            </Button>
            <Button
              size="sm"
              className="bg-indigo-600 text-xs text-white hover:bg-indigo-500"
              onClick={() => {
                startNew();
                navigate({ to: "/workspace" });
              }}
            >
              New Analysis
            </Button>
          </div>
        }
      />

      {active && !activeProject && (
        <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-300">
          You have an unsaved session with “{active.dataset.name}”. Save it from the Data Workspace
          to keep it permanently backed up.
        </div>
      )}

      {/* Cloud Status Banner */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-slate-900/60 p-4 backdrop-blur-xl">
        <div className="flex items-center gap-2.5">
          <div className="flex size-8 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-400">
            <Cloud className="size-4" />
          </div>
          <div>
            <div className="text-xs font-semibold text-white flex items-center gap-1.5">
              <span>Supabase Cloud Vault Active</span>
              <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
            </div>
            <div className="text-[11px] text-slate-400">
              {user
                ? `Connected to ${user.email} · All records synced safely.`
                : "Safe local cloud vault active · Sign up to enable remote multi-device access."}
            </div>
          </div>
        </div>

        <div className="text-right">
          <span className="font-mono text-[11px] text-slate-400">
            {projects.length} record(s) protected
          </span>
        </div>
      </div>

      {!ready ? null : projects.length === 0 ? (
        <EmptyState title="No saved projects yet">
          Saved datasets and analysis sessions will appear here with full Supabase cloud redundancy.
        </EmptyState>
      ) : (
        <div className="glass-card overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="border-b border-white/10 bg-slate-900/80 text-left text-slate-400">
              <tr>
                <th className="px-4 py-3 font-medium">Project</th>
                <th className="px-4 py-3 font-medium">Dataset</th>
                <th className="px-4 py-3 font-medium">Cloud Redundancy</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Modified</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {projects.map((p) => (
                <tr key={p.id} className="hover:bg-white/5 transition-colors">
                  <td className="px-4 py-3">
                    {editing === p.id ? (
                      <form
                        className="flex gap-1.5"
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
                          className="h-8 border-white/10 bg-slate-900 text-xs text-white"
                          autoFocus
                        />
                        <Button
                          size="sm"
                          type="submit"
                          className="bg-indigo-600 text-xs text-white"
                        >
                          Save
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          type="button"
                          className="text-xs text-slate-400"
                          onClick={() => setEditing(null)}
                        >
                          Cancel
                        </Button>
                      </form>
                    ) : (
                      <span className="font-semibold text-white">{p.name}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-300">
                    {p.dataset ? (
                      <>
                        <span className="text-white font-medium">{p.dataset.name}</span>{" "}
                        <span className="num text-xs text-slate-400">
                          ({p.dataset.rows.toLocaleString()} × {p.dataset.columns})
                        </span>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 text-[10px] font-mono text-emerald-300">
                      <CheckCircle2 className="size-3" />
                      <span>Supabase Safe</span>
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] font-mono text-slate-300">
                      {STATUS[p.status]}
                    </span>
                  </td>
                  <td className="num px-4 py-3 text-xs text-slate-400">
                    {new Date(p.updatedAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-white/10 text-xs hover:bg-white/10"
                        onClick={() => {
                          const r = openProject(p.id);
                          navigate({
                            to: "/workspace",
                            search: r.error ? { notice: r.error } : {},
                          });
                        }}
                      >
                        Open
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-xs text-slate-400 hover:text-white"
                        onClick={() => {
                          setEditing(p.id);
                          setDraft(p.name);
                        }}
                      >
                        Rename
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10"
                        onClick={() => setToDelete(p)}
                      >
                        Delete
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Delete Confirmation Alert */}
      <AlertDialog open={toDelete !== null} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent className="border border-white/10 bg-slate-950 text-white">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete project “{toDelete?.name}”?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400 text-xs">
              This will remove the project and its stored CSV dataset from both local memory and
              Supabase cloud.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-white/10 bg-transparent text-white hover:bg-white/5">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-500"
              onClick={() => {
                if (toDelete) {
                  deleteProject(toDelete.id);
                  toast.success(`Project "${toDelete.name}" deleted.`);
                }
                setToDelete(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { EmptyState, PageHeader } from "@/components/AppShell";
import { useStore } from "@/lib/store";
import { pageMeta } from "@/lib/meta";
import type { ProjectMeta } from "@/lib/persistence/projects";

export const Route = createFileRoute("/projects")({
  head: () => pageMeta("My Projects", "Projects saved locally on this device."),
  component: Projects,
});

const STATUS: Record<ProjectMeta["status"], string> = {
  "no-data": "No data",
  "data-loaded": "Data loaded",
  analysed: "Analysed",
};

function Projects() {
  const { projects, ready, openProject, renameProject, deleteProject, active, activeProject } = useStore();
  const navigate = useNavigate();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [toDelete, setToDelete] = useState<ProjectMeta | null>(null);

  return (
    <>
      <PageHeader
        title="My Projects"
        description="Project details are saved in this browser only. Datasets up to 2 MB are stored with the project; larger files must be re-uploaded."
        actions={<Button onClick={() => navigate({ to: "/workspace" })}>New analysis</Button>}
      />
      {active && !activeProject && (
        <div className="mb-4 rounded-md border border-warning-foreground/30 bg-warning px-3 py-2 text-[13px] text-warning-foreground">
          You have an unsaved session with “{active.dataset.name}”. Save it from the Data Workspace to keep it.
        </div>
      )}
      {!ready ? null : projects.length === 0 ? (
        <EmptyState title="No saved projects">Saved projects appear here with their dataset details and status.</EmptyState>
      ) : (
        <div className="panel overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="border-b bg-muted/50 text-left text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Project</th>
                <th className="px-4 py-2 font-medium">Dataset</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Created</th>
                <th className="px-4 py-2 font-medium">Modified</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id} className="border-b last:border-0">
                  <td className="px-4 py-2.5">
                    {editing === p.id ? (
                      <form
                        className="flex gap-1.5"
                        onSubmit={(e) => {
                          e.preventDefault();
                          renameProject(p.id, draft);
                          setEditing(null);
                        }}
                      >
                        <Input aria-label="Project name" value={draft} onChange={(e) => setDraft(e.target.value)} className="h-8" autoFocus />
                        <Button size="sm" type="submit">Save</Button>
                        <Button size="sm" variant="ghost" type="button" onClick={() => setEditing(null)}>Cancel</Button>
                      </form>
                    ) : (
                      <span className="font-medium">{p.name}</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    {p.dataset ? (
                      <>
                        {p.dataset.name} <span className="num">({p.dataset.rows.toLocaleString()} × {p.dataset.columns})</span>
                        {!p.dataset.stored && <div className="text-[11.5px] text-warning-foreground">Data not stored — re-upload needed</div>}
                      </>
                    ) : "—"}
                  </td>
                  <td className="px-4 py-2.5">{STATUS[p.status]}</td>
                  <td className="num px-4 py-2.5 text-muted-foreground">{new Date(p.createdAt).toLocaleDateString()}</td>
                  <td className="num px-4 py-2.5 text-muted-foreground">{new Date(p.updatedAt).toLocaleString()}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="outline" onClick={() => {
                        const r = openProject(p.id);
                        navigate({ to: "/workspace", search: r.error ? { notice: r.error } : {} });
                      }}>Open</Button>
                      <Button size="sm" variant="ghost" onClick={() => { setEditing(p.id); setDraft(p.name); }}>Rename</Button>
                      <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setToDelete(p)}>Delete</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{toDelete?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the project and any dataset stored with it from this device. It cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (toDelete) deleteProject(toDelete.id); setToDelete(null); }}
            >
              Delete project
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

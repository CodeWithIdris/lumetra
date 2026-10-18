import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { PageHeader } from "@/components/AppShell";
import { useStore } from "@/lib/store";
import { pageMeta } from "@/lib/meta";
import { toast } from "sonner";

export const Route = createFileRoute("/settings")({
  head: () => pageMeta("Settings", "Privacy information and local data controls for Lumetra."),
  component: Settings,
});

function Settings() {
  const { resetAll, projects } = useStore();
  const [confirm, setConfirm] = useState(false);
  return (
    <>
      <PageHeader title="Settings" />
      <div className="max-w-2xl space-y-4">
        <section className="panel p-5">
          <h2 className="font-medium">Privacy</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px] text-muted-foreground">
            <li>CSV files are read and analysed entirely in your browser.</li>
            <li>No account, no server database, no AI service and no analytics on your data.</li>
            <li>Project details, and datasets up to 2 MB, are stored in this browser's local storage. Anyone with access to this browser profile can read them.</li>
            <li>Clearing your browser data also removes saved projects.</li>
          </ul>
        </section>
        <section className="panel p-5">
          <h2 className="font-medium">Appearance</h2>
          <p className="mt-1 text-[13px] text-muted-foreground">Light theme. A dark theme is planned.</p>
        </section>
        <section className="panel p-5">
          <h2 className="font-medium">Local data</h2>
          <p className="mt-1 text-[13px] text-muted-foreground">{projects.length} saved project(s) on this device.</p>
          <Button variant="outline" className="mt-3 text-destructive hover:text-destructive" onClick={() => setConfirm(true)}>
            Delete all local data
          </Button>
        </section>
      </div>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete all local data?</AlertDialogTitle>
            <AlertDialogDescription>All projects and stored datasets will be removed from this browser. This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { resetAll(); toast.success("Local data deleted"); }}>
              Delete everything
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

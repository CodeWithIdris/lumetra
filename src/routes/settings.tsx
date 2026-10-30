import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
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
import { PageHeader } from "@/components/AppShell";
import { useStore } from "@/lib/store";
import { pageMeta } from "@/lib/meta";
import { PERSONAS, type PersonaId } from "@/lib/stats/personas";
import { getStorageEstimate, type StorageEstimateInfo } from "@/lib/persistence/indexeddb";
import { toast } from "sonner";
import {
  ShieldCheck,
  Check,
  HardDrive,
  Cpu,
  TrendingUp,
  Boxes,
  Target,
  HeartPulse,
  Trash2,
  CheckCircle2,
} from "lucide-react";

export const Route = createFileRoute("/settings")({
  head: () => pageMeta("Settings", "Account, persistence, and analytical preferences for Lumetra."),
  component: Settings,
});

const ROLE_ICONS: Record<PersonaId, typeof Cpu> = {
  engineer: Cpu,
  economist: TrendingUp,
  scientist: Boxes,
  product: Target,
  clinical: HeartPulse,
};

function Settings() {
  const { resetAll, projects, persona, setPersona, user, persistenceState, importLocalProjects } =
    useStore();
  const [confirm, setConfirm] = useState(false);
  const [associating, setAssociating] = useState(false);
  const [storageEstimate, setStorageEstimate] = useState<StorageEstimateInfo | null>(null);

  useEffect(() => {
    getStorageEstimate()
      .then((est) => setStorageEstimate(est))
      .catch(() => {});
  }, [projects]);

  const handleAssociateLocalProjects = async () => {
    if (!user) return;
    setAssociating(true);
    try {
      const res = await importLocalProjects();
      if (res.success && res.imported > 0) {
        toast.success(`Associated and verified ${res.imported} project(s) to your account.`);
      } else if (res.skipped > 0 && res.imported === 0) {
        toast.info("All local projects are already associated with your account.");
      } else if (!res.success) {
        toast.error(res.errors[0] || "Could not associate local projects.");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to associate projects.");
    } finally {
      setAssociating(false);
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Configure your active professional persona, local working cache, and workspace settings."
      />

      <div className="max-w-4xl space-y-6">
        {/* Section 1: Professional Persona */}
        <section className="rounded-md border border-slate-200 bg-white p-5 shadow-2xs space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Professional Context</h2>
            <p className="mt-0.5 text-xs text-slate-600">
              Adapts available statistical toolkits, default parameter presets, and interpretation
              guidance to your domain.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 pt-1">
            {(Object.keys(PERSONAS) as PersonaId[]).map((pId) => {
              const p = PERSONAS[pId];
              const Icon = ROLE_ICONS[pId];
              const isSelected = pId === persona;
              return (
                <button
                  key={pId}
                  onClick={() => {
                    setPersona(pId);
                    toast.success(`Active context updated to ${p.title}.`);
                  }}
                  className={`rounded border p-3.5 text-left transition-colors flex flex-col justify-between ${
                    isSelected
                      ? "border-blue-600 bg-blue-50/50 text-slate-900 ring-1 ring-blue-600"
                      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:border-slate-300"
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Icon
                          className={`size-4 ${isSelected ? "text-blue-600" : "text-slate-400"}`}
                        />
                        <span className="font-semibold text-xs text-slate-900">{p.shortRole}</span>
                      </div>
                      {isSelected && <Check className="size-3.5 text-blue-600 shrink-0" />}
                    </div>
                    <p className="mt-1.5 text-[11px] text-slate-500 leading-snug line-clamp-2">
                      {p.tagline}
                    </p>
                  </div>
                  <div className="mt-3 border-t border-slate-100 pt-2 font-mono text-[10px] text-slate-400 truncate">
                    {p.keyMetrics.slice(0, 2).join(" • ")}
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        {/* Section 2: Storage & Working Cache */}
        <section className="rounded-md border border-slate-200 bg-white p-5 shadow-2xs space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <HardDrive className="size-4 text-blue-600" />
                <h2 className="text-sm font-semibold text-slate-900">Workspace Storage & Cache</h2>
              </div>
              <p className="mt-0.5 text-xs text-slate-600">
                All projects and analyses are automatically persisted as you work. Local browser
                cache provides instant offline capability.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-mono text-emerald-800">
                {user ? "Automatic Persistence Active" : "Saved to Device"}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
            <div className="rounded border border-slate-200 bg-slate-50/70 p-3 space-y-1">
              <div className="text-[11px] text-slate-500 font-sans">Local Cache Usage</div>
              <div className="text-base font-bold text-slate-900 font-mono">
                {storageEstimate ? formatBytes(storageEstimate.usage) : "—"}
              </div>
              <div className="text-[10px] text-slate-400 font-mono">
                {storageEstimate
                  ? `${storageEstimate.percentUsed.toFixed(2)}% of browser quota`
                  : "Calculating..."}
              </div>
            </div>

            <div className="rounded border border-slate-200 bg-slate-50/70 p-3 space-y-1">
              <div className="text-[11px] text-slate-500 font-sans">Active Projects</div>
              <div className="text-base font-bold text-slate-900 font-mono">{projects.length}</div>
              <div className="text-[10px] text-slate-400 font-mono">
                {persistenceState.statusText}
              </div>
            </div>

            <div className="rounded border border-slate-200 bg-slate-50/70 p-3 space-y-1">
              <div className="text-[11px] text-slate-500 font-sans">Account Status</div>
              <div className="text-sm font-bold text-slate-900 truncate">
                {user ? user.email : "Local Guest"}
              </div>
              <div className="text-[10px] text-slate-400 font-mono">
                {user ? "Cross-device sync enabled" : "Stored on this device"}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-100">
            {user && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={associating}
                onClick={handleAssociateLocalProjects}
                className="h-8 border-slate-300 text-xs text-slate-700 hover:bg-slate-50"
              >
                <CheckCircle2 className="mr-1.5 size-3.5 text-blue-600" />
                {associating ? "Associating..." : "Associate Device Projects to Account"}
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setConfirm(true)}
              className="h-8 border-red-200 text-xs text-red-600 hover:bg-red-50"
            >
              <Trash2 className="mr-1.5 size-3.5" />
              Reset Local Storage
            </Button>
          </div>
        </section>

        {/* Section 3: Privacy & Computation Architecture */}
        <section className="rounded-md border border-slate-200 bg-white p-5 shadow-2xs space-y-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-emerald-600" />
            <h2 className="text-sm font-semibold text-slate-900">
              Computational Model & Privacy Guarantees
            </h2>
          </div>
          <div className="text-xs text-slate-600 leading-relaxed space-y-2">
            <p>
              • <strong>Deterministic Client-Side Execution:</strong> All CSV parsing, statistical
              metrics, and regressions execute locally in your web browser. Mathematical outputs are
              computed by verifiable algorithms, never hallucinated by an AI language model.
            </p>
            <p>
              • <strong>Missing Value Correctness:</strong> Blank cells and missing records are
              retained strictly as <code className="font-mono text-slate-800">null</code> and are
              excluded from calculations. They are never coerced to zero.
            </p>
            <p>
              • <strong>Seamless Persistence:</strong> Your projects, datasets, and analysis
              configurations are automatically persisted to your account with PostgreSQL Row Level
              Security. All computation remains client-side.
            </p>
          </div>
        </section>
      </div>

      {/* Reset Confirmation Dialog */}
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent className="bg-white text-slate-900 border-slate-200">
          <AlertDialogHeader>
            <AlertDialogTitle>Reset local working storage?</AlertDialogTitle>
            <AlertDialogDescription className="text-xs text-slate-600">
              This will clear cached datasets and projects stored in this browser session. Verified
              account records remain intact.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-slate-300 text-xs text-slate-700 hover:bg-slate-50">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-xs text-white hover:bg-red-700"
              onClick={async () => {
                await resetAll();
                toast.success("Local storage cache cleared.");
              }}
            >
              Reset Storage
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

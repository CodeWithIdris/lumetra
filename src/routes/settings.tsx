import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import {
  loadSupabaseConfig,
  saveSupabaseConfig,
  getSupabaseClient,
} from "@/lib/persistence/supabase";
import { validateSupabaseConfig } from "@/integrations/supabase/client";
import { getStorageEstimate, type StorageEstimateInfo } from "@/lib/persistence/indexeddb";
import { toast } from "sonner";
import {
  Database,
  ShieldCheck,
  Check,
  HardDrive,
  Cpu,
  TrendingUp,
  Boxes,
  Target,
  HeartPulse,
  RefreshCw,
} from "lucide-react";

export const Route = createFileRoute("/settings")({
  head: () =>
    pageMeta(
      "Settings",
      "Account, Supabase cloud persistence, and professional analytical settings for Lumetra.",
    ),
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
  const { resetAll, projects, persona, setPersona, user, syncWithCloud, cloudSyncStatus } =
    useStore();
  const [confirm, setConfirm] = useState(false);
  const [storageEstimate, setStorageEstimate] = useState<StorageEstimateInfo | null>(null);

  useEffect(() => {
    getStorageEstimate()
      .then((est) => setStorageEstimate(est))
      .catch(() => {});
  }, [projects]);

  // Supabase connection state
  const config = loadSupabaseConfig();
  const configStatus = validateSupabaseConfig();
  const [supaUrl, setSupaUrl] = useState(config.url);
  const [supaKey, setSupaKey] = useState(config.anonKey);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    const supabase = getSupabaseClient();
    const res = await supabase.testConnection(supaUrl, supaKey);
    setTesting(false);
    setTestResult(res);
    if (res.ok) {
      saveSupabaseConfig({ url: supaUrl, anonKey: supaKey });
      toast.success("Successfully connected to Supabase Cloud.");
    } else {
      toast.error(res.message);
    }
  };

  const handleSaveConfig = () => {
    saveSupabaseConfig({ url: supaUrl, anonKey: supaKey });
    toast.success("Supabase database configuration saved.");
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Configure your active professional persona, storage preferences, and cloud connectivity."
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

        {/* Section 2: Storage & Supabase Cloud Integration */}
        <section className="rounded-md border border-slate-200 bg-white p-5 shadow-2xs space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <Database className="size-4 text-blue-600" />
                <h2 className="text-sm font-semibold text-slate-900">
                  Cloud Persistence & Supabase Integration
                </h2>
              </div>
              <p className="mt-0.5 text-xs text-slate-600">
                Configure your Supabase project credentials to synchronize projects, datasets, and
                cached results.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`rounded border px-2 py-0.5 text-[10px] font-mono ${
                  configStatus.isConfigured
                    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                    : "border-amber-200 bg-amber-50 text-amber-800"
                }`}
              >
                {configStatus.isConfigured ? "Connected" : "Unconfigured"}
              </span>
              <span className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-mono text-slate-600">
                {cloudSyncStatus.lastSyncedAt ? "Synced" : "Local Vault"}
              </span>
            </div>
          </div>

          {!configStatus.isConfigured && (
            <div className="rounded border border-amber-200 bg-amber-50/70 p-3 text-xs text-amber-900 leading-relaxed">
              <strong>Configuration Notice:</strong> <code>VITE_SUPABASE_URL</code> and{" "}
              <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> are not detected in the environment. Set
              them in <code>.env.local</code> or Lovable Settings to enable Supabase Cloud
              authentication and cloud database persistence. Never expose secret or service_role
              keys.
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2 pt-1">
            <div className="space-y-1">
              <Label className="text-xs font-medium text-slate-700">Supabase Project URL</Label>
              <Input
                placeholder="https://your-project.supabase.co"
                value={supaUrl}
                onChange={(e) => setSupaUrl(e.target.value)}
                className="h-8 border-slate-300 bg-white text-xs font-mono text-slate-900"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-medium text-slate-700">
                Supabase Anon Public API Key
              </Label>
              <Input
                type="password"
                placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                value={supaKey}
                onChange={(e) => setSupaKey(e.target.value)}
                className="h-8 border-slate-300 bg-white text-xs font-mono text-slate-900"
              />
            </div>
          </div>

          {testResult && (
            <div
              className={`rounded border p-3 text-xs ${
                testResult.ok
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : "border-red-200 bg-red-50 text-red-800"
              }`}
            >
              {testResult.message}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={testing}
              onClick={handleTestConnection}
              className="h-8 border-slate-300 text-xs text-slate-700 hover:bg-slate-50"
            >
              {testing ? "Testing..." : "Test Connection"}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleSaveConfig}
              className="h-8 bg-blue-600 text-xs text-white hover:bg-blue-700 font-medium px-3"
            >
              Save Configuration
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={async () => {
                const res = await syncWithCloud();
                if (res.success) {
                  toast.success("Synchronized project records with Supabase.");
                } else {
                  toast.error(res.error || "Sync error");
                }
              }}
              className="h-8 border-slate-300 text-xs text-slate-700 hover:bg-slate-50"
            >
              <RefreshCw className="mr-1.5 size-3.5 text-slate-400" />
              Sync Projects Now
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
              • <strong>Storage Boundaries:</strong> Local analysis remains on this device by
              default. When you configure and connect Supabase Cloud, project metadata and dataset
              records are transmitted securely to your designated database endpoint.
            </p>
          </div>
        </section>

        {/* Section 4: Local Storage & Quota Management */}
        <section className="rounded-md border border-slate-200 bg-white p-5 shadow-2xs space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <HardDrive className="size-4 text-blue-600" />
                <h2 className="text-sm font-semibold text-slate-900">Browser-Local Storage</h2>
              </div>
              <p className="mt-0.5 text-xs text-slate-600">
                Datasets are stored locally using browser IndexedDB with metadata preserved in local
                storage.
              </p>
            </div>
            <span className="rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-mono text-emerald-700">
              IndexedDB Active
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
            <div className="rounded border border-slate-200 bg-slate-50 p-3">
              <div className="text-[10px] text-slate-500">Local Projects</div>
              <div className="text-sm font-bold text-slate-900 mt-0.5 font-mono">
                {projects.length} project{projects.length === 1 ? "" : "s"}
              </div>
            </div>
            <div className="rounded border border-slate-200 bg-slate-50 p-3">
              <div className="text-[10px] text-slate-500">Storage Used</div>
              <div className="text-sm font-bold text-slate-900 mt-0.5 font-mono">
                {storageEstimate
                  ? `${(storageEstimate.usage / (1024 * 1024)).toFixed(1)} MB`
                  : "Client managed"}
              </div>
            </div>
            <div className="rounded border border-slate-200 bg-slate-50 p-3">
              <div className="text-[10px] text-slate-500">Available Quota</div>
              <div className="text-sm font-bold text-slate-900 mt-0.5 font-mono">
                {storageEstimate && storageEstimate.quota > 0
                  ? `${(storageEstimate.available / (1024 * 1024)).toFixed(0)} MB free (${storageEstimate.percentUsed.toFixed(1)}% used)`
                  : "Browser managed"}
              </div>
            </div>
          </div>

          <div className="rounded border border-amber-200 bg-amber-50/70 p-3 text-xs text-amber-900 space-y-1">
            <div className="font-semibold text-amber-950 flex items-center gap-1.5">
              <span>Notice on Browser-Local Persistence</span>
            </div>
            <p className="text-[11px] leading-relaxed text-amber-900">
              Browser-local data is subject to client environment boundaries: clearing browser
              cookies/site data, operating in private/incognito browsing windows, or disk space
              pressure can lead to browser eviction. We strongly recommend exporting critical
              datasets and analytical reports from the Export view.
            </p>
          </div>

          <div className="pt-1">
            <Button
              variant="outline"
              size="sm"
              className="h-8 border-red-200 text-xs text-red-600 hover:bg-red-50 hover:text-red-700"
              onClick={() => setConfirm(true)}
            >
              Clear Browser Cache & Local Data
            </Button>
          </div>
        </section>
      </div>

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent className="bg-white text-slate-900 border-slate-200">
          <AlertDialogHeader>
            <AlertDialogTitle>Clear local cached data?</AlertDialogTitle>
            <AlertDialogDescription className="text-xs text-slate-600">
              All projects and locally cached datasets will be removed from this browser. Records
              synced to Supabase Cloud remain intact.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-slate-300 text-xs text-slate-700 hover:bg-slate-50">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-xs text-white hover:bg-red-700"
              onClick={() => {
                resetAll();
                toast.success("Local browser cache cleared.");
              }}
            >
              Clear Cache
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

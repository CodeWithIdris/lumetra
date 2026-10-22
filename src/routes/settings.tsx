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
import { toast } from "sonner";
import { Database, ShieldCheck, Sparkles, Cloud, CheckCircle2, User } from "lucide-react";

export const Route = createFileRoute("/settings")({
  head: () =>
    pageMeta(
      "Settings",
      "Account, Supabase cloud database, and personalization controls for Lumetra.",
    ),
  component: Settings,
});

function Settings() {
  const { resetAll, projects, persona, setPersona, user, logout, syncWithCloud } = useStore();
  const [confirm, setConfirm] = useState(false);

  // Supabase connection state
  const config = loadSupabaseConfig();
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
      toast.success("Connected to Supabase!");
    } else {
      toast.error(res.message);
    }
  };

  const handleSaveConfig = () => {
    saveSupabaseConfig({ url: supaUrl, anonKey: supaKey });
    toast.success("Supabase database settings updated.");
  };

  return (
    <>
      <PageHeader
        title="Settings & Cloud Infrastructure"
        description="Personalization, Supabase database storage, and security controls."
      />
      <div className="max-w-3xl space-y-6">
        {/* Personalization Section */}
        <section className="glass-card p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-indigo-400" />
            <h2 className="font-semibold text-white">Personalized Professional Background</h2>
          </div>
          <p className="text-xs text-slate-400">
            Lumetra personalizes statistical calculations, interpretation notes, and recommendations
            based on your primary field.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            {(Object.keys(PERSONAS) as PersonaId[]).map((pId) => {
              const p = PERSONAS[pId];
              const isSelected = pId === persona;
              return (
                <button
                  key={pId}
                  onClick={() => {
                    setPersona(pId);
                    toast.success(`Personalization updated to ${p.title}`);
                  }}
                  className={`rounded-xl border p-3.5 text-left transition-all ${
                    isSelected
                      ? "border-indigo-500/50 bg-indigo-950/30 text-white shadow-[0_0_20px_rgba(99,102,241,0.2)]"
                      : "border-white/10 bg-slate-900/40 text-slate-300 hover:border-white/20"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-sm">{p.shortRole}</span>
                    {isSelected && (
                      <span className="size-2 rounded-full bg-indigo-400 animate-pulse" />
                    )}
                  </div>
                  <div className="text-[11px] text-slate-400 mt-1">{p.badge}</div>
                  <div className="text-[11px] text-indigo-300 font-mono mt-1.5 truncate">
                    {p.keyMetrics.slice(0, 2).join(" · ")}
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        {/* Supabase Database Storage */}
        <section className="glass-card p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Database className="size-4 text-emerald-400" />
              <h2 className="font-semibold text-white">Supabase Cloud Database & Storage</h2>
            </div>
            <span className="rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-0.5 text-[10px] font-mono text-emerald-300">
              Unlimited Storage Mode
            </span>
          </div>

          <p className="text-xs text-slate-400 leading-relaxed">
            By keeping your datasets and analysis projects in <strong>Supabase</strong>, you bypass
            browser storage quotas (which restrict files to 2 MB) and can safely access all records
            from any browser or workstation.
          </p>

          <div className="grid gap-3 pt-1">
            <div className="space-y-1">
              <Label className="text-xs text-slate-300">Supabase Project URL</Label>
              <Input
                placeholder="https://your-project.supabase.co"
                value={supaUrl}
                onChange={(e) => setSupaUrl(e.target.value)}
                className="border-white/10 bg-slate-900 text-xs font-mono text-white"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-slate-300">Supabase Anon Public API Key</Label>
              <Input
                type="password"
                placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                value={supaKey}
                onChange={(e) => setSupaKey(e.target.value)}
                className="border-white/10 bg-slate-900 text-xs font-mono text-white"
              />
            </div>
          </div>

          {testResult && (
            <div
              className={`rounded-lg p-3 text-xs ${
                testResult.ok
                  ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/30"
                  : "bg-red-500/10 text-red-300 border border-red-500/30"
              }`}
            >
              {testResult.message}
            </div>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={testing}
              onClick={handleTestConnection}
              className="border-white/10 text-xs text-white hover:bg-slate-900"
            >
              {testing ? "Testing..." : "Test Supabase Connection"}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleSaveConfig}
              className="bg-indigo-600 text-xs text-white hover:bg-indigo-500"
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
                  toast.success("Synchronized all projects with Cloud Database!");
                } else {
                  toast.error(res.error || "Sync error");
                }
              }}
              className="border-white/10 text-xs text-slate-300 hover:bg-slate-900"
            >
              Sync Records Now
            </Button>
          </div>
        </section>

        {/* Interface & Appearance */}
        <section className="glass-card p-6 space-y-2">
          <h2 className="font-semibold text-white">ThreeUI Aesthetic Interface</h2>
          <p className="text-xs text-slate-300 leading-relaxed">
            High-contrast ThreeUI dark palette with interactive 3D particle constellation canvas,
            glassmorphism blur filters, and electric indigo luminous accents. Built for professional
            analytical ergonomics.
          </p>
        </section>

        {/* Privacy & Determinism Guarantee */}
        <section className="glass-card p-6 space-y-2">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-emerald-400" />
            <h2 className="font-semibold text-white">Privacy & Determinism Guarantee</h2>
          </div>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-xs text-slate-400">
            <li>
              CSV parsing, statistical computations and regressions execute client-side in your
              browser.
            </li>
            <li>
              Numbers come exclusively from verifiable deterministic code, never from generative
              halluncinations.
            </li>
            <li>
              Missing values remain strictly <code className="text-indigo-300 font-mono">null</code>{" "}
              and are excluded from calculations, never coerced to zero.
            </li>
            <li>Your Supabase database keys are stored privately on this machine.</li>
          </ul>
        </section>

        {/* Local Data Management */}
        <section className="glass-card p-6 space-y-3">
          <h2 className="font-semibold text-white">Data Management</h2>
          <p className="text-xs text-slate-400">
            {projects.length} project(s) currently recorded on this device.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="border-red-500/30 text-xs text-red-400 hover:bg-red-500/10 hover:text-red-300"
            onClick={() => setConfirm(true)}
          >
            Clear all local cached data
          </Button>
        </section>
      </div>

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent className="border border-white/10 bg-slate-950 text-white">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete all cached data?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400 text-xs">
              All projects and locally cached datasets will be removed from this browser. Cloud
              records stored in Supabase remain safe.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-white/10 bg-transparent text-white hover:bg-white/5">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-500"
              onClick={() => {
                resetAll();
                toast.success("Local cache cleared.");
              }}
            >
              Delete Local Cache
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

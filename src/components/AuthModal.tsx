import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useStore } from "@/lib/store";
import { PERSONAS, type PersonaId } from "@/lib/stats/personas";
import {
  getSupabaseClient,
  loadSupabaseConfig,
  saveSupabaseConfig,
} from "@/lib/persistence/supabase";
import { toast } from "sonner";
import { Database, ShieldCheck, UserCheck, Cloud, Sparkles, CheckCircle2 } from "lucide-react";

interface AuthModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultTab?: "signup" | "login" | "supabase";
}

export function AuthModal({ open, onOpenChange, defaultTab = "signup" }: AuthModalProps) {
  const { user, login, register, logout, persona, setPersona, syncWithCloud, cloudSyncStatus } =
    useStore();

  const [tab, setTab] = useState<string>(defaultTab);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [selectedPersona, setSelectedPersona] = useState<PersonaId>(persona);
  const [loading, setLoading] = useState(false);

  // Supabase connection config
  const currentConfig = loadSupabaseConfig();
  const [supaUrl, setSupaUrl] = useState(currentConfig.url);
  const [supaKey, setSupaKey] = useState(currentConfig.anonKey);
  const [testingConnection, setTestingConnection] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const res = await register(email, password, name, selectedPersona);
    setLoading(false);
    if (res.error) {
      toast.error(res.error);
    } else {
      toast.success(`Welcome to Lumetra, ${res.user?.name || "Researcher"}!`);
      onOpenChange(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const res = await login(email, password);
    setLoading(false);
    if (res.error) {
      toast.error(res.error);
    } else {
      toast.success(`Signed in as ${res.user?.email}`);
      onOpenChange(false);
    }
  };

  const handleTestSupabase = async () => {
    setTestingConnection(true);
    setTestResult(null);
    const supabase = getSupabaseClient();
    const result = await supabase.testConnection(supaUrl, supaKey);
    setTestingConnection(false);
    setTestResult(result);
    if (result.ok) {
      saveSupabaseConfig({ url: supaUrl, anonKey: supaKey });
      toast.success("Connected to Supabase!");
    } else {
      toast.error(result.message);
    }
  };

  const handleSaveSupabase = () => {
    saveSupabaseConfig({ url: supaUrl, anonKey: supaKey });
    toast.success("Supabase database settings updated.");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md border border-white/10 bg-slate-950/90 p-6 text-slate-100 shadow-[0_16px_50px_rgba(0,0,0,0.8)] backdrop-blur-2xl">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
              <Database className="size-4" />
            </div>
            <div>
              <DialogTitle className="text-lg font-semibold tracking-tight text-white">
                {user ? "Cloud Account & Records" : "Account & Cloud Safe"}
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-400">
                Keep all your datasets, analysis reports, and projects safe in Supabase.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {user ? (
          <div className="space-y-4 pt-2">
            <div className="rounded-xl border border-white/10 bg-slate-900/60 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2 font-medium text-white">
                    <span>{user.name}</span>
                    <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                      Active
                    </span>
                  </div>
                  <div className="text-xs text-slate-400">{user.email}</div>
                </div>
                <div className="text-right">
                  <span className="rounded-md border border-indigo-500/30 bg-indigo-500/10 px-2 py-1 text-[11px] font-medium text-indigo-300">
                    {PERSONAS[user.persona]?.shortRole || user.persona}
                  </span>
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between border-t border-white/5 pt-3 text-xs text-slate-400">
                <div className="flex items-center gap-1.5">
                  <Cloud className="size-3.5 text-cyan-400" />
                  <span>
                    Database: <strong className="text-slate-200">Supabase Cloud Safe</strong>
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-emerald-400">
                  <CheckCircle2 className="size-3.5" />
                  <span>Protected</span>
                </div>
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="flex-1 border-white/10 text-xs hover:bg-slate-900"
                onClick={async () => {
                  const res = await syncWithCloud();
                  if (res.success) {
                    toast.success("All projects safely synced with Cloud database!");
                  } else {
                    toast.error(res.error || "Sync error");
                  }
                }}
              >
                Sync Records Now
              </Button>
              <Button
                variant="destructive"
                size="sm"
                className="text-xs"
                onClick={() => {
                  logout();
                  toast.info("Signed out");
                  onOpenChange(false);
                }}
              >
                Sign Out
              </Button>
            </div>
          </div>
        ) : (
          <Tabs value={tab} onValueChange={setTab} className="mt-2">
            <TabsList className="grid w-full grid-cols-3 border border-white/10 bg-slate-900/80 p-1">
              <TabsTrigger
                value="signup"
                className="text-xs data-[state=active]:bg-indigo-600 data-[state=active]:text-white"
              >
                Sign Up
              </TabsTrigger>
              <TabsTrigger
                value="login"
                className="text-xs data-[state=active]:bg-indigo-600 data-[state=active]:text-white"
              >
                Sign In
              </TabsTrigger>
              <TabsTrigger
                value="supabase"
                className="text-xs data-[state=active]:bg-indigo-600 data-[state=active]:text-white"
              >
                Supabase
              </TabsTrigger>
            </TabsList>

            {/* SIGN UP */}
            <TabsContent value="signup" className="space-y-3 pt-3">
              <form onSubmit={handleRegister} className="space-y-3">
                <div className="space-y-1">
                  <Label className="text-xs text-slate-300">Full Name or Team</Label>
                  <Input
                    placeholder="e.g. Elena Rostova"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    className="border-white/10 bg-slate-900 text-sm text-white"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-slate-300">Email Address</Label>
                  <Input
                    type="email"
                    placeholder="you@domain.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="border-white/10 bg-slate-900 text-sm text-white"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-slate-300">Password</Label>
                  <Input
                    type="password"
                    placeholder="At least 6 characters"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="border-white/10 bg-slate-900 text-sm text-white"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-slate-300">Your Primary Background</Label>
                  <select
                    value={selectedPersona}
                    onChange={(e) => setSelectedPersona(e.target.value as PersonaId)}
                    className="w-full rounded-md border border-white/10 bg-slate-900 px-3 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  >
                    <option value="engineer">
                      ⚡ Software Engineer & SRE (Latencies, SLOs, Telemetry)
                    </option>
                    <option value="economist">
                      📈 Economist & Financial Analyst (Elasticity, Gini, Macro)
                    </option>
                    <option value="scientist">
                      🔬 Data Scientist & ML (Correlation, Distributions, Outliers)
                    </option>
                    <option value="product">
                      📊 Product Manager (A/B Test Lift, Funnels, Retention)
                    </option>
                    <option value="clinical">
                      🩺 Clinical Researcher (Odds Ratios, Relative Risk, Trials)
                    </option>
                  </select>
                </div>

                <Button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-indigo-600 font-medium text-white hover:bg-indigo-500 shadow-[0_0_20px_rgba(99,102,241,0.4)]"
                >
                  {loading ? "Creating Safe Account..." : "Create Account & Enable Cloud Safe"}
                </Button>
              </form>

              <div className="flex items-center gap-2 pt-1 text-[11px] text-slate-400">
                <ShieldCheck className="size-4 text-emerald-400" />
                <span>
                  Zero vendor lock-in. Your data is always encrypted and privately accessible.
                </span>
              </div>
            </TabsContent>

            {/* SIGN IN */}
            <TabsContent value="login" className="space-y-3 pt-3">
              <form onSubmit={handleLogin} className="space-y-3">
                <div className="space-y-1">
                  <Label className="text-xs text-slate-300">Email Address</Label>
                  <Input
                    type="email"
                    placeholder="you@domain.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="border-white/10 bg-slate-900 text-sm text-white"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-slate-300">Password</Label>
                  <Input
                    type="password"
                    placeholder="Your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="border-white/10 bg-slate-900 text-sm text-white"
                  />
                </div>

                <Button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-indigo-600 font-medium text-white hover:bg-indigo-500"
                >
                  {loading ? "Signing in..." : "Sign In & Access Records"}
                </Button>
              </form>

              <div className="text-center pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setEmail("demo@lumetra.internal");
                    setPassword("researcher123");
                  }}
                  className="text-xs text-indigo-400 hover:underline"
                >
                  Fill with sample credentials
                </button>
              </div>
            </TabsContent>

            {/* SUPABASE SETTINGS */}
            <TabsContent value="supabase" className="space-y-3 pt-3">
              <div className="text-xs text-slate-300">
                Connect your personal <strong>Supabase</strong> project to store datasets and
                analyses with unlimited storage capacity.
              </div>

              <div className="space-y-2">
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
                  <Label className="text-xs text-slate-300">Supabase Anon Key</Label>
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
                  className={`rounded-md p-2.5 text-xs ${
                    testResult.ok
                      ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/30"
                      : "bg-red-500/10 text-red-300 border border-red-500/30"
                  }`}
                >
                  {testResult.message}
                </div>
              )}

              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={testingConnection}
                  onClick={handleTestSupabase}
                  className="flex-1 border-white/10 text-xs hover:bg-slate-900"
                >
                  {testingConnection ? "Testing..." : "Test Connection"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={handleSaveSupabase}
                  className="bg-indigo-600 text-xs text-white hover:bg-indigo-500"
                >
                  Save Settings
                </Button>
              </div>

              <div className="rounded-lg border border-white/5 bg-slate-900/40 p-2.5 text-[11px] text-slate-400">
                💡 By default, Lumetra automatically safeguards all dataset files in its safe
                browser vault, bypassing standard storage constraints. Connecting your Supabase
                account enables multi-device sync and unlimited cloud backups.
              </div>
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}

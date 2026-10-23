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
import { Database, ShieldCheck, UserCheck, CheckCircle2, HardDrive, RefreshCw } from "lucide-react";

interface AuthModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultTab?: "signup" | "login" | "supabase";
}

export function AuthModal({ open, onOpenChange, defaultTab = "signup" }: AuthModalProps) {
  const { user, login, register, logout, persona, syncWithCloud, cloudSyncStatus } = useStore();

  const [tab, setTab] = useState<string>(defaultTab);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [selectedPersona, setSelectedPersona] = useState<PersonaId>(persona);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);

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
      toast.success("Successfully connected to Supabase Cloud.");
    } else {
      toast.error(result.message);
    }
  };

  const handleSaveSupabase = () => {
    saveSupabaseConfig({ url: supaUrl, anonKey: supaKey });
    toast.success("Supabase database settings updated.");
  };

  const handleSyncProjects = async () => {
    setSyncing(true);
    const res = await syncWithCloud();
    setSyncing(false);
    if (res.success) {
      toast.success("All project records synchronized with Supabase Cloud.");
    } else {
      toast.error(res.error || "Sync error");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md border border-slate-200 bg-white p-6 text-slate-900 shadow-lg">
        <DialogHeader>
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded border border-blue-200 bg-blue-50 text-blue-600">
              <Database className="size-4" />
            </div>
            <div>
              <DialogTitle className="text-base font-bold tracking-tight text-slate-900">
                {user ? "Account & Cloud Persistence" : "Account & Cloud Storage"}
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-500">
                Manage your user session and Supabase project database synchronization.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {user ? (
          <div className="space-y-4 pt-2">
            <div className="rounded border border-slate-200 bg-slate-50/70 p-3.5 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2 font-semibold text-xs text-slate-900">
                    <span>{user.name}</span>
                    <span className="rounded bg-emerald-50 text-emerald-700 border border-emerald-200 px-1.5 py-0.2 text-[10px] font-mono">
                      Active
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-500 font-mono mt-0.5">{user.email}</div>
                </div>
                <div className="text-right">
                  <span className="rounded border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700">
                    {PERSONAS[user.persona]?.shortRole || user.persona}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between border-t border-slate-200 pt-2 text-[11px] text-slate-600">
                <div className="flex items-center gap-1.5">
                  <Database className="size-3.5 text-blue-600" />
                  <span>
                    Storage: <strong>{cloudSyncStatus.isConfigured ? "Supabase Cloud" : "Local Browser"}</strong>
                  </span>
                </div>
                <span className="font-mono text-slate-400">
                  {user.provider === "supabase" ? "Supabase Auth" : "Local Vault"}
                </span>
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="flex-1 border-slate-300 text-xs text-slate-700 hover:bg-slate-50 font-medium"
                disabled={syncing}
                onClick={handleSyncProjects}
              >
                <RefreshCw className={`mr-1.5 size-3 text-slate-400 ${syncing ? "animate-spin" : ""}`} />
                {syncing ? "Syncing..." : "Sync Projects to Cloud"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="border-slate-300 text-xs text-red-600 hover:bg-red-50 hover:border-red-200 font-medium"
                onClick={() => {
                  logout();
                  toast.info("Signed out of session.");
                  onOpenChange(false);
                }}
              >
                Sign Out
              </Button>
            </div>
          </div>
        ) : (
          <Tabs value={tab} onValueChange={setTab} className="mt-2 space-y-4">
            <TabsList className="grid w-full grid-cols-3 border border-slate-200 bg-slate-100 p-0.5">
              <TabsTrigger
                value="signup"
                className="text-xs data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-xs"
              >
                Sign Up
              </TabsTrigger>
              <TabsTrigger
                value="login"
                className="text-xs data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-xs"
              >
                Sign In
              </TabsTrigger>
              <TabsTrigger
                value="supabase"
                className="text-xs data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-xs"
              >
                Supabase
              </TabsTrigger>
            </TabsList>

            {/* SIGN UP */}
            <TabsContent value="signup" className="space-y-3">
              <form onSubmit={handleRegister} className="space-y-3">
                <div className="space-y-1">
                  <Label className="text-xs font-medium text-slate-700">Full Name</Label>
                  <Input
                    placeholder="e.g. Dr. Alex Mercer"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    className="h-8 border-slate-300 bg-white text-xs text-slate-900"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-medium text-slate-700">Email Address</Label>
                  <Input
                    type="email"
                    placeholder="researcher@institution.org"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="h-8 border-slate-300 bg-white text-xs text-slate-900"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-medium text-slate-700">Password</Label>
                  <Input
                    type="password"
                    placeholder="At least 6 characters"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="h-8 border-slate-300 bg-white text-xs text-slate-900"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-medium text-slate-700">Primary Discipline</Label>
                  <select
                    value={selectedPersona}
                    onChange={(e) => setSelectedPersona(e.target.value as PersonaId)}
                    className="h-8 w-full rounded border border-slate-300 bg-white px-2.5 text-xs text-slate-900"
                  >
                    <option value="engineer">Software Engineer & SRE (Latencies, SLOs)</option>
                    <option value="economist">Economist & Financial Analyst (Elasticity, Gini)</option>
                    <option value="scientist">Data Scientist & ML (Distributions, Outliers)</option>
                    <option value="product">Product Manager (A/B Test Lift, Conversions)</option>
                    <option value="clinical">Clinical Researcher (Odds Ratios, Relative Risk)</option>
                  </select>
                </div>

                <Button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-blue-600 h-8 font-medium text-xs text-white hover:bg-blue-700"
                >
                  {loading ? "Creating Profile..." : "Register Profile"}
                </Button>
              </form>

              <div className="flex items-center gap-1.5 pt-1 text-[11px] text-slate-500">
                <ShieldCheck className="size-3.5 text-emerald-600 shrink-0" />
                <span>Deterministic client execution with optional cloud persistence.</span>
              </div>
            </TabsContent>

            {/* SIGN IN */}
            <TabsContent value="login" className="space-y-3">
              <form onSubmit={handleLogin} className="space-y-3">
                <div className="space-y-1">
                  <Label className="text-xs font-medium text-slate-700">Email Address</Label>
                  <Input
                    type="email"
                    placeholder="researcher@institution.org"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="h-8 border-slate-300 bg-white text-xs text-slate-900"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-medium text-slate-700">Password</Label>
                  <Input
                    type="password"
                    placeholder="Your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="h-8 border-slate-300 bg-white text-xs text-slate-900"
                  />
                </div>

                <Button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-blue-600 h-8 font-medium text-xs text-white hover:bg-blue-700"
                >
                  {loading ? "Signing in..." : "Sign In"}
                </Button>
              </form>

              <div className="text-center pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setEmail("demo@lumetra.internal");
                    setPassword("researcher123");
                  }}
                  className="text-xs text-blue-600 hover:underline"
                >
                  Fill with demo credentials
                </button>
              </div>
            </TabsContent>

            {/* SUPABASE SETTINGS */}
            <TabsContent value="supabase" className="space-y-3">
              <div className="text-xs text-slate-600">
                Connect your <strong>Supabase</strong> project to store datasets and analyses with
                persistent cloud backup.
              </div>

              <div className="space-y-2">
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
                  <Label className="text-xs font-medium text-slate-700">Supabase Anon Key</Label>
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
                  className={`rounded border p-2.5 text-xs ${
                    testResult.ok
                      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                      : "border-red-200 bg-red-50 text-red-800"
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
                  className="flex-1 h-8 border-slate-300 text-xs text-slate-700 hover:bg-slate-50"
                >
                  {testingConnection ? "Testing..." : "Test Connection"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={handleSaveSupabase}
                  className="h-8 bg-blue-600 text-xs text-white hover:bg-blue-700 font-medium px-3"
                >
                  Save Settings
                </Button>
              </div>

              <div className="rounded border border-slate-200 bg-slate-50/70 p-2.5 text-[11px] text-slate-500 leading-relaxed">
                By default, Lumetra stores projects locally on this browser. Connecting your Supabase
                account provides remote backup and cross-device synchronization.
              </div>
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}

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
import { validateSupabaseConfig } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Database,
  ShieldCheck,
  RefreshCw,
  Mail,
  KeyRound,
  Lock,
  ArrowLeft,
  CheckCircle2,
  AlertCircle,
  Loader2,
} from "lucide-react";

interface AuthModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultTab?: "signup" | "login" | "supabase" | "magic" | "reset";
}

export function AuthModal({ open, onOpenChange, defaultTab = "signup" }: AuthModalProps) {
  const {
    user,
    login,
    register,
    logout,
    persona,
    syncWithCloud,
    cloudSyncStatus,
    magicLink,
    resetPassword,
    updatePassword,
    loginWithGoogle,
  } = useStore();

  const [tab, setTab] = useState<string>(defaultTab);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [selectedPersona, setSelectedPersona] = useState<PersonaId>(persona);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);
  const [magicSent, setMagicSent] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [verifyNotice, setVerifyNotice] = useState<string | null>(null);

  // Supabase connection config
  const currentConfig = loadSupabaseConfig();
  const [supaUrl, setSupaUrl] = useState(currentConfig.url);
  const [supaKey, setSupaKey] = useState(currentConfig.anonKey);
  const [testingConnection, setTestingConnection] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const configStatus = validateSupabaseConfig();

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setVerifyNotice(null);
    const res = await register(email, password, name, selectedPersona);
    setLoading(false);
    if (res.error) {
      toast.error(res.error);
    } else {
      if (res.user?.provider === "supabase" && !res.user?.emailConfirmed) {
        setVerifyNotice(
          "Confirmation email sent! Please check your inbox to verify your email address.",
        );
        toast.info("Please verify your email address to complete registration.");
      } else {
        toast.success(`Welcome to Lumetra, ${res.user?.name || "Researcher"}!`);
        onOpenChange(false);
      }
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

  const handleMagicLinkSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const res = await magicLink(email);
    setLoading(false);
    if (res.success) {
      setMagicSent(true);
      toast.success("Magic sign-in link sent to your email!");
    } else {
      toast.error(res.error || "Failed to send magic link.");
    }
  };

  const handleResetPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const res = await resetPassword(email);
    setLoading(false);
    if (res.success) {
      setResetSent(true);
      toast.success("Password reset link sent to your email!");
    } else {
      toast.error(res.error || "Failed to send password reset link.");
    }
  };

  const handleUpdatePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const res = await updatePassword(newPassword);
    setLoading(false);
    if (res.success) {
      toast.success("Password updated successfully.");
      setNewPassword("");
      setTab("login");
    } else {
      toast.error(res.error || "Failed to update password.");
    }
  };

  const handleGoogleSignIn = async () => {
    setOauthLoading(true);
    const res = await loginWithGoogle();
    setOauthLoading(false);
    if (res.error) {
      toast.error(res.error);
    }
  };

  const handleTestSupabase = async () => {
    setTestingConnection(true);
    setTestResult(null);
    const client = getSupabaseClient();
    const result = await client.testConnection(supaUrl, supaKey);
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
                {user ? "Account & Cloud Persistence" : "Account & Cloud Authentication"}
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-500">
                Manage your user session, identity, and Supabase cloud synchronization.
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
                    Storage:{" "}
                    <strong>
                      {cloudSyncStatus.isConfigured ? "Supabase Cloud" : "Local Browser"}
                    </strong>
                  </span>
                </div>
                <span className="font-mono text-slate-400">
                  {user.provider === "supabase" ? "Supabase Auth" : "Local Vault"}
                </span>
              </div>
            </div>

            {/* Change Password option for signed-in user */}
            <div className="rounded border border-slate-200 p-3 bg-white space-y-2">
              <div className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                <KeyRound className="size-3.5 text-slate-500" />
                Change Password
              </div>
              <form onSubmit={handleUpdatePasswordSubmit} className="flex gap-2">
                <Input
                  type="password"
                  placeholder="New password (min 6 chars)"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="h-8 border-slate-300 text-xs text-slate-900 flex-1"
                />
                <Button
                  type="submit"
                  size="sm"
                  disabled={loading || newPassword.length < 6}
                  className="h-8 bg-blue-600 px-3 text-xs text-white hover:bg-blue-700"
                >
                  {loading ? "Updating..." : "Update"}
                </Button>
              </form>
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="flex-1 border-slate-300 text-xs text-slate-700 hover:bg-slate-50 font-medium"
                disabled={syncing}
                onClick={handleSyncProjects}
              >
                <RefreshCw
                  className={`mr-1.5 size-3 text-slate-400 ${syncing ? "animate-spin" : ""}`}
                />
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
            <TabsList className="grid w-full grid-cols-4 border border-slate-200 bg-slate-100 p-0.5">
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
                value="magic"
                className="text-xs data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-xs"
              >
                Magic Link
              </TabsTrigger>
              <TabsTrigger
                value="supabase"
                className="text-xs data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-xs"
              >
                Cloud
              </TabsTrigger>
            </TabsList>

            {/* SIGN UP */}
            <TabsContent value="signup" className="space-y-3">
              {verifyNotice && (
                <div className="rounded border border-blue-200 bg-blue-50 p-2.5 text-xs text-blue-800 flex items-start gap-2">
                  <CheckCircle2 className="size-4 shrink-0 text-blue-600 mt-0.5" />
                  <span>{verifyNotice}</span>
                </div>
              )}

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
                    <option value="economist">
                      Economist & Financial Analyst (Elasticity, Gini)
                    </option>
                    <option value="scientist">Data Scientist & ML (Distributions, Outliers)</option>
                    <option value="product">Product Manager (A/B Test Lift, Conversions)</option>
                    <option value="clinical">
                      Clinical Researcher (Odds Ratios, Relative Risk)
                    </option>
                  </select>
                </div>

                <Button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-blue-600 h-8 font-medium text-xs text-white hover:bg-blue-700"
                >
                  {loading ? (
                    <span className="flex items-center gap-1.5">
                      <Loader2 className="size-3.5 animate-spin" /> Creating Profile...
                    </span>
                  ) : (
                    "Register Profile"
                  )}
                </Button>
              </form>

              <div className="relative my-3">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-slate-200" />
                </div>
                <div className="relative flex justify-center text-[10px] uppercase">
                  <span className="bg-white px-2 text-slate-400 font-mono">or</span>
                </div>
              </div>

              <Button
                type="button"
                variant="outline"
                disabled={oauthLoading}
                onClick={handleGoogleSignIn}
                className="w-full h-8 border-slate-300 bg-white text-xs text-slate-700 hover:bg-slate-50 font-medium"
              >
                <svg className="mr-2 size-3.5" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                  />
                </svg>
                Continue with Google
              </Button>
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
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-medium text-slate-700">Password</Label>
                    <button
                      type="button"
                      onClick={() => setTab("reset")}
                      className="text-[11px] text-blue-600 hover:underline"
                    >
                      Forgot password?
                    </button>
                  </div>
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
                  {loading ? (
                    <span className="flex items-center gap-1.5">
                      <Loader2 className="size-3.5 animate-spin" /> Signing In...
                    </span>
                  ) : (
                    "Sign In"
                  )}
                </Button>
              </form>

              <div className="relative my-3">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-slate-200" />
                </div>
                <div className="relative flex justify-center text-[10px] uppercase">
                  <span className="bg-white px-2 text-slate-400 font-mono">or</span>
                </div>
              </div>

              <Button
                type="button"
                variant="outline"
                disabled={oauthLoading}
                onClick={handleGoogleSignIn}
                className="w-full h-8 border-slate-300 bg-white text-xs text-slate-700 hover:bg-slate-50 font-medium"
              >
                <svg className="mr-2 size-3.5" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                  />
                </svg>
                Continue with Google
              </Button>

              <div className="flex justify-between items-center pt-1 text-xs">
                <button
                  type="button"
                  onClick={() => setTab("magic")}
                  className="text-slate-600 hover:text-blue-600 text-[11px]"
                >
                  Passwordless magic link $\rightarrow$
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEmail("demo@lumetra.internal");
                    setPassword("researcher123");
                  }}
                  className="text-slate-500 hover:text-slate-800 text-[11px]"
                >
                  Demo credentials
                </button>
              </div>
            </TabsContent>

            {/* MAGIC LINK */}
            <TabsContent value="magic" className="space-y-3">
              <div className="text-xs text-slate-600 leading-relaxed">
                Enter your email address and we will send you a secure magic link to sign in without
                a password.
              </div>

              {magicSent ? (
                <div className="rounded border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800 space-y-1.5">
                  <div className="font-semibold flex items-center gap-1.5">
                    <CheckCircle2 className="size-4 text-emerald-600" />
                    Magic Link Sent!
                  </div>
                  <p>
                    Check your email inbox at <strong>{email}</strong> and click the link to sign in
                    immediately.
                  </p>
                </div>
              ) : (
                <form onSubmit={handleMagicLinkSubmit} className="space-y-3">
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

                  <Button
                    type="submit"
                    disabled={loading}
                    className="w-full bg-blue-600 h-8 font-medium text-xs text-white hover:bg-blue-700"
                  >
                    {loading ? (
                      <span className="flex items-center gap-1.5">
                        <Loader2 className="size-3.5 animate-spin" /> Sending Link...
                      </span>
                    ) : (
                      "Send Magic Link"
                    )}
                  </Button>
                </form>
              )}

              <div className="pt-1 text-center">
                <button
                  type="button"
                  onClick={() => setTab("login")}
                  className="text-xs text-slate-500 hover:text-slate-800 flex items-center justify-center gap-1 mx-auto"
                >
                  <ArrowLeft className="size-3" /> Back to Sign In
                </button>
              </div>
            </TabsContent>

            {/* PASSWORD RESET */}
            <TabsContent value="reset" className="space-y-3">
              <div className="text-xs text-slate-600 leading-relaxed">
                Enter your registered email address and we will send you a link to reset your
                password.
              </div>

              {resetSent ? (
                <div className="rounded border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800 space-y-1.5">
                  <div className="font-semibold flex items-center gap-1.5">
                    <CheckCircle2 className="size-4 text-emerald-600" />
                    Reset Email Dispatched!
                  </div>
                  <p>
                    We have sent a password reset link to <strong>{email}</strong> if an account
                    exists with that address.
                  </p>
                </div>
              ) : (
                <form onSubmit={handleResetPasswordSubmit} className="space-y-3">
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

                  <Button
                    type="submit"
                    disabled={loading}
                    className="w-full bg-blue-600 h-8 font-medium text-xs text-white hover:bg-blue-700"
                  >
                    {loading ? (
                      <span className="flex items-center gap-1.5">
                        <Loader2 className="size-3.5 animate-spin" /> Sending Reset Link...
                      </span>
                    ) : (
                      "Send Reset Link"
                    )}
                  </Button>
                </form>
              )}

              <div className="pt-1 text-center">
                <button
                  type="button"
                  onClick={() => setTab("login")}
                  className="text-xs text-slate-500 hover:text-slate-800 flex items-center justify-center gap-1 mx-auto"
                >
                  <ArrowLeft className="size-3" /> Back to Sign In
                </button>
              </div>
            </TabsContent>

            {/* SUPABASE SETTINGS */}
            <TabsContent value="supabase" className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-700">Configuration Status</span>
                <span
                  className={`rounded border px-2 py-0.5 text-[10px] font-mono ${
                    configStatus.isConfigured
                      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                      : "border-amber-200 bg-amber-50 text-amber-800"
                  }`}
                >
                  {configStatus.isConfigured ? "Configured" : "Missing Configuration"}
                </span>
              </div>

              {!configStatus.isConfigured && (
                <div className="rounded border border-amber-200 bg-amber-50/70 p-2.5 text-xs text-amber-900 leading-relaxed flex items-start gap-2">
                  <AlertCircle className="size-4 shrink-0 text-amber-600 mt-0.5" />
                  <div>
                    Set <code>VITE_SUPABASE_URL</code> and{" "}
                    <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> in your <code>.env.local</code> file
                    or Lovable Settings to enable Supabase Cloud authentication and database backup.
                  </div>
                </div>
              )}

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
                By default, Lumetra stores projects locally on this browser. Connecting your
                Supabase account provides remote backup and cross-device synchronization. Never
                enter secret or service_role keys.
              </div>
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}

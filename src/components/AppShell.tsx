import { Link, useRouterState } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { useStore } from "@/lib/store";
import { PERSONAS, type PersonaId } from "@/lib/stats/personas";
import { AuthModal } from "./AuthModal";
import {
  Cloud,
  CheckCircle2,
  Sparkles,
  User,
  Database,
  TrendingUp,
  Cpu,
  Boxes,
  Target,
  HeartPulse,
  ChevronDown,
} from "lucide-react";
import { Button } from "./ui/button";

const NAV = [
  { to: "/", label: "Overview" },
  { to: "/projects", label: "My Projects" },
  { to: "/workspace", label: "Data Workspace" },
  { to: "/analyses", label: "Analyses" },
  { to: "/ask", label: "Ask" },
  { to: "/reports", label: "Reports" },
  { to: "/learn", label: "Learn" },
] as const;

const PERSONA_ICONS: Record<PersonaId, typeof Cpu> = {
  engineer: Cpu,
  economist: TrendingUp,
  scientist: Boxes,
  product: Target,
  clinical: HeartPulse,
};

function Mark() {
  return (
    <div className="relative flex size-6 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-cyan-500 p-1 shadow-[0_0_15px_rgba(99,102,241,0.5)]">
      <svg viewBox="0 0 24 24" className="size-4 text-white" aria-hidden="true" fill="currentColor">
        <rect x="3" y="13" width="3.5" height="8" rx="0.75" />
        <rect x="10.25" y="7" width="3.5" height="14" rx="0.75" opacity=".85" />
        <rect x="17.5" y="2" width="3.5" height="19" rx="0.75" opacity=".95" />
      </svg>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { active, activeProject, persona, setPersona, user, cloudSyncStatus } = useStore();
  const [authOpen, setAuthOpen] = useState(false);
  const [authTab, setAuthTab] = useState<"signup" | "login" | "supabase">("signup");
  const [personaOpen, setPersonaOpen] = useState(false);

  const isActive = (to: string) => (to === "/" ? path === "/" : path.startsWith(to));
  const PersonaIcon = PERSONA_ICONS[persona] || Cpu;

  return (
    <div className="min-h-screen md:grid md:grid-cols-[240px_1fr]">
      {/* ThreeUI Glass Sidebar */}
      <aside className="no-print border-b border-white/10 bg-slate-950/70 backdrop-blur-xl md:sticky md:top-0 md:h-screen md:border-b-0 md:border-r md:flex md:flex-col">
        {/* Brand Header */}
        <div className="flex items-center gap-2.5 px-4 py-4 md:py-5 border-b border-white/5">
          <Mark />
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-[15px] font-bold tracking-tight text-white">Lumetra</span>
              <span className="rounded-full bg-indigo-500/10 border border-indigo-500/20 px-1.5 py-0.2 text-[10px] font-mono text-indigo-300">
                PRO
              </span>
            </div>
            <p className="text-[10.5px] text-slate-400 font-mono tracking-tight">
              ThreeUI Intelligence
            </p>
          </div>
        </div>

        {/* Personalized Background Switcher */}
        <div className="p-3 border-b border-white/5 relative">
          <div className="eyebrow mb-1.5 flex items-center justify-between text-[10px]">
            <span>Active Persona</span>
            <span className="text-[9px] text-indigo-400 font-mono">Tailored</span>
          </div>
          <button
            onClick={() => setPersonaOpen(!personaOpen)}
            className="w-full flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-slate-900/80 p-2 text-left hover:border-indigo-500/40 hover:bg-slate-900 transition-all shadow-sm"
          >
            <div className="flex items-center gap-2 min-w-0">
              <div className="flex size-6 items-center justify-center rounded-md bg-indigo-500/20 text-indigo-300">
                <PersonaIcon className="size-3.5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[12px] font-medium text-white truncate">
                  {PERSONAS[persona]?.shortRole}
                </div>
                <div className="text-[10px] text-slate-400 truncate">
                  {PERSONAS[persona]?.badge}
                </div>
              </div>
            </div>
            <ChevronDown className="size-3.5 text-slate-400 shrink-0" />
          </button>

          {/* Persona Dropdown */}
          {personaOpen && (
            <div className="absolute left-3 right-3 top-full z-50 mt-1 rounded-xl border border-white/10 bg-slate-950/95 p-1.5 shadow-[0_12px_40px_rgba(0,0,0,0.8)] backdrop-blur-2xl">
              {(Object.keys(PERSONAS) as PersonaId[]).map((pId) => {
                const p = PERSONAS[pId];
                const Icon = PERSONA_ICONS[pId];
                const isCurrent = pId === persona;
                return (
                  <button
                    key={pId}
                    onClick={() => {
                      setPersona(pId);
                      setPersonaOpen(false);
                    }}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs transition-colors ${
                      isCurrent
                        ? "bg-indigo-600/20 text-indigo-200 border border-indigo-500/30"
                        : "text-slate-300 hover:bg-white/5 hover:text-white"
                    }`}
                  >
                    <Icon className="size-4 shrink-0 text-indigo-400" />
                    <div className="min-w-0">
                      <div className="font-medium truncate">{p.shortRole}</div>
                      <div className="text-[10px] text-slate-400 truncate">{p.badge}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Navigation Links */}
        <nav
          aria-label="Main"
          className="flex gap-1 overflow-x-auto px-2 py-2 md:flex-col md:overflow-visible md:flex-1"
        >
          {NAV.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              className={`whitespace-nowrap rounded-lg px-3 py-2 text-[13px] font-medium transition-all ${
                isActive(n.to)
                  ? "bg-gradient-to-r from-indigo-500/20 to-cyan-500/10 text-white border border-indigo-500/30 shadow-[0_0_15px_rgba(99,102,241,0.2)]"
                  : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
              }`}
            >
              {n.label}
            </Link>
          ))}
          <Link
            to="/settings"
            className={`whitespace-nowrap rounded-lg px-3 py-2 text-[13px] font-medium md:mt-2 transition-all ${
              isActive("/settings")
                ? "bg-indigo-500/20 text-white border border-indigo-500/30"
                : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
            }`}
          >
            Settings & Supabase
          </Link>
        </nav>

        {/* Active Dataset Widget */}
        <div className="hidden px-3 py-3 border-t border-white/5 md:block">
          <div className="eyebrow mb-1.5 text-[10px]">Active dataset</div>
          {active ? (
            <div className="rounded-lg border border-white/10 bg-slate-900/60 p-2.5 text-[12px] leading-snug">
              <div className="truncate font-medium text-white" title={active.dataset.name}>
                {active.dataset.name}
              </div>
              <div className="num text-[11px] text-slate-400 mt-0.5">
                {active.dataset.rows.length.toLocaleString()} rows × {active.dataset.columns.length}{" "}
                cols
              </div>
              <div className="mt-1 flex items-center gap-1.5 text-[11px]">
                <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span
                  className={
                    activeProject ? "text-emerald-400 font-medium" : "text-amber-400 font-medium"
                  }
                >
                  {activeProject ? `Saved · ${activeProject.name}` : "Unsaved session"}
                </span>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-white/10 p-2.5 text-[11px] text-slate-500">
              No dataset loaded
            </div>
          )}
        </div>

        {/* User Account & Supabase Safe Bar */}
        <div className="p-3 border-t border-white/5 bg-slate-950/40">
          {user ? (
            <button
              onClick={() => {
                setAuthTab("signup");
                setAuthOpen(true);
              }}
              className="flex w-full items-center justify-between gap-2 rounded-lg border border-white/10 bg-slate-900/60 p-2 text-left hover:border-indigo-500/30 hover:bg-slate-900 transition-all"
            >
              <div className="flex items-center gap-2 min-w-0">
                <div className="flex size-7 items-center justify-center rounded-full bg-indigo-600/30 text-indigo-300 font-bold text-xs border border-indigo-500/30">
                  {user.name.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-medium text-white truncate">{user.name}</div>
                  <div className="flex items-center gap-1 text-[10px] text-emerald-400">
                    <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span>Supabase Safe</span>
                  </div>
                </div>
              </div>
            </button>
          ) : (
            <div className="space-y-1.5">
              <button
                onClick={() => {
                  setAuthTab("signup");
                  setAuthOpen(true);
                }}
                className="w-full flex items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-500 hover:to-indigo-600 px-3 py-1.5 text-xs font-medium text-white shadow-[0_0_15px_rgba(99,102,241,0.35)] transition-all"
              >
                <Database className="size-3.5" />
                <span>Sign Up · Safe Cloud</span>
              </button>
              <div className="flex items-center justify-between px-1 text-[10px] text-slate-400">
                <span className="flex items-center gap-1">
                  <span className="size-1.5 rounded-full bg-cyan-400" />
                  Local Vault Safe
                </span>
                <button
                  onClick={() => {
                    setAuthTab("supabase");
                    setAuthOpen(true);
                  }}
                  className="text-indigo-400 hover:underline"
                >
                  Supabase DB
                </button>
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="min-w-0 px-4 py-6 md:px-10 md:py-8 relative z-10">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>

      {/* Auth & Supabase Modal */}
      <AuthModal open={authOpen} onOpenChange={setAuthOpen} defaultTab={authTab} />
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-col gap-3 border-b border-white/10 pb-5 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white gradient-heading">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-[13px] text-slate-400">{description}</p>}
      </div>
      {actions && <div className="no-print flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="glass-card flex flex-col items-start gap-2 border-dashed border-white/15 p-6 backdrop-blur-xl">
      <div className="font-semibold text-white">{title}</div>
      {children && <div className="max-w-xl text-[13px] text-slate-400">{children}</div>}
      {action && <div className="mt-2 flex flex-wrap gap-2">{action}</div>}
    </div>
  );
}

export function Notice({
  tone = "info",
  children,
}: {
  tone?: "info" | "warning" | "error";
  children: ReactNode;
}) {
  const cls =
    tone === "error"
      ? "border-red-500/40 bg-red-500/10 text-red-300 shadow-[0_0_20px_rgba(239,68,68,0.15)]"
      : tone === "warning"
        ? "border-amber-500/40 bg-amber-500/10 text-amber-300 shadow-[0_0_20px_rgba(245,158,11,0.15)]"
        : "border-indigo-500/30 bg-indigo-500/10 text-indigo-300 shadow-[0_0_20px_rgba(99,102,241,0.15)]";
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`rounded-xl border px-3.5 py-2.5 text-[13px] backdrop-blur-md ${cls}`}
    >
      {children}
    </div>
  );
}

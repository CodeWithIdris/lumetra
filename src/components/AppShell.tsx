import { Link, useRouterState } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { useStore } from "@/lib/store";
import { PERSONAS, type PersonaId } from "@/lib/stats/personas";
import { AuthModal } from "./AuthModal";
import {
  LayoutDashboard,
  FolderKanban,
  Table2,
  LineChart,
  MessageSquareCode,
  FileText,
  BookOpen,
  Settings,
  Database,
  Check,
  ChevronDown,
  Menu,
  X,
  Cpu,
  TrendingUp,
  Boxes,
  Target,
  HeartPulse,
  HardDrive,
} from "lucide-react";
import { Button } from "./ui/button";

const NAV = [
  { to: "/", label: "Overview", icon: LayoutDashboard },
  { to: "/projects", label: "My Projects", icon: FolderKanban },
  { to: "/workspace", label: "Data Workspace", icon: Table2 },
  { to: "/analyses", label: "Analyses", icon: LineChart },
  { to: "/ask", label: "Ask", icon: MessageSquareCode },
  { to: "/reports", label: "Reports", icon: FileText },
  { to: "/learn", label: "Learn", icon: BookOpen },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

const PERSONA_ICONS: Record<PersonaId, typeof Cpu> = {
  engineer: Cpu,
  economist: TrendingUp,
  scientist: Boxes,
  product: Target,
  clinical: HeartPulse,
};

function LumetraMark() {
  return (
    <div className="flex size-7 items-center justify-center rounded bg-slate-900 text-white">
      <svg viewBox="0 0 24 24" className="size-4 text-white" aria-hidden="true" fill="currentColor">
        <rect x="3" y="14" width="3.5" height="7" rx="0.5" />
        <rect x="10.25" y="8" width="3.5" height="13" rx="0.5" opacity=".9" />
        <rect x="17.5" y="3" width="3.5" height="18" rx="0.5" opacity="1" />
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
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const isActive = (to: string) => (to === "/" ? path === "/" : path.startsWith(to));
  const PersonaIcon = PERSONA_ICONS[persona] || Cpu;
  const currentPersona = PERSONAS[persona];

  // Route title mapping for top bar
  const pageTitle =
    path === "/"
      ? "Overview"
      : path.startsWith("/projects")
        ? "My Projects"
        : path.startsWith("/workspace")
          ? "Data Workspace"
          : path.startsWith("/analyses")
            ? "Analyses"
            : path.startsWith("/ask")
              ? "Ask Analyst"
              : path.startsWith("/reports")
                ? "Reports"
                : path.startsWith("/learn")
                  ? "Learn & Methods"
                  : path.startsWith("/settings")
                    ? "Settings"
                    : "Workspace";

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 md:grid md:grid-cols-[240px_1fr]">
      {/* Mobile Backdrop */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-xs md:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Persistent Left Sidebar */}
      <aside
        className={`no-print fixed inset-y-0 left-0 z-50 flex w-60 flex-col border-r border-slate-200 bg-white transition-transform duration-200 ease-in-out md:static md:translate-x-0 ${
          mobileMenuOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Brand Header */}
        <div className="flex h-14 items-center justify-between border-b border-slate-200 px-4">
          <Link
            to="/"
            className="flex items-center gap-2.5"
            onClick={() => setMobileMenuOpen(false)}
          >
            <LumetraMark />
            <div>
              <div className="text-[14px] font-bold tracking-tight text-slate-900 leading-none">
                Lumetra
              </div>
              <div className="text-[11px] text-slate-500 font-mono tracking-tight mt-0.5">
                Analytical Workspace
              </div>
            </div>
          </Link>
          <button
            className="p-1 text-slate-400 hover:text-slate-600 md:hidden"
            onClick={() => setMobileMenuOpen(false)}
            aria-label="Close menu"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Primary Navigation Links */}
        <nav aria-label="Main Navigation" className="flex-1 space-y-0.5 overflow-y-auto px-2.5 py-3">
          <div className="px-2 pb-1 text-[10px] font-mono uppercase tracking-wider text-slate-400 font-semibold">
            Workspace
          </div>
          {NAV.map((n) => {
            const Icon = n.icon;
            const activeLink = isActive(n.to);
            return (
              <Link
                key={n.to}
                to={n.to}
                onClick={() => setMobileMenuOpen(false)}
                className={`flex items-center gap-2.5 rounded px-2.5 py-1.5 text-[13px] font-medium transition-colors ${
                  activeLink
                    ? "bg-slate-100 text-blue-700 font-semibold"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                }`}
              >
                <Icon
                  className={`size-4 shrink-0 ${activeLink ? "text-blue-600" : "text-slate-400"}`}
                />
                <span>{n.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Active Dataset & Context Summary */}
        <div className="border-t border-slate-200 p-3 bg-slate-50/60">
          <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400 font-semibold mb-1.5">
            Active Dataset
          </div>
          {active ? (
            <div className="rounded border border-slate-200 bg-white p-2.5 text-xs shadow-2xs">
              <div className="truncate font-semibold text-slate-900" title={active.dataset.name}>
                {active.dataset.name}
              </div>
              <div className="num mt-0.5 text-[11px] text-slate-500 font-mono">
                {active.dataset.rows.length.toLocaleString()} rows × {active.dataset.columns.length}{" "}
                columns
              </div>
              <div className="mt-1.5 flex items-center gap-1.5 text-[11px]">
                <span className="size-1.5 rounded-full bg-emerald-600" />
                <span className={activeProject ? "text-slate-700 font-medium truncate" : "text-amber-700"}>
                  {activeProject ? activeProject.name : "Unsaved session"}
                </span>
              </div>
            </div>
          ) : (
            <div className="rounded border border-dashed border-slate-300 bg-white/50 p-2.5 text-xs text-slate-500 text-center">
              No dataset loaded
            </div>
          )}
        </div>

        {/* Storage & Privacy Status Bar */}
        <div className="border-t border-slate-200 p-3 bg-white text-xs">
          <div className="flex items-center justify-between text-[11px] text-slate-600">
            <span className="flex items-center gap-1.5">
              <HardDrive className="size-3 text-slate-400" />
              <span>In-browser local engine</span>
            </span>
            <span className="inline-block size-1.5 rounded-full bg-emerald-500" title="Deterministic client engine active" />
          </div>

          <div className="mt-2 flex items-center justify-between pt-1 border-t border-slate-100">
            <button
              onClick={() => {
                setAuthTab("supabase");
                setAuthOpen(true);
              }}
              className="flex items-center gap-1.5 text-[11px] text-slate-600 hover:text-slate-900"
            >
              <Database className="size-3 text-blue-600" />
              <span>{user ? `Cloud: ${user.name}` : "Supabase Cloud"}</span>
            </button>
            <span className="text-[10px] font-mono text-slate-400">
              {cloudSyncStatus === "synced" ? "Synced" : "Local"}
            </span>
          </div>
        </div>
      </aside>

      {/* Main Column */}
      <div className="flex flex-col min-w-0">
        {/* Compact Production Top Bar */}
        <header className="no-print sticky top-0 z-30 flex h-14 items-center justify-between border-b border-slate-200 bg-white/95 px-4 backdrop-blur-xs md:px-8">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="p-1.5 text-slate-600 hover:text-slate-900 md:hidden"
              aria-label="Open menu"
            >
              <Menu className="size-5" />
            </button>

            <div className="flex items-center gap-2 truncate">
              <span className="text-sm font-semibold text-slate-900">{pageTitle}</span>
              {active && (
                <>
                  <span className="text-slate-300">/</span>
                  <span
                    className="truncate text-xs font-mono text-slate-500 max-w-[200px]"
                    title={active.dataset.name}
                  >
                    {active.dataset.name}
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Top Bar Controls */}
          <div className="flex items-center gap-2.5">
            {/* Compact Professional Persona Selector */}
            <div className="relative">
              <button
                onClick={() => setPersonaOpen(!personaOpen)}
                className="flex items-center gap-1.5 rounded border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 hover:text-slate-900 transition-colors"
                title="Change professional analytical context"
              >
                <PersonaIcon className="size-3.5 text-blue-600 shrink-0" />
                <span className="hidden sm:inline">{currentPersona.shortRole}</span>
                <ChevronDown className="size-3 text-slate-400" />
              </button>

              {personaOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setPersonaOpen(false)} />
                  <div className="absolute right-0 top-full z-50 mt-1 w-64 rounded-md border border-slate-200 bg-white p-1 shadow-lg">
                    <div className="px-2 py-1.5 text-[10px] font-mono uppercase tracking-wider text-slate-400 font-semibold border-b border-slate-100">
                      Professional Context
                    </div>
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
                          className={`flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors ${
                            isCurrent
                              ? "bg-blue-50 text-blue-900 font-semibold"
                              : "text-slate-700 hover:bg-slate-50 hover:text-slate-900"
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <Icon
                              className={`size-3.5 shrink-0 ${isCurrent ? "text-blue-600" : "text-slate-400"}`}
                            />
                            <span className="truncate">{p.shortRole}</span>
                          </div>
                          {isCurrent && <Check className="size-3 text-blue-600 shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>

            {/* Auth / Account Quick Trigger */}
            {user ? (
              <button
                onClick={() => {
                  setAuthTab("supabase");
                  setAuthOpen(true);
                }}
                className="flex items-center gap-1.5 rounded border border-slate-200 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
              >
                <div className="flex size-4 items-center justify-center rounded-full bg-blue-600 text-[10px] font-bold text-white">
                  {user.name.charAt(0).toUpperCase()}
                </div>
                <span className="hidden sm:inline max-w-[100px] truncate">{user.name}</span>
              </button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs border-slate-200 text-slate-700 hover:bg-slate-50"
                onClick={() => {
                  setAuthTab("signup");
                  setAuthOpen(true);
                }}
              >
                Sign In
              </Button>
            )}
          </div>
        </header>

        {/* Page Content Viewport */}
        <main className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8">
          <div className="mx-auto max-w-6xl">{children}</div>
        </main>
      </div>

      {/* Cloud & Authentication Modal */}
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
    <header className="mb-6 flex flex-col gap-3 border-b border-slate-200 pb-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-[13px] text-slate-600">{description}</p>}
      </div>
      {actions && <div className="no-print flex flex-wrap items-center gap-2">{actions}</div>}
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
    <div className="rounded-md border border-slate-200 bg-white p-6 shadow-2xs">
      <div className="text-sm font-semibold text-slate-900">{title}</div>
      {children && <div className="mt-1 max-w-xl text-[13px] text-slate-600 leading-relaxed">{children}</div>}
      {action && <div className="mt-4 flex flex-wrap gap-2">{action}</div>}
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
      ? "border-red-200 bg-red-50 text-red-900"
      : tone === "warning"
        ? "border-amber-200 bg-amber-50 text-amber-900"
        : "border-blue-200 bg-blue-50 text-blue-900";
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`rounded border px-3.5 py-2.5 text-[13px] ${cls}`}
    >
      {children}
    </div>
  );
}

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
  Loader2,
  CheckCircle2,
  AlertCircle,
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
    <div className="flex size-6 items-center justify-center rounded bg-slate-900 text-white shadow-2xs">
      <svg
        viewBox="0 0 24 24"
        className="size-3.5 text-white"
        aria-hidden="true"
        fill="currentColor"
      >
        <rect x="3" y="14" width="3.5" height="7" rx="0.5" />
        <rect x="10.25" y="8" width="3.5" height="13" rx="0.5" opacity=".9" />
        <rect x="17.5" y="3" width="3.5" height="18" rx="0.5" opacity="1" />
      </svg>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const {
    active,
    activeProject,
    persona,
    setPersona,
    user,
    persistenceState,
  } = useStore();
  const [authOpen, setAuthOpen] = useState(false);
  const [authTab, setAuthTab] = useState<"signup" | "login" | "magic" | "reset">("signup");
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
    <div className="min-h-screen bg-slate-50 text-slate-900 md:grid md:grid-cols-[230px_1fr]">
      {/* Mobile Backdrop */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-xs md:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Persistent Left Sidebar */}
      <aside
        className={`no-print fixed inset-y-0 left-0 z-50 flex w-[230px] flex-col border-r border-slate-200 bg-white transition-transform duration-200 ease-in-out md:static md:translate-x-0 ${
          mobileMenuOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Brand Header */}
        <div className="flex h-12 items-center justify-between border-b border-slate-200 px-3.5">
          <Link
            to="/"
            className="flex items-center gap-2.5"
            onClick={() => setMobileMenuOpen(false)}
          >
            <LumetraMark />
            <div className="leading-tight">
              <div className="text-[13px] font-semibold tracking-tight text-slate-900">Lumetra</div>
              <div className="text-[11px] text-slate-500 font-normal">Analytical Workspace</div>
            </div>
          </Link>
          <button
            className="p-1 text-slate-400 hover:text-slate-600 md:hidden"
            onClick={() => setMobileMenuOpen(false)}
            aria-label="Close menu"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Primary Navigation Links */}
        <nav
          aria-label="Main Navigation"
          className="flex-1 space-y-0.5 overflow-y-auto px-2 py-2.5"
        >
          <div className="px-2 pb-1.5 text-[11px] font-medium text-slate-400">Workspace</div>
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
                    ? "bg-slate-100 text-slate-900 font-semibold"
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

        {/* Compact Unobtrusive Sidebar Footer */}
        <div className="border-t border-slate-200 bg-slate-50/60 p-2.5 text-xs space-y-2">
          {/* Active Dataset Context */}
          <div className="flex items-center justify-between gap-1 text-[11px]">
            <span className="text-slate-400 font-medium">Dataset</span>
            {active ? (
              <div className="min-w-0 text-right truncate" title={active.dataset.name}>
                <span className="font-mono text-slate-800 truncate block font-medium">
                  {active.dataset.name}
                </span>
                <span className="num font-mono text-[10px] text-slate-400 block">
                  {active.dataset.rows.length.toLocaleString()} rows
                </span>
              </div>
            ) : (
              <span className="text-slate-400">None loaded</span>
            )}
          </div>

          {/* Engine & Persistence Status */}
          <div className="flex items-center justify-between border-t border-slate-200/70 pt-1.5 text-[11px] text-slate-500">
            <span className="flex items-center gap-1.5">
              <span
                className="size-1.5 rounded-full bg-emerald-500"
                title="Deterministic client-side engine active"
              />
              <span>Local Engine</span>
            </span>
            <div className="flex items-center gap-1 font-mono text-[10px] text-slate-500">
              <span className="size-1.5 rounded-full bg-emerald-500" />
              <span>{persistenceState.status === "saved" ? "Saved" : persistenceState.statusText}</span>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Column */}
      <div className="flex flex-col min-w-0">
        {/* Compact Production Top Bar */}
        <header className="no-print sticky top-0 z-30 flex h-12 items-center justify-between border-b border-slate-200 bg-white/95 px-4 backdrop-blur-xs md:px-6">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="p-1 text-slate-600 hover:text-slate-900 md:hidden"
              aria-label="Open menu"
            >
              <Menu className="size-4" />
            </button>

            <div className="flex items-center gap-1.5 truncate text-xs">
              <span className="font-semibold text-slate-900">{pageTitle}</span>
              {activeProject && (
                <>
                  <span className="text-slate-300">/</span>
                  <span
                    className="truncate font-medium text-slate-700 max-w-[160px]"
                    title={`Project: ${activeProject.name}`}
                  >
                    {activeProject.name}
                  </span>
                </>
              )}
              {active && (
                <>
                  <span className="text-slate-300">/</span>
                  <span
                    className="truncate font-mono text-slate-500 max-w-[160px]"
                    title={`Dataset: ${active.dataset.name}`}
                  >
                    {active.dataset.name}
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Top Bar Controls */}
          <div className="flex items-center gap-2">
            {/* Save & Persistence Indicator (Requirement 1 & 9) */}
            <div
              className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-mono border ${
                persistenceState.status === "error"
                  ? "border-red-200 bg-red-50 text-red-700"
                  : persistenceState.status === "retrying"
                    ? "border-amber-200 bg-amber-50 text-amber-700"
                    : persistenceState.status === "saving"
                      ? "border-blue-200 bg-blue-50 text-blue-700"
                      : persistenceState.status === "offline"
                        ? "border-slate-200 bg-slate-100 text-slate-600"
                        : persistenceState.status === "pending"
                          ? "border-amber-200 bg-amber-50 text-amber-700"
                          : "border-slate-200 bg-slate-50 text-slate-600"
              }`}
              title={persistenceState.error ?? persistenceState.statusText}
            >
              {persistenceState.status === "saving" && (
                <>
                  <Loader2 className="size-3 animate-spin text-blue-600" />
                  <span className="hidden sm:inline">Saving...</span>
                </>
              )}
              {persistenceState.status === "saved" && (
                <>
                  <CheckCircle2 className="size-3 text-emerald-600" />
                  <span className="text-emerald-700 hidden sm:inline">
                    {activeProject ? "Saved" : persistenceState.statusText}
                  </span>
                </>
              )}
              {persistenceState.status === "offline" && (
                <>
                  <span className="size-1.5 rounded-full bg-slate-400" />
                  <span className="text-slate-600 hidden sm:inline">Working offline</span>
                </>
              )}
              {persistenceState.status === "pending" && (
                <>
                  <span className="size-1.5 rounded-full bg-amber-500" />
                  <span className="text-amber-700 hidden sm:inline">Changes pending</span>
                </>
              )}
              {persistenceState.status === "retrying" && (
                <>
                  <Loader2 className="size-3 animate-spin text-amber-600" />
                  <span className="text-amber-700 hidden sm:inline">Couldn't save changes. Retrying...</span>
                </>
              )}
              {persistenceState.status === "error" && (
                <>
                  <AlertCircle className="size-3 text-red-600" />
                  <span className="text-red-600 hidden sm:inline">Save failed</span>
                </>
              )}
            </div>
            {/* Compact Professional Persona Selector */}
            <div className="relative">
              <button
                onClick={() => setPersonaOpen(!personaOpen)}
                className="flex items-center gap-1.5 rounded border border-slate-200 bg-slate-50/80 px-2.5 h-7 text-xs font-medium text-slate-700 hover:bg-slate-100 hover:text-slate-900 transition-colors"
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
                    <div className="px-2 py-1.5 text-[11px] font-medium text-slate-400 border-b border-slate-100">
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
                  setAuthTab("login");
                  setAuthOpen(true);
                }}
                className="flex items-center gap-1.5 rounded border border-slate-200 px-2 h-7 text-xs text-slate-700 hover:bg-slate-50"
              >
                <div className="flex size-4 items-center justify-center rounded-full bg-blue-600 text-[10px] font-bold text-white">
                  {user.name.charAt(0).toUpperCase()}
                </div>
                <span className="hidden sm:inline max-w-[120px] truncate">{user.name}</span>
              </button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs border-slate-200 text-slate-700 hover:bg-slate-50 px-2.5"
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
        <main className="min-w-0 flex-1 px-4 py-5 md:px-6 md:py-6">
          <div className="mx-auto max-w-5xl">{children}</div>
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
    <header className="mb-5 flex flex-col gap-2.5 border-b border-slate-200 pb-3 sm:flex-row sm:items-baseline sm:justify-between">
      <div className="flex flex-wrap items-baseline gap-2.5">
        <h1 className="text-lg font-semibold tracking-tight text-slate-900">{title}</h1>
        {description && (
          <>
            <span className="hidden text-slate-300 sm:inline">•</span>
            <p className="text-xs text-slate-500 max-w-xl">{description}</p>
          </>
        )}
      </div>
      {actions && (
        <div className="no-print flex flex-wrap items-center gap-2 shrink-0">{actions}</div>
      )}
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
    <div className="rounded border border-slate-200 bg-white p-5 shadow-2xs">
      <div className="text-sm font-semibold text-slate-900">{title}</div>
      {children && (
        <div className="mt-1 max-w-xl text-xs text-slate-600 leading-relaxed">{children}</div>
      )}
      {action && <div className="mt-3.5 flex flex-wrap gap-2">{action}</div>}
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
      className={`rounded border px-3 py-2 text-xs ${cls}`}
    >
      {children}
    </div>
  );
}

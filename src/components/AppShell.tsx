import { Link, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useStore } from "@/lib/store";

const NAV = [
  { to: "/", label: "Overview" },
  { to: "/projects", label: "My Projects" },
  { to: "/workspace", label: "Data Workspace" },
  { to: "/analyses", label: "Analyses" },
  { to: "/ask", label: "Ask" },
  { to: "/reports", label: "Reports" },
  { to: "/learn", label: "Learn" },
] as const;

function Mark() {
  return (
    <svg viewBox="0 0 24 24" className="size-5 text-primary" aria-hidden="true">
      <rect x="3" y="13" width="3.5" height="8" fill="currentColor" />
      <rect x="10.25" y="8" width="3.5" height="13" fill="currentColor" opacity=".75" />
      <rect x="17.5" y="3" width="3.5" height="18" fill="currentColor" opacity=".5" />
    </svg>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { active, activeProject } = useStore();
  const isActive = (to: string) => (to === "/" ? path === "/" : path.startsWith(to));

  return (
    <div className="min-h-screen md:grid md:grid-cols-[220px_1fr]">
      <aside className="no-print border-b bg-sidebar md:sticky md:top-0 md:h-screen md:border-b-0 md:border-r">
        <div className="flex items-center gap-2 px-4 py-3 md:py-5">
          <Mark />
          <span className="text-[15px] font-semibold tracking-tight">Lumetra</span>
          <span className="eyebrow ml-auto md:ml-1">v0.1</span>
        </div>
        <nav aria-label="Main" className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:overflow-visible md:pb-0">
          {NAV.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              className={`whitespace-nowrap rounded-md px-3 py-1.5 text-[13px] transition-colors ${
                isActive(n.to)
                  ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                  : "text-sidebar-foreground hover:bg-sidebar-accent/60"
              }`}
            >
              {n.label}
            </Link>
          ))}
          <Link
            to="/settings"
            className={`whitespace-nowrap rounded-md px-3 py-1.5 text-[13px] md:mt-4 ${
              isActive("/settings") ? "bg-sidebar-accent font-medium" : "text-muted-foreground hover:bg-sidebar-accent/60"
            }`}
          >
            Settings
          </Link>
        </nav>
        <div className="hidden px-4 pt-6 md:block">
          <div className="eyebrow mb-1.5">Active dataset</div>
          {active ? (
            <div className="text-[12px] leading-snug">
              <div className="truncate font-medium" title={active.dataset.name}>{active.dataset.name}</div>
              <div className="num text-muted-foreground">
                {active.dataset.rows.length.toLocaleString()} × {active.dataset.columns.length}
              </div>
              <div className={activeProject ? "text-primary" : "text-warning-foreground"}>
                {activeProject ? `Saved · ${activeProject.name}` : "Unsaved session"}
              </div>
            </div>
          ) : (
            <div className="text-[12px] text-muted-foreground">None loaded</div>
          )}
        </div>
      </aside>
      <main className="min-w-0 px-4 py-6 md:px-10 md:py-8">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-col gap-3 border-b pb-5 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-[13px] text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="no-print flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="panel flex flex-col items-start gap-2 border-dashed p-6">
      <div className="font-medium">{title}</div>
      {children && <div className="max-w-xl text-[13px] text-muted-foreground">{children}</div>}
      {action && <div className="mt-2 flex flex-wrap gap-2">{action}</div>}
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warning" | "error"; children: ReactNode }) {
  const cls =
    tone === "error"
      ? "border-destructive/40 bg-destructive/5 text-destructive"
      : tone === "warning"
        ? "border-warning-foreground/30 bg-warning text-warning-foreground"
        : "border-primary/30 bg-accent text-accent-foreground";
  return <div role={tone === "error" ? "alert" : "status"} className={`rounded-md border px-3 py-2 text-[13px] ${cls}`}>{children}</div>;
}

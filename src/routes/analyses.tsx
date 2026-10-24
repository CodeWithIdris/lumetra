import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState, Notice, PageHeader } from "@/components/AppShell";
import { MethodNote, ResultsView } from "@/components/ResultsView";
import { useStore } from "@/lib/store";
import { profileDataset } from "@/lib/data/infer";
import { runDescriptive, type DescriptiveReport } from "@/lib/stats/analysis";
import { descriptiveToCsv, downloadText } from "@/lib/data/export";
import { pageMeta } from "@/lib/meta";
import { PersonaAnalysisView } from "@/components/PersonaAnalysisView";
import { PERSONAS, type PersonaId } from "@/lib/stats/personas";
import {
  Sparkles,
  BarChart3,
  Sliders,
  Table2,
  FileText,
  Info,
  Check,
  ChevronDown,
  Cpu,
  TrendingUp,
  Boxes,
  Target,
  HeartPulse,
  Download,
} from "lucide-react";

export const Route = createFileRoute("/analyses")({
  head: () =>
    pageMeta(
      "Analyses",
      "Production-grade split-panel statistical workspace with tailored engines and descriptive reports.",
    ),
  component: Analyses,
});

const ROLE_ICONS: Record<PersonaId, typeof Cpu> = {
  engineer: Cpu,
  economist: TrendingUp,
  scientist: Boxes,
  product: Target,
  clinical: HeartPulse,
};

const CATALOGUE = [
  {
    id: "personalized",
    name: "Persona-Tailored Engine",
    desc: "Domain-specific computations for active context.",
    ready: true,
  },
  {
    id: "descriptive",
    name: "Descriptive Statistics",
    desc: "Moments, medians, IQR, standard deviations and histograms.",
    ready: true,
  },
  {
    id: "crosstab",
    name: "Cross-Tabulation",
    desc: "Contingency tables across two categorical dimensions.",
    ready: false,
  },
  {
    id: "correlation",
    name: "Correlation Matrix",
    desc: "Full dataset Pearson and Spearman matrices.",
    ready: false,
  },
  {
    id: "ttest",
    name: "Two-Sample Comparison",
    desc: "Hypothesis testing and group mean variance.",
    ready: false,
  },
] as const;

function Analyses() {
  const { active, setStatus, persona, setPersona } = useStore();
  const navigate = useNavigate();
  const ds = active?.dataset;
  const profiles = useMemo(() => (ds ? profileDataset(ds) : []), [ds]);
  const eligible = profiles.filter((p) => p.type === "numeric" || p.type === "categorical");

  const [selected, setSelected] = useState<string[] | null>(null);
  const [report, setReport] = useState<DescriptiveReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reportFor, setReportFor] = useState<string | null>(null);
  const [activeEngine, setActiveEngine] = useState<"personalized" | "descriptive">("personalized");
  const [personaOpen, setPersonaOpen] = useState(false);

  useEffect(() => setSelected(null), [ds?.id]);

  const sel = (selected ?? eligible.map((p) => p.name)).filter((n) =>
    eligible.some((p) => p.name === n),
  );
  const stale = report && reportFor !== ds?.id;

  function run() {
    if (!ds) return;
    setError(null);
    if (sel.length === 0) return setError("Select at least one column for analysis.");
    try {
      setReport(runDescriptive(ds, sel));
      setReportFor(ds.id);
      setStatus("analysed");
    } catch (e) {
      setError(e instanceof Error ? e.message : "The analysis failed.");
    }
  }

  if (!ds) {
    return (
      <>
        <PageHeader title="Analyses" />
        <EmptyState
          title="No dataset loaded"
          action={
            <Button
              className="bg-blue-600 text-xs text-white hover:bg-blue-700"
              onClick={() => navigate({ to: "/workspace" })}
            >
              Go to Data Workspace
            </Button>
          }
        >
          Import a CSV file or load a role-tailored benchmark dataset first to run statistical
          routines.
        </EmptyState>
      </>
    );
  }

  const personaMeta = PERSONAS[persona];
  const PersonaIcon = ROLE_ICONS[persona] || Cpu;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Analysis Workspace"
        description={`Dataset: ${ds.name} (${ds.rows.length.toLocaleString()} observations) • Active engine: ${
          activeEngine === "personalized" ? `${personaMeta.shortRole} Toolkit` : "Descriptive Statistics"
        }`}
        actions={
          report && !stale ? (
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs border-slate-300 text-slate-700 hover:bg-slate-50"
              onClick={() =>
                downloadText(
                  `${ds.name.replace(/\.[^.]+$/, "")}-descriptives.csv`,
                  descriptiveToCsv(report),
                )
              }
            >
              <Download className="size-3.5 mr-1.5" />
              Export CSV
            </Button>
          ) : undefined
        }
      />

      {/* Split-Panel Analytical Layout */}
      <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
        {/* SECONDARY PANEL: Context, Variables, Controls (Single Cohesive Panel) */}
        <aside className="rounded border border-slate-200 bg-white p-3.5 shadow-2xs space-y-3.5 divide-y divide-slate-100">
          {/* Active Context Section */}
          <div className="space-y-2">
            <div className="text-[11px] font-medium text-slate-500">
              Professional Context
            </div>
            <div className="relative">
              <button
                onClick={() => setPersonaOpen(!personaOpen)}
                className="flex w-full items-center justify-between gap-2 rounded border border-slate-300 bg-slate-50 px-2.5 py-1.5 text-left text-xs font-medium text-slate-800 hover:bg-slate-100 transition-colors"
              >
                <div className="flex items-center gap-2 truncate">
                  <PersonaIcon className="size-3.5 text-blue-600 shrink-0" />
                  <span className="truncate">{personaMeta.title}</span>
                </div>
                <ChevronDown className="size-3 text-slate-400 shrink-0" />
              </button>

              {personaOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setPersonaOpen(false)} />
                  <div className="absolute left-0 top-full z-50 mt-1 w-full rounded-md border border-slate-200 bg-white p-1 shadow-lg">
                    {(Object.keys(PERSONAS) as PersonaId[]).map((pId) => {
                      const p = PERSONAS[pId];
                      const Icon = ROLE_ICONS[pId];
                      const isCurrent = pId === persona;
                      return (
                        <button
                          key={pId}
                          onClick={() => {
                            setPersona(pId);
                            setPersonaOpen(false);
                          }}
                          className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs ${
                            isCurrent
                              ? "bg-blue-50 text-blue-900 font-semibold"
                              : "text-slate-700 hover:bg-slate-50"
                          }`}
                        >
                          <div className="flex items-center gap-1.5 truncate">
                            <Icon className="size-3.5 shrink-0 text-slate-500" />
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
          </div>

          {/* Analysis Engine Mode Selector */}
          <div className="pt-3 space-y-2">
            <div className="text-[11px] font-medium text-slate-500">
              Analysis Engines
            </div>
            <div className="space-y-1">
              {CATALOGUE.map((item) => {
                const isSelected = activeEngine === item.id;
                return (
                  <button
                    key={item.id}
                    disabled={!item.ready}
                    onClick={() => {
                      if (item.id === "personalized" || item.id === "descriptive") {
                        setActiveEngine(item.id);
                      }
                    }}
                    className={`w-full rounded px-2.5 py-1.5 text-left text-xs transition-colors border ${
                      isSelected
                        ? "bg-blue-50 text-blue-900 font-semibold border-blue-200"
                        : item.ready
                          ? "bg-white text-slate-700 hover:bg-slate-50 border-slate-200"
                          : "bg-slate-50 text-slate-400 border-slate-100 cursor-not-allowed opacity-60"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="truncate">{item.name}</span>
                      {!item.ready && (
                        <span className="text-[9px] font-mono text-slate-400">Planned</span>
                      )}
                    </div>
                    <p className="text-[11px] font-normal text-slate-500 mt-0.5 line-clamp-1">
                      {item.desc}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Variable Selection (When in Descriptive Mode) */}
          {activeEngine === "descriptive" && (
            <div className="pt-3 space-y-2.5">
              <div className="flex items-center justify-between border-b border-slate-100 pb-1.5">
                <span className="text-[11px] font-medium text-slate-500">
                  Variables ({sel.length}/{eligible.length})
                </span>
                <div className="flex gap-2 text-[11px]">
                  <button
                    onClick={() => setSelected(eligible.map((p) => p.name))}
                    className="text-blue-600 hover:underline"
                  >
                    All
                  </button>
                  <button onClick={() => setSelected([])} className="text-slate-500 hover:underline">
                    Clear
                  </button>
                </div>
              </div>

              <div className="max-h-52 overflow-y-auto space-y-1 pr-1">
                {eligible.map((p) => (
                  <label
                    key={p.name}
                    className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs text-slate-700 hover:bg-slate-50"
                  >
                    <Checkbox
                      checked={sel.includes(p.name)}
                      onCheckedChange={(c) =>
                        setSelected(c ? [...sel, p.name] : sel.filter((x) => x !== p.name))
                      }
                    />
                    <span className="truncate font-mono">{p.name}</span>
                    <span className="ml-auto text-[10px] font-mono text-slate-400">{p.type}</span>
                  </label>
                ))}
              </div>

              <Button
                className="w-full bg-blue-600 text-xs text-white hover:bg-blue-700 font-medium h-7.5"
                onClick={run}
                disabled={sel.length === 0}
              >
                Execute Descriptive Analysis
              </Button>
            </div>
          )}

          {/* Methodology & Assumptions */}
          <div className="pt-3 space-y-1.5">
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
              <Info className="size-3 text-slate-400" />
              <span>Statistical Methodology</span>
            </div>
            <div className="text-[11px] text-slate-500 leading-relaxed space-y-1">
              <p>• Sample standard deviations employ Bessel's correction (n − 1).</p>
              <p>• Missing values are treated as null and excluded from denominators.</p>
              <p>• All calculations execute client-side; deterministic results guaranteed.</p>
            </div>
          </div>
        </aside>

        {/* MAIN RESULTS AREA (Visual Priority) */}
        <main className="min-w-0 space-y-4">
          {error && <Notice tone="error">{error}</Notice>}
          {stale && (
            <Notice tone="warning">
              The dataset changed. Re-run analysis to synchronize computed metrics.
            </Notice>
          )}

          {activeEngine === "personalized" ? (
            <PersonaAnalysisView persona={persona} dataset={ds} profiles={profiles} />
          ) : report && !stale ? (
            <div className="rounded-md border border-slate-200 bg-white p-5 shadow-2xs space-y-6">
              <ResultsView report={report} />
            </div>
          ) : (
            <EmptyState title="Descriptive statistics ready to run">
              Select desired numeric and categorical variables in the left panel and click “Execute
              Descriptive Analysis”. Results are computed instantly in your browser.
            </EmptyState>
          )}
        </main>
      </div>
    </div>
  );
}

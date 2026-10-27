import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState, Notice, PageHeader } from "@/components/AppShell";
import { MethodNote, ResultsView } from "@/components/ResultsView";
import { useStore } from "@/lib/store";
import { profileDataset } from "@/lib/data/infer";
import {
  runDescriptive,
  createDescriptiveSavedAnalysis,
  createCorrelationSavedAnalysis,
  createTTestSavedAnalysis,
  createCrosstabSavedAnalysis,
  isAnalysisStale,
  type DescriptiveReport,
  type SavedAnalysis,
} from "@/lib/stats/analysis";
import { descriptiveToCsv, downloadText } from "@/lib/data/export";
import { fmt } from "@/lib/stats/descriptive";
import { pageMeta } from "@/lib/meta";
import { PersonaAnalysisView } from "@/components/PersonaAnalysisView";
import { PERSONAS, type PersonaId } from "@/lib/stats/personas";
import { toast } from "sonner";
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
  History,
  RotateCcw,
  Trash2,
  AlertTriangle,
  BookmarkCheck,
  Split,
  GitCompare,
} from "lucide-react";

export const Route = createFileRoute("/analyses")({
  head: () =>
    pageMeta(
      "Analyses",
      "Production-grade statistical workspace with tailored engines, parametric comparisons, and reproducible results history.",
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

type EngineId = "personalized" | "descriptive" | "correlation" | "ttest" | "crosstab" | "history";

const CATALOGUE = [
  {
    id: "personalized" as const,
    name: "Persona-Tailored Engine",
    desc: "Domain-specific computations for active context.",
    ready: true,
  },
  {
    id: "descriptive" as const,
    name: "Descriptive Statistics",
    desc: "Moments, medians, IQR, standard deviations and histograms.",
    ready: true,
  },
  {
    id: "correlation" as const,
    name: "Correlation Analysis",
    desc: "Bivariate Pearson or Spearman correlation with significance tests.",
    ready: true,
  },
  {
    id: "ttest" as const,
    name: "Two-Sample Comparison",
    desc: "Welch's t-test comparing group means with unequal variances.",
    ready: true,
  },
  {
    id: "crosstab" as const,
    name: "Cross-Tabulation & Chi-Square",
    desc: "Two-way contingency tables with Pearson chi-square independence test.",
    ready: true,
  },
  {
    id: "history" as const,
    name: "Analysis History",
    desc: "Inspect, re-run, or export previously saved analytical findings.",
    ready: true,
  },
];

function Analyses() {
  const { active, setStatus, persona, setPersona, savedAnalyses, saveAnalysis, removeAnalysis } =
    useStore();
  const navigate = useNavigate();
  const ds = active?.dataset;
  const profiles = useMemo(() => (ds ? profileDataset(ds) : []), [ds]);
  const eligible = profiles.filter((p) => p.type === "numeric" || p.type === "categorical");
  const numericProfiles = profiles.filter((p) => p.type === "numeric");
  const categoricalProfiles = profiles.filter((p) => p.type === "categorical");

  const [activeEngine, setActiveEngine] = useState<EngineId>("personalized");
  const [personaOpen, setPersonaOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Descriptive state
  const [selectedCols, setSelectedCols] = useState<string[] | null>(null);

  // Correlation state
  const [corrColX, setCorrColX] = useState<string>("");
  const [corrColY, setCorrColY] = useState<string>("");
  const [corrMethod, setCorrMethod] = useState<"pearson" | "spearman">("pearson");

  // t-test state
  const [tTestNumCol, setTTestNumCol] = useState<string>("");
  const [tTestGrpCol, setTTestGrpCol] = useState<string>("");

  // Crosstab state
  const [crossRowCol, setCrossRowCol] = useState<string>("");
  const [crossColCol, setCrossColCol] = useState<string>("");

  // Currently viewed analysis
  const [viewedAnalysis, setViewedAnalysis] = useState<SavedAnalysis | null>(null);

  useEffect(() => {
    setSelectedCols(null);
    if (numericProfiles.length >= 2) {
      setCorrColX(numericProfiles[0]!.name);
      setCorrColY(numericProfiles[1]!.name);
    }
    if (numericProfiles.length >= 1 && categoricalProfiles.length >= 1) {
      setTTestNumCol(numericProfiles[0]!.name);
      setTTestGrpCol(categoricalProfiles[0]!.name);
    }
    if (categoricalProfiles.length >= 2) {
      setCrossRowCol(categoricalProfiles[0]!.name);
      setCrossColCol(categoricalProfiles[1]!.name);
    }
  }, [ds?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const sel = (selectedCols ?? eligible.map((p) => p.name)).filter((n) =>
    eligible.some((p) => p.name === n),
  );

  // Run handlers
  function runDescriptiveCalc() {
    if (!ds) return;
    setError(null);
    if (sel.length === 0) return setError("Select at least one column for analysis.");
    try {
      const saved = createDescriptiveSavedAnalysis(ds, sel);
      saveAnalysis(saved);
      setViewedAnalysis(saved);
      setStatus("analysed");
      toast.success("Descriptive analysis calculated and saved to history.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "The analysis failed.");
    }
  }

  function runCorrelationCalc() {
    if (!ds) return;
    setError(null);
    if (!corrColX || !corrColY) {
      return setError("Please select both variable X and variable Y.");
    }
    if (corrColX === corrColY) {
      return setError("Variable X and Variable Y must be distinct columns.");
    }
    try {
      const saved = createCorrelationSavedAnalysis(ds, corrColX, corrColY, corrMethod);
      saveAnalysis(saved);
      setViewedAnalysis(saved);
      setStatus("analysed");
      toast.success("Correlation analysis calculated and saved to history.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Correlation calculation failed.");
    }
  }

  function runTTestCalc() {
    if (!ds) return;
    setError(null);
    if (!tTestNumCol || !tTestGrpCol) {
      return setError("Please select a numeric outcome variable and a grouping variable.");
    }
    try {
      const saved = createTTestSavedAnalysis(ds, tTestNumCol, tTestGrpCol);
      saveAnalysis(saved);
      setViewedAnalysis(saved);
      setStatus("analysed");
      toast.success("Two-sample comparison calculated and saved to history.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Two-sample t-test calculation failed.");
    }
  }

  function runCrosstabCalc() {
    if (!ds) return;
    setError(null);
    if (!crossRowCol || !crossColCol) {
      return setError("Please select both row and column categorical variables.");
    }
    if (crossRowCol === crossColCol) {
      return setError("Row and column variables must be different.");
    }
    try {
      const saved = createCrosstabSavedAnalysis(ds, crossRowCol, crossColCol);
      saveAnalysis(saved);
      setViewedAnalysis(saved);
      setStatus("analysed");
      toast.success("Cross-tabulation calculated and saved to history.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cross-tabulation calculation failed.");
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
  const isStale = viewedAnalysis ? isAnalysisStale(viewedAnalysis, ds) : false;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Analysis Workspace"
        description={`Dataset: ${ds.name} (${ds.rows.length.toLocaleString()} observations) • Active engine: ${
          activeEngine === "personalized"
            ? `${personaMeta.shortRole} Toolkit`
            : activeEngine === "history"
              ? "Saved Analyses History"
              : CATALOGUE.find((c) => c.id === activeEngine)?.name ?? "Statistical Engine"
        }`}
        actions={
          viewedAnalysis && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs border-slate-300 text-slate-700 hover:bg-slate-50"
                onClick={() => {
                  const blobText = JSON.stringify(viewedAnalysis, null, 2);
                  downloadText(`${viewedAnalysis.name.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`, blobText);
                }}
              >
                <Download className="size-3.5 mr-1.5" />
                Export JSON
              </Button>
            </div>
          )
        }
      />

      {/* Split-Panel Analytical Layout */}
      <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
        {/* SECONDARY PANEL: Context, Variables, Controls */}
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
                    onClick={() => {
                      setActiveEngine(item.id);
                      setError(null);
                    }}
                    className={`w-full rounded px-2.5 py-1.5 text-left text-xs transition-colors border ${
                      isSelected
                        ? "bg-blue-50 text-blue-900 font-semibold border-blue-200"
                        : "bg-white text-slate-700 hover:bg-slate-50 border-slate-200"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="truncate">{item.name}</span>
                      {item.id === "history" && savedAnalyses.length > 0 && (
                        <span className="rounded-full bg-blue-100 text-blue-800 text-[10px] px-1.5 py-0.2 font-mono">
                          {savedAnalyses.length}
                        </span>
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

          {/* ENGINE 2: DESCRIPTIVE VARIABLES */}
          {activeEngine === "descriptive" && (
            <div className="pt-3 space-y-2.5">
              <div className="flex items-center justify-between border-b border-slate-100 pb-1.5">
                <span className="text-[11px] font-medium text-slate-500">
                  Variables ({sel.length}/{eligible.length})
                </span>
                <div className="flex gap-2 text-[11px]">
                  <button
                    onClick={() => setSelectedCols(eligible.map((p) => p.name))}
                    className="text-blue-600 hover:underline"
                  >
                    All
                  </button>
                  <button onClick={() => setSelectedCols([])} className="text-slate-500 hover:underline">
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
                        setSelectedCols(c ? [...sel, p.name] : sel.filter((x) => x !== p.name))
                      }
                    />
                    <span className="truncate font-mono">{p.name}</span>
                    <span className="ml-auto text-[10px] font-mono text-slate-400">{p.type}</span>
                  </label>
                ))}
              </div>

              <Button
                className="w-full bg-blue-600 text-xs text-white hover:bg-blue-700 font-medium h-7.5"
                onClick={runDescriptiveCalc}
                disabled={sel.length === 0}
              >
                Execute Descriptive Analysis
              </Button>
            </div>
          )}

          {/* ENGINE 3: CORRELATION CONFIGURATION */}
          {activeEngine === "correlation" && (
            <div className="pt-3 space-y-3">
              <div className="space-y-1.5">
                <label className="text-[11px] font-medium text-slate-600">Variable X (Numeric):</label>
                <select
                  value={corrColX}
                  onChange={(e) => setCorrColX(e.target.value)}
                  className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900"
                >
                  <option value="">Select column...</option>
                  {numericProfiles.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-medium text-slate-600">Variable Y (Numeric):</label>
                <select
                  value={corrColY}
                  onChange={(e) => setCorrColY(e.target.value)}
                  className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900"
                >
                  <option value="">Select column...</option>
                  {numericProfiles.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-medium text-slate-600">Method:</label>
                <select
                  value={corrMethod}
                  onChange={(e) => setCorrMethod(e.target.value as "pearson" | "spearman")}
                  className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900"
                >
                  <option value="pearson">Pearson (Linear association)</option>
                  <option value="spearman">Spearman (Rank monotonic)</option>
                </select>
              </div>

              <Button
                className="w-full bg-blue-600 text-xs text-white hover:bg-blue-700 font-medium h-7.5"
                onClick={runCorrelationCalc}
                disabled={!corrColX || !corrColY || corrColX === corrColY}
              >
                Compute Correlation
              </Button>
            </div>
          )}

          {/* ENGINE 4: TWO-SAMPLE COMPARISON CONFIGURATION */}
          {activeEngine === "ttest" && (
            <div className="pt-3 space-y-3">
              <div className="space-y-1.5">
                <label className="text-[11px] font-medium text-slate-600">Continuous Variable (Outcome):</label>
                <select
                  value={tTestNumCol}
                  onChange={(e) => setTTestNumCol(e.target.value)}
                  className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900"
                >
                  <option value="">Select numeric variable...</option>
                  {numericProfiles.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-medium text-slate-600">Grouping Column (≥2 Levels):</label>
                <select
                  value={tTestGrpCol}
                  onChange={(e) => setTTestGrpCol(e.target.value)}
                  className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900"
                >
                  <option value="">Select grouping column...</option>
                  {categoricalProfiles.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name} ({c.distinct} levels)
                    </option>
                  ))}
                </select>
              </div>

              <Button
                className="w-full bg-blue-600 text-xs text-white hover:bg-blue-700 font-medium h-7.5"
                onClick={runTTestCalc}
                disabled={!tTestNumCol || !tTestGrpCol}
              >
                Run Welch's t-Test
              </Button>
            </div>
          )}

          {/* ENGINE 5: CROSSTAB CONFIGURATION */}
          {activeEngine === "crosstab" && (
            <div className="pt-3 space-y-3">
              <div className="space-y-1.5">
                <label className="text-[11px] font-medium text-slate-600">Row Variable (Categorical):</label>
                <select
                  value={crossRowCol}
                  onChange={(e) => setCrossRowCol(e.target.value)}
                  className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900"
                >
                  <option value="">Select row variable...</option>
                  {categoricalProfiles.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name} ({c.distinct} levels)
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-medium text-slate-600">Column Variable (Categorical):</label>
                <select
                  value={crossColCol}
                  onChange={(e) => setCrossColCol(e.target.value)}
                  className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900"
                >
                  <option value="">Select column variable...</option>
                  {categoricalProfiles.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name} ({c.distinct} levels)
                    </option>
                  ))}
                </select>
              </div>

              <Button
                className="w-full bg-blue-600 text-xs text-white hover:bg-blue-700 font-medium h-7.5"
                onClick={runCrosstabCalc}
                disabled={!crossRowCol || !crossColCol || crossRowCol === crossColCol}
              >
                Generate Contingency Table
              </Button>
            </div>
          )}

          {/* ENGINE 6: SAVED ANALYSES LIST */}
          {activeEngine === "history" && (
            <div className="pt-3 space-y-2">
              <div className="text-[11px] font-medium text-slate-500">
                Saved Runs ({savedAnalyses.length})
              </div>
              {savedAnalyses.length === 0 ? (
                <div className="text-[11px] text-slate-400 py-4 text-center">
                  No saved analyses yet.
                </div>
              ) : (
                <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
                  {savedAnalyses.map((a) => {
                    const stale = isAnalysisStale(a, ds);
                    const isSelected = viewedAnalysis?.id === a.id;
                    return (
                      <div
                        key={a.id}
                        onClick={() => setViewedAnalysis(a)}
                        className={`rounded p-2 text-xs cursor-pointer border transition-colors ${
                          isSelected
                            ? "bg-blue-50 border-blue-300 text-blue-950 font-medium"
                            : "bg-white border-slate-200 hover:bg-slate-50 text-slate-800"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-semibold truncate text-[11px]">{a.name}</span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              removeAnalysis(a.id);
                              if (viewedAnalysis?.id === a.id) setViewedAnalysis(null);
                            }}
                            className="text-slate-400 hover:text-red-600 p-0.5"
                          >
                            <Trash2 className="size-3" />
                          </button>
                        </div>
                        <div className="flex items-center gap-1.5 mt-1 text-[10px] text-slate-500 font-mono">
                          <span>{new Date(a.timestamp).toLocaleTimeString()}</span>
                          {stale && (
                            <span className="rounded bg-amber-100 text-amber-800 px-1 font-bold">
                              Stale
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Methodology & Assumptions Footer */}
          <div className="pt-3 space-y-1.5">
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
              <Info className="size-3 text-slate-400" />
              <span>Statistical Methodology</span>
            </div>
            <div className="text-[11px] text-slate-500 leading-relaxed space-y-1">
              <p>• Missing values are excluded pairwise; never coerced to zero.</p>
              <p>• Parametric tests do not claim causality without randomization.</p>
              <p>• Deterministic client-side computation.</p>
            </div>
          </div>
        </aside>

        {/* MAIN RESULTS AREA */}
        <main className="min-w-0 space-y-4">
          {error && <Notice tone="error">{error}</Notice>}

          {/* Stale Warning Banner if underlying dataset changed */}
          {isStale && viewedAnalysis && (
            <Notice tone="warning">
              <div className="flex items-center justify-between">
                <span>
                  The underlying dataset has changed since this analysis was generated. Results
                  reflect an earlier dataset version.
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    if (viewedAnalysis.type === "descriptive") runDescriptiveCalc();
                    else if (viewedAnalysis.type === "correlation") runCorrelationCalc();
                    else if (viewedAnalysis.type === "ttest") runTTestCalc();
                    else if (viewedAnalysis.type === "crosstab") runCrosstabCalc();
                  }}
                  className="h-6 text-[10px] border-amber-300 text-amber-900 bg-white ml-2 shrink-0"
                >
                  <RotateCcw className="size-3 mr-1" />
                  Rerun with Current Data
                </Button>
              </div>
            </Notice>
          )}

          {activeEngine === "personalized" ? (
            <PersonaAnalysisView persona={persona} dataset={ds} profiles={profiles} />
          ) : viewedAnalysis ? (
            /* Render Structured Analysis Result Card */
            <div className="rounded-md border border-slate-200 bg-white p-5 shadow-2xs space-y-6">
              {/* Header */}
              <div className="border-b border-slate-100 pb-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-blue-50 text-blue-800 border border-blue-200">
                      {viewedAnalysis.type.toUpperCase()}
                    </span>
                    <span className="text-xs text-slate-400 font-mono">
                      Run at {new Date(viewedAnalysis.timestamp).toLocaleString()}
                    </span>
                  </div>
                  <h3 className="text-base font-bold text-slate-900 mt-1">{viewedAnalysis.name}</h3>
                </div>

                <div className="text-right text-xs font-mono text-slate-500">
                  <div>Effective n: <strong className="text-slate-900">{viewedAnalysis.sampleSize.toLocaleString()}</strong></div>
                  <div className="text-[10px] text-slate-400">{viewedAnalysis.missingHandling}</div>
                </div>
              </div>

              {/* Numerical outputs specific to analysis type */}
              {viewedAnalysis.type === "descriptive" && Boolean(viewedAnalysis.results["report"]) ? (
                <ResultsView report={viewedAnalysis.results["report"] as DescriptiveReport} />
              ) : null}

              {viewedAnalysis.type === "correlation" ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="rounded border border-slate-200 bg-slate-50 p-3">
                    <div className="text-[11px] font-medium text-slate-500">Correlation (r)</div>
                    <div className="num mt-1 text-2xl font-bold font-mono text-slate-900">
                      {typeof viewedAnalysis.results["r"] === "number"
                        ? (viewedAnalysis.results["r"] as number).toFixed(3)
                        : "—"}
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5 font-mono">
                      Method: {String(viewedAnalysis.results["method"])}
                    </div>
                  </div>
                  <div className="rounded border border-slate-200 bg-slate-50 p-3">
                    <div className="text-[11px] font-medium text-slate-500">p-Value (Two-Sided)</div>
                    <div className="num mt-1 text-2xl font-bold font-mono text-slate-900">
                      {typeof viewedAnalysis.results["pValue"] === "number"
                        ? (viewedAnalysis.results["pValue"] as number) < 0.001
                          ? "< 0.001"
                          : (viewedAnalysis.results["pValue"] as number).toFixed(4)
                        : "—"}
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5 font-mono">
                      {typeof viewedAnalysis.results["pValue"] === "number" &&
                      (viewedAnalysis.results["pValue"] as number) < 0.05
                        ? "Statistically significant"
                        : "Inconclusive"}
                    </div>
                  </div>
                  <div className="rounded border border-slate-200 bg-slate-50 p-3">
                    <div className="text-[11px] font-medium text-slate-500">Paired Sample Size</div>
                    <div className="num mt-1 text-2xl font-bold font-mono text-slate-900">
                      {Number(viewedAnalysis.results["n"]).toLocaleString()}
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5 font-mono">Complete pairs</div>
                  </div>
                  <div className="rounded border border-slate-200 bg-slate-50 p-3">
                    <div className="text-[11px] font-medium text-slate-500">Variables</div>
                    <div className="font-mono text-xs font-semibold text-slate-800 mt-1 truncate">
                      {viewedAnalysis.variables.join(" × ")}
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5">Bivariate association</div>
                  </div>
                </div>
              ) : null}

              {viewedAnalysis.type === "ttest" && Boolean(viewedAnalysis.results["groups"]) ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <div className="rounded border border-slate-200 bg-slate-50 p-3">
                      <div className="text-[11px] font-medium text-slate-500">Mean Difference</div>
                      <div className="num mt-1 text-xl font-bold font-mono text-slate-900">
                        {fmt(viewedAnalysis.results["difference"] as number | null)}
                      </div>
                    </div>
                    <div className="rounded border border-slate-200 bg-slate-50 p-3">
                      <div className="text-[11px] font-medium text-slate-500">Welch's t-Stat</div>
                      <div className="num mt-1 text-xl font-bold font-mono text-slate-900">
                        {typeof viewedAnalysis.results["t"] === "number"
                          ? (viewedAnalysis.results["t"] as number).toFixed(3)
                          : "—"}
                      </div>
                      <div className="text-[10px] text-slate-500 mt-0.5 font-mono">
                        df = {typeof viewedAnalysis.results["df"] === "number" ? (viewedAnalysis.results["df"] as number).toFixed(1) : "—"}
                      </div>
                    </div>
                    <div className="rounded border border-slate-200 bg-slate-50 p-3">
                      <div className="text-[11px] font-medium text-slate-500">p-Value</div>
                      <div className="num mt-1 text-xl font-bold font-mono text-slate-900">
                        {typeof viewedAnalysis.results["pValue"] === "number"
                          ? (viewedAnalysis.results["pValue"] as number) < 0.001
                            ? "< 0.001"
                            : (viewedAnalysis.results["pValue"] as number).toFixed(4)
                          : "—"}
                      </div>
                    </div>
                    <div className="rounded border border-slate-200 bg-slate-50 p-3">
                      <div className="text-[11px] font-medium text-slate-500">Unequal Variances</div>
                      <div className="text-xs font-semibold text-emerald-700 mt-1">
                        Satterthwaite df
                      </div>
                    </div>
                  </div>

                  {/* Groups Table */}
                  <div className="border border-slate-200 rounded overflow-hidden">
                    <table className="w-full text-xs text-left">
                      <thead className="bg-slate-50 text-slate-600 font-medium border-b border-slate-200">
                        <tr>
                          <th className="px-3 py-2">Group Level</th>
                          <th className="px-3 py-2 text-right">Sample (n)</th>
                          <th className="px-3 py-2 text-right">Mean</th>
                          <th className="px-3 py-2 text-right">Std Dev (s)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-mono">
                        {(viewedAnalysis.results["groups"] as Array<{ name: string; n: number; mean: number | null; sd: number | null }>).map((g) => (
                          <tr key={g.name}>
                            <td className="px-3 py-2 font-semibold text-slate-900">{g.name}</td>
                            <td className="px-3 py-2 text-right text-slate-700">{g.n}</td>
                            <td className="px-3 py-2 text-right text-slate-900 font-semibold">{fmt(g.mean)}</td>
                            <td className="px-3 py-2 text-right text-slate-600">{fmt(g.sd)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}

              {viewedAnalysis.type === "crosstab" && Boolean(viewedAnalysis.results["counts"]) ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <div className="rounded border border-slate-200 bg-slate-50 p-3">
                      <div className="text-[11px] font-medium text-slate-500">Chi-Square (χ²)</div>
                      <div className="num mt-1 text-xl font-bold font-mono text-slate-900">
                        {typeof viewedAnalysis.results["chiSquare"] === "number"
                          ? (viewedAnalysis.results["chiSquare"] as number).toFixed(2)
                          : "—"}
                      </div>
                      <div className="text-[10px] text-slate-500 font-mono">
                        df = {String(viewedAnalysis.results["df"])}
                      </div>
                    </div>
                    <div className="rounded border border-slate-200 bg-slate-50 p-3">
                      <div className="text-[11px] font-medium text-slate-500">p-Value</div>
                      <div className="num mt-1 text-xl font-bold font-mono text-slate-900">
                        {typeof viewedAnalysis.results["pValue"] === "number"
                          ? (viewedAnalysis.results["pValue"] as number) < 0.001
                            ? "< 0.001"
                            : (viewedAnalysis.results["pValue"] as number).toFixed(4)
                          : "—"}
                      </div>
                    </div>
                    <div className="rounded border border-slate-200 bg-slate-50 p-3">
                      <div className="text-[11px] font-medium text-slate-500">Cramer's V</div>
                      <div className="num mt-1 text-xl font-bold font-mono text-slate-900">
                        {typeof viewedAnalysis.results["cramersV"] === "number"
                          ? (viewedAnalysis.results["cramersV"] as number).toFixed(3)
                          : "—"}
                      </div>
                    </div>
                    <div className="rounded border border-slate-200 bg-slate-50 p-3">
                      <div className="text-[11px] font-medium text-slate-500">Complete Pairs</div>
                      <div className="num mt-1 text-xl font-bold font-mono text-slate-900">
                        {Number(viewedAnalysis.results["n"]).toLocaleString()}
                      </div>
                    </div>
                  </div>

                  {/* Contingency Table */}
                  <div className="border border-slate-200 rounded overflow-x-auto">
                    <table className="w-full text-xs text-left font-mono">
                      <thead className="bg-slate-50 text-slate-600 font-medium border-b border-slate-200">
                        <tr>
                          <th className="px-3 py-2 bg-slate-100">{viewedAnalysis.variables[0]} \ {viewedAnalysis.variables[1]}</th>
                          {(viewedAnalysis.results["cols"] as string[]).map((c) => (
                            <th key={c} className="px-3 py-2 text-right">{c}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {(viewedAnalysis.results["rows"] as string[]).map((r, rIdx) => (
                          <tr key={r}>
                            <td className="px-3 py-2 font-semibold text-slate-900 bg-slate-50/50">{r}</td>
                            {(viewedAnalysis.results["cols"] as string[]).map((_, cIdx) => (
                              <td key={cIdx} className="px-3 py-2 text-right text-slate-800">
                                {((viewedAnalysis.results["counts"] as number[][])[rIdx]?.[cIdx] ?? 0).toLocaleString()}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}

              {/* 5-SECTION DETERMINISTIC INTERPRETATION (Requirement 6) */}
              <div className="border-t border-slate-200 pt-4 space-y-4">
                <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                  Structured Results Interpretation
                </h4>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded border border-slate-200 bg-slate-50/50 p-3 space-y-1.5 text-xs">
                    <div className="font-semibold text-slate-900 text-[11px] flex items-center gap-1.5">
                      <span className="size-2 rounded-full bg-blue-600" />
                      <span>1. Observed Results</span>
                    </div>
                    <ul className="list-disc pl-4 space-y-1 text-slate-700 leading-relaxed text-[11px]">
                      {viewedAnalysis.interpretation.observedResults.map((line, i) => (
                        <li key={i}>{line}</li>
                      ))}
                    </ul>
                  </div>

                  <div className="rounded border border-slate-200 bg-slate-50/50 p-3 space-y-1.5 text-xs">
                    <div className="font-semibold text-slate-900 text-[11px] flex items-center gap-1.5">
                      <span className="size-2 rounded-full bg-emerald-600" />
                      <span>2. Statistical Inference</span>
                    </div>
                    <ul className="list-disc pl-4 space-y-1 text-slate-700 leading-relaxed text-[11px]">
                      {viewedAnalysis.interpretation.statisticalInference.map((line, i) => (
                        <li key={i}>{line}</li>
                      ))}
                    </ul>
                  </div>

                  <div className="rounded border border-slate-200 bg-slate-50/50 p-3 space-y-1.5 text-xs">
                    <div className="font-semibold text-slate-900 text-[11px] flex items-center gap-1.5">
                      <span className="size-2 rounded-full bg-purple-600" />
                      <span>3. Assumptions</span>
                    </div>
                    <ul className="list-disc pl-4 space-y-1 text-slate-700 leading-relaxed text-[11px]">
                      {viewedAnalysis.interpretation.assumptions.map((line, i) => (
                        <li key={i}>{line}</li>
                      ))}
                    </ul>
                  </div>

                  <div className="rounded border border-slate-200 bg-slate-50/50 p-3 space-y-1.5 text-xs">
                    <div className="font-semibold text-slate-900 text-[11px] flex items-center gap-1.5">
                      <span className="size-2 rounded-full bg-amber-600" />
                      <span>4. Limitations</span>
                    </div>
                    <ul className="list-disc pl-4 space-y-1 text-slate-700 leading-relaxed text-[11px]">
                      {viewedAnalysis.interpretation.limitations.map((line, i) => (
                        <li key={i}>{line}</li>
                      ))}
                    </ul>
                  </div>
                </div>

                <div className="rounded border border-blue-200 bg-blue-50/60 p-3 text-xs text-blue-950 space-y-1">
                  <div className="font-semibold text-[11px] flex items-center gap-1.5">
                    <span className="size-2 rounded-full bg-blue-700" />
                    <span>5. Recommendations for Further Investigation</span>
                  </div>
                  <ul className="list-disc pl-4 space-y-0.5 text-[11px] leading-relaxed">
                    {viewedAnalysis.interpretation.recommendations.map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          ) : (
            <EmptyState title="Select and configure an analytical method">
              Choose an analysis from the left panel (Descriptive Statistics, Correlation, Two-Sample
              Comparison, Cross-Tabulation, or the active {personaMeta.shortRole} Toolkit), configure the variables, and click Execute.
            </EmptyState>
          )}
        </main>
      </div>
    </div>
  );
}

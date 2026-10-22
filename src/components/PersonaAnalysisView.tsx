import { useState, useMemo } from "react";
import type { Dataset, ColumnProfile } from "@/lib/data/types";
import { columnValues } from "@/lib/data/infer";
import {
  PERSONAS,
  type PersonaId,
  calculateTailLatency,
  calculateSloBreach,
  calculateElasticity,
  calculateGini,
  calculateNormalityDiagnostics,
  calculateABTest,
  calculateOddsRatio,
} from "@/lib/stats/personas";
import { correlation } from "@/lib/stats/advanced";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import {
  Cpu,
  TrendingUp,
  Boxes,
  Target,
  HeartPulse,
  AlertTriangle,
  CheckCircle2,
  Activity,
  Layers,
  ArrowUpRight,
  Sparkles,
} from "lucide-react";

interface PersonaAnalysisViewProps {
  persona: PersonaId;
  dataset: Dataset;
  profiles: ColumnProfile[];
}

export function PersonaAnalysisView({ persona, dataset, profiles }: PersonaAnalysisViewProps) {
  const numericProfiles = profiles.filter((p) => p.type === "numeric");
  const personaMeta = PERSONAS[persona];

  return (
    <div className="space-y-6">
      {/* ThreeUI Persona Header Banner */}
      <div className="relative overflow-hidden rounded-2xl border border-indigo-500/20 bg-gradient-to-br from-indigo-950/40 via-slate-900/60 to-slate-950/80 p-5 shadow-[0_8px_32px_rgba(0,0,0,0.4)] backdrop-blur-xl">
        <div className="absolute -right-8 -top-8 size-40 rounded-full bg-indigo-500/10 blur-3xl" />
        <div className="relative z-10 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex size-6 items-center justify-center rounded-md bg-indigo-500/20 text-indigo-400">
                <Sparkles className="size-3.5" />
              </span>
              <span className="eyebrow text-indigo-400">{personaMeta.badge}</span>
            </div>
            <h2 className="mt-1 text-xl font-bold tracking-tight text-white">
              {personaMeta.title} Toolkit
            </h2>
            <p className="mt-0.5 text-xs text-slate-300 max-w-xl">{personaMeta.tagline}</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {personaMeta.keyMetrics.map((km) => (
              <span
                key={km}
                className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-mono text-slate-300"
              >
                {km}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Render tailored tool per persona */}
      {persona === "engineer" && (
        <EngineerToolkit dataset={dataset} numericCols={numericProfiles} />
      )}
      {persona === "economist" && (
        <EconomistToolkit dataset={dataset} numericCols={numericProfiles} />
      )}
      {persona === "scientist" && (
        <ScientistToolkit dataset={dataset} numericCols={numericProfiles} />
      )}
      {persona === "product" && <ProductToolkit dataset={dataset} numericCols={numericProfiles} />}
      {persona === "clinical" && (
        <ClinicalToolkit dataset={dataset} numericCols={numericProfiles} />
      )}
    </div>
  );
}

// -------------------------------------------------------------
// 1. SOFTWARE ENGINEER / SRE TOOLKIT
// -------------------------------------------------------------
function EngineerToolkit({
  dataset,
  numericCols,
}: {
  dataset: Dataset;
  numericCols: ColumnProfile[];
}) {
  const defaultCol =
    numericCols.find((p) => p.name.toLowerCase().includes("latency"))?.name ||
    numericCols[0]?.name ||
    "";
  const [selectedCol, setSelectedCol] = useState(defaultCol);
  const [sloThreshold, setSloThreshold] = useState<number>(200);
  const [sloTarget, setSloTarget] = useState<number>(99.0);

  const colProfile = numericCols.find((p) => p.name === selectedCol);
  const rawValues = useMemo(() => {
    if (!colProfile) return [];
    return columnValues(dataset, colProfile.index);
  }, [dataset, colProfile]);

  const latencyStats = useMemo(() => calculateTailLatency(rawValues), [rawValues]);
  const sloStats = useMemo(
    () => calculateSloBreach(rawValues, sloThreshold, sloTarget),
    [rawValues, sloThreshold, sloTarget],
  );

  if (numericCols.length === 0) {
    return <div className="text-xs text-slate-400">No numeric telemetry columns found.</div>;
  }

  const percentilesList = [
    { label: "P50 (Median)", val: latencyStats.p50, highlight: false },
    { label: "P75", val: latencyStats.p75, highlight: false },
    { label: "P90", val: latencyStats.p90, highlight: false },
    { label: "P95", val: latencyStats.p95, highlight: true },
    { label: "P99 (Tail)", val: latencyStats.p99, highlight: true },
    { label: "P99.9 (Extreme)", val: latencyStats.p999, highlight: true },
  ];

  return (
    <div className="space-y-6">
      {/* Column & SLA Target Bar */}
      <div className="glass-card flex flex-wrap items-center justify-between gap-4 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <Label className="text-xs text-slate-300">Metric Column:</Label>
          <select
            value={selectedCol}
            onChange={(e) => setSelectedCol(e.target.value)}
            className="rounded-lg border border-white/10 bg-slate-900 px-3 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            {numericCols.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            <Label className="text-xs text-slate-300">SLO Threshold:</Label>
            <Input
              type="number"
              value={sloThreshold}
              onChange={(e) => setSloThreshold(Number(e.target.value) || 0)}
              className="h-8 w-20 border-white/10 bg-slate-900 text-xs text-white"
            />
            <span className="text-xs text-slate-400">ms</span>
          </div>

          <div className="flex items-center gap-1.5">
            <Label className="text-xs text-slate-300">Target:</Label>
            <select
              value={sloTarget}
              onChange={(e) => setSloTarget(Number(e.target.value))}
              className="h-8 rounded-lg border border-white/10 bg-slate-900 px-2 text-xs text-white"
            >
              <option value={99.9}>99.9% (Three 9s)</option>
              <option value={99.0}>99.0% (Two 9s)</option>
              <option value={95.0}>95.0%</option>
              <option value={90.0}>90.0%</option>
            </select>
          </div>
        </div>
      </div>

      {/* Latency Percentile Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {percentilesList.map((p) => (
          <div
            key={p.label}
            className={`glass-card p-3 ${
              p.highlight
                ? "border-indigo-500/40 bg-indigo-950/20 shadow-[0_0_15px_rgba(99,102,241,0.15)]"
                : ""
            }`}
          >
            <div className="text-[11px] font-mono text-slate-400">{p.label}</div>
            <div className="num mt-1 text-lg font-bold text-white">
              {p.val !== null ? p.val.toFixed(1) : "—"}
              <span className="ml-1 text-[11px] font-normal text-slate-400">ms</span>
            </div>
          </div>
        ))}
      </div>

      {/* Tail Degradation & SLO Cards */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Tail Ratio & Jitter */}
        <div className="glass-card p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="font-semibold text-white flex items-center gap-2">
              <Activity className="size-4 text-cyan-400" />
              <span>Tail Latency Jitter & Ratio</span>
            </div>
            {latencyStats.tailRatio !== null && (
              <span
                className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                  latencyStats.tailRatio > 5
                    ? "bg-red-500/20 text-red-300 border border-red-500/30"
                    : latencyStats.tailRatio > 2.5
                      ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                      : "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                }`}
              >
                {latencyStats.tailRatio.toFixed(1)}x Tail Ratio
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 pt-1">
            <div className="rounded-xl border border-white/5 bg-slate-900/60 p-3">
              <div className="text-[11px] text-slate-400">P99 / P50 Ratio</div>
              <div className="num mt-1 text-xl font-bold text-cyan-300">
                {latencyStats.tailRatio ? `${latencyStats.tailRatio.toFixed(2)}×` : "—"}
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5">Degradation factor under peak</div>
            </div>
            <div className="rounded-xl border border-white/5 bg-slate-900/60 p-3">
              <div className="text-[11px] text-slate-400">Average Jitter</div>
              <div className="num mt-1 text-xl font-bold text-indigo-300">
                {latencyStats.jitter ? `${latencyStats.jitter.toFixed(1)} ms` : "—"}
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5">Consecutive request variance</div>
            </div>
          </div>

          <p className="text-xs text-slate-300 leading-relaxed border-t border-white/5 pt-2">
            {latencyStats.assessment}
          </p>
        </div>

        {/* SLO Error Budget */}
        <div className="glass-card p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="font-semibold text-white flex items-center gap-2">
              <Cpu className="size-4 text-indigo-400" />
              <span>SLO & Error Budget Burn</span>
            </div>
            <span
              className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                sloStats.status === "breached"
                  ? "bg-red-500/20 text-red-300 border border-red-500/30"
                  : sloStats.status === "warning"
                    ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                    : "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
              }`}
            >
              {sloStats.status.toUpperCase()}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3 pt-1">
            <div className="rounded-xl border border-white/5 bg-slate-900/60 p-3">
              <div className="text-[11px] text-slate-400">Availability</div>
              <div className="num mt-1 text-xl font-bold text-emerald-400">
                {sloStats.actualAvailabilityPercent.toFixed(2)}%
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5">
                Target: {sloStats.targetPercent}% (&lt;{sloThreshold}ms)
              </div>
            </div>
            <div className="rounded-xl border border-white/5 bg-slate-900/60 p-3">
              <div className="text-[11px] text-slate-400">Budget Consumed</div>
              <div
                className={`num mt-1 text-xl font-bold ${
                  sloStats.budgetConsumedPercent > 100
                    ? "text-red-400"
                    : sloStats.budgetConsumedPercent > 80
                      ? "text-amber-400"
                      : "text-slate-200"
                }`}
              >
                {sloStats.budgetConsumedPercent.toFixed(1)}%
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5">
                {sloStats.breachCount} breaches / {sloStats.budgetTotalAllowedBreaches} allowed
              </div>
            </div>
          </div>

          <p className="text-xs text-slate-300 leading-relaxed border-t border-white/5 pt-2">
            {sloStats.summary}
          </p>
        </div>
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// 2. ECONOMIST & FINANCIAL ANALYST TOOLKIT
// -------------------------------------------------------------
function EconomistToolkit({
  dataset,
  numericCols,
}: {
  dataset: Dataset;
  numericCols: ColumnProfile[];
}) {
  const priceCol =
    numericCols.find(
      (p) => p.name.toLowerCase().includes("price") || p.name.toLowerCase().includes("rate"),
    )?.name ||
    numericCols[0]?.name ||
    "";
  const quantCol =
    numericCols.find(
      (p) =>
        p.name.toLowerCase().includes("demand") ||
        p.name.toLowerCase().includes("gdp") ||
        p.name.toLowerCase().includes("unemploy"),
    )?.name ||
    numericCols[1]?.name ||
    "";
  const incomeCol =
    numericCols.find(
      (p) =>
        p.name.toLowerCase().includes("income") ||
        p.name.toLowerCase().includes("gdp") ||
        p.name.toLowerCase().includes("spend"),
    )?.name ||
    numericCols[0]?.name ||
    "";

  const [price, setPrice] = useState(priceCol);
  const [quant, setQuant] = useState(quantCol);
  const [income, setIncome] = useState(incomeCol);

  const priceProfile = numericCols.find((p) => p.name === price);
  const quantProfile = numericCols.find((p) => p.name === quant);
  const incomeProfile = numericCols.find((p) => p.name === income);

  const priceVals = useMemo(
    () => (priceProfile ? columnValues(dataset, priceProfile.index) : []),
    [dataset, priceProfile],
  );
  const quantVals = useMemo(
    () => (quantProfile ? columnValues(dataset, quantProfile.index) : []),
    [dataset, quantProfile],
  );
  const incomeVals = useMemo(
    () => (incomeProfile ? columnValues(dataset, incomeProfile.index) : []),
    [dataset, incomeProfile],
  );

  const elasticity = useMemo(
    () => calculateElasticity(priceVals, quantVals),
    [priceVals, quantVals],
  );
  const gini = useMemo(() => calculateGini(incomeVals), [incomeVals]);

  return (
    <div className="space-y-6">
      {/* Section 1: Price Elasticity of Demand */}
      <div className="glass-card p-5 space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-white/10 pb-3">
          <div>
            <h3 className="font-semibold text-white flex items-center gap-2">
              <TrendingUp className="size-4 text-indigo-400" />
              <span>Price Elasticity & Econometric Response</span>
            </h3>
            <p className="text-xs text-slate-400">
              Point elasticity of demand E = (dQ/dP) · (P̄ / Q̄) estimated via OLS regression.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className="rounded-md border border-white/10 bg-slate-900 px-2 py-1 text-xs text-white"
            >
              {numericCols.map((c) => (
                <option key={c.name} value={c.name}>
                  P: {c.name}
                </option>
              ))}
            </select>
            <span className="text-slate-400 text-xs">vs</span>
            <select
              value={quant}
              onChange={(e) => setQuant(e.target.value)}
              className="rounded-md border border-white/10 bg-slate-900 px-2 py-1 text-xs text-white"
            >
              {numericCols.map((c) => (
                <option key={c.name} value={c.name}>
                  Q: {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-white/5 bg-slate-900/60 p-3">
            <div className="text-[11px] text-slate-400">Elasticity ($E_p$)</div>
            <div className="num mt-1 text-xl font-bold text-indigo-300">
              {elasticity.pointElasticity !== null ? elasticity.pointElasticity.toFixed(2) : "—"}
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              Classification: {elasticity.classification}
            </div>
          </div>
          <div className="rounded-xl border border-white/5 bg-slate-900/60 p-3">
            <div className="text-[11px] text-slate-400">Marginal Effect ($dQ/dP$)</div>
            <div className="num mt-1 text-xl font-bold text-cyan-300">
              {elasticity.slope !== null ? elasticity.slope.toFixed(3) : "—"}
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">OLS regression slope</div>
          </div>
          <div className="rounded-xl border border-white/5 bg-slate-900/60 p-3">
            <div className="text-[11px] text-slate-400">Goodness of Fit ($R^2$)</div>
            <div className="num mt-1 text-xl font-bold text-emerald-300">
              {elasticity.rSquared !== null ? (elasticity.rSquared * 100).toFixed(1) + "%" : "—"}
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">Explained variance</div>
          </div>
          <div className="rounded-xl border border-white/5 bg-slate-900/60 p-3">
            <div className="text-[11px] text-slate-400">Sample Pairs (n)</div>
            <div className="num mt-1 text-xl font-bold text-slate-200">{elasticity.n}</div>
            <div className="text-[10px] text-slate-400 mt-0.5">Pairwise complete</div>
          </div>
        </div>

        <div className="rounded-xl border border-indigo-500/20 bg-indigo-950/20 p-3 text-xs text-indigo-200">
          <strong>Economic Takeaway:</strong> {elasticity.interpretation}
        </div>
      </div>

      {/* Section 2: Gini Coefficient & Lorenz Distribution */}
      <div className="glass-card p-5 space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-white/10 pb-3">
          <div>
            <h3 className="font-semibold text-white flex items-center gap-2">
              <Layers className="size-4 text-cyan-400" />
              <span>Gini Coefficient & Inequality Index</span>
            </h3>
            <p className="text-xs text-slate-400">
              Measures statistical dispersion and wealth/income/metric concentration (0 = perfect
              equality, 1 = maximum concentration).
            </p>
          </div>
          <select
            value={income}
            onChange={(e) => setIncome(e.target.value)}
            className="rounded-md border border-white/10 bg-slate-900 px-2 py-1 text-xs text-white"
          >
            {numericCols.map((c) => (
              <option key={c.name} value={c.name}>
                Distribution: {c.name}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-xl border border-white/5 bg-slate-900/60 p-3">
            <div className="text-[11px] text-slate-400">Gini Coefficient (0 to 1)</div>
            <div className="num mt-1 text-2xl font-bold text-cyan-300">
              {gini.gini !== null ? gini.gini.toFixed(3) : "—"}
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">{gini.rating}</div>
          </div>
          <div className="rounded-xl border border-white/5 bg-slate-900/60 p-3">
            <div className="text-[11px] text-slate-400">Top 10% Share</div>
            <div className="num mt-1 text-2xl font-bold text-amber-300">
              {gini.top10SharePct !== null ? `${gini.top10SharePct.toFixed(1)}%` : "—"}
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              Concentrated in 90th+ percentile
            </div>
          </div>
          <div className="rounded-xl border border-white/5 bg-slate-900/60 p-3">
            <div className="text-[11px] text-slate-400">Palma Ratio</div>
            <div className="num mt-1 text-2xl font-bold text-emerald-300">
              {gini.palmaRatio !== null ? gini.palmaRatio.toFixed(2) : "—"}
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              Top 10% share / Bottom 40% share
            </div>
          </div>
        </div>

        {gini.quintiles.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-white/10">
            <table className="w-full text-xs">
              <thead className="bg-slate-900/80 border-b border-white/10 text-slate-400">
                <tr>
                  <th className="px-3 py-2 text-left">Lorenz Quintile</th>
                  <th className="px-3 py-2 text-right">Segment Share</th>
                  <th className="px-3 py-2 text-right">Cumulative Share</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 font-mono">
                {gini.quintiles.map((q) => (
                  <tr key={q.quintile} className="hover:bg-white/5">
                    <td className="px-3 py-2 text-slate-300 font-sans">
                      Q{q.quintile} (
                      {q.quintile === 1
                        ? "Bottom 20%"
                        : q.quintile === 5
                          ? "Top 20%"
                          : `${(q.quintile - 1) * 20}% - ${q.quintile * 20}%`}
                      )
                    </td>
                    <td className="px-3 py-2 text-right text-indigo-300">
                      {q.sharePct.toFixed(1)}%
                    </td>
                    <td className="px-3 py-2 text-right text-slate-400">
                      {q.cumSharePct.toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// 3. DATA SCIENTIST & ML TOOLKIT
// -------------------------------------------------------------
function ScientistToolkit({
  dataset,
  numericCols,
}: {
  dataset: Dataset;
  numericCols: ColumnProfile[];
}) {
  const [targetCol, setTargetCol] = useState(numericCols[0]?.name || "");
  const targetProfile = numericCols.find((p) => p.name === targetCol);
  const rawVals = useMemo(
    () => (targetProfile ? columnValues(dataset, targetProfile.index) : []),
    [dataset, targetProfile],
  );

  const diag = useMemo(() => calculateNormalityDiagnostics(rawVals), [rawVals]);

  // Pairwise correlation matrix for top 5 numeric columns
  const matrixCols = numericCols.slice(0, 5);
  const corrMatrix = useMemo(() => {
    return matrixCols.map((c1) => {
      const v1 = columnValues(dataset, c1.index).map((x) =>
        x !== null && x !== "" ? Number(x) : null,
      );
      return matrixCols.map((c2) => {
        if (c1.name === c2.name) return { r: 1, p: 0 };
        const v2 = columnValues(dataset, c2.index).map((x) =>
          x !== null && x !== "" ? Number(x) : null,
        );
        const res = correlation(
          v1.filter((_, idx) => v1[idx] !== null && v2[idx] !== null) as number[],
          v2.filter((_, idx) => v1[idx] !== null && v2[idx] !== null) as number[],
        );
        return { r: res.r, p: res.pValue };
      });
    });
  }, [dataset, matrixCols]);

  return (
    <div className="space-y-6">
      {/* Normality & Moment Diagnostics */}
      <div className="glass-card p-5 space-y-4">
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <div>
            <h3 className="font-semibold text-white flex items-center gap-2">
              <Boxes className="size-4 text-indigo-400" />
              <span>Feature Moments & Normality Diagnostics</span>
            </h3>
            <p className="text-xs text-slate-400">
              Evaluates third and fourth standardized moments (skewness and kurtosis) for
              distribution modeling.
            </p>
          </div>
          <select
            value={targetCol}
            onChange={(e) => setTargetCol(e.target.value)}
            className="rounded-md border border-white/10 bg-slate-900 px-2 py-1 text-xs text-white"
          >
            {numericCols.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-white/5 bg-slate-900/60 p-3">
            <div className="text-[11px] text-slate-400">Skewness ($g_1$)</div>
            <div className="num mt-1 text-xl font-bold text-cyan-300">
              {diag.skewness !== null ? diag.skewness.toFixed(2) : "—"}
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              {diag.skewness && Math.abs(diag.skewness) < 0.5 ? "Symmetric" : "Asymmetric"}
            </div>
          </div>
          <div className="rounded-xl border border-white/5 bg-slate-900/60 p-3">
            <div className="text-[11px] text-slate-400">Excess Kurtosis ($g_2$)</div>
            <div className="num mt-1 text-xl font-bold text-indigo-300">
              {diag.kurtosis !== null ? diag.kurtosis.toFixed(2) : "—"}
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              Tail heaviness relative to normal
            </div>
          </div>
          <div className="rounded-xl border border-white/5 bg-slate-900/60 p-3">
            <div className="text-[11px] text-slate-400">IQR Outliers</div>
            <div className="num mt-1 text-xl font-bold text-amber-300">{diag.iqrOutliersCount}</div>
            <div className="text-[10px] text-slate-400 mt-0.5">Outside 1.5× IQR fences</div>
          </div>
          <div className="rounded-xl border border-white/5 bg-slate-900/60 p-3">
            <div className="text-[11px] text-slate-400">Parametric Ready</div>
            <div className="num mt-1 text-xl font-bold text-emerald-400">
              {diag.isNormalCandidate ? "YES" : "NO"}
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">Bell curve compliance</div>
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-slate-900/50 p-3 text-xs text-slate-200">
          💡 <strong>ML Engineering Note:</strong> {diag.recommendation}
        </div>
      </div>

      {/* Feature Correlation Matrix */}
      {matrixCols.length > 1 && (
        <div className="glass-card p-5 space-y-3">
          <h3 className="font-semibold text-white flex items-center gap-2">
            <Layers className="size-4 text-emerald-400" />
            <span>Pairwise Feature Correlation Heatmap</span>
          </h3>
          <div className="overflow-x-auto rounded-lg border border-white/10">
            <table className="w-full text-xs">
              <thead className="bg-slate-900/80 border-b border-white/10 text-slate-400">
                <tr>
                  <th className="px-3 py-2 text-left font-mono">Feature</th>
                  {matrixCols.map((c) => (
                    <th key={c.name} className="px-3 py-2 text-center font-mono">
                      {c.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 font-mono">
                {matrixCols.map((r, i) => (
                  <tr key={r.name} className="hover:bg-white/5">
                    <td className="px-3 py-2 text-slate-300 font-medium">{r.name}</td>
                    {matrixCols.map((_, j) => {
                      const cell = corrMatrix[i]?.[j];
                      const rVal = cell?.r;
                      const isHigh = rVal !== null && rVal !== undefined && Math.abs(rVal) > 0.6;
                      return (
                        <td
                          key={j}
                          className={`px-3 py-2 text-center ${
                            isHigh ? "bg-indigo-600/30 text-indigo-200 font-bold" : "text-slate-300"
                          }`}
                        >
                          {rVal !== null && rVal !== undefined ? rVal.toFixed(2) : "—"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// -------------------------------------------------------------
// 4. PRODUCT MANAGER TOOLKIT
// -------------------------------------------------------------
function ProductToolkit({
  dataset,
  numericCols,
}: {
  dataset: Dataset;
  numericCols: ColumnProfile[];
}) {
  const [controlUsers, setControlUsers] = useState(1000);
  const [controlConv, setControlConv] = useState(120);
  const [testUsers, setTestUsers] = useState(1000);
  const [testConv, setTestConv] = useState(165);

  const abResult = useMemo(
    () => calculateABTest(controlConv, controlUsers, testConv, testUsers),
    [controlConv, controlUsers, testConv, testUsers],
  );

  return (
    <div className="glass-card p-5 space-y-4">
      <div className="border-b border-white/10 pb-3">
        <h3 className="font-semibold text-white flex items-center gap-2">
          <Target className="size-4 text-indigo-400" />
          <span>A/B Experiment Conversion & Lift Significance</span>
        </h3>
        <p className="text-xs text-slate-400">
          Two-proportion z-test with 95% confidence bounds and decision recommendation.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <Label className="text-xs text-slate-300">Control Visitors</Label>
          <Input
            type="number"
            value={controlUsers}
            onChange={(e) => setControlUsers(Number(e.target.value) || 0)}
            className="mt-1 h-8 border-white/10 bg-slate-900 text-xs text-white"
          />
        </div>
        <div>
          <Label className="text-xs text-slate-300">Control Conversions</Label>
          <Input
            type="number"
            value={controlConv}
            onChange={(e) => setControlConv(Number(e.target.value) || 0)}
            className="mt-1 h-8 border-white/10 bg-slate-900 text-xs text-white"
          />
        </div>
        <div>
          <Label className="text-xs text-slate-300">Variant Visitors</Label>
          <Input
            type="number"
            value={testUsers}
            onChange={(e) => setTestUsers(Number(e.target.value) || 0)}
            className="mt-1 h-8 border-white/10 bg-slate-900 text-xs text-white"
          />
        </div>
        <div>
          <Label className="text-xs text-slate-300">Variant Conversions</Label>
          <Input
            type="number"
            value={testConv}
            onChange={(e) => setTestConv(Number(e.target.value) || 0)}
            className="mt-1 h-8 border-white/10 bg-slate-900 text-xs text-white"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 pt-2">
        <div className="rounded-xl border border-white/5 bg-slate-900/60 p-3">
          <div className="text-[11px] text-slate-400">Relative Lift</div>
          <div
            className={`num mt-1 text-xl font-bold ${
              abResult.relativeLiftPct > 0 ? "text-emerald-400" : "text-red-400"
            }`}
          >
            {abResult.relativeLiftPct > 0 ? "+" : ""}
            {abResult.relativeLiftPct.toFixed(1)}%
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">
            {(abResult.controlRate * 100).toFixed(1)}% → {(abResult.testRate * 100).toFixed(1)}%
          </div>
        </div>
        <div className="rounded-xl border border-white/5 bg-slate-900/60 p-3">
          <div className="text-[11px] text-slate-400">P-Value</div>
          <div className="num mt-1 text-xl font-bold text-indigo-300">
            {abResult.pValue !== null ? abResult.pValue.toFixed(4) : "—"}
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">
            {abResult.isSignificant ? "p < 0.05 (Significant)" : "p ≥ 0.05"}
          </div>
        </div>
        <div className="rounded-xl border border-white/5 bg-slate-900/60 p-3">
          <div className="text-[11px] text-slate-400">Z-Score</div>
          <div className="num mt-1 text-xl font-bold text-cyan-300">
            {abResult.zScore !== null ? abResult.zScore.toFixed(2) : "—"}
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">Critical threshold: ±1.96</div>
        </div>
        <div className="rounded-xl border border-white/5 bg-slate-900/60 p-3">
          <div className="text-[11px] text-slate-400">Outcome</div>
          <div
            className={`num mt-1 text-lg font-bold ${
              abResult.isSignificant ? "text-emerald-400" : "text-amber-400"
            }`}
          >
            {abResult.isSignificant ? "WINNER" : "INCONCLUSIVE"}
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">At 95% confidence</div>
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-slate-900/50 p-3 text-xs text-slate-200">
        📊 <strong>Recommendation:</strong> {abResult.recommendation}
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// 5. CLINICAL RESEARCHER TOOLKIT
// -------------------------------------------------------------
function ClinicalToolkit({
  dataset,
  numericCols,
}: {
  dataset: Dataset;
  numericCols: ColumnProfile[];
}) {
  const [a, setA] = useState(45); // Exposed cases
  const [b, setB] = useState(55); // Exposed non-cases
  const [c, setC] = useState(20); // Unexposed cases
  const [d, setD] = useState(80); // Unexposed non-cases

  const orResult = useMemo(() => calculateOddsRatio(a, b, c, d), [a, b, c, d]);

  return (
    <div className="glass-card p-5 space-y-4">
      <div className="border-b border-white/10 pb-3">
        <h3 className="font-semibold text-white flex items-center gap-2">
          <HeartPulse className="size-4 text-red-400" />
          <span>Epidemiology & Clinical 2×2 Contingency Odds Ratio</span>
        </h3>
        <p className="text-xs text-slate-400">
          Calculates Odds Ratio (OR), Relative Risk (RR), and 95% Wald confidence bounds.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <Label className="text-xs text-slate-300">Exposed Cases (a)</Label>
          <Input
            type="number"
            value={a}
            onChange={(e) => setA(Number(e.target.value) || 0)}
            className="mt-1 h-8 border-white/10 bg-slate-900 text-xs text-white"
          />
        </div>
        <div>
          <Label className="text-xs text-slate-300">Exposed Non-Cases (b)</Label>
          <Input
            type="number"
            value={b}
            onChange={(e) => setB(Number(e.target.value) || 0)}
            className="mt-1 h-8 border-white/10 bg-slate-900 text-xs text-white"
          />
        </div>
        <div>
          <Label className="text-xs text-slate-300">Unexposed Cases (c)</Label>
          <Input
            type="number"
            value={c}
            onChange={(e) => setC(Number(e.target.value) || 0)}
            className="mt-1 h-8 border-white/10 bg-slate-900 text-xs text-white"
          />
        </div>
        <div>
          <Label className="text-xs text-slate-300">Unexposed Non-Cases (d)</Label>
          <Input
            type="number"
            value={d}
            onChange={(e) => setD(Number(e.target.value) || 0)}
            className="mt-1 h-8 border-white/10 bg-slate-900 text-xs text-white"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 pt-2">
        <div className="rounded-xl border border-white/5 bg-slate-900/60 p-3">
          <div className="text-[11px] text-slate-400">Odds Ratio (OR)</div>
          <div className="num mt-1 text-2xl font-bold text-red-300">
            {orResult.oddsRatio !== null ? orResult.oddsRatio.toFixed(2) : "—"}
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">
            95% CI: [{orResult.ci95Lower?.toFixed(2)}, {orResult.ci95Upper?.toFixed(2)}]
          </div>
        </div>
        <div className="rounded-xl border border-white/5 bg-slate-900/60 p-3">
          <div className="text-[11px] text-slate-400">Relative Risk (RR)</div>
          <div className="num mt-1 text-2xl font-bold text-indigo-300">
            {orResult.relativeRisk !== null ? orResult.relativeRisk.toFixed(2) : "—"}
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">Risk in exposed vs unexposed</div>
        </div>
        <div className="rounded-xl border border-white/5 bg-slate-900/60 p-3">
          <div className="text-[11px] text-slate-400">Chi-Square p-value</div>
          <div className="num mt-1 text-2xl font-bold text-cyan-300">
            {orResult.chiSquareP !== null ? orResult.chiSquareP.toFixed(4) : "—"}
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">Yates corrected independence</div>
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-slate-900/50 p-3 text-xs text-slate-200">
        🩺 <strong>Interpretation:</strong> {orResult.interpretation}
      </div>
    </div>
  );
}

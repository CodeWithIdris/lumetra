import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import type { FrequencyRow, HistogramBin } from "@/lib/stats/descriptive";
import { fmt } from "@/lib/stats/descriptive";
import type { RegressionResult } from "@/lib/stats/advanced";

const axis = { fontSize: 11, fill: "var(--color-muted-foreground)" };

export function HistogramChart({ bins, column }: { bins: HistogramBin[]; column: string }) {
  return (
    <figure aria-label={`Histogram of ${column}`}>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={bins}
            margin={{ top: 8, right: 8, bottom: 28, left: 4 }}
            barCategoryGap={1}
          >
            <CartesianGrid vertical={false} stroke="var(--color-border)" />
            <XAxis
              dataKey="label"
              tick={axis}
              interval={0}
              angle={-30}
              textAnchor="end"
              height={50}
              label={{ value: column, position: "insideBottom", offset: -22, ...axis }}
            />
            <YAxis
              allowDecimals={false}
              tick={axis}
              width={40}
              label={{ value: "Count", angle: -90, position: "insideLeft", ...axis }}
            />
            <Tooltip
              cursor={{ fill: "var(--color-muted)" }}
              contentStyle={{ fontSize: 12, borderRadius: 6 }}
            />
            <Bar
              dataKey="count"
              name="Count"
              fill="var(--color-chart-1)"
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}

export function FrequencyChart({ rows, column }: { rows: FrequencyRow[]; column: string }) {
  const data = rows.slice(0, 15);
  return (
    <figure aria-label={`Bar chart of ${column}`}>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 28, left: 4 }}>
            <CartesianGrid vertical={false} stroke="var(--color-border)" />
            <XAxis
              dataKey="value"
              tick={axis}
              interval={0}
              angle={-30}
              textAnchor="end"
              height={50}
              label={{ value: column, position: "insideBottom", offset: -22, ...axis }}
            />
            <YAxis
              allowDecimals={false}
              tick={axis}
              width={40}
              label={{ value: "Count", angle: -90, position: "insideLeft", ...axis }}
            />
            <Tooltip
              cursor={{ fill: "var(--color-muted)" }}
              contentStyle={{ fontSize: 12, borderRadius: 6 }}
            />
            <Bar
              dataKey="count"
              name="Count"
              fill="var(--color-chart-1)"
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      {rows.length > 15 && (
        <figcaption className="text-[12px] text-muted-foreground">
          Showing the 15 most frequent of {rows.length} categories.
        </figcaption>
      )}
    </figure>
  );
}

export interface ScatterPlotPoint {
  x: number;
  y: number;
  rowIndex?: number;
}

export interface ScatterPlotChartProps {
  xLabel: string;
  yLabel: string;
  points: ScatterPlotPoint[];
  totalPairs?: number;
  r?: number | null;
  pValue?: number | null;
  method?: "pearson" | "spearman";
  regression?: Partial<RegressionResult> | null;
  trendLine?: Array<{ x: number; y: number }> | null;
  missingCount?: number;
  className?: string;
  height?: number;
  staleNotice?: string;
  caption?: string;
}

function CustomScatterTooltip({
  active,
  payload,
  xLabel,
  yLabel,
}: {
  active?: boolean;
  payload?: Array<{ payload: ScatterPlotPoint }>;
  xLabel: string;
  yLabel: string;
}) {
  if (!active || !payload || !payload.length || !payload[0]?.payload) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded border border-slate-200 bg-white/95 p-2 text-xs shadow-md font-mono space-y-0.5">
      {p.rowIndex !== undefined && (
        <div className="text-[10px] text-slate-500 font-sans">Observation #{p.rowIndex + 1}</div>
      )}
      <div className="text-slate-800">
        <span className="text-slate-500 font-sans">{xLabel}: </span>
        <span className="font-semibold">{fmt(p.x, 3)}</span>
      </div>
      <div className="text-slate-800">
        <span className="text-slate-500 font-sans">{yLabel}: </span>
        <span className="font-semibold">{fmt(p.y, 3)}</span>
      </div>
    </div>
  );
}

export function ScatterPlotChart({
  xLabel,
  yLabel,
  points,
  totalPairs,
  r,
  pValue,
  method = "pearson",
  regression,
  trendLine,
  missingCount,
  className = "",
  height = 280,
  staleNotice,
  caption,
}: ScatterPlotChartProps) {
  const n = totalPairs ?? points.length;

  if (points.length === 0) {
    return (
      <figure
        role="region"
        aria-label={`Scatter plot of ${yLabel} versus ${xLabel}`}
        className={`rounded border border-dashed border-slate-200 bg-slate-50/50 p-6 text-center text-xs text-slate-500 ${className}`}
      >
        <p className="font-medium text-slate-700">No complete paired observations</p>
        <p className="mt-1 text-[11px] text-slate-500">
          Neither variable has paired non-missing numeric coordinates for “{xLabel}” and “{yLabel}”.
        </p>
      </figure>
    );
  }

  // Downsample if dataset is exceptionally large (>2,000 points) to keep SVG rendering performant
  const MAX_DISPLAY_POINTS = 2000;
  const isDownsampled = points.length > MAX_DISPLAY_POINTS;
  const displayPoints = isDownsampled
    ? points.filter((_, idx) => idx % Math.ceil(points.length / MAX_DISPLAY_POINTS) === 0)
    : points;

  // Compute trendline points if not explicitly provided
  let activeTrendLine = trendLine;
  if (
    !activeTrendLine &&
    regression &&
    regression.slope !== null &&
    regression.slope !== undefined &&
    regression.intercept !== null &&
    regression.intercept !== undefined
  ) {
    const xs = points.map((p) => p.x);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    if (minX !== maxX) {
      activeTrendLine = [
        { x: minX, y: regression.intercept + regression.slope * minX },
        { x: maxX, y: regression.intercept + regression.slope * maxX },
      ];
    }
  }

  const hasTrendLine = activeTrendLine && activeTrendLine.length === 2;

  return (
    <figure
      role="region"
      aria-label={`Scatter plot of ${yLabel} versus ${xLabel}`}
      className={`rounded border border-slate-200 bg-white p-3 space-y-2.5 ${className}`}
    >
      {/* Chart Header & Metadata Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2 text-xs">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-slate-900">
            {yLabel} vs {xLabel}
          </span>
          {staleNotice && (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
              {staleNotice}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 font-mono text-[11px] text-slate-600">
          <span>n = {n.toLocaleString()} pairs</span>
          {r !== undefined && r !== null && (
            <span>
              r = {r.toFixed(3)}
              {pValue !== undefined && pValue !== null
                ? ` (p ${pValue < 0.001 ? "< 0.001" : `= ${pValue.toFixed(4)}`})`
                : ""}
            </span>
          )}
          {missingCount !== undefined && missingCount > 0 && (
            <span className="text-slate-400">({missingCount.toLocaleString()} excluded)</span>
          )}
        </div>
      </div>

      {/* Small sample warning */}
      {points.length < 3 && (
        <div className="rounded border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] text-amber-800">
          Correlation and regression require at least 3 complete pairs (found n = {points.length}).
        </div>
      )}

      {/* SVG Scatter Plot Container */}
      <div style={{ height }} className="w-full print:h-64">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 10, right: 16, bottom: 24, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
            <XAxis
              type="number"
              dataKey="x"
              name={xLabel}
              tick={axis}
              domain={["auto", "auto"]}
              tickFormatter={(v) => fmt(v, 2)}
              label={{ value: xLabel, position: "insideBottom", offset: -16, ...axis }}
            />
            <YAxis
              type="number"
              dataKey="y"
              name={yLabel}
              tick={axis}
              domain={["auto", "auto"]}
              tickFormatter={(v) => fmt(v, 2)}
              label={{ value: yLabel, angle: -90, position: "insideLeft", offset: 0, ...axis }}
            />
            <ZAxis range={[25, 25]} />
            <Tooltip
              cursor={{ strokeDasharray: "3 3", stroke: "var(--color-border)" }}
              content={<CustomScatterTooltip xLabel={xLabel} yLabel={yLabel} />}
            />
            <Scatter
              name="Observations"
              data={displayPoints}
              fill="var(--color-chart-1, #2563eb)"
              fillOpacity={0.65}
              isAnimationActive={false}
            />
            {hasTrendLine && (
              <Scatter
                name="Fitted Trend Line (OLS)"
                data={activeTrendLine}
                line={{ stroke: "#475569", strokeWidth: 2, strokeDasharray: "4 4" }}
                shape={() => null}
                isAnimationActive={false}
              />
            )}
          </ScatterChart>
        </ResponsiveContainer>
      </div>

      {/* Legend & Analytical Footnote Strip */}
      <div className="border-t border-slate-100 pt-2 text-[11px] text-slate-500 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-4">
          <span className="flex items-center gap-1.5">
            <span className="inline-block size-2 rounded-full bg-blue-600" />
            <span>Paired Observations</span>
          </span>
          {hasTrendLine && regression && (
            <span className="flex items-center gap-1.5 font-mono text-[10px]">
              <span className="inline-block h-0.5 w-3 border-t border-dashed border-slate-600" />
              <span>
                OLS Fit: y = {fmt(regression.intercept, 2)} + {fmt(regression.slope, 2)}·x
                {regression.rSquared !== null && regression.rSquared !== undefined && (
                  <span className="text-slate-400"> (R² = {fmt(regression.rSquared, 3)})</span>
                )}
              </span>
            </span>
          )}
        </div>
        <div className="text-[10px] text-slate-400 italic">
          Linear trendline for reference; correlation does not imply causation.
        </div>
      </div>

      {/* Downsampling or custom caption note */}
      {isDownsampled && (
        <figcaption className="text-[10px] text-slate-400">
          Showing {displayPoints.length.toLocaleString()} sampled points from {points.length.toLocaleString()}{" "}
          observations for browser rendering efficiency. Full sample used in calculations.
        </figcaption>
      )}
      {caption && <figcaption className="text-[11px] text-slate-600">{caption}</figcaption>}

      {/* Accessible screen reader summary */}
      <div className="sr-only">
        Bivariate scatter plot comparing {yLabel} against {xLabel} across {n} paired observations.
        {r !== undefined && r !== null
          ? `${method === "spearman" ? "Spearman" : "Pearson"} r = ${r.toFixed(3)}.`
          : ""}
      </div>
    </figure>
  );
}

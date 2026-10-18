import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { FrequencyRow, HistogramBin } from "@/lib/stats/descriptive";

const axis = { fontSize: 11, fill: "var(--color-muted-foreground)" };

export function HistogramChart({ bins, column }: { bins: HistogramBin[]; column: string }) {
  return (
    <figure aria-label={`Histogram of ${column}`}>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={bins} margin={{ top: 8, right: 8, bottom: 28, left: 4 }} barCategoryGap={1}>
            <CartesianGrid vertical={false} stroke="var(--color-border)" />
            <XAxis dataKey="label" tick={axis} interval={0} angle={-30} textAnchor="end" height={50}
              label={{ value: column, position: "insideBottom", offset: -22, ...axis }} />
            <YAxis allowDecimals={false} tick={axis} width={40}
              label={{ value: "Count", angle: -90, position: "insideLeft", ...axis }} />
            <Tooltip cursor={{ fill: "var(--color-muted)" }} contentStyle={{ fontSize: 12, borderRadius: 6 }} />
            <Bar dataKey="count" name="Count" fill="var(--color-chart-1)" isAnimationActive={false} />
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
            <XAxis dataKey="value" tick={axis} interval={0} angle={-30} textAnchor="end" height={50}
              label={{ value: column, position: "insideBottom", offset: -22, ...axis }} />
            <YAxis allowDecimals={false} tick={axis} width={40}
              label={{ value: "Count", angle: -90, position: "insideLeft", ...axis }} />
            <Tooltip cursor={{ fill: "var(--color-muted)" }} contentStyle={{ fontSize: 12, borderRadius: 6 }} />
            <Bar dataKey="count" name="Count" fill="var(--color-chart-1)" isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      {rows.length > 15 && (
        <figcaption className="text-[12px] text-muted-foreground">Showing the 15 most frequent of {rows.length} categories.</figcaption>
      )}
    </figure>
  );
}

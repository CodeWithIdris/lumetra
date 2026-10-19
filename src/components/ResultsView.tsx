import type { DescriptiveReport } from "@/lib/stats/analysis";
import { fmt } from "@/lib/stats/descriptive";
import { FrequencyChart, HistogramChart } from "./Charts";

const th = "px-3 py-2 text-left font-medium text-muted-foreground";
const td = "px-3 py-1.5";

export function NumericTable({ report }: { report: DescriptiveReport }) {
  if (report.numeric.length === 0) return <p className="text-[13px] text-muted-foreground">No numeric columns selected.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead className="border-b bg-muted/50">
          <tr>
            <th className={th}>Column</th>
            {["n", "Missing", "Mean", "Median", "Min", "Max", "SD (n−1)"].map((h) => (
              <th key={h} className={`${th} text-right`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {report.numeric.map(({ column, summary: s }) => (
            <tr key={column} className="border-b last:border-0">
              <td className={`${td} font-medium`}>{column}</td>
              {[s.n, s.missing, s.mean, s.median, s.min, s.max, s.sd].map((v, i) => (
                <td key={i} className={`${td} num text-right`}>{fmt(v)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function FrequencyTable({ column, rows, missing }: { column: string; rows: DescriptiveReport["categorical"][number]["rows"]; missing: number }) {
  return (
    <table className="w-full text-[13px]" aria-label={`Frequencies of ${column}`}>
      <thead className="border-b bg-muted/50">
        <tr>
          <th className={th}>{column}</th>
          <th className={`${th} text-right`}>Count</th>
          <th className={`${th} text-right`}>% of non-missing</th>
        </tr>
      </thead>
      <tbody>
        {rows.slice(0, 25).map((r) => (
          <tr key={r.value} className="border-b">
            <td className={td}>{r.value}</td>
            <td className={`${td} num text-right`}>{r.count}</td>
            <td className={`${td} num text-right`}>{fmt(r.pct, 1)}%</td>
          </tr>
        ))}
        {missing > 0 && (
          <tr className="text-muted-foreground">
            <td className={`${td} italic`}>(missing)</td>
            <td className={`${td} num text-right`}>{missing}</td>
            <td className={`${td} text-right`}>—</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

export function ResultsView({ report, charts = true }: { report: DescriptiveReport; charts?: boolean }) {
  return (
    <div className="space-y-6">
      <section className="panel p-4">
        <h3 className="eyebrow mb-2">Summary</h3>
        <ul className="list-disc space-y-1 pl-5 text-[13px] leading-relaxed">
          {report.summary.map((s, i) => <li key={i}>{s}</li>)}
        </ul>
      </section>
      <section className="panel">
        <h3 className="eyebrow border-b px-4 py-3">Numeric columns</h3>
        <NumericTable report={report} />
      </section>
      {charts && report.numeric.filter((n) => n.bins.length).length > 0 && (
        <section className="grid gap-4 md:grid-cols-2">
          {report.numeric.filter((n) => n.bins.length).map((n) => (
            <div key={n.column} className="panel p-4">
              <h4 className="mb-2 text-[13px] font-medium">Distribution of {n.column}</h4>
              <HistogramChart bins={n.bins} column={n.column} />
            </div>
          ))}
        </section>
      )}
      {report.categorical.length > 0 && (
        <section className="grid gap-4 md:grid-cols-2">
          {report.categorical.map((c) => (
            <div key={c.column} className="panel p-4">
              <h4 className="mb-2 text-[13px] font-medium">{c.column}</h4>
              {charts && <FrequencyChart rows={c.rows} column={c.column} />}
              <FrequencyTable column={c.column} rows={c.rows} missing={c.missing} />
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

export function MethodNote() {
  return (
    <div className="space-y-1.5 text-[12.5px] leading-relaxed text-muted-foreground">
      <p><strong className="text-foreground">Missing values</strong> (blank cells and NA, N/A, NULL, NaN, #N/A) are excluded from every calculation. They are never treated as zero.</p>
      <p><strong className="text-foreground">Mean</strong> is the arithmetic mean. <strong className="text-foreground">Median</strong> is the middle value; for an even count it is the average of the two middle values.</p>
      <p><strong className="text-foreground">Standard deviation</strong> is the sample SD (divisor n − 1), computed with Welford's algorithm. It is undefined when n &lt; 2.</p>
      <p><strong className="text-foreground">Histograms</strong> use equal-width bins; the number of bins follows Sturges' rule (⌈log₂ n⌉ + 1). Each bin includes its lower edge; the last also includes the maximum. Whole-number columns spanning 30 or fewer values get one bar per value instead.</p>
      <p><strong className="text-foreground">Frequencies</strong> are percentages of non-missing values, sorted by count.</p>
    </div>
  );
}

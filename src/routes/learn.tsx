import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/AppShell";
import { pageMeta } from "@/lib/meta";

export const Route = createFileRoute("/learn")({
  head: () =>
    pageMeta(
      "Learn",
      "Short, practical guides to datasets, data quality, descriptive statistics and responsible interpretation.",
    ),
  component: Learn,
});

const TOPICS = [
  [
    "Understanding datasets",
    "A dataset is a structured table: each row represents an individual observation (a user, a server node, a transaction) and each column records a distinct measured variable. Before statistical modeling, verify row uniformity and column schema coherence.",
  ],
  [
    "Missing values and data quality",
    "Blank cells are not zeros. A missing latency, income, or response is unknown, not nothing. Lumetra strictly excludes missing values and audits gaps, allowing you to evaluate potential attrition or reporting bias.",
  ],
  [
    "Descriptive statistics & moments",
    "The arithmetic mean measures central tendency; the median marks the 50th percentile. When they diverge significantly, heavy-tailed outliers are pulling the distribution. Lumetra applies Bessel's correction (divisor n − 1) for sample standard deviations.",
  ],
  [
    "Interpreting distributions & charts",
    "A histogram segments numeric values into contiguous bins according to Sturges' rule. Inspect shape, skewness, and multimodal clusters. Bar charts evaluate discrete category frequencies and always start from baseline zero.",
  ],
  [
    "Correlation versus causation",
    "Strong Pearson or Spearman correlation coefficients indicate statistical association, not causal mechanics. Confounders or temporal artifacts often drive apparent relationships without an experimental design.",
  ],
  [
    "Responsible analytical reporting",
    "Always state sample size (n), missing value rates, and degrees of freedom alongside every figure. Avoid inflating marginal effects, acknowledge analytical limitations, and preserve raw data for reproducibility.",
  ],
] as const;

function Learn() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Learn & Statistical Methods"
        description="Core principles for rigorous dataset auditing, statistical inference, and responsible interpretation."
      />
      <div className="grid gap-4 md:grid-cols-2">
        {TOPICS.map(([t, body], i) => (
          <article key={t} className="rounded-md border border-slate-200 bg-white p-5 shadow-2xs">
            <div className="font-mono text-xs font-bold text-blue-600">0{i + 1}</div>
            <h2 className="mt-1.5 text-sm font-semibold text-slate-900">{t}</h2>
            <p className="mt-2 text-xs leading-relaxed text-slate-600">{body}</p>
          </article>
        ))}
      </div>
    </div>
  );
}

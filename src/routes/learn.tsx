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
    "A dataset is a table: each row is one observation (a person, a sale, a day) and each column is one variable measured for it. Before analysing, check that every row means the same kind of thing and that each column holds one kind of value.",
  ],
  [
    "Missing values and data quality",
    "Blank cells are not zeros. A missing income is unknown, not nothing. Lumetra excludes missing values and reports how many there are, so you can judge whether gaps might bias results — for example, if higher earners skipped the question.",
  ],
  [
    "Descriptive statistics",
    "The mean is the average; the median is the middle value. When they differ a lot, a few extreme values are pulling the mean. The standard deviation measures typical spread around the mean. Lumetra uses the sample standard deviation (dividing by n − 1), which is standard when your data is a sample from a larger group.",
  ],
  [
    "Interpreting charts",
    "A histogram groups numbers into equal-width ranges and shows how many fall in each. Look at its shape: one peak or several, symmetric or stretched to one side. A bar chart shows counts of categories; check the axis starts at zero and read the actual counts, not just bar heights.",
  ],
  [
    "Correlation versus causation",
    "Two variables moving together does not mean one causes the other. Both may be driven by a third factor, or the link may be chance. Establishing cause usually needs an experiment or a carefully designed study.",
  ],
  [
    "Responsible use of results",
    "Report the method, the sample size and missing data alongside every figure. Avoid overstating small differences, do not generalise beyond who was actually measured, and keep the original data so others can check your work.",
  ],
] as const;

function Learn() {
  return (
    <>
      <PageHeader
        title="Learn"
        description="Concise guidance for reading data and results carefully."
      />
      <div className="grid gap-4 md:grid-cols-2">
        {TOPICS.map(([t, body], i) => (
          <article key={t} className="panel p-5">
            <div className="num text-[11px] text-primary">0{i + 1}</div>
            <h2 className="mt-1 font-medium">{t}</h2>
            <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">{body}</p>
          </article>
        ))}
      </div>
    </>
  );
}

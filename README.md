# Lumetra

An open-source data intelligence workspace: turn raw data into reliable, understandable, defensible insights. Status: **early foundation (v0.1), not production-ready.** Licence not yet chosen.

## Current capabilities
- CSV import (UTF-8, ≤20 MB, ≤200k rows) parsed in the browser with PapaParse; validation for empty/binary/malformed rows, duplicate headers, encoding issues and spreadsheet-formula content.
- Dataset inspection: inferred types (numeric/categorical/date/text/empty) with explanations, missing counts and %, searchable paginated rows.
- Descriptive statistics: n, missing, mean, median, min, max, sample SD (n−1, Welford); frequency tables; histograms (Sturges) and bar charts; deterministic text summary; CSV export (formula-escaped).
- Report preview (print to PDF via browser). Local projects in localStorage (datasets ≤2 MB stored).
- Synthetic, seeded sample dataset.

- **Ask**: an AI assistant (Lovable AI) answers questions by calling local analysis tools — descriptives, percentiles, group aggregates, Pearson/Spearman correlation, OLS regression, Welch t-test, one-way ANOVA, chi-square crosstabs, IQR outliers. Tools run in the browser; only schema, ≤20 sample rows, questions and results are sent.

Planned (labelled in-app, not implemented): Excel import, cross-tabs, correlation, group comparisons, PDF/Word export, dark theme.

## Setup
```
bun install
bun run dev
bunx vitest run
```

## Structure
- `src/lib/data` — parsing, type inference, export, sample data
- `src/lib/stats` — pure statistical computation and summaries
- `src/lib/persistence` — local storage
- `src/lib/store.tsx` — app state
- `src/components`, `src/routes` — UI

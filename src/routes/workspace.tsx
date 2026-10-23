import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { EmptyState, Notice, PageHeader } from "@/components/AppShell";
import { useStore } from "@/lib/store";
import { profileDataset } from "@/lib/data/infer";
import { fmt } from "@/lib/stats/descriptive";
import { pageMeta } from "@/lib/meta";
import { PERSONAS } from "@/lib/stats/personas";
import { toast } from "sonner";
import {
  Table2,
  FileSpreadsheet,
  AlertTriangle,
  CheckCircle2,
  Upload,
  RefreshCw,
  Trash2,
  ArrowRight,
  Search,
  Filter,
  Layers,
  Database,
  Info,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/workspace")({
  validateSearch: (s: Record<string, unknown>): { notice?: string } =>
    typeof s["notice"] === "string" ? { notice: s["notice"] } : {},
  head: () =>
    pageMeta(
      "Data Workspace",
      "Inspect spreadsheet preview, column schema and data quality before statistical analysis.",
    ),
  component: Workspace,
});

const PAGE_SIZE = 30;

const TYPE_BADGES: Record<string, { label: string; cls: string }> = {
  numeric: { label: "Numeric", cls: "bg-blue-50 text-blue-700 border-blue-200" },
  categorical: { label: "Categorical", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  date: { label: "Date/Time", cls: "bg-purple-50 text-purple-700 border-purple-200" },
  text: { label: "Text", cls: "bg-slate-100 text-slate-700 border-slate-200" },
  empty: { label: "Empty", cls: "bg-amber-50 text-amber-700 border-amber-200" },
};

function Workspace() {
  const { notice } = Route.useSearch();
  const {
    active,
    activeProject,
    loadFile,
    loadPersonaSample,
    clearDataset,
    saveAsProject,
    persona,
  } = useStore();

  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [query, setQuery] = useState("");
  const [selectedCol, setSelectedCol] = useState<string>("all");
  const [page, setPage] = useState(0);
  const [activeTab, setActiveTab] = useState<string>("data");

  const replace = () => (activeProject ? setConfirmReplace(true) : fileRef.current?.click());

  const ds = active?.dataset;
  const profiles = useMemo(() => (ds ? profileDataset(ds) : []), [ds]);

  // Total missing values across entire dataset
  const totalMissing = useMemo(
    () => profiles.reduce((sum, p) => sum + p.missing, 0),
    [profiles],
  );

  const totalCells = useMemo(
    () => (ds ? ds.rows.length * ds.columns.length : 0),
    [ds],
  );

  const completenessPct = useMemo(
    () => (totalCells > 0 ? ((totalCells - totalMissing) / totalCells) * 100 : 100),
    [totalCells, totalMissing],
  );

  // Cell search & column filtering
  const filteredRowIndices = useMemo(() => {
    if (!ds) return [];
    const q = query.trim().toLowerCase();
    const colIdx = selectedCol === "all" ? -1 : ds.columns.indexOf(selectedCol);

    return ds.rows
      .map((_, i) => i)
      .filter((rowIndex) => {
        const row = ds.rows[rowIndex]!;
        if (!q) return true;
        if (colIdx >= 0) {
          const val = row[colIdx];
          return val != null && val.toLowerCase().includes(q);
        }
        return row.some((c) => c !== null && c.toLowerCase().includes(q));
      });
  }, [ds, query, selectedCol]);

  const totalPages = Math.max(1, Math.ceil(filteredRowIndices.length / PAGE_SIZE));

  async function handle(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setErrors([]);
    const r = await loadFile(file);
    setBusy(false);
    setErrors(r.errors);
    setPage(0);
    setQuery("");
    if (fileRef.current) fileRef.current.value = "";
    if (!r.errors.length) navigate({ to: "/workspace", search: {} });
  }

  const picker = (
    <input
      ref={fileRef}
      type="file"
      accept=".csv,text/csv,.txt"
      className="sr-only"
      aria-label="Upload CSV file"
      onChange={(e) => handle(e.target.files?.[0])}
    />
  );

  const personaMeta = PERSONAS[persona];

  return (
    <>
      <PageHeader
        title="Data Workspace"
        description="Inspect tabular data, column data types, and null indicators. Client-side deterministic parsing."
        actions={
          ds && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs border-slate-300 text-slate-700 hover:bg-slate-50"
                onClick={replace}
              >
                Replace
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs border-slate-300 text-red-600 hover:bg-red-50 hover:border-red-200"
                onClick={() => setConfirmRemove(true)}
              >
                Clear
              </Button>
              <Button
                size="sm"
                className="h-8 text-xs bg-blue-600 text-white hover:bg-blue-700 font-medium"
                onClick={() => navigate({ to: "/analyses" })}
              >
                Run Analyses →
              </Button>
            </div>
          )
        }
      />
      {picker}

      <div className="space-y-6">
        {notice && <Notice tone="warning">{notice}</Notice>}
        {errors.length > 0 && (
          <Notice tone="error">
            <div className="font-semibold text-red-900">The file could not be loaded</div>
            <ul className="mt-1 list-disc pl-5 text-xs text-red-800">
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </Notice>
        )}

        {!ds ? (
          /* Clean, Purposeful CSV Dropzone */
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              handle(e.dataTransfer.files[0]);
            }}
            className={`flex flex-col items-center justify-center rounded-md border-2 border-dashed bg-white p-12 text-center transition-colors ${
              drag ? "border-blue-500 bg-blue-50/30" : "border-slate-300 hover:border-slate-400"
            }`}
          >
            <div className="flex size-12 items-center justify-center rounded bg-slate-100 text-slate-600">
              <FileSpreadsheet className="size-6 text-slate-600" />
            </div>

            <div className="mt-4">
              <div className="text-base font-semibold text-slate-900">
                Import CSV Dataset
              </div>
              <p className="mt-1 max-w-md text-xs text-slate-500 leading-relaxed">
                Drag and drop your CSV file here, or browse your local storage.
                Supports UTF-8 CSV files up to 50 MB with header names in the first row.
              </p>
            </div>

            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Button
                className="bg-blue-600 text-xs text-white hover:bg-blue-700 font-medium h-8 px-4"
                onClick={() => fileRef.current?.click()}
                disabled={busy}
              >
                {busy ? "Parsing..." : "Select CSV File"}
              </Button>
              <Button
                variant="outline"
                className="border-slate-300 text-xs text-slate-700 hover:bg-slate-50 font-medium h-8 px-4"
                onClick={() => loadPersonaSample(persona)}
              >
                Load {personaMeta.shortRole} Benchmark Sample
              </Button>
            </div>

            <div className="mt-4 text-[11px] text-slate-400 font-mono">
              Client-side in-memory execution • No unconsented cloud transfer
            </div>
          </div>
        ) : (
          <>
            {/* Compact Dataset Summary Strip */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              <div className="rounded border border-slate-200 bg-white p-3 shadow-2xs">
                <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400 font-semibold">
                  Dataset Name
                </div>
                <div className="mt-1 truncate font-semibold text-slate-900 text-xs" title={ds.name}>
                  {ds.name}
                </div>
              </div>
              <div className="rounded border border-slate-200 bg-white p-3 shadow-2xs">
                <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400 font-semibold">
                  Total Rows
                </div>
                <div className="mt-1 num font-mono font-semibold text-slate-900 text-xs">
                  {ds.rows.length.toLocaleString()}
                </div>
              </div>
              <div className="rounded border border-slate-200 bg-white p-3 shadow-2xs">
                <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400 font-semibold">
                  Columns
                </div>
                <div className="mt-1 num font-mono font-semibold text-slate-900 text-xs">
                  {ds.columns.length}
                </div>
              </div>
              <div className="rounded border border-slate-200 bg-white p-3 shadow-2xs">
                <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400 font-semibold">
                  Missing Cells
                </div>
                <div
                  className={`mt-1 num font-mono font-semibold text-xs ${
                    totalMissing > 0 ? "text-amber-700" : "text-emerald-700"
                  }`}
                >
                  {totalMissing.toLocaleString()}{" "}
                  <span className="text-[11px] font-normal text-slate-400">
                    ({fmt(100 - completenessPct, 1)}%)
                  </span>
                </div>
              </div>
              <div className="rounded border border-slate-200 bg-white p-3 shadow-2xs col-span-2 sm:col-span-1">
                <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400 font-semibold">
                  Memory Size
                </div>
                <div className="mt-1 num font-mono font-semibold text-slate-900 text-xs">
                  {fmt(ds.sizeBytes / 1024, 1)} KB
                </div>
              </div>
            </div>

            {/* Project Persistence Strip */}
            <div className="flex flex-col gap-2 rounded border border-slate-200 bg-white px-3.5 py-2.5 sm:flex-row sm:items-center sm:justify-between text-xs shadow-2xs">
              {activeProject ? (
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="size-4 text-emerald-600 shrink-0" />
                  <span className="text-slate-700">
                    Project record: <strong className="text-slate-900">{activeProject.name}</strong>{" "}
                    · Synced with Supabase
                  </span>
                </div>
              ) : (
                <form
                  className="flex w-full flex-col gap-2 sm:flex-row sm:items-center"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const p = saveAsProject(projectName);
                    if (p) toast.success(`Project “${p.name}” saved and synced.`);
                  }}
                >
                  <span className="text-slate-500 font-medium shrink-0">Unsaved Session:</span>
                  <Input
                    aria-label="Project name"
                    placeholder={`Name (default: ${ds.name})`}
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                    className="h-7 text-xs border-slate-300 sm:max-w-xs bg-white text-slate-900"
                  />
                  <Button
                    size="sm"
                    type="submit"
                    className="h-7 bg-blue-600 text-xs text-white hover:bg-blue-700 px-3 font-medium"
                  >
                    Save Project
                  </Button>
                </form>
              )}
            </div>

            {/* Workspace Secondary Tabs: Data Preview, Schema, Quality */}
            <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
              <TabsList className="border border-slate-200 bg-slate-100 p-0.5">
                <TabsTrigger
                  value="data"
                  className="text-xs px-3 py-1 data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-xs"
                >
                  <Table2 className="size-3.5 mr-1.5 text-slate-500" />
                  Data Preview
                </TabsTrigger>
                <TabsTrigger
                  value="schema"
                  className="text-xs px-3 py-1 data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-xs"
                >
                  <Layers className="size-3.5 mr-1.5 text-slate-500" />
                  Columns & Schema ({profiles.length})
                </TabsTrigger>
                <TabsTrigger
                  value="quality"
                  className="text-xs px-3 py-1 data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-xs"
                >
                  <AlertTriangle
                    className={`size-3.5 mr-1.5 ${totalMissing > 0 ? "text-amber-600" : "text-emerald-600"}`}
                  />
                  Data Quality & Nulls
                </TabsTrigger>
              </TabsList>

              {/* TAB 1: SPREADSHEET DATA PREVIEW */}
              <TabsContent value="data" className="space-y-3">
                {/* Search & Filter Toolbar */}
                <div className="flex flex-col gap-2 rounded-t-md border border-b-0 border-slate-200 bg-white p-2.5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-2 flex-1">
                    <div className="relative flex-1 sm:max-w-sm">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-slate-400" />
                      <Input
                        aria-label="Search rows"
                        placeholder="Search across cells…"
                        value={query}
                        onChange={(e) => {
                          setQuery(e.target.value);
                          setPage(0);
                        }}
                        className="h-8 pl-8 text-xs border-slate-300 text-slate-900 bg-white"
                      />
                    </div>

                    <select
                      value={selectedCol}
                      onChange={(e) => {
                        setSelectedCol(e.target.value);
                        setPage(0);
                      }}
                      className="h-8 rounded border border-slate-300 bg-white px-2.5 text-xs text-slate-700"
                      aria-label="Filter by column"
                    >
                      <option value="all">All Columns</option>
                      {ds.columns.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="text-[11px] font-mono text-slate-500">
                    Showing {filteredRowIndices.length.toLocaleString()} matching row(s)
                  </div>
                </div>

                {/* Spreadsheet Table */}
                <div className="rounded-b-md border border-slate-200 bg-white overflow-hidden shadow-2xs">
                  <div className="max-h-[500px] overflow-auto">
                    <table className="w-full text-xs text-left border-collapse">
                      <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 text-slate-700 font-mono">
                        <tr>
                          <th className="num w-12 px-3 py-2 text-center border-r border-slate-200 bg-slate-100 text-slate-400 font-normal">
                            #
                          </th>
                          {ds.columns.map((colName) => {
                            const profile = profiles.find((p) => p.name === colName);
                            const badge = profile ? TYPE_BADGES[profile.type] : undefined;
                            return (
                              <th
                                key={colName}
                                className="whitespace-nowrap px-3 py-2 border-r border-slate-200 last:border-r-0 font-medium"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span className="font-semibold text-slate-900">{colName}</span>
                                  {badge && (
                                    <span
                                      className={`rounded border px-1 py-0.2 text-[9px] font-normal ${badge.cls}`}
                                    >
                                      {badge.label}
                                    </span>
                                  )}
                                </div>
                              </th>
                            );
                          })}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-mono text-[12px]">
                        {filteredRowIndices
                          .slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)
                          .map((rowIndex) => (
                            <tr key={rowIndex} className="hover:bg-slate-50/70">
                              <td className="num px-3 py-1.5 text-center border-r border-slate-200 bg-slate-50/50 text-slate-400 text-[11px]">
                                {rowIndex + 1}
                              </td>
                              {ds.rows[rowIndex]!.map((cellVal, colIdx) => (
                                <td
                                  key={colIdx}
                                  className="max-w-[260px] truncate whitespace-nowrap px-3 py-1.5 border-r border-slate-100 last:border-r-0 text-slate-800"
                                >
                                  {cellVal === null ? (
                                    <span className="italic font-mono text-[10px] text-amber-700 bg-amber-50 px-1 py-0.5 rounded border border-amber-200">
                                      null
                                    </span>
                                  ) : (
                                    cellVal
                                  )}
                                </td>
                              ))}
                            </tr>
                          ))}
                      </tbody>
                    </table>

                    {filteredRowIndices.length === 0 && (
                      <div className="py-12 text-center text-xs text-slate-500">
                        No rows found matching “{query}”.
                      </div>
                    )}
                  </div>

                  {/* Spreadsheet Pagination Bar */}
                  <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-600">
                    <span className="font-mono text-[11px]">
                      Page {page + 1} of {totalPages} ({filteredRowIndices.length.toLocaleString()}{" "}
                      rows)
                    </span>
                    <div className="flex items-center gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs border-slate-300 px-2.5"
                        disabled={page === 0}
                        onClick={() => setPage(page - 1)}
                      >
                        Previous
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs border-slate-300 px-2.5"
                        disabled={page >= totalPages - 1}
                        onClick={() => setPage(page + 1)}
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                </div>
              </TabsContent>

              {/* TAB 2: COLUMNS & INFERRED SCHEMA */}
              <TabsContent value="schema" className="space-y-4">
                <div className="rounded-md border border-slate-200 bg-white overflow-hidden shadow-2xs">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-slate-200 bg-slate-50 text-slate-600 font-medium">
                        <tr>
                          <th className="px-4 py-2.5">Column Name</th>
                          <th className="px-4 py-2.5">Inferred Type</th>
                          <th className="px-4 py-2.5 text-right">Missing Count</th>
                          <th className="px-4 py-2.5 text-right">Missing %</th>
                          <th className="px-4 py-2.5 text-right">Distinct Values</th>
                          <th className="px-4 py-2.5">Inference Rationale</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {profiles.map((p) => {
                          const badge = TYPE_BADGES[p.type];
                          return (
                            <tr key={p.name} className="hover:bg-slate-50/80">
                              <td className="px-4 py-2.5 font-mono font-semibold text-slate-900">
                                {p.name}
                              </td>
                              <td className="px-4 py-2.5">
                                <span
                                  className={`rounded border px-1.5 py-0.5 text-[10px] font-mono ${badge?.cls}`}
                                >
                                  {badge?.label ?? p.type}
                                </span>
                              </td>
                              <td className="px-4 py-2.5 text-right font-mono text-xs">
                                {p.missing > 0 ? (
                                  <span className="text-amber-700 font-semibold">
                                    {p.missing.toLocaleString()}
                                  </span>
                                ) : (
                                  <span className="text-slate-400">0</span>
                                )}
                              </td>
                              <td className="px-4 py-2.5 text-right font-mono text-xs text-slate-600">
                                {fmt(p.missingPct, 1)}%
                              </td>
                              <td className="px-4 py-2.5 text-right font-mono text-xs text-slate-700">
                                {p.distinct.toLocaleString()}
                              </td>
                              <td className="px-4 py-2.5 text-slate-600 max-w-sm text-[11px] leading-relaxed">
                                {p.reason}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </TabsContent>

              {/* TAB 3: DATA QUALITY & NULL AUDIT */}
              <TabsContent value="quality" className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="rounded border border-slate-200 bg-white p-4 shadow-2xs">
                    <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400 font-semibold">
                      Data Completeness
                    </div>
                    <div className="mt-1 num font-mono text-2xl font-bold text-slate-900">
                      {fmt(completenessPct, 1)}%
                    </div>
                    <p className="mt-1 text-[11px] text-slate-500">
                      {totalMissing === 0
                        ? "Zero missing cells detected. Clean complete matrix."
                        : `${totalMissing.toLocaleString()} null entries across ${totalCells.toLocaleString()} data cells.`}
                    </p>
                  </div>

                  <div className="rounded border border-slate-200 bg-white p-4 shadow-2xs">
                    <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400 font-semibold">
                      Null Coercion Policy
                    </div>
                    <div className="mt-1 text-xs font-semibold text-emerald-700">
                      Excluded (Never Coerced to Zero)
                    </div>
                    <p className="mt-1 text-[11px] text-slate-500">
                      Guaranteed correctness: missing income or response is treated as unknown, not zero.
                    </p>
                  </div>

                  <div className="rounded border border-slate-200 bg-white p-4 shadow-2xs">
                    <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400 font-semibold">
                      Incomplete Columns
                    </div>
                    <div className="mt-1 num font-mono text-2xl font-bold text-slate-900">
                      {profiles.filter((p) => p.missing > 0).length} / {profiles.length}
                    </div>
                    <p className="mt-1 text-[11px] text-slate-500">
                      Columns with one or more missing or unparsable values.
                    </p>
                  </div>
                </div>

                {/* Quality Findings Table */}
                <div className="rounded-md border border-slate-200 bg-white p-4 shadow-2xs space-y-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-700 font-mono">
                    Column-by-Column Null Audit
                  </h3>

                  {profiles.filter((p) => p.missing > 0).length === 0 ? (
                    <div className="flex items-center gap-2 rounded border border-emerald-200 bg-emerald-50/60 p-3 text-xs text-emerald-800">
                      <CheckCircle2 className="size-4 text-emerald-600 shrink-0" />
                      <span>
                        Excellent data health! No missing values or irregular blank records found in
                        this dataset.
                      </span>
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100 border border-slate-200 rounded overflow-hidden">
                      {profiles
                        .filter((p) => p.missing > 0)
                        .map((p) => (
                          <div
                            key={p.name}
                            className="flex items-center justify-between p-3 text-xs hover:bg-slate-50"
                          >
                            <div className="min-w-0">
                              <span className="font-mono font-semibold text-slate-900">
                                {p.name}
                              </span>
                              <span className="ml-2 text-slate-500 text-[11px]">
                                ({p.type} column)
                              </span>
                              <div className="text-[11px] text-slate-500 mt-0.5">
                                Reason: {p.reason}
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <span className="font-mono text-amber-700 font-bold">
                                {p.missing} missing ({fmt(p.missingPct, 1)}%)
                              </span>
                            </div>
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>

      {/* Confirmation Dialogs */}
      <AlertDialog open={confirmReplace} onOpenChange={setConfirmReplace}>
        <AlertDialogContent className="bg-white text-slate-900 border-slate-200">
          <AlertDialogHeader>
            <AlertDialogTitle>Replace dataset in “{activeProject?.name}”?</AlertDialogTitle>
            <AlertDialogDescription className="text-xs text-slate-600">
              The replacement file will be updated in your project session and synced to Supabase
              Cloud. Previous analysis caches will be recomputed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-slate-300 text-xs text-slate-700 hover:bg-slate-50">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-blue-600 text-xs text-white hover:bg-blue-700"
              onClick={() => fileRef.current?.click()}
            >
              Choose Replacement File
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <AlertDialogContent className="bg-white text-slate-900 border-slate-200">
          <AlertDialogHeader>
            <AlertDialogTitle>Clear active dataset?</AlertDialogTitle>
            <AlertDialogDescription className="text-xs text-slate-600">
              {activeProject
                ? `Data will be cleared from “${activeProject.name}”. The project definition remains saved in Supabase.`
                : "This unsaved session will be cleared from memory."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-slate-300 text-xs text-slate-700 hover:bg-slate-50">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-xs text-white hover:bg-red-700"
              onClick={() => {
                clearDataset();
                setErrors([]);
              }}
            >
              Clear Dataset
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

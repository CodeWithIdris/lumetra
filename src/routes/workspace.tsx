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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState, Notice, PageHeader } from "@/components/AppShell";
import { useStore } from "@/lib/store";
import { columnValues, profileDataset, isNumeric } from "@/lib/data/infer";
import { fmt, describe, frequencies, toNumbers, type NumericSummary } from "@/lib/stats/descriptive";
import { parseCsvFile, parseCsvText } from "@/lib/data/parse";
import {
  auditDataset,
  countDuplicateRows,
  type CleaningStepType,
  type FilterOperator,
  type MissingStrategy,
} from "@/lib/data/clean";
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
  Wand2,
  Undo2,
  RotateCcw,
  Plus,
  HelpCircle,
  Eye,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Dataset, ParseResult } from "@/lib/data/types";

export const Route = createFileRoute("/workspace")({
  validateSearch: (s: Record<string, unknown>): { notice?: string } =>
    typeof s["notice"] === "string" ? { notice: s["notice"] } : {},
  head: () =>
    pageMeta(
      "Data Workspace",
      "Inspect spreadsheet preview, column schema, data cleaning and quality audit.",
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
    rawDataset,
    cleaningSteps,
    applyCleaning,
    undoCleaning,
    resetCleaning,
    loadFile,
    loadPersonaSample,
    clearDataset,
    saveAsProject,
    persona,
    saveState,
    lastSaveError,
  } = useStore();

  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [confirmResetCleaning, setConfirmResetCleaning] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [query, setQuery] = useState("");
  const [selectedCol, setSelectedCol] = useState<string>("all");
  const [page, setPage] = useState(0);
  const [activeTab, setActiveTab] = useState<string>("data");

  // Import Preview Modal State
  const [pendingImport, setPendingImport] = useState<{
    file: File;
    dataset: Dataset;
    csv: string;
  } | null>(null);

  // Cleaning tool state
  const [cleaningOp, setCleaningOp] = useState<CleaningStepType>("handle_missing");
  const [cleanCol, setCleanCol] = useState<string>("");
  const [cleanNewName, setCleanNewName] = useState<string>("");
  const [cleanColsToRemove, setCleanColsToRemove] = useState<string[]>([]);
  const [cleanFilterOp, setCleanFilterOp] = useState<FilterOperator>("equals");
  const [cleanFilterVal, setCleanFilterVal] = useState<string>("");
  const [cleanMissingStrategy, setCleanMissingStrategy] = useState<MissingStrategy>("drop_rows");
  const [cleanMissingCustomVal, setCleanMissingCustomVal] = useState<string>("");
  const [cleanRecodeFrom, setCleanRecodeFrom] = useState<string>("");
  const [cleanRecodeTo, setCleanRecodeTo] = useState<string>("");

  const replace = () => (activeProject ? setConfirmReplace(true) : fileRef.current?.click());

  const ds = active?.dataset;
  const audit = useMemo(() => (ds ? auditDataset(ds) : null), [ds]);
  const profiles = useMemo(() => audit?.profiles ?? (ds ? profileDataset(ds) : []), [audit, ds]);

  // Selected column for detailed inspection in Schema tab
  const [inspectCol, setInspectCol] = useState<string | null>(null);
  const inspectedProfile = useMemo(
    () => profiles.find((p) => p.name === inspectCol) ?? profiles[0] ?? null,
    [profiles, inspectCol],
  );

  const inspectedStats = useMemo(() => {
    if (!ds || !inspectedProfile) return null;
    const values = columnValues(ds, inspectedProfile.index);
    if (inspectedProfile.type === "numeric") {
      const { nums, missing, invalid } = toNumbers(values);
      return { type: "numeric" as const, summary: describe(nums, missing, invalid) };
    }
    const freq = frequencies(values);
    return { type: "categorical" as const, frequencies: freq };
  }, [ds, inspectedProfile]);

  const totalMissing = audit?.missingCells ?? 0;
  const totalCells = audit?.totalCells ?? 0;
  const completenessPct = audit ? 100 - audit.missingPct : 100;
  const duplicateRows = audit?.duplicateRowsCount ?? 0;

  // Search & Filter
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

  async function handleFileSelect(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setErrors([]);
    try {
      const { result, text } = await parseCsvFile(file);
      setBusy(false);
      if (!result.ok) {
        setErrors(result.errors);
        return;
      }
      // Show Preview modal before committing
      setPendingImport({ file, dataset: result.dataset, csv: text });
    } catch (e) {
      setBusy(false);
      setErrors([e instanceof Error ? e.message : "Failed to read file."]);
    }
    if (fileRef.current) fileRef.current.value = "";
  }

  async function commitPendingImport() {
    if (!pendingImport) return;
    setBusy(true);
    const r = await loadFile(pendingImport.file);
    setBusy(false);
    setPendingImport(null);
    if (r.errors.length) {
      setErrors(r.errors);
    } else {
      setPage(0);
      setQuery("");
      toast.success(`Imported "${pendingImport.dataset.name}" (${pendingImport.dataset.rows.length.toLocaleString()} rows).`);
      navigate({ to: "/workspace", search: {} });
    }
  }

  const picker = (
    <input
      ref={fileRef}
      type="file"
      accept=".csv,text/csv,.txt"
      className="sr-only"
      aria-label="Upload CSV file"
      onChange={(e) => handleFileSelect(e.target.files?.[0])}
    />
  );

  const handleApplyClean = () => {
    if (!ds) return;
    let res: { success: boolean; error?: string };

    switch (cleaningOp) {
      case "rename_column":
        if (!cleanCol || !cleanNewName.trim()) {
          toast.error("Please specify both current column and new name.");
          return;
        }
        res = applyCleaning("rename_column", { from: cleanCol, to: cleanNewName.trim() });
        break;
      case "remove_columns":
        if (cleanColsToRemove.length === 0) {
          toast.error("Select at least one column to remove.");
          return;
        }
        res = applyCleaning("remove_columns", { columns: cleanColsToRemove });
        setCleanColsToRemove([]);
        break;
      case "remove_duplicates":
        res = applyCleaning("remove_duplicates", {});
        break;
      case "filter_rows":
        if (!cleanCol) {
          toast.error("Please choose a column to filter on.");
          return;
        }
        res = applyCleaning("filter_rows", {
          column: cleanCol,
          operator: cleanFilterOp,
          value: cleanFilterVal,
        });
        break;
      case "handle_missing":
        if (!cleanCol) {
          toast.error("Please choose a column.");
          return;
        }
        res = applyCleaning("handle_missing", {
          column: cleanCol,
          strategy: cleanMissingStrategy,
          customValue: cleanMissingCustomVal,
        });
        break;
      case "recode_categorical":
        if (!cleanCol || !cleanRecodeFrom.trim() || !cleanRecodeTo.trim()) {
          toast.error("Please specify column, original value and replacement value.");
          return;
        }
        res = applyCleaning("recode_categorical", {
          column: cleanCol,
          fromValue: cleanRecodeFrom.trim(),
          toValue: cleanRecodeTo.trim(),
        });
        break;
      default:
        res = { success: false, error: "Unsupported operation." };
    }

    if (res.success) {
      toast.success("Transformation applied successfully.");
    } else {
      toast.error(res.error || "Failed to apply transformation.");
    }
  };

  const personaMeta = PERSONAS[persona];

  return (
    <>
      <PageHeader
        title="Data Workspace"
        description="Inspect tabular data, column schema, missing values, and execute reversible data cleaning transformations."
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
        {saveState === "error" && lastSaveError && (
          <Notice tone="error">
            <div className="font-semibold text-red-900">Storage Notice</div>
            <p className="text-xs text-red-800">{lastSaveError}</p>
          </Notice>
        )}
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
          /* Clean CSV Dropzone with clear file-size disclosure */
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              handleFileSelect(e.dataTransfer.files[0]);
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
                Drag and drop your CSV file here, or browse local files.
                Supports UTF-8 CSV with column headers in row 1.
                Browser memory limit is <strong>20 MB</strong> for optimal client-side performance.
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
              Client-side in-memory execution • No unconsented cloud transfer • Maximum 20 MB
            </div>
          </div>
        ) : (
          <>
            {/* Unified Dataset Summary & Persistence Strip */}
            <div className="rounded border border-slate-200 bg-white p-3 shadow-2xs space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="flex flex-wrap items-center gap-4">
                  <div>
                    <span className="text-[11px] font-medium text-slate-400">Dataset: </span>
                    <span className="font-semibold text-slate-900">{ds.name}</span>
                  </div>
                  <div className="h-3 w-px bg-slate-200 hidden sm:block" />
                  <div>
                    <span className="text-[11px] font-medium text-slate-400">Rows: </span>
                    <span className="num font-mono font-semibold text-slate-900">
                      {ds.rows.length.toLocaleString()}
                    </span>
                    {rawDataset && rawDataset.rows.length !== ds.rows.length && (
                      <span className="ml-1 text-[10px] text-slate-400 font-normal">
                        (orig: {rawDataset.rows.length.toLocaleString()})
                      </span>
                    )}
                  </div>
                  <div className="h-3 w-px bg-slate-200 hidden sm:block" />
                  <div>
                    <span className="text-[11px] font-medium text-slate-400">Columns: </span>
                    <span className="num font-mono font-semibold text-slate-900">{ds.columns.length}</span>
                  </div>
                  <div className="h-3 w-px bg-slate-200 hidden sm:block" />
                  <div>
                    <span className="text-[11px] font-medium text-slate-400">Missing: </span>
                    <span
                      className={`num font-mono font-semibold ${
                        totalMissing > 0 ? "text-amber-700" : "text-emerald-700"
                      }`}
                    >
                      {totalMissing.toLocaleString()}{" "}
                      <span className="text-[11px] font-normal text-slate-400">
                        ({fmt(100 - completenessPct, 1)}%)
                      </span>
                    </span>
                  </div>
                  <div className="h-3 w-px bg-slate-200 hidden sm:block" />
                  <div>
                    <span className="text-[11px] font-medium text-slate-400">Duplicates: </span>
                    <span className={`num font-mono font-semibold ${duplicateRows > 0 ? "text-amber-700" : "text-slate-700"}`}>
                      {duplicateRows}
                    </span>
                  </div>
                </div>

                {/* Project Persistence Control */}
                <div className="flex items-center gap-2">
                  {activeProject ? (
                    <div className="flex items-center gap-1.5 text-[11px] text-slate-600">
                      <CheckCircle2 className="size-3.5 text-emerald-600 shrink-0" />
                      <span>
                        Project: <strong className="text-slate-800">{activeProject.name}</strong>
                      </span>
                    </div>
                  ) : (
                    <form
                      className="flex items-center gap-1.5"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const p = saveAsProject(projectName);
                        if (p) toast.success(`Project “${p.name}” saved and synced.`);
                      }}
                    >
                      <Input
                        aria-label="Project name"
                        placeholder={`Name (default: ${ds.name})`}
                        value={projectName}
                        onChange={(e) => setProjectName(e.target.value)}
                        className="h-7 text-xs border-slate-300 w-44 bg-white text-slate-900"
                      />
                      <Button
                        size="sm"
                        type="submit"
                        className="h-7 bg-blue-600 text-xs text-white hover:bg-blue-700 px-2.5 font-medium"
                      >
                        Save Project
                      </Button>
                    </form>
                  )}
                </div>
              </div>

              {/* Cleaning History Ribbon if any steps applied */}
              {cleaningSteps.length > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2 text-[11px] bg-blue-50/50 -mx-3 -mb-2.5 p-2 px-3 rounded-b">
                  <div className="flex items-center gap-2">
                    <Wand2 className="size-3.5 text-blue-600" />
                    <span className="text-blue-900 font-medium">
                      Cleaned Analytical Dataset: {cleaningSteps.length} transformation(s) active.
                    </span>
                    <span className="text-slate-500">
                      Original raw dataset ({rawDataset?.rows.length ?? ds.rows.length} rows) is preserved in vault.
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={undoCleaning}
                      className="h-6 text-[10px] text-blue-700 hover:bg-blue-100/60 px-2"
                    >
                      <Undo2 className="size-3 mr-1" />
                      Undo Last
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setConfirmResetCleaning(true)}
                      className="h-6 text-[10px] text-red-600 hover:bg-red-50 px-2"
                    >
                      <RotateCcw className="size-3 mr-1" />
                      Reset to Raw
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {/* Workspace Secondary Tabs: Data Preview, Schema, Clean & Transform, Quality */}
            <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-3">
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
                  Columns & Summaries ({profiles.length})
                </TabsTrigger>
                <TabsTrigger
                  value="cleaning"
                  className="text-xs px-3 py-1 data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-xs"
                >
                  <Wand2 className="size-3.5 mr-1.5 text-blue-600" />
                  Clean & Transform
                  {cleaningSteps.length > 0 && (
                    <span className="ml-1.5 rounded-full bg-blue-100 text-blue-800 text-[10px] px-1.5 py-0.2 font-mono">
                      {cleaningSteps.length}
                    </span>
                  )}
                </TabsTrigger>
                <TabsTrigger
                  value="quality"
                  className="text-xs px-3 py-1 data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-xs"
                >
                  <AlertTriangle
                    className={`size-3.5 mr-1.5 ${totalMissing > 0 || duplicateRows > 0 ? "text-amber-600" : "text-emerald-600"}`}
                  />
                  Data Quality & Nulls
                </TabsTrigger>
              </TabsList>

              {/* TAB 1: SPREADSHEET DATA PREVIEW */}
              <TabsContent value="data" className="space-y-3">
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

              {/* TAB 2: COLUMNS, SCHEMA & SUMMARY INSPECTION */}
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
                          <th className="px-4 py-2.5 text-right">Inspection</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {profiles.map((p) => {
                          const badge = TYPE_BADGES[p.type];
                          const isSelected = (inspectCol ?? profiles[0]?.name) === p.name;
                          return (
                            <tr
                              key={p.name}
                              className={`cursor-pointer transition-colors ${
                                isSelected ? "bg-blue-50/60" : "hover:bg-slate-50"
                              }`}
                              onClick={() => setInspectCol(p.name)}
                            >
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
                              <td className="px-4 py-2.5 text-right">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 text-[11px] px-2 text-blue-600 hover:text-blue-800"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setInspectCol(p.name);
                                  }}
                                >
                                  <Eye className="size-3 mr-1" />
                                  Inspect
                                </Button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Column Detailed Summary Card */}
                {inspectedProfile && inspectedStats && (
                  <div className="rounded-md border border-slate-200 bg-white p-4 shadow-2xs space-y-3">
                    <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                      <div>
                        <span className="text-[10px] font-medium text-slate-400 font-mono">
                          Column Summary Inspector
                        </span>
                        <h4 className="text-sm font-bold text-slate-900 font-mono">
                          {inspectedProfile.name}{" "}
                          <span className="text-xs font-normal text-slate-500">
                            ({inspectedProfile.type})
                          </span>
                        </h4>
                      </div>
                      <span className="text-xs text-slate-500">
                        {inspectedProfile.nonMissing.toLocaleString()} non-missing • {inspectedProfile.distinct.toLocaleString()} distinct
                      </span>
                    </div>

                    {inspectedStats.type === "numeric" ? (
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-6 text-xs">
                        <div className="rounded border border-slate-100 bg-slate-50/50 p-2">
                          <div className="text-[10px] text-slate-500">Mean</div>
                          <div className="font-mono font-bold text-slate-900 mt-0.5">
                            {fmt(inspectedStats.summary.mean)}
                          </div>
                        </div>
                        <div className="rounded border border-slate-100 bg-slate-50/50 p-2">
                          <div className="text-[10px] text-slate-500">Median</div>
                          <div className="font-mono font-bold text-slate-900 mt-0.5">
                            {fmt(inspectedStats.summary.median)}
                          </div>
                        </div>
                        <div className="rounded border border-slate-100 bg-slate-50/50 p-2">
                          <div className="text-[10px] text-slate-500">Std Dev (s)</div>
                          <div className="font-mono font-bold text-slate-900 mt-0.5">
                            {fmt(inspectedStats.summary.sd)}
                          </div>
                        </div>
                        <div className="rounded border border-slate-100 bg-slate-50/50 p-2">
                          <div className="text-[10px] text-slate-500">Min</div>
                          <div className="font-mono font-bold text-slate-900 mt-0.5">
                            {fmt(inspectedStats.summary.min)}
                          </div>
                        </div>
                        <div className="rounded border border-slate-100 bg-slate-50/50 p-2">
                          <div className="text-[10px] text-slate-500">Max</div>
                          <div className="font-mono font-bold text-slate-900 mt-0.5">
                            {fmt(inspectedStats.summary.max)}
                          </div>
                        </div>
                        <div className="rounded border border-slate-100 bg-slate-50/50 p-2">
                          <div className="text-[10px] text-slate-500">Invalid / Text</div>
                          <div className="font-mono font-bold text-slate-900 mt-0.5">
                            {inspectedStats.summary.invalid}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <div className="text-[11px] font-medium text-slate-500">
                          Top Categories by Frequency:
                        </div>
                        <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-4">
                          {inspectedStats.frequencies.rows.slice(0, 8).map((r) => (
                            <div
                              key={r.value}
                              className="rounded border border-slate-100 bg-slate-50 p-2 text-xs flex items-center justify-between"
                            >
                              <span className="font-mono truncate max-w-[140px] text-slate-800">
                                {r.value || "<blank>"}
                              </span>
                              <span className="font-mono text-slate-600 font-medium">
                                {r.count} ({fmt(r.pct, 1)}%)
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </TabsContent>

              {/* TAB 3: CLEAN & TRANSFORM WORKFLOW */}
              <TabsContent value="cleaning" className="space-y-4">
                <div className="grid gap-4 md:grid-cols-[1fr_320px]">
                  {/* Clean Tool Configuration */}
                  <div className="rounded-md border border-slate-200 bg-white p-4 shadow-2xs space-y-4">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                        <Wand2 className="size-4 text-blue-600" />
                        <span>Data Cleaning Pipeline</span>
                      </h3>
                      <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                        Apply deterministic, reproducible transformations. The original imported data is never overwritten silently.
                      </p>
                    </div>

                    {/* Step selector */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-slate-700">Choose Cleaning Operation:</label>
                      <select
                        value={cleaningOp}
                        onChange={(e) => setCleaningOp(e.target.value as CleaningStepType)}
                        className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900"
                      >
                        <option value="handle_missing">Handle Missing / Null Values</option>
                        <option value="remove_duplicates">Remove Exact Duplicate Rows</option>
                        <option value="filter_rows">Filter Rows by Condition</option>
                        <option value="rename_column">Rename Column</option>
                        <option value="remove_columns">Remove Columns</option>
                        <option value="recode_categorical">Recode Categorical Value</option>
                      </select>
                    </div>

                    {/* Operation-specific inputs */}
                    {cleaningOp === "handle_missing" && (
                      <div className="space-y-3 rounded border border-slate-200 bg-slate-50/50 p-3">
                        <div className="grid gap-2 sm:grid-cols-2">
                          <div>
                            <label className="text-[11px] font-medium text-slate-600">Target Column:</label>
                            <select
                              value={cleanCol}
                              onChange={(e) => setCleanCol(e.target.value)}
                              className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900"
                            >
                              <option value="">Select column...</option>
                              <option value="all_columns">All Columns (Drop rows with any null)</option>
                              {ds.columns.map((c) => (
                                <option key={c} value={c}>
                                  {c}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="text-[11px] font-medium text-slate-600">Strategy:</label>
                            <select
                              value={cleanMissingStrategy}
                              onChange={(e) => setCleanMissingStrategy(e.target.value as MissingStrategy)}
                              className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900"
                            >
                              <option value="drop_rows">Drop rows with missing values</option>
                              <option value="fill_mean">Impute with Mean (Numeric columns)</option>
                              <option value="fill_median">Impute with Median (Numeric columns)</option>
                              <option value="fill_mode">Impute with Mode (Most frequent)</option>
                              <option value="fill_custom">Fill with Custom Value</option>
                            </select>
                          </div>
                        </div>

                        {cleanMissingStrategy === "fill_custom" && (
                          <div>
                            <label className="text-[11px] font-medium text-slate-600">Custom Replacement Value:</label>
                            <Input
                              placeholder="e.g. Unknown, 0, N/A"
                              value={cleanMissingCustomVal}
                              onChange={(e) => setCleanMissingCustomVal(e.target.value)}
                              className="mt-1 h-7 text-xs border-slate-300 bg-white"
                            />
                          </div>
                        )}
                      </div>
                    )}

                    {cleaningOp === "remove_duplicates" && (
                      <div className="rounded border border-slate-200 bg-slate-50/50 p-3 text-xs text-slate-700">
                        <p>
                          Detected <strong>{duplicateRows}</strong> exact duplicate row(s) in the dataset.
                        </p>
                        <p className="mt-1 text-slate-500 text-[11px]">
                          Applying this will keep the first occurrence of each unique row and remove identical subsequent rows.
                        </p>
                      </div>
                    )}

                    {cleaningOp === "filter_rows" && (
                      <div className="space-y-3 rounded border border-slate-200 bg-slate-50/50 p-3">
                        <div className="grid gap-2 sm:grid-cols-3">
                          <div>
                            <label className="text-[11px] font-medium text-slate-600">Column:</label>
                            <select
                              value={cleanCol}
                              onChange={(e) => setCleanCol(e.target.value)}
                              className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900"
                            >
                              <option value="">Select column...</option>
                              {ds.columns.map((c) => (
                                <option key={c} value={c}>
                                  {c}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="text-[11px] font-medium text-slate-600">Operator:</label>
                            <select
                              value={cleanFilterOp}
                              onChange={(e) => setCleanFilterOp(e.target.value as FilterOperator)}
                              className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900"
                            >
                              <option value="equals">Equals (=)</option>
                              <option value="not_equals">Does not equal (≠)</option>
                              <option value="greater_than">Greater than (&gt;)</option>
                              <option value="less_than">Less than (&lt;)</option>
                              <option value="contains">Contains text</option>
                              <option value="not_null">Is not null / present</option>
                              <option value="is_null">Is null / missing</option>
                            </select>
                          </div>
                          <div>
                            <label className="text-[11px] font-medium text-slate-600">Value:</label>
                            <Input
                              placeholder="Compare value"
                              value={cleanFilterVal}
                              onChange={(e) => setCleanFilterVal(e.target.value)}
                              className="mt-1 h-7 text-xs border-slate-300 bg-white"
                              disabled={cleanFilterOp === "is_null" || cleanFilterOp === "not_null"}
                            />
                          </div>
                        </div>
                      </div>
                    )}

                    {cleaningOp === "rename_column" && (
                      <div className="grid gap-2 sm:grid-cols-2 rounded border border-slate-200 bg-slate-50/50 p-3">
                        <div>
                          <label className="text-[11px] font-medium text-slate-600">Column to Rename:</label>
                          <select
                            value={cleanCol}
                            onChange={(e) => setCleanCol(e.target.value)}
                            className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900"
                          >
                            <option value="">Select column...</option>
                            {ds.columns.map((c) => (
                              <option key={c} value={c}>
                                {c}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="text-[11px] font-medium text-slate-600">New Column Name:</label>
                          <Input
                            placeholder="e.g. response_time_ms"
                            value={cleanNewName}
                            onChange={(e) => setCleanNewName(e.target.value)}
                            className="mt-1 h-7 text-xs border-slate-300 bg-white"
                          />
                        </div>
                      </div>
                    )}

                    {cleaningOp === "remove_columns" && (
                      <div className="space-y-2 rounded border border-slate-200 bg-slate-50/50 p-3">
                        <label className="text-[11px] font-medium text-slate-600">
                          Select Columns to Drop from Analytical Dataset:
                        </label>
                        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 max-h-36 overflow-y-auto">
                          {ds.columns.map((c) => {
                            const checked = cleanColsToRemove.includes(c);
                            return (
                              <label
                                key={c}
                                className="flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer p-1 rounded hover:bg-white"
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => {
                                    setCleanColsToRemove(
                                      checked
                                        ? cleanColsToRemove.filter((x) => x !== c)
                                        : [...cleanColsToRemove, c],
                                    );
                                  }}
                                  className="rounded border-slate-300"
                                />
                                <span className="font-mono truncate">{c}</span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {cleaningOp === "recode_categorical" && (
                      <div className="space-y-3 rounded border border-slate-200 bg-slate-50/50 p-3">
                        <div>
                          <label className="text-[11px] font-medium text-slate-600">Column:</label>
                          <select
                            value={cleanCol}
                            onChange={(e) => setCleanCol(e.target.value)}
                            className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900"
                          >
                            <option value="">Select column...</option>
                            {ds.columns.map((c) => (
                              <option key={c} value={c}>
                                {c}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2">
                          <div>
                            <label className="text-[11px] font-medium text-slate-600">Original Value:</label>
                            <Input
                              placeholder="e.g. Pending"
                              value={cleanRecodeFrom}
                              onChange={(e) => setCleanRecodeFrom(e.target.value)}
                              className="mt-1 h-7 text-xs border-slate-300 bg-white"
                            />
                          </div>
                          <div>
                            <label className="text-[11px] font-medium text-slate-600">Recode to:</label>
                            <Input
                              placeholder="e.g. Under Review"
                              value={cleanRecodeTo}
                              onChange={(e) => setCleanRecodeTo(e.target.value)}
                              className="mt-1 h-7 text-xs border-slate-300 bg-white"
                            />
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="flex justify-end pt-2">
                      <Button
                        size="sm"
                        onClick={handleApplyClean}
                        className="bg-blue-600 text-xs text-white hover:bg-blue-700 font-medium h-8 px-4"
                      >
                        Apply Transformation
                      </Button>
                    </div>
                  </div>

                  {/* Transformation Audit History Log */}
                  <div className="rounded-md border border-slate-200 bg-white p-4 shadow-2xs space-y-3">
                    <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                      <div className="font-semibold text-slate-900 text-xs flex items-center gap-1.5">
                        <Layers className="size-3.5 text-blue-600" />
                        <span>Applied Transformations</span>
                      </div>
                      <span className="font-mono text-[11px] text-slate-500">
                        {cleaningSteps.length} step(s)
                      </span>
                    </div>

                    {cleaningSteps.length === 0 ? (
                      <div className="py-8 text-center text-xs text-slate-400">
                        No transformations applied yet. Dataset is currently in original raw format.
                      </div>
                    ) : (
                      <div className="space-y-2 max-h-[360px] overflow-y-auto pr-1">
                        {cleaningSteps.map((s, idx) => (
                          <div
                            key={s.id}
                            className="rounded border border-slate-200 bg-slate-50/70 p-2 text-xs space-y-1"
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-semibold text-slate-800 text-[11px]">
                                {idx + 1}. {s.description}
                              </span>
                              <span className="font-mono text-[9px] text-slate-400">
                                {new Date(s.timestamp).toLocaleTimeString()}
                              </span>
                            </div>
                            <div className="text-[10px] text-slate-500 font-mono">
                              Rows: {s.effect.rowsBefore} → {s.effect.rowsAfter} | Nulls: {s.effect.missingBefore} → {s.effect.missingAfter}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {cleaningSteps.length > 0 && (
                      <div className="pt-2 flex items-center justify-between border-t border-slate-100">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={undoCleaning}
                          className="h-7 text-xs border-slate-300 text-slate-700"
                        >
                          <Undo2 className="size-3 mr-1" />
                          Undo Last Step
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setConfirmResetCleaning(true)}
                          className="h-7 text-xs text-red-600 hover:bg-red-50"
                        >
                          Reset All
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </TabsContent>

              {/* TAB 4: DATA QUALITY & NULL AUDIT */}
              <TabsContent value="quality" className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-4">
                  <div className="rounded border border-slate-200 bg-white p-3.5 shadow-2xs">
                    <div className="text-[11px] font-medium text-slate-500">
                      Data Completeness
                    </div>
                    <div className="mt-1 num font-mono text-xl font-bold text-slate-900">
                      {fmt(completenessPct, 1)}%
                    </div>
                    <p className="mt-1 text-[11px] text-slate-500 leading-snug">
                      {totalMissing === 0
                        ? "Zero missing cells detected. Clean complete matrix."
                        : `${totalMissing.toLocaleString()} null entries across ${totalCells.toLocaleString()} data cells.`}
                    </p>
                  </div>

                  <div className="rounded border border-slate-200 bg-white p-3.5 shadow-2xs">
                    <div className="text-[11px] font-medium text-slate-500">
                      Duplicate Rows
                    </div>
                    <div className="mt-1 num font-mono text-xl font-bold text-slate-900">
                      {duplicateRows.toLocaleString()}
                    </div>
                    <p className="mt-1 text-[11px] text-slate-500 leading-snug">
                      {duplicateRows === 0
                        ? "Zero exact duplicate rows detected."
                        : `${duplicateRows} duplicate record(s) can be removed in Clean & Transform.`}
                    </p>
                  </div>

                  <div className="rounded border border-slate-200 bg-white p-3.5 shadow-2xs">
                    <div className="text-[11px] font-medium text-slate-500">
                      Incomplete Columns
                    </div>
                    <div className="mt-1 num font-mono text-xl font-bold text-slate-900">
                      {profiles.filter((p) => p.missing > 0).length} / {profiles.length}
                    </div>
                    <p className="mt-1 text-[11px] text-slate-500 leading-snug">
                      Columns with one or more missing or unparsable values.
                    </p>
                  </div>

                  <div className="rounded border border-slate-200 bg-white p-3.5 shadow-2xs">
                    <div className="text-[11px] font-medium text-slate-500">
                      Null Coercion Policy
                    </div>
                    <div className="mt-1 text-sm font-semibold text-emerald-700">
                      Excluded (Never Coerced to Zero)
                    </div>
                    <p className="mt-1 text-[11px] text-slate-500 leading-snug">
                      Guaranteed correctness: missing values are excluded from denominators.
                    </p>
                  </div>
                </div>

                {/* Column-by-Column Null Audit */}
                <div className="rounded border border-slate-200 bg-white p-3.5 shadow-2xs space-y-2.5">
                  <h3 className="text-xs font-semibold text-slate-800">
                    Column-by-Column Quality & Null Audit
                  </h3>

                  {profiles.filter((p) => p.missing > 0).length === 0 ? (
                    <div className="flex items-center gap-2 rounded border border-emerald-200 bg-emerald-50/60 p-3 text-xs text-emerald-800">
                      <CheckCircle2 className="size-4 text-emerald-600 shrink-0" />
                      <span>
                        Excellent data health! No missing values or blank records found in this dataset.
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

      {/* Dataset Import Preview Modal (Requirement 2: preview before user commits import) */}
      <Dialog open={pendingImport !== null} onOpenChange={(o) => !o && setPendingImport(null)}>
        <DialogContent className="bg-white text-slate-900 border-slate-200 sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold flex items-center gap-2">
              <FileSpreadsheet className="size-4 text-blue-600" />
              <span>Import Dataset Preview: {pendingImport?.file.name}</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-600">
              Verify detected columns, types, and warnings before committing into memory.
            </DialogDescription>
          </DialogHeader>

          {pendingImport && (
            <div className="space-y-3 py-1 text-xs">
              <div className="grid grid-cols-3 gap-2 bg-slate-50 p-2.5 rounded border border-slate-200 font-mono text-[11px]">
                <div>
                  <span className="text-slate-400">Rows:</span> <strong>{pendingImport.dataset.rows.length.toLocaleString()}</strong>
                </div>
                <div>
                  <span className="text-slate-400">Columns:</span> <strong>{pendingImport.dataset.columns.length}</strong>
                </div>
                <div>
                  <span className="text-slate-400">File Size:</span> <strong>{(pendingImport.file.size / 1024).toFixed(1)} KB</strong>
                </div>
              </div>

              {pendingImport.dataset.warnings.length > 0 && (
                <div className="rounded border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900 space-y-1">
                  <div className="font-semibold flex items-center gap-1.5">
                    <AlertTriangle className="size-3.5 text-amber-700" />
                    <span>Import Warnings Detected:</span>
                  </div>
                  <ul className="list-disc pl-4 text-[11px] space-y-0.5">
                    {pendingImport.dataset.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Sample preview table */}
              <div className="border border-slate-200 rounded max-h-44 overflow-auto">
                <table className="w-full text-[11px] text-left border-collapse font-mono">
                  <thead className="bg-slate-100 text-slate-700 sticky top-0">
                    <tr>
                      {pendingImport.dataset.columns.map((c) => (
                        <th key={c} className="p-1.5 border-r border-slate-200 last:border-r-0 whitespace-nowrap">
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {pendingImport.dataset.rows.slice(0, 5).map((row, rIdx) => (
                      <tr key={rIdx}>
                        {row.map((cell, cIdx) => (
                          <td key={cIdx} className="p-1.5 border-r border-slate-100 last:border-r-0 whitespace-nowrap text-slate-700 truncate max-w-[140px]">
                            {cell === null ? <span className="text-amber-700 italic">null</span> : cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <DialogFooter className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 text-xs border-slate-300 text-slate-700"
              onClick={() => setPendingImport(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-8 bg-blue-600 text-xs text-white hover:bg-blue-700"
              onClick={commitPendingImport}
              disabled={busy}
            >
              {busy ? "Importing..." : "Commit Import"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

      <AlertDialog open={confirmResetCleaning} onOpenChange={setConfirmResetCleaning}>
        <AlertDialogContent className="bg-white text-slate-900 border-slate-200">
          <AlertDialogHeader>
            <AlertDialogTitle>Reset to original raw dataset?</AlertDialogTitle>
            <AlertDialogDescription className="text-xs text-slate-600">
              This will discard all {cleaningSteps.length} cleaning transformations and restore the raw
              imported CSV rows and columns.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-slate-300 text-xs text-slate-700 hover:bg-slate-50">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-xs text-white hover:bg-red-700"
              onClick={() => {
                resetCleaning();
                toast.success("Dataset reset to original raw state.");
              }}
            >
              Reset to Raw
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

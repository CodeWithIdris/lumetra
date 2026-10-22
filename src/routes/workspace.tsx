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
import { Cloud, UploadCloud, Database, Sparkles, CheckCircle2 } from "lucide-react";

export const Route = createFileRoute("/workspace")({
  validateSearch: (s: Record<string, unknown>): { notice?: string } =>
    typeof s["notice"] === "string" ? { notice: s["notice"] } : {},
  head: () =>
    pageMeta(
      "Data Workspace",
      "Upload a CSV, inspect columns, types and missing values before analysing.",
    ),
  component: Workspace,
});

const PAGE = 25;
const TYPE_STYLE: Record<string, string> = {
  numeric: "bg-indigo-500/20 text-indigo-300 border border-indigo-500/30",
  categorical: "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30",
  date: "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30",
  text: "bg-slate-800 text-slate-300 border border-slate-700",
  empty: "bg-amber-500/20 text-amber-300 border border-amber-500/30",
};

function Workspace() {
  const { notice } = Route.useSearch();
  const {
    active,
    activeProject,
    loadFile,
    loadSample,
    loadPersonaSample,
    clearDataset,
    saveAsProject,
    persona,
    user,
  } = useStore();

  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const replace = () => (activeProject ? setConfirmReplace(true) : fileRef.current?.click());
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);

  const ds = active?.dataset;
  const profiles = useMemo(() => (ds ? profileDataset(ds) : []), [ds]);
  const filtered = useMemo(() => {
    if (!ds) return [];
    const q = query.trim().toLowerCase();
    const idx = ds.rows.map((_, i) => i);
    return q
      ? idx.filter((i) => ds.rows[i]!.some((c) => c !== null && c.toLowerCase().includes(q)))
      : idx;
  }, [ds, query]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));

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
        description="Private in-browser parsing with Supabase Cloud backup redundancy. No data is sent to external AI servers without explicit prompt."
        actions={
          ds && (
            <>
              <Button
                variant="outline"
                className="border-white/10 text-xs text-white hover:bg-white/10"
                onClick={replace}
              >
                Replace Dataset
              </Button>
              <Button
                variant="ghost"
                className="text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10"
                onClick={() => setConfirmRemove(true)}
              >
                Remove
              </Button>
              <Button
                className="bg-indigo-600 text-xs text-white hover:bg-indigo-500 shadow-[0_0_15px_rgba(99,102,241,0.35)]"
                onClick={() => navigate({ to: "/analyses" })}
              >
                Run {personaMeta.shortRole} Analyses →
              </Button>
            </>
          )
        }
      />
      {picker}

      <div className="space-y-6">
        {notice && <Notice tone="warning">{notice}</Notice>}
        {errors.length > 0 && (
          <Notice tone="error">
            <div className="font-semibold text-white">The file could not be loaded</div>
            <ul className="mt-1 list-disc pl-5 text-xs text-red-200">
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </Notice>
        )}

        {!ds ? (
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
            className={`glass-card flex flex-col items-center gap-4 border-2 border-dashed px-6 py-16 text-center transition-all ${
              drag ? "border-indigo-500 bg-indigo-950/30" : "border-white/15"
            }`}
          >
            <div className="flex size-14 items-center justify-center rounded-2xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 shadow-[0_0_30px_rgba(99,102,241,0.25)]">
              <UploadCloud className="size-7" />
            </div>

            <div>
              <div className="text-base font-semibold text-white">Drop your CSV dataset here</div>
              <p className="mt-1 max-w-md text-xs text-slate-400">
                UTF-8 CSV up to 50 MB. Column headers in first row. Processed client-side and saved
                safely in Supabase.
              </p>
            </div>

            <div className="flex flex-wrap justify-center gap-2.5 pt-2">
              <Button
                className="bg-indigo-600 text-xs text-white hover:bg-indigo-500 font-medium"
                onClick={() => fileRef.current?.click()}
                disabled={busy}
              >
                {busy ? "Parsing..." : "Choose File from Computer"}
              </Button>
              <Button
                variant="outline"
                className="border-white/10 bg-white/5 text-xs text-white hover:bg-white/10"
                onClick={() => loadPersonaSample(persona)}
              >
                <Sparkles className="mr-1.5 size-3.5 text-indigo-400" />
                Load {personaMeta.shortRole} Sample Dataset
              </Button>
            </div>

            <p className="text-[11px] text-slate-500 font-mono">
              Tailored for <span className="text-slate-300">{personaMeta.title}</span> (
              {personaMeta.badge})
            </p>
          </div>
        ) : (
          <>
            {/* Dataset Metadata Bar */}
            <section className="glass-card grid grid-cols-2 gap-px overflow-hidden border border-white/10 bg-white/5 sm:grid-cols-4">
              {[
                ["File Name", ds.name],
                ["Rows", ds.rows.length.toLocaleString()],
                ["Columns", String(ds.columns.length)],
                ["Size", `${fmt(ds.sizeBytes / 1024, 1)} KB`],
              ].map(([k, v]) => (
                <div key={k} className="bg-slate-900/90 px-4 py-3">
                  <div className="eyebrow text-[10px] text-slate-400">{k}</div>
                  <div
                    className="num mt-0.5 truncate text-[14px] font-semibold text-white"
                    title={v}
                  >
                    {v}
                  </div>
                </div>
              ))}
            </section>

            {ds.source === "sample" && (
              <div className="rounded-xl border border-indigo-500/30 bg-indigo-950/20 px-4 py-2.5 text-xs text-indigo-200 flex items-center justify-between">
                <span>
                  Tailored benchmark dataset loaded for <strong>{personaMeta.title}</strong>.
                </span>
                <span className="font-mono text-[10px] text-indigo-400">Deterministic Seed</span>
              </div>
            )}

            {/* Cloud Safe Save Bar */}
            <section className="glass-card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              {activeProject ? (
                <div className="flex items-center gap-2 text-xs">
                  <CheckCircle2 className="size-4 text-emerald-400" />
                  <span className="text-slate-300">
                    Saved as project <strong className="text-white">{activeProject.name}</strong> ·{" "}
                    <span className="text-emerald-400">Safeguarded in Supabase Cloud</span>
                  </span>
                </div>
              ) : (
                <form
                  className="flex w-full flex-col gap-2 sm:flex-row sm:items-center"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const p = saveAsProject(name);
                    if (p) toast.success(`Saved and backed up “${p.name}” in Supabase!`);
                  }}
                >
                  <span className="text-xs text-amber-300 font-medium">Unsaved Session:</span>
                  <Input
                    aria-label="Project name"
                    placeholder={ds.name}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="h-8 sm:max-w-xs border-white/10 bg-slate-900 text-xs text-white"
                  />
                  <Button
                    size="sm"
                    type="submit"
                    className="bg-indigo-600 text-xs text-white hover:bg-indigo-500"
                  >
                    Save as Project & Sync to Cloud
                  </Button>
                </form>
              )}
            </section>

            {/* Columns Schema */}
            <section className="glass-card overflow-hidden">
              <h2 className="eyebrow border-b border-white/10 px-4 py-3 text-slate-400">
                Columns Schema
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead className="border-b border-white/10 bg-slate-900/80 text-left text-slate-400">
                    <tr>
                      <th className="px-4 py-2.5 font-medium">Column</th>
                      <th className="px-4 py-2.5 font-medium">Inferred Type</th>
                      <th className="px-4 py-2.5 text-right font-medium">Missing</th>
                      <th className="px-4 py-2.5 text-right font-medium">Distinct</th>
                      <th className="px-4 py-2.5 font-medium">Type Inference Rationale</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {profiles.map((p) => (
                      <tr key={p.name} className="hover:bg-white/5 transition-colors">
                        <td className="px-4 py-2.5 font-mono text-xs font-semibold text-white">
                          {p.name}
                        </td>
                        <td className="px-4 py-2.5">
                          <span
                            className={`num rounded-md px-2 py-0.5 text-[10px] font-mono ${TYPE_STYLE[p.type]}`}
                          >
                            {p.type}
                          </span>
                        </td>
                        <td className="num px-4 py-2.5 text-right text-xs">
                          {p.missing > 0 ? (
                            <span className="text-amber-400 font-medium">
                              {p.missing} ({fmt(p.missingPct, 1)}%)
                            </span>
                          ) : (
                            <span className="text-slate-500">0</span>
                          )}
                        </td>
                        <td className="num px-4 py-2.5 text-right text-xs text-slate-300">
                          {p.distinct}
                        </td>
                        <td className="max-w-md px-4 py-2.5 text-xs text-slate-400">{p.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Rows Table */}
            <section className="glass-card overflow-hidden">
              <div className="flex flex-col gap-2 border-b border-white/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between bg-slate-900/60">
                <h2 className="eyebrow text-slate-400">Preview Rows</h2>
                <Input
                  aria-label="Search rows"
                  placeholder="Search across all cells…"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setPage(0);
                  }}
                  className="h-8 sm:max-w-xs border-white/10 bg-slate-900 text-xs text-white"
                />
              </div>
              <div className="max-h-[480px] overflow-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 border-b border-white/10 bg-slate-900 text-left text-slate-400">
                    <tr>
                      <th className="num px-3 py-2 font-medium">#</th>
                      {ds.columns.map((c) => (
                        <th
                          key={c}
                          className="whitespace-nowrap px-3 py-2 font-mono font-medium text-slate-300"
                        >
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 font-mono">
                    {filtered.slice(page * PAGE, page * PAGE + PAGE).map((i) => (
                      <tr key={i} className="hover:bg-white/5 transition-colors">
                        <td className="num px-3 py-1.5 text-slate-500">{i + 1}</td>
                        {ds.rows[i]!.map((c, j) => (
                          <td
                            key={j}
                            className="max-w-[240px] truncate whitespace-nowrap px-3 py-1.5 text-slate-200"
                          >
                            {c === null ? (
                              <span className="italic text-amber-400/80">null</span>
                            ) : (
                              c
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filtered.length === 0 && (
                  <p className="px-4 py-6 text-xs text-slate-400 text-center">
                    No rows match “{query}”.
                  </p>
                )}
              </div>
              <div className="flex items-center justify-between border-t border-white/10 px-4 py-2 text-xs text-slate-400">
                <span className="num font-mono">
                  {filtered.length.toLocaleString()} row(s) total
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-xs text-slate-300 hover:text-white"
                    disabled={page === 0}
                    onClick={() => setPage(page - 1)}
                  >
                    Previous
                  </Button>
                  <span className="num font-mono">
                    {page + 1} / {pages}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-xs text-slate-300 hover:text-white"
                    disabled={page >= pages - 1}
                    onClick={() => setPage(page + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </section>
          </>
        )}
      </div>

      <AlertDialog open={confirmReplace} onOpenChange={setConfirmReplace}>
        <AlertDialogContent className="border border-white/10 bg-slate-950 text-white">
          <AlertDialogHeader>
            <AlertDialogTitle>Replace dataset in “{activeProject?.name}”?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400 text-xs">
              The replacement file will be updated in Supabase cloud and results will be refreshed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-white/10 bg-transparent text-white hover:bg-white/5">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-indigo-600 text-white hover:bg-indigo-500"
              onClick={() => fileRef.current?.click()}
            >
              Choose Replacement File
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <AlertDialogContent className="border border-white/10 bg-slate-950 text-white">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this dataset?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400 text-xs">
              {activeProject
                ? `Data will be cleared from “${activeProject.name}”. The project definition is preserved.`
                : "This unsaved session will be cleared."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-white/10 bg-transparent text-white hover:bg-white/5">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-500"
              onClick={() => {
                clearDataset();
                setErrors([]);
              }}
            >
              Remove Dataset
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

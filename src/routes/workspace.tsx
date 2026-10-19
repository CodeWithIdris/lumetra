import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { EmptyState, Notice, PageHeader } from "@/components/AppShell";
import { useStore } from "@/lib/store";
import { profileDataset } from "@/lib/data/infer";
import { fmt } from "@/lib/stats/descriptive";
import { pageMeta } from "@/lib/meta";
import { toast } from "sonner";

export const Route = createFileRoute("/workspace")({
  validateSearch: (s: Record<string, unknown>): { notice?: string } =>
    typeof s["notice"] === "string" ? { notice: s["notice"] } : {},
  head: () => pageMeta("Data Workspace", "Upload a CSV, inspect columns, types and missing values before analysing."),
  component: Workspace,
});

const PAGE = 25;
const TYPE_STYLE: Record<string, string> = {
  numeric: "bg-accent text-accent-foreground",
  categorical: "bg-secondary text-secondary-foreground",
  date: "bg-secondary text-secondary-foreground",
  text: "bg-muted text-muted-foreground",
  empty: "bg-warning text-warning-foreground",
};

function Workspace() {
  const { notice } = Route.useSearch();
  const { active, activeProject, loadFile, loadSample, clearDataset, saveAsProject } = useStore();
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
    return q ? idx.filter((i) => ds.rows[i]!.some((c) => c !== null && c.toLowerCase().includes(q))) : idx;
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
    <input ref={fileRef} type="file" accept=".csv,text/csv,.txt" className="sr-only" aria-label="Upload CSV file"
      onChange={(e) => handle(e.target.files?.[0])} />
  );

  return (
    <>
      <PageHeader
        title="Data Workspace"
        description="Files are parsed in your browser. Nothing is uploaded to a server."
        actions={ds && (
          <>
            <Button variant="outline" onClick={replace}>Replace dataset</Button>
            <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setConfirmRemove(true)}>Remove</Button>
            <Button onClick={() => navigate({ to: "/analyses" })}>Analyse</Button>
          </>
        )}
      />
      {picker}
      <div className="space-y-4">
        {notice && <Notice tone="warning">{notice}</Notice>}
        {errors.length > 0 && (
          <Notice tone="error">
            <div className="font-medium">The file could not be loaded</div>
            <ul className="mt-1 list-disc pl-5">{errors.map((e) => <li key={e}>{e}</li>)}</ul>
          </Notice>
        )}

        {!ds ? (
          <div
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); handle(e.dataTransfer.files[0]); }}
            className={`panel flex flex-col items-center gap-3 border-dashed px-6 py-14 text-center ${drag ? "border-primary bg-accent" : ""}`}
          >
            <div className="font-medium">Drop a CSV file here</div>
            <p className="max-w-md text-[13px] text-muted-foreground">
              UTF-8 CSV up to 20 MB and 200,000 rows. The first row must contain column names.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              <Button onClick={() => fileRef.current?.click()} disabled={busy}>{busy ? "Reading…" : "Choose file"}</Button>
              <Button variant="outline" onClick={loadSample}>Use synthetic sample</Button>
            </div>
            <p className="text-[12px] text-muted-foreground">Excel (.xlsx) import is planned — for now, save the sheet as CSV.</p>
          </div>
        ) : (
          <>
            <section className="panel grid grid-cols-2 gap-px overflow-hidden bg-border sm:grid-cols-4">
              {[
                ["File", ds.name],
                ["Rows", ds.rows.length.toLocaleString()],
                ["Columns", String(ds.columns.length)],
                ["Size", `${fmt(ds.sizeBytes / 1024, 1)} KB`],
              ].map(([k, v]) => (
                <div key={k} className="bg-surface px-4 py-3">
                  <div className="eyebrow">{k}</div>
                  <div className="num mt-0.5 truncate text-[14px]" title={v}>{v}</div>
                </div>
              ))}
            </section>

            {ds.source === "sample" && <Notice>This is a synthetic dataset generated for demonstration. It describes no real people.</Notice>}
            {ds.warnings.map((w) => <Notice key={w} tone="warning">{w}</Notice>)}

            <section className="panel flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
              {activeProject ? (
                <div className="text-[13px]">
                  Saved as project <strong>{activeProject.name}</strong>
                  {activeProject.dataset && !activeProject.dataset.stored && (
                    <span className="text-warning-foreground"> — file is over 2 MB, so the data itself is not kept after reload.</span>
                  )}
                </div>
              ) : (
                <form className="flex w-full flex-col gap-2 sm:flex-row sm:items-center" onSubmit={(e) => {
                  e.preventDefault();
                  const p = saveAsProject(name);
                  if (p) toast.success(`Saved “${p.name}”`);
                }}>
                  <span className="text-[13px] text-warning-foreground">Unsaved session.</span>
                  <Input aria-label="Project name" placeholder={ds.name} value={name} onChange={(e) => setName(e.target.value)} className="h-8 sm:max-w-xs" />
                  <Button size="sm" type="submit">Save as project</Button>
                </form>
              )}
            </section>

            <section className="panel">
              <h2 className="eyebrow border-b px-4 py-3">Columns</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead className="border-b bg-muted/50 text-left text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2 font-medium">Column</th>
                      <th className="px-4 py-2 font-medium">Type</th>
                      <th className="px-4 py-2 text-right font-medium">Missing</th>
                      <th className="px-4 py-2 text-right font-medium">Distinct</th>
                      <th className="px-4 py-2 font-medium">Why this type</th>
                    </tr>
                  </thead>
                  <tbody>
                    {profiles.map((p) => (
                      <tr key={p.name} className="border-b align-top last:border-0">
                        <td className="px-4 py-2 font-medium">{p.name}</td>
                        <td className="px-4 py-2"><span className={`num rounded px-1.5 py-0.5 text-[11px] ${TYPE_STYLE[p.type]}`}>{p.type}</span></td>
                        <td className="num px-4 py-2 text-right">
                          {p.missing} <span className="text-muted-foreground">({fmt(p.missingPct, 1)}%)</span>
                        </td>
                        <td className="num px-4 py-2 text-right">{p.distinct}</td>
                        <td className="max-w-md px-4 py-2 text-[12.5px] text-muted-foreground">{p.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="panel">
              <div className="flex flex-col gap-2 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <h2 className="eyebrow">Rows</h2>
                <Input aria-label="Search rows" placeholder="Search all cells…" value={query}
                  onChange={(e) => { setQuery(e.target.value); setPage(0); }} className="h-8 sm:max-w-xs" />
              </div>
              <div className="max-h-[480px] overflow-auto">
                <table className="w-full text-[12.5px]">
                  <thead className="sticky top-0 border-b bg-muted text-left text-muted-foreground">
                    <tr>
                      <th className="num px-3 py-2 font-medium">#</th>
                      {ds.columns.map((c) => <th key={c} className="whitespace-nowrap px-3 py-2 font-medium">{c}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.slice(page * PAGE, page * PAGE + PAGE).map((i) => (
                      <tr key={i} className="border-b last:border-0">
                        <td className="num px-3 py-1.5 text-muted-foreground">{i + 1}</td>
                        {ds.rows[i]!.map((c, j) => (
                          <td key={j} className="max-w-[240px] truncate whitespace-nowrap px-3 py-1.5">
                            {c === null ? <span className="italic text-muted-foreground">missing</span> : c}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filtered.length === 0 && <p className="px-4 py-6 text-[13px] text-muted-foreground">No rows match “{query}”.</p>}
              </div>
              <div className="flex items-center justify-between border-t px-4 py-2 text-[12px] text-muted-foreground">
                <span className="num">{filtered.length.toLocaleString()} row(s)</span>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
                  <span className="num">{page + 1} / {pages}</span>
                  <Button size="sm" variant="ghost" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>Next</Button>
                </div>
              </div>
            </section>
          </>
        )}
      </div>

      <AlertDialog open={confirmReplace} onOpenChange={setConfirmReplace}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace the data in “{activeProject?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The new file will replace this project's dataset and its results will need to be re-run. To keep this project unchanged, cancel and use “Start a new analysis” on the Overview instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => fileRef.current?.click()}>Choose replacement file</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this dataset?</AlertDialogTitle>
            <AlertDialogDescription>
              {activeProject
                ? `The data will be removed from “${activeProject.name}”. The project itself is kept.`
                : "This unsaved session will be cleared."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { clearDataset(); setErrors([]); }}>Remove dataset</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

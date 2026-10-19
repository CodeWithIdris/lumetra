import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { parseCsvFile, parseCsvText } from "./data/parse";
import { sampleCsv, SAMPLE_NAME } from "./data/sample";
import type { Dataset } from "./data/types";
import {
  clearAll,
  deleteCsv,
  loadCsv,
  loadProjects,
  saveProjects,
  storeCsv,
  type ProjectMeta,
  type ProjectStatus,
} from "./persistence/projects";

interface Active {
  dataset: Dataset;
  csv: string;
  projectId: string | null;
}

interface Store {
  ready: boolean;
  projects: ProjectMeta[];
  active: Active | null;
  activeProject: ProjectMeta | null;
  loadFile: (file: File) => Promise<{ errors: string[] }>;
  loadSample: () => void;
  clearDataset: () => void;
  /** Detach from a saved project (its data stays saved). Unsaved sessions are kept. */
  startNew: () => void;
  saveAsProject: (name: string) => ProjectMeta | null;
  openProject: (id: string) => { error?: string };
  renameProject: (id: string, name: string) => void;
  deleteProject: (id: string) => void;
  setStatus: (status: ProjectStatus) => void;
  setObjective: (text: string) => void;
  resetAll: () => void;
}

const Ctx = createContext<Store | null>(null);

function nowIso() {
  return new Date().toISOString();
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [ready, setReady] = useState(false);
  const [active, setActive] = useState<Active | null>(null);

  useEffect(() => {
    setProjects(loadProjects());
    setReady(true);
  }, []);

  const commit = useCallback((next: ProjectMeta[]) => {
    setProjects(next);
    saveProjects(next);
  }, []);

  const update = useCallback(
    (id: string, patch: Partial<ProjectMeta>) => {
      commit(loadProjects().map((p) => (p.id === id ? { ...p, ...patch, updatedAt: nowIso() } : p)));
    },
    [commit],
  );

  // Side effects (storage writes) happen outside state updaters so they run exactly once.
  const attach = useCallback(
    (dataset: Dataset, csv: string) => {
      const projectId = active?.projectId ?? null;
      if (projectId) {
        const stored = replaceCsv(projectId, csv);
        update(projectId, {
          status: "data-loaded",
          dataset: { name: dataset.name, rows: dataset.rows.length, columns: dataset.columns.length, source: dataset.source, stored },
        });
      }
      setActive({ dataset, csv, projectId });
    },
    [active, update],
  );

  const loadFile = useCallback(
    async (file: File) => {
      const { result, text } = await parseCsvFile(file);
      if (!result.ok) return { errors: result.errors };
      attach(result.dataset, text);
      return { errors: [] };
    },
    [attach],
  );

  const loadSample = useCallback(() => {
    const csv = sampleCsv();
    const res = parseCsvText(csv, SAMPLE_NAME, "sample");
    if (res.ok) attach(res.dataset, csv);
  }, [attach]);

  const clearDataset = useCallback(() => {
    if (active?.projectId) {
      deleteCsv(active.projectId);
      update(active.projectId, { status: "no-data", dataset: null });
    }
    setActive(null);
  }, [active, update]);

  const startNew = useCallback(() => {
    if (active?.projectId) setActive(null);
  }, [active]);

  const saveAsProject = useCallback(
    (name: string) => {
      if (!active) return null;
      const id = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
      const stored = storeCsv(id, active.csv);
      const p: ProjectMeta = {
        id,
        name: name.trim() || active.dataset.name,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        status: "data-loaded",
        dataset: {
          name: active.dataset.name,
          rows: active.dataset.rows.length,
          columns: active.dataset.columns.length,
          source: active.dataset.source,
          stored,
        },
      };
      commit([p, ...loadProjects()]);
      setActive({ ...active, projectId: id });
      return p;
    },
    [active, commit],
  );

  const openProject = useCallback((id: string) => {
    const p = loadProjects().find((x) => x.id === id);
    if (!p) return { error: "Project not found." };
    if (!p.dataset) {
      setActive(null);
      return { error: "This project has no dataset yet. Upload one in the Data Workspace." };
    }
    const csv = loadCsv(id);
    if (!csv) return { error: "The data for this project was too large to keep on this device. Re-upload the file to continue." };
    const res = parseCsvText(csv, p.dataset.name, p.dataset.source);
    if (!res.ok) return { error: res.errors.join(" ") };
    setActive({ dataset: res.dataset, csv, projectId: id });
    return {};
  }, []);

  const renameProject = useCallback((id: string, name: string) => update(id, { name: name.trim() || "Untitled project" }), [update]);

  const deleteProject = useCallback(
    (id: string) => {
      deleteCsv(id);
      commit(loadProjects().filter((p) => p.id !== id));
      setActive((prev) => (prev?.projectId === id ? { ...prev, projectId: null } : prev));
    },
    [commit],
  );

  const setStatus = useCallback(
    (status: ProjectStatus) => {
      if (active?.projectId) update(active.projectId, { status });
    },
    [active, update],
  );

  const setObjective = useCallback(
    (objective: string) => {
      if (active?.projectId) update(active.projectId, { objective });
    },
    [active, update],
  );

  const resetAll = useCallback(() => {
    clearAll();
    setProjects([]);
    setActive(null);
  }, []);

  const activeProject = useMemo(
    () => projects.find((p) => p.id === active?.projectId) ?? null,
    [projects, active],
  );

  const value: Store = {
    ready, projects, active, activeProject, loadFile, loadSample, clearDataset, startNew, saveAsProject,
    openProject, renameProject, deleteProject, setStatus, setObjective, resetAll,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore() {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore must be used inside StoreProvider");
  return s;
}

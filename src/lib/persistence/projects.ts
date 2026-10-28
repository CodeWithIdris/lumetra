/** Local-only persistence (browser localStorage). Nothing leaves the device. */
import type { CleaningStep } from "../data/clean";
import type { SavedAnalysis } from "../stats/analysis";

export type ProjectStatus = "no-data" | "data-loaded" | "analysed";

export interface ProjectMeta {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  status: ProjectStatus;
  dataset: {
    id?: string;
    name: string;
    rows: number;
    columns: number;
    source: "upload" | "sample";
    stored: boolean;
  } | null;
  objective?: string;
  cleaningSteps?: CleaningStep[];
  savedAnalyses?: SavedAnalysis[];
}

const KEY = "lumetra.projects.v1";
const DATA_PREFIX = "lumetra.data.v1.";
export const MAX_STORED_CSV_BYTES = 2 * 1024 * 1024;

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function isProject(x: unknown): x is ProjectMeta {
  const p = x as ProjectMeta;
  return (
    !!p && typeof p.id === "string" && typeof p.name === "string" && typeof p.createdAt === "string"
  );
}

export function loadProjects(): ProjectMeta[] {
  const raw = storage()?.getItem(KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isProject) : [];
  } catch {
    return [];
  }
}

export function saveProjects(list: ProjectMeta[]): boolean {
  const s = storage();
  if (!s) return false;
  try {
    s.setItem(KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

/** Store raw CSV for a project if small enough. Returns whether it was stored. */
export function storeCsv(projectId: string, csv: string): boolean {
  const s = storage();
  if (!s || new Blob([csv]).size > MAX_STORED_CSV_BYTES) return false;
  try {
    s.setItem(DATA_PREFIX + projectId, csv);
    return true;
  } catch {
    return false;
  }
}

export function loadCsv(projectId: string): string | null {
  return storage()?.getItem(DATA_PREFIX + projectId) ?? null;
}

export function deleteCsv(projectId: string) {
  storage()?.removeItem(DATA_PREFIX + projectId);
}

export function clearAll() {
  const s = storage();
  if (!s) return;
  for (const k of Object.keys(s)) if (k.startsWith("lumetra.")) s.removeItem(k);
}

/**
 * Replace a project's stored CSV. The previous copy is always removed first, so a
 * failed write can never leave stale data that no longer matches the metadata.
 */
export function replaceCsv(projectId: string, csv: string): boolean {
  deleteCsv(projectId);
  return storeCsv(projectId, csv);
}

/**
 * Duplicate a project without sharing any mutable analysis state or data references.
 */
export function duplicateProject(projectId: string): ProjectMeta | null {
  const projects = loadProjects();
  const source = projects.find((p) => p.id === projectId);
  if (!source) return null;

  const newId = "proj_" + Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
  const now = new Date().toISOString();
  const newDatasetId = source.dataset
    ? "ds_" + Math.random().toString(36).slice(2, 9) + Date.now().toString(36)
    : undefined;

  // Deep clone metadata, cleaning steps, and saved analyses
  const copy: ProjectMeta = {
    ...JSON.parse(JSON.stringify(source)),
    id: newId,
    name: `${source.name} (Copy)`,
    createdAt: now,
    updatedAt: now,
    cleaningSteps: source.cleaningSteps ? JSON.parse(JSON.stringify(source.cleaningSteps)) : [],
    savedAnalyses: source.savedAnalyses ? JSON.parse(JSON.stringify(source.savedAnalyses)) : [],
    dataset: source.dataset
      ? {
          ...JSON.parse(JSON.stringify(source.dataset)),
          id: newDatasetId,
        }
      : null,
  };

  // Clone stored CSV data under the new ID if it exists
  const existingCsv = loadCsv(projectId);
  if (existingCsv) {
    storeCsv(newId, existingCsv);
  }

  const updatedProjects = [copy, ...projects];
  saveProjects(updatedProjects);
  return copy;
}

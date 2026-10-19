/** Local-only persistence (browser localStorage). Nothing leaves the device. */

export type ProjectStatus = "no-data" | "data-loaded" | "analysed";

export interface ProjectMeta {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  status: ProjectStatus;
  dataset: { name: string; rows: number; columns: number; source: "upload" | "sample"; stored: boolean } | null;
  objective?: string;
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
  return !!p && typeof p.id === "string" && typeof p.name === "string" && typeof p.createdAt === "string";
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

export function saveProjects(list: ProjectMeta[]) {
  storage()?.setItem(KEY, JSON.stringify(list));
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

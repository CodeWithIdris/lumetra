import type { UIMessage } from "ai";

/** One conversation per saved project, kept in this browser. */
const PREFIX = "lumetra.chat.v1.";

export function loadChat(projectId: string): UIMessage[] {
  try {
    const raw = window.localStorage.getItem(PREFIX + projectId);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as UIMessage[]) : [];
  } catch {
    return [];
  }
}

export function saveChat(projectId: string, messages: UIMessage[]): boolean {
  try {
    window.localStorage.setItem(PREFIX + projectId, JSON.stringify(messages));
    return true;
  } catch {
    return false;
  }
}

export function deleteChat(projectId: string) {
  try {
    window.localStorage.removeItem(PREFIX + projectId);
  } catch {
    /* ignore */
  }
}

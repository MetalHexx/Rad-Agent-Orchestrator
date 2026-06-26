import type { SavedSession } from "@rad-orchestration/telemetry";

const BASE = "/api/observability/saved";

export async function listSaved(): Promise<SavedSession[]> {
  const res = await fetch(BASE, { cache: "no-store" });
  if (!res.ok) return [];
  return ((await res.json()).saved ?? []) as SavedSession[];
}
export async function fetchIsSaved(sessionId: string): Promise<boolean> {
  const res = await fetch(`${BASE}/${encodeURIComponent(sessionId)}`, { cache: "no-store" });
  if (!res.ok) return false;
  return Boolean((await res.json()).saved);
}
export async function saveSession(sessionId: string): Promise<SavedSession | null> {
  const res = await fetch(BASE, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId }) });
  return res.ok ? ((await res.json()).saved as SavedSession) : null;
}
export async function renameSaved(sessionId: string, title: string): Promise<SavedSession | null> {
  const res = await fetch(`${BASE}/${encodeURIComponent(sessionId)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title }) });
  return res.ok ? ((await res.json()).saved as SavedSession) : null;
}
export async function unsaveSession(sessionId: string): Promise<boolean> {
  const res = await fetch(`${BASE}/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
  return res.ok;
}

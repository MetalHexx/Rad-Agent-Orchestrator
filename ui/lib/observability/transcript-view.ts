// Pure, SSR-safe view helpers for the Transcript facet. No React, no DOM.
export function formatClock(ts: string): string {
  const m = /T(\d{2}:\d{2}:\d{2})/.exec(ts);
  return m ? m[1] : "";
}

export function toolArgPreview(text: string | undefined, max = 80): string {
  if (!text) return "";
  const first = text.split("\n")[0].trim();
  return first.length > max ? first.slice(0, max - 1) + "…" : first;
}

import type { TranscriptEvent } from "@rad-orchestration/telemetry";

export function matchesQuery(event: TranscriptEvent, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  const hay = [event.text, event.tool?.name, event.tool?.input?.text, event.result?.output?.text, event.file?.path]
    .filter(Boolean).join(" ").toLowerCase();
  return hay.includes(q);
}

export function visibleEvents(events: TranscriptEvent[], opts: { showThinking: boolean; query: string }): TranscriptEvent[] {
  return events.filter((e) => (opts.showThinking || e.kind !== "thinking") && matchesQuery(e, opts.query));
}

export function errorEventSeqs(events: TranscriptEvent[]): number[] {
  return events.filter((e) => e.kind === "tool_result" && e.result?.isError).map((e) => e.seq);
}

// A result at index i is "tight" when the previous event is its matching call
// (same toolUseId). Adjacency only — the id is never rendered (AD-6, DD-7).
export function isTightResult(events: TranscriptEvent[], i: number): boolean {
  const cur = events[i];
  const prev = events[i - 1];
  if (!cur || cur.kind !== "tool_result" || !prev || prev.kind !== "tool_call") return false;
  return !!cur.result && !!prev.tool && cur.result.toolUseId === prev.tool.toolUseId;
}

export function windowEvents<T>(items: T[], limit: number): { shown: T[]; hidden: number } {
  if (!Number.isFinite(limit) || items.length <= limit) return { shown: items, hidden: 0 };
  return { shown: items.slice(items.length - limit), hidden: items.length - limit };
}

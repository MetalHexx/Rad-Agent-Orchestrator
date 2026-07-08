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

// Per-card reveal (more / less). A body taller than CLAMP_LINES display rows
// gets a collapse control; short bodies render bare. The decision is computed
// server-side (mirrors out.truncated) so it is unit-testable and SSR-safe.
export const CLAMP_LINES = 10;

// Count the display rows a body occupies: explicit newlines PLUS the soft-wrap
// rows each segment spills into at colsPerLine. So a single 1000-char arg line
// is correctly detected as long (the args-wrapping path), not counted as one.
export function displayLineCount(text: string, colsPerLine: number): number {
  if (!text) return 0;
  return text.split("\n").reduce((n, seg) => n + Math.max(1, Math.ceil(seg.length / colsPerLine)), 0);
}

export function needsClamp(text: string, colsPerLine = 88): boolean {
  return displayLineCount(text, colsPerLine) > CLAMP_LINES;
}

import type { TranscriptEvent } from "@rad-orchestration/telemetry";

export function matchesQuery(event: TranscriptEvent, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  const hay = [event.text, event.tool?.name, event.tool?.input?.text, event.result?.output?.text, event.file?.path]
    .filter(Boolean).join(" ").toLowerCase();
  return hay.includes(q);
}

export interface TranscriptFacetState {
  types: { user: boolean; assistant: boolean; thinking: boolean; toolResults: boolean; errors: boolean };
  tools: ReadonlySet<string> | "all"; // selected tool names; 'all' = every tool; empty set = hide all tool calls
  files: ReadonlySet<string> | "all"; // selected file ops ('edit'|'write'|'snapshot'); empty set = hide all file changes
  query: string;
}

function matchesFacet(event: TranscriptEvent, f: TranscriptFacetState): boolean {
  switch (event.kind) {
    case "tool_call":
      return f.tools === "all" || (!!event.tool && f.tools.has(event.tool.name));
    case "file_change":
      return f.files === "all" || (!!event.file && f.files.has(event.file.op));
    case "message":
      return event.role === "user" ? f.types.user : f.types.assistant;
    case "thinking":
      return f.types.thinking;
    case "tool_result":
      return event.result?.isError === true ? f.types.errors : f.types.toolResults;
    case "system":
    case "hook":
      return true;
    default:
      return true;
  }
}

export function applyFacets(events: TranscriptEvent[], f: TranscriptFacetState): TranscriptEvent[] {
  return events.filter((e) => matchesFacet(e, f) && matchesQuery(e, f.query));
}

export function facetLabel(sel: ReadonlySet<string> | "all", total: number): string {
  if (sel === "all" || sel.size === total) return "All";
  if (sel.size === 0) return "None";
  return `${sel.size} of ${total}`;
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

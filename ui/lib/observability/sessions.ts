import type { ObservabilityUsageRow } from "@rad-orchestration/telemetry";
import { effectiveTokens } from "./effective-tokens";

export const DECAY_WINDOW_MS = 5 * 60 * 1000;

/** Composite merge key — uniqueness is only guaranteed per session (AD-4). */
export function rowKey(r: Pick<ObservabilityUsageRow, "sessionId" | "usageId">): string {
  return `${r.sessionId} ${r.usageId}`;
}

/** Last-wins upsert into a keyed map; tolerant of duplicates/backfill (AD-4, NFR-3). */
export function upsertRows(prev: Map<string, ObservabilityUsageRow>, incoming: ObservabilityUsageRow[]): Map<string, ObservabilityUsageRow> {
  const next = new Map(prev);
  for (const r of incoming) next.set(rowKey(r), r);
  return next;
}

export interface SessionAgg {
  sessionId: string;
  worktree?: string;
  startedMs: number;
  lastMs: number;
  spend: number;
  rows: ObservabilityUsageRow[];
}

/** Group rows by sessionId; subagent sidechain rows share the parent sessionId so spend folds in (FR-8). */
export function deriveSessions(rows: Map<string, ObservabilityUsageRow> | ObservabilityUsageRow[]): SessionAgg[] {
  const list = Array.isArray(rows) ? rows : [...rows.values()];
  const by = new Map<string, SessionAgg>();
  for (const r of list) {
    const t = Date.parse(r.timestamp);
    const agg = by.get(r.sessionId);
    if (!agg) {
      by.set(r.sessionId, { sessionId: r.sessionId, worktree: r.worktree, startedMs: t, lastMs: t, spend: effectiveTokens(r), rows: [r] });
    } else {
      agg.startedMs = Math.min(agg.startedMs, t);
      agg.lastMs = Math.max(agg.lastMs, t);
      agg.spend += effectiveTokens(r);
      agg.worktree = agg.worktree ?? r.worktree;
      agg.rows.push(r);
    }
  }
  return [...by.values()];
}

/** Wall-clock span = last - first timestamp; includes idle gaps (FR-9). */
export function sessionDuration(s: SessionAgg): number {
  return s.lastMs - s.startedMs;
}

/** Keep only rows whose timestamp falls within [startMs, endMs] (FR-3). */
export function rowsInWindow(rows: ObservabilityUsageRow[], startMs: number, endMs: number): ObservabilityUsageRow[] {
  return rows.filter(r => { const t = Date.parse(r.timestamp); return t >= startMs && t <= endMs; });
}

/** Keep rows at or after startMs with no upper clamp, so live-tail SSE appends
 *  newer than the tick-pinned rangeEnd surface immediately (FR-9, AD-6). */
export function rowsSince(rows: ObservabilityUsageRow[], startMs: number): ObservabilityUsageRow[] {
  return rows.filter(r => Date.parse(r.timestamp) >= startMs);
}

export interface RatePoint { t: number; value: number; }

/**
 * Spiky per-bucket effective-spend rate (NOT cumulative) over a rolling window (FR-10, FR-5).
 *
 * `anchor` controls where the bucket boundaries fall:
 *  - 'window' (default): boundaries are relative to the window — `startMs + i*size`. Simple, but
 *    every time `endMs` advances the boundaries slide and rows re-bucket, so a live chart's shape
 *    warps on each tick. Kept as the default to preserve existing call sites and their tests.
 *  - 'grid': boundaries are snapped to an ABSOLUTE wall-clock grid (multiples of `size`). A data
 *    point therefore keeps the same bucket — the same `t` — across renders as the window slides, so
 *    the viewport scrolls smoothly while the curve's shape stays steady (no per-tick distortion).
 *    The leftmost bucket may begin slightly before `startMs` (it scrolls off the left edge) and a
 *    new rightmost bucket fills in as time advances.
 */
export function timeBucketedRate(
  rows: ObservabilityUsageRow[],
  opts: { endMs: number; windowMs: number; buckets: number; anchor?: "window" | "grid" }
): RatePoint[] {
  const { endMs, windowMs, buckets, anchor = "window" } = opts;
  // Guard: zero-length or negative window — return a flat zero series anchored at endMs (FR-5).
  if (windowMs <= 0) {
    return Array.from({ length: buckets }, (_, i) => ({ t: endMs + i, value: 0 }));
  }
  const startMs = endMs - windowMs;
  const size = windowMs / buckets;

  if (anchor === "grid") {
    const gridStart = Math.floor(startMs / size) * size;
    const count = Math.max(1, Math.ceil((endMs - gridStart) / size));
    const series: RatePoint[] = Array.from({ length: count }, (_, i) => ({ t: gridStart + i * size, value: 0 }));
    for (const r of rows) {
      const t = Date.parse(r.timestamp);
      if (t < startMs || t >= endMs) continue;
      const idx = Math.min(count - 1, Math.floor((t - gridStart) / size));
      series[idx].value += effectiveTokens(r);
    }
    return series;
  }

  const series: RatePoint[] = Array.from({ length: buckets }, (_, i) => ({ t: startMs + i * size, value: 0 }));
  for (const r of rows) {
    const t = Date.parse(r.timestamp);
    if (t < startMs || t >= endMs) continue;
    const idx = Math.min(buckets - 1, Math.floor((t - startMs) / size));
    series[idx].value += effectiveTokens(r);
  }
  return series;
}

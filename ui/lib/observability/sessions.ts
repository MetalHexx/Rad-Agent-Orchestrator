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

export interface RatePoint { t: number; value: number; }

/** Spiky per-bucket effective-spend rate (NOT cumulative) over a rolling window (FR-10). */
export function timeBucketedRate(rows: ObservabilityUsageRow[], opts: { endMs: number; windowMs: number; buckets: number }): RatePoint[] {
  const { endMs, windowMs, buckets } = opts;
  const startMs = endMs - windowMs;
  const size = windowMs / buckets;
  const series: RatePoint[] = Array.from({ length: buckets }, (_, i) => ({ t: startMs + i * size, value: 0 }));
  for (const r of rows) {
    const t = Date.parse(r.timestamp);
    if (t < startMs || t >= endMs) continue;
    const idx = Math.min(buckets - 1, Math.floor((t - startMs) / size));
    series[idx].value += effectiveTokens(r);
  }
  return series;
}

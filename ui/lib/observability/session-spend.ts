import type { ObservabilityUsageRow } from "@rad-orchestration/telemetry";
import { rowsInWindow } from "./sessions";
import { effectiveTokens } from "./effective-tokens";

/**
 * A single session's effective-token spend over an explicit [startMs, endMs] window — the
 * same `rowsInWindow` clamp session-detail applies (rowsInWindow → filter sessionId → sum
 * effectiveTokens), so any caller windowing by an explicit range agrees with session-detail's
 * figure for that range instead of drifting via an open-ended `rowsSince` sum (AD-6).
 */
export function sessionSpendInRange(
  rows: ObservabilityUsageRow[],
  sessionId: string,
  startMs: number,
  endMs: number,
): number {
  return rowsInWindow(rows, startMs, endMs)
    .filter((r) => r.sessionId === sessionId)
    .reduce((sum, r) => sum + effectiveTokens(r), 0);
}

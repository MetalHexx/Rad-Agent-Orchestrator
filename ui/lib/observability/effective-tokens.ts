import type { ObservabilityUsageRow } from "@rad-orchestration/telemetry";

type TokenFields = Pick<ObservabilityUsageRow, "inputTokens" | "outputTokens" | "cacheReadTokens" | "cacheCreationTokens">;

/** Effective (cache-weighted) tokens — the single Spend unit (AD-3). Cumulative, NOT occupancy. */
export function effectiveTokens(row: TokenFields): number {
  return row.inputTokens * 1
    + row.outputTokens * 5
    + (row.cacheReadTokens ?? 0) * 0.1
    + (row.cacheCreationTokens ?? 0) * 1.25;
}

import type { ObservabilityUsageRow } from './observability-row.js';

export type TokenFields = Pick<ObservabilityUsageRow,
  'inputTokens' | 'outputTokens' | 'cacheReadTokens' | 'cacheCreationTokens' | 'cacheCreation1hTokens'>;

/**
 * Effective (cache-weighted) tokens — the single Spend unit. Cumulative, not occupancy. (AD-4)
 * Weights mirror the per-input cost ratios: output 5×, cache-read 0.1×, and cache-write by TTL
 * — 5m at 1.25× and 1h at 2×. The 1h subset (`cacheCreation1hTokens`) is weighted at 2×; the
 * remainder (and any legacy row lacking the split) stays at the 5m 1.25×.
 */
export function effectiveTokens(row: TokenFields): number {
  const cacheCreate = row.cacheCreationTokens ?? 0;
  const cache1h = Math.min(cacheCreate, row.cacheCreation1hTokens ?? 0); // clamp: 1h ≤ total
  const cache5m = cacheCreate - cache1h;
  return row.inputTokens * 1
    + row.outputTokens * 5
    + (row.cacheReadTokens ?? 0) * 0.1
    + cache5m * 1.25
    + cache1h * 2;
}

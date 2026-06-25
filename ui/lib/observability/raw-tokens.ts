import type { ObservabilityUsageRow } from "@rad-orchestration/telemetry";

type RawTokenRow = Pick<
  ObservabilityUsageRow,
  "inputTokens" | "outputTokens" | "cacheReadTokens" | "cacheCreationTokens"
>;

/** Normalized raw-token totals matching TokenBreakdown's prop shape. */
export interface RawTokenTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreate: number;
}

/** Sum the four raw token fields across a session's rows into the normalized shape (FR-4, FR-6). */
export function sumRawTokens(rows: RawTokenRow[]): RawTokenTotals {
  return rows.reduce<RawTokenTotals>(
    (acc, r) => ({
      input: acc.input + r.inputTokens,
      output: acc.output + r.outputTokens,
      cacheRead: acc.cacheRead + (r.cacheReadTokens ?? 0),
      cacheCreate: acc.cacheCreate + (r.cacheCreationTokens ?? 0),
    }),
    { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 },
  );
}

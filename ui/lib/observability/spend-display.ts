import type { ObservabilityUsageRow } from "@rad-orchestration/telemetry";
import { effectiveTokens } from "@/lib/observability/effective-tokens";
import { dollarsFor } from "@rad-orchestration/telemetry/read/pricing";
import { sumRawTokens, type RawTokenTotals } from "@/lib/observability/raw-tokens";

/** Canonical spend-vocabulary labels every Observability surface reuses — one wording, everywhere. */
export const SPEND_LABELS = {
  newTokens: "New tokens",
  costWeighted: "Cost (weighted)",
  cost: "Cost",
  costUsd: "Cost (USD)",
} as const;

/** Formats a dollar amount for display; `null` (unknown-priced model) renders as unavailable, never `$0`. */
export function formatUsd(dollars: number | null): string {
  if (dollars === null) return "price unavailable";
  return `$${dollars.toFixed(2)}`;
}

export interface SpendReceipt {
  /** Σ cacheCreationTokens — net-new context (~ harness headline figure). */
  newTokens: number;
  /** Σ effectiveTokens(row) — the cache-weighted spend unit. */
  costWeighted: number;
  /** Raw per-field token totals. */
  raw: RawTokenTotals;
  /** Σ dollarsFor(row); null if any contributing model is unknown-priced. */
  dollars: number | null;
  /** Per-model dollar attribution, sorted desc by dollars (unknown-priced models sort last). */
  perModel: { model: string; dollars: number | null }[];
}

/** Builds the shared spend number set — labels, dollars, and raw breakdown — from a row set (AD-4). */
export function spendReceipt(rows: ReadonlyArray<ObservabilityUsageRow>): SpendReceipt {
  let newTokens = 0;
  let costWeighted = 0;
  const perModelDollars = new Map<string, number | null>();

  for (const row of rows) {
    newTokens += row.cacheCreationTokens ?? 0;
    costWeighted += effectiveTokens(row);

    const rowDollars = dollarsFor(row);
    const existing = perModelDollars.has(row.model) ? perModelDollars.get(row.model)! : 0;
    if (existing === null || rowDollars === null) {
      perModelDollars.set(row.model, null);
    } else {
      perModelDollars.set(row.model, existing + rowDollars);
    }
  }

  let dollars: number | null = 0;
  for (const modelDollars of perModelDollars.values()) {
    if (dollars === null || modelDollars === null) {
      dollars = null;
    } else {
      dollars += modelDollars;
    }
  }

  const perModel = [...perModelDollars.entries()]
    .map(([model, modelDollars]) => ({ model, dollars: modelDollars }))
    .sort((a, b) => {
      if (a.dollars === null) return 1;
      if (b.dollars === null) return -1;
      return b.dollars - a.dollars;
    });

  return {
    newTokens,
    costWeighted,
    raw: sumRawTokens([...rows]),
    dollars,
    perModel,
  };
}

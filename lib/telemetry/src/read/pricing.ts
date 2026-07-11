/**
 * Model-keyed, date-aware dollar pricing. No pricing API exists, so dollar cost
 * comes from this maintained table — verified against the pricing docs on 2026-07-09.
 * Dependency-free, browser-safe (no `node:*` imports) so it can be imported as a
 * client leaf, mirroring `./effective-tokens.js`.
 */

/** Recorded into snapshots as a reproducibility marker for the table version used. */
export const PRICING_VERSION = '2026-07-09';

export type TokenType = 'input' | 'output' | 'cacheRead' | 'cacheWrite5m' | 'cacheWrite1h';

export interface PricedRow {
  model: string;
  timestamp: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}

type PricingFamily = 'haiku' | 'sonnet-5' | 'opus' | 'fable';

interface PerMTokPrices {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
}

interface PricingWindow {
  /** Inclusive ISO date (YYYY-MM-DD) the window takes effect from; '' = effective always. */
  effectiveFrom: string;
  perMTok: PerMTokPrices;
}

// Prices are per MTok (1,000,000 tokens); windows within a family are ordered ascending
// by effectiveFrom, and the last window whose date has arrived wins.
const PRICING_TABLE: Record<PricingFamily, PricingWindow[]> = {
  haiku: [
    { effectiveFrom: '', perMTok: { input: 1, output: 5, cacheRead: 0.10, cacheWrite5m: 1.25, cacheWrite1h: 2 } },
  ],
  'sonnet-5': [
    { effectiveFrom: '', perMTok: { input: 2, output: 10, cacheRead: 0.20, cacheWrite5m: 2.50, cacheWrite1h: 4 } },
    { effectiveFrom: '2026-09-01', perMTok: { input: 3, output: 15, cacheRead: 0.30, cacheWrite5m: 3.75, cacheWrite1h: 6 } },
  ],
  opus: [
    { effectiveFrom: '', perMTok: { input: 5, output: 25, cacheRead: 0.50, cacheWrite5m: 6.25, cacheWrite1h: 10 } },
  ],
  fable: [
    { effectiveFrom: '', perMTok: { input: 10, output: 50, cacheRead: 1.00, cacheWrite5m: 12.50, cacheWrite1h: 20 } },
  ],
};

const FAMILY_PATTERNS: ReadonlyArray<readonly [RegExp, PricingFamily]> = [
  [/^claude-opus-4-8/, 'opus'],
  [/^claude-sonnet-5/, 'sonnet-5'],
  [/^claude-haiku-4-5/, 'haiku'],
  [/^claude-fable-5/, 'fable'],
];

/**
 * Maps a harness-reported model id to its pricing family. Finer-grained than the
 * UI's color normalizer (Sonnet 5 carries effective-date ranges here); kept independent.
 */
export function normalizePricingKey(model: string): PricingFamily | null {
  for (const [pattern, family] of FAMILY_PATTERNS) {
    if (pattern.test(model)) return family;
  }
  return null;
}

function pricesFor(family: PricingFamily, at: string): PerMTokPrices | null {
  const date = at.slice(0, 10);
  let selected: PerMTokPrices | null = null;
  for (const window of PRICING_TABLE[family]) {
    if (window.effectiveFrom <= date) selected = window.perMTok;
  }
  return selected;
}

/** Dollars per single token for (model, type) at ISO date `at`; null when model/date unknown. */
export function priceFor(model: string, type: TokenType, at: string): number | null {
  const family = normalizePricingKey(model);
  if (!family) return null;
  const prices = pricesFor(family, at);
  if (!prices) return null;
  return prices[type] / 1_000_000;
}

/**
 * Σ tokenType × priceFor(model, type, row.timestamp); null when the model is unknown
 * ("unavailable"), never a silent $0. Cache-creation tokens price at the 5-minute-TTL
 * write rate — telemetry doesn't record cache TTL and Claude Code uses the 5-min
 * ephemeral cache.
 */
export function dollarsFor(row: PricedRow): number | null {
  const family = normalizePricingKey(row.model);
  if (!family) return null;
  const prices = pricesFor(family, row.timestamp);
  if (!prices) return null;
  return (
    row.inputTokens * prices.input
    + row.outputTokens * prices.output
    + (row.cacheReadTokens ?? 0) * prices.cacheRead
    + (row.cacheCreationTokens ?? 0) * prices.cacheWrite5m
  ) / 1_000_000;
}

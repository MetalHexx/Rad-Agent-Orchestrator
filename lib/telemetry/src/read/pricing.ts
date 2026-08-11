/**
 * Family-keyed, date-aware dollar pricing. No pricing API exists, so dollar cost
 * comes from this maintained table — verified against the pricing docs on 2026-08-05.
 * Keyed by model *family*, not generation: every active generation within a family
 * shares one rate, so a new release prices correctly without editing this file.
 * Dependency-free, browser-safe (no `node:*` imports) so it can be imported as a
 * client leaf, mirroring `./effective-tokens.js`.
 */

/** Recorded into snapshots as a reproducibility marker for the table version used. */
export const PRICING_VERSION = '2026-08-05';

export type TokenType = 'input' | 'output' | 'cacheRead' | 'cacheWrite5m' | 'cacheWrite1h';

export interface PricedRow {
  model: string;
  timestamp: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;        // total cache-write tokens (5m + 1h)
  cacheCreation1hTokens?: number;      // 1h-TTL subset; undefined => price all cache-write at 5m
}

type PricingFamily = 'haiku' | 'sonnet' | 'opus' | 'fable';

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
  sonnet: [
    // List price. The $2/$10 Sonnet 5 intro discount (through 2026-08-31) is intentionally
    // NOT applied: Claude Code's /cost bills Sonnet 5 at list rate, and a dashboard that
    // reads below the terminal erodes trust. Rates converge when the promo ends anyway.
    { effectiveFrom: '', perMTok: { input: 3, output: 15, cacheRead: 0.30, cacheWrite5m: 3.75, cacheWrite1h: 6 } },
  ],
  opus: [
    { effectiveFrom: '', perMTok: { input: 5, output: 25, cacheRead: 0.50, cacheWrite5m: 6.25, cacheWrite1h: 10 } },
  ],
  fable: [
    { effectiveFrom: '', perMTok: { input: 10, output: 50, cacheRead: 1.00, cacheWrite5m: 12.50, cacheWrite1h: 20 } },
  ],
};

// Family prefixes on the modern `claude-<family>-<generation>` id shape — deliberately not
// pinned to a generation, so `claude-opus-5`, a future `claude-opus-6`, a dated snapshot
// (`claude-haiku-4-5-20251001`) and a context-window variant (`claude-opus-5[1m]`) all
// resolve to the family that carries their rate. The family name must be followed by the
// `-<generation>` delimiter, so a lookalike name (`claude-opusplus-1`) can't cross into a
// real family's price; the generation suffix itself stays unanchored and free.
const FAMILY_PATTERNS: ReadonlyArray<readonly [RegExp, PricingFamily]> = [
  [/^claude-opus-/, 'opus'],
  [/^claude-sonnet-/, 'sonnet'],
  [/^claude-haiku-/, 'haiku'],
  [/^claude-fable-/, 'fable'],
  [/^claude-mythos-/, 'fable'],   // Mythos 5 bills at Fable rates
];

/**
 * Maps a harness-reported model id to its pricing family, or null when this table carries
 * no rate for it — callers surface that as "unavailable", never a silent $0.
 *
 * Matching is by family prefix, not exact generation, so a model release does not need a
 * table edit. Legacy pre-2025 ids are excluded by *naming shape* rather than by luck: they
 * put the generation first (`claude-3-opus-20240229`, `claude-3-5-sonnet-20241022`), so they
 * never match these patterns. That is the correct conservative answer — their rates genuinely
 * differed (Opus 3 was $15/$75) and this table does not carry them. A looser substring match
 * would silently misprice them, which is why this stays a prefix match and not `includes()`.
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
 * ("unavailable"), never a silent $0. Cache-creation is split by TTL: the 1h subset
 * (`cacheCreation1hTokens`) prices at the 1h write rate and the remainder at the 5m rate.
 * Claude Code caches its stable prefix for 1h, so pricing the whole total at the 5m rate
 * undercounts. Rows without the split (legacy / other harnesses) price entirely at 5m.
 */
export function dollarsFor(row: PricedRow): number | null {
  const family = normalizePricingKey(row.model);
  if (!family) return null;
  const prices = pricesFor(family, row.timestamp);
  if (!prices) return null;
  const cacheCreate = row.cacheCreationTokens ?? 0;
  const cache1h = Math.min(cacheCreate, row.cacheCreation1hTokens ?? 0); // clamp: 1h ≤ total
  const cache5m = cacheCreate - cache1h;
  return (
    row.inputTokens * prices.input
    + row.outputTokens * prices.output
    + (row.cacheReadTokens ?? 0) * prices.cacheRead
    + cache5m * prices.cacheWrite5m
    + cache1h * prices.cacheWrite1h
  ) / 1_000_000;
}

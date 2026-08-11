import { describe, expect, it } from 'vitest';
import { dollarsFor, priceFor, PRICING_VERSION, type PricedRow, type TokenType } from '../src/read/pricing.js';
import { effectiveTokens } from '../src/read/effective-tokens.js';

const TOKEN_TYPES: TokenType[] = ['input', 'output', 'cacheRead', 'cacheWrite5m', 'cacheWrite1h'];

describe('PRICING_VERSION', () => {
  it('is a non-empty string', () => {
    expect(typeof PRICING_VERSION).toBe('string');
    expect(PRICING_VERSION.length).toBeGreaterThan(0);
  });
});

describe('priceFor', () => {
  it('resolves a per-token price for each family, at any date, for every token type', () => {
    const models = [
      'claude-haiku-4-5-20260101',
      'claude-opus-4-8-20260101',
      'claude-fable-5-20260101',
    ];
    for (const model of models) {
      for (const type of TOKEN_TYPES) {
        const price = priceFor(model, type, '2026-07-11');
        expect(price).not.toBeNull();
        expect(price).toBeGreaterThan(0);
      }
    }
  });

  it('prices Sonnet 5 at its list rate on every date (intro discount not applied)', () => {
    const model = 'claude-sonnet-5-20260101';
    for (const type of TOKEN_TYPES) {
      const early = priceFor(model, type, '2026-07-12'); // during the (unapplied) intro window
      const later = priceFor(model, type, '2026-12-01'); // after the intro window
      expect(early).not.toBeNull();
      expect(later).not.toBeNull();
      // Flat: no intro→standard step. The dashboard matches Claude Code's /cost, which
      // bills Sonnet 5 at list rate regardless of the intro promo.
      expect(early).toBeCloseTo(later!, 12);
    }
  });

  it('prices Sonnet 5 input tokens at the list $3/MTok rate on every date', () => {
    expect(priceFor('claude-sonnet-5-20260101', 'input', '2026-07-12')).toBeCloseTo(3 / 1_000_000, 12);
    expect(priceFor('claude-sonnet-5-20260101', 'input', '2026-09-01')).toBeCloseTo(3 / 1_000_000, 12);
  });

  it('returns null for an unknown model', () => {
    expect(priceFor('claude-unknown-9', 'input', '2026-07-11')).toBeNull();
  });
});

describe('family matching across generations', () => {
  const AT = '2026-08-05';

  it('prices every model id present in live telemetry', () => {
    const models = ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5-20251001'];
    for (const model of models) {
      for (const type of TOKEN_TYPES) {
        expect(priceFor(model, type, AT)).toBeGreaterThan(0);
      }
    }
  });

  it('prices an unreleased future generation at its family rate', () => {
    // The regression guard: pinning a family to one generation blanked Opus 5 as
    // "price unavailable" the day the harness started reporting it.
    const models = ['claude-opus-9', 'claude-sonnet-9', 'claude-haiku-9', 'claude-fable-9'];
    for (const model of models) {
      for (const type of TOKEN_TYPES) {
        expect(priceFor(model, type, AT)).toBeGreaterThan(0);
      }
    }
    expect(priceFor('claude-opus-9', 'input', AT)).toBeCloseTo(priceFor('claude-opus-5', 'input', AT)!, 12);
  });

  it('prices Opus at $5/MTok input and $25/MTok output', () => {
    expect(priceFor('claude-opus-5', 'input', AT)).toBeCloseTo(5 / 1_000_000, 12);
    expect(priceFor('claude-opus-5', 'output', AT)).toBeCloseTo(25 / 1_000_000, 12);
  });

  it('prices a bracketed context-window variant identically to the bare id', () => {
    for (const type of TOKEN_TYPES) {
      const bare = priceFor('claude-opus-5', type, AT);
      // toBeCloseTo treats null as 0, so two unpriced models compare equal — assert
      // priced first or this test passes under the very bug it exists to catch.
      expect(priceFor('claude-opus-5[1m]', type, AT)).toBeGreaterThan(0);
      expect(priceFor('claude-opus-5[1m]', type, AT)).toBeCloseTo(bare!, 12);
    }
  });

  it('prices Mythos at Fable rates', () => {
    for (const type of TOKEN_TYPES) {
      expect(priceFor('claude-mythos-5', type, AT)).toBeGreaterThan(0);
      expect(priceFor('claude-mythos-5', type, AT)).toBeCloseTo(priceFor('claude-fable-5', type, AT)!, 12);
    }
  });

  it('leaves legacy generation-first model ids unpriced rather than guessing a rate', () => {
    // `claude-3-opus` billed $15/$75 — a rate this table does not carry. Null is the
    // honest answer; the naming shape (generation before family) is what excludes them.
    expect(priceFor('claude-3-opus-20240229', 'input', AT)).toBeNull();
    expect(priceFor('claude-3-5-sonnet-20241022', 'input', AT)).toBeNull();
    expect(priceFor('claude-3-haiku-20240307', 'input', AT)).toBeNull();
  });

  it('still returns null for ids outside the claude-<family> shape', () => {
    for (const model of ['claude-unknown-9', 'gpt-5-codex', 'opus', 'sonnet']) {
      expect(priceFor(model, 'input', AT)).toBeNull();
    }
  });

  it('leaves lookalike family-prefix names unpriced (e.g. opusplus is not opus)', () => {
    for (const model of ['claude-opusplus-1', 'claude-sonnetmini-1', 'claude-haikuish-1', 'claude-fabled-1']) {
      expect(priceFor(model, 'input', AT)).toBeNull();
    }
  });
});

describe('dollarsFor', () => {
  function row(model: string, timestamp: string): PricedRow {
    return {
      model,
      timestamp,
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheReadTokens: 1_000_000,
      cacheCreationTokens: 1_000_000,
    };
  }

  it('sums the four priced token types for a single-model row', () => {
    const r = row('claude-haiku-4-5-20260101', '2026-07-11');
    const dollars = dollarsFor(r);
    expect(dollars).not.toBeNull();
    expect(dollars).toBeCloseTo(1 + 5 + 0.10 + 1.25, 6);
  });

  it('prices cache-creation tokens at the 5-minute write rate, not the 1-hour rate', () => {
    const withoutCacheWrite: PricedRow = { ...row('claude-opus-4-8-20260101', '2026-07-11'), cacheCreationTokens: 0 };
    const withCacheWrite = row('claude-opus-4-8-20260101', '2026-07-11');
    const delta = dollarsFor(withCacheWrite)! - dollarsFor(withoutCacheWrite)!;
    const write5m = priceFor('claude-opus-4-8-20260101', 'cacheWrite5m', '2026-07-11')!;
    const write1h = priceFor('claude-opus-4-8-20260101', 'cacheWrite1h', '2026-07-11')!;
    expect(delta).toBeCloseTo(write5m * 1_000_000, 9);
    expect(delta).not.toBeCloseTo(write1h * 1_000_000, 9);
  });

  it('prices each record in a mixed-model set by its own model, never a blended rate', () => {
    const haikuRow = row('claude-haiku-4-5-20260101', '2026-07-11');
    const opusRow = row('claude-opus-4-8-20260101', '2026-07-11');
    const haikuDollars = dollarsFor(haikuRow)!;
    const opusDollars = dollarsFor(opusRow)!;
    const mixedTotal = [haikuRow, opusRow].reduce((sum, r) => sum + (dollarsFor(r) ?? 0), 0);

    expect(haikuDollars).not.toBeCloseTo(opusDollars, 6);
    expect(mixedTotal).toBeCloseTo(haikuDollars + opusDollars, 9);
  });

  it('prices Sonnet 5 at the list rate regardless of the row timestamp (intro discount not applied)', () => {
    const early = row('claude-sonnet-5-20260101', '2026-07-12'); // during the (unapplied) intro window
    const later = row('claude-sonnet-5-20260101', '2026-12-01'); // after the intro window
    expect(dollarsFor(early)).toBeCloseTo(dollarsFor(later)!, 9);
  });

  it('returns null (never 0) for an unknown model', () => {
    const r = row('claude-unknown-9', '2026-07-11');
    expect(dollarsFor(r)).toBeNull();
  });

  it('prices a bare current-generation id, so no live row falls through to null', () => {
    const r = row('claude-opus-5', '2026-08-05');
    expect(dollarsFor(r)).toBeCloseTo(5 + 25 + 0.50 + 6.25, 6);
  });

  it('matches effectiveTokens weighted by the input rate (cross-check, not a code dependency)', () => {
    const r = row('claude-fable-5-20260101', '2026-07-11');
    const inputPrice = priceFor(r.model, 'input', r.timestamp)!;
    expect(dollarsFor(r)).toBeCloseTo(effectiveTokens(r) * inputPrice, 6);
  });
});

describe('cache-write TTL split (1h vs 5m)', () => {
  const MODEL = 'claude-opus-4-8-20260101';
  const AT = '2026-07-11';

  it('prices the 1h subset at the 1h rate and the remainder at the 5m rate', () => {
    // 1,000,000 cache-creation tokens, 600k of them 1-hour writes.
    const r: PricedRow = {
      model: MODEL, timestamp: AT, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0,
      cacheCreationTokens: 1_000_000, cacheCreation1hTokens: 600_000,
    };
    const write5m = priceFor(MODEL, 'cacheWrite5m', AT)!;
    const write1h = priceFor(MODEL, 'cacheWrite1h', AT)!;
    const expected = 400_000 * write5m + 600_000 * write1h;
    expect(dollarsFor(r)).toBeCloseTo(expected, 9);
  });

  it('prices an all-1h cache-write row strictly higher than the all-5m default (the undercount fix)', () => {
    const base = { model: MODEL, timestamp: AT, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 1_000_000 };
    const all5m: PricedRow = { ...base };                                // legacy: no split → all 5m
    const all1h: PricedRow = { ...base, cacheCreation1hTokens: 1_000_000 };
    expect(dollarsFor(all1h)! > dollarsFor(all5m)!).toBe(true);
    // Opus: 1h write $10/MTok vs 5m $6.25/MTok → 1.6× more for the cache-creation line.
    expect(dollarsFor(all1h)!).toBeCloseTo(10, 6);
    expect(dollarsFor(all5m)!).toBeCloseTo(6.25, 6);
  });

  it('effectiveTokens weights the 1h subset at 2x and the remainder at 1.25x', () => {
    const r = {
      inputTokens: 0, outputTokens: 0, cacheReadTokens: 0,
      cacheCreationTokens: 1_000_000, cacheCreation1hTokens: 600_000,
    };
    expect(effectiveTokens(r)).toBeCloseTo(400_000 * 1.25 + 600_000 * 2, 6);
  });

  it('keeps the effectiveTokens×inputRate == dollarsFor identity exact even with 1h writes present', () => {
    const r: PricedRow = {
      model: MODEL, timestamp: AT, inputTokens: 123, outputTokens: 456, cacheReadTokens: 7_890,
      cacheCreationTokens: 1_000_000, cacheCreation1hTokens: 1_000_000,
    };
    const inputPrice = priceFor(MODEL, 'input', AT)!;
    expect(dollarsFor(r)).toBeCloseTo(effectiveTokens(r) * inputPrice, 9);
  });

  it('clamps a 1h count that exceeds the total (never a negative 5m share)', () => {
    const r: PricedRow = {
      model: MODEL, timestamp: AT, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0,
      cacheCreationTokens: 1_000_000, cacheCreation1hTokens: 5_000_000, // malformed: 1h > total
    };
    const write1h = priceFor(MODEL, 'cacheWrite1h', AT)!;
    expect(dollarsFor(r)).toBeCloseTo(1_000_000 * write1h, 6); // clamped to the total, all at 1h
    expect(effectiveTokens(r)).toBeCloseTo(1_000_000 * 2, 6);
  });
});

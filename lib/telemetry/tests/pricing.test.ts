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

  it('crosses the Sonnet 5 intro/standard boundary correctly across all token types', () => {
    const model = 'claude-sonnet-5-20260101';
    for (const type of TOKEN_TYPES) {
      const introSide = priceFor(model, type, '2026-08-31');
      const standardSide = priceFor(model, type, '2026-09-01');
      expect(introSide).not.toBeNull();
      expect(standardSide).not.toBeNull();
      // The standard row is strictly higher than the intro row for every token type.
      expect(standardSide! > introSide!).toBe(true);
    }
  });

  it('prices Sonnet 5 input tokens exactly at the documented per-MTok rates on each side', () => {
    expect(priceFor('claude-sonnet-5-20260101', 'input', '2026-08-31')).toBeCloseTo(2 / 1_000_000, 12);
    expect(priceFor('claude-sonnet-5-20260101', 'input', '2026-09-01')).toBeCloseTo(3 / 1_000_000, 12);
  });

  it('returns null for an unknown model', () => {
    expect(priceFor('claude-unknown-9', 'input', '2026-07-11')).toBeNull();
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

  it('selects the Sonnet 5 rate by the row own timestamp, not a fixed rate', () => {
    const introRow = row('claude-sonnet-5-20260101', '2026-08-31');
    const standardRow = row('claude-sonnet-5-20260101', '2026-09-01');
    expect(dollarsFor(standardRow)! > dollarsFor(introRow)!).toBe(true);
  });

  it('returns null (never 0) for an unknown model', () => {
    const r = row('claude-unknown-9', '2026-07-11');
    expect(dollarsFor(r)).toBeNull();
  });

  it('matches effectiveTokens weighted by the input rate (cross-check, not a code dependency)', () => {
    const r = row('claude-fable-5-20260101', '2026-07-11');
    const inputPrice = priceFor(r.model, 'input', r.timestamp)!;
    expect(dollarsFor(r)).toBeCloseTo(effectiveTokens(r) * inputPrice, 6);
  });
});

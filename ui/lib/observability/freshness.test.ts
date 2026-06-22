import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshness } from './freshness';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const row = (t: string) => ({ timestamp: t } as any);

test('returns the latest timestamp and elapsed since now (AD-4, FR-5)', () => {
  const now = Date.parse('2026-06-21T12:00:10Z');
  const f = freshness([row('2026-06-21T12:00:00Z'), row('2026-06-21T12:00:05Z')], now);
  assert.equal(f.latestMs, Date.parse('2026-06-21T12:00:05Z'));
  assert.equal(f.msSinceActivity, 5000);
});

test('idle when there are no rows → latest 0, elapsed Infinity (AD-4, FR-5, DD-12)', () => {
  const f = freshness([], Date.parse('2026-06-21T12:00:00Z'));
  assert.equal(f.latestMs, 0);
  assert.equal(f.msSinceActivity, Infinity);
});

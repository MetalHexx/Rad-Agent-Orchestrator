import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sumRawTokens } from './raw-tokens';

test('sums the four raw fields across rows — cumulative over main + subagents (FR-4, FR-6)', () => {
  const totals = sumRawTokens([
    { inputTokens: 100, outputTokens: 20, cacheReadTokens: 5000, cacheCreationTokens: 40 },
    { inputTokens: 50, outputTokens: 10, cacheReadTokens: 1000, cacheCreationTokens: 60 },
  ]);
  assert.deepEqual(totals, { input: 150, output: 30, cacheRead: 6000, cacheCreate: 100 });
});

test('treats missing optional cache fields as zero (FR-6, NFR-1)', () => {
  const totals = sumRawTokens([{ inputTokens: 10, outputTokens: 5 }]);
  assert.deepEqual(totals, { input: 10, output: 5, cacheRead: 0, cacheCreate: 0 });
});

test('returns all-zero totals for an empty row set (FR-4)', () => {
  assert.deepEqual(sumRawTokens([]), { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 });
});

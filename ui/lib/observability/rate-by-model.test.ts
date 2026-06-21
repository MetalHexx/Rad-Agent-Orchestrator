import { test } from 'node:test';
import assert from 'node:assert/strict';
import { timeBucketedRateByModel } from './sessions';
import type { ObservabilityUsageRow } from '@rad-orchestration/telemetry';

function row(model: string, ms: number, outputTokens: number): ObservabilityUsageRow {
  return {
    sessionId: 's', usageId: `${model}-${ms}`, timestamp: new Date(ms).toISOString(),
    inputTokens: 0, outputTokens, model, source: 'main-agent',
  } as ObservabilityUsageRow;
}

test('splits each bucket by model; per-model columns sum to the total (FR-6, AD-3, FR-3)', () => {
  const rows = [ row('claude-opus-4-8', 50_000, 10), row('claude-haiku-4-5', 50_000, 4), row('claude-opus-4-8', 150_000, 2) ];
  const pts = timeBucketedRateByModel(rows, { endMs: 600_000, windowMs: 600_000, buckets: 12, anchor: 'window' });
  const sum = pts.reduce((a, p) => a + p.total, 0);
  const opus = pts.reduce((a, p) => a + ((p['claude-opus-4-8'] as number) ?? 0), 0);
  const haiku = pts.reduce((a, p) => a + ((p['claude-haiku-4-5'] as number) ?? 0), 0);
  assert.equal(sum, (10 + 4 + 2) * 5, 'total equals summed effective tokens (output*5)');
  assert.equal(opus, (10 + 2) * 5, 'opus column sums its rows');
  assert.equal(haiku, 4 * 5, 'haiku column sums its rows');
  assert.equal(opus + haiku, sum, 'per-model columns sum to total (FR-3)');
});

test('every point carries a numeric total, even with no rows (FR-6)', () => {
  const pts = timeBucketedRateByModel([], { endMs: 1_000, windowMs: 1_000, buckets: 4 });
  assert.equal(pts.length, 4);
  for (const p of pts) assert.equal(p.total, 0);
});

test('idle buckets read 0 for every known model — lines drop to 0, never break (continuous)', () => {
  // opus logs in two separate buckets; haiku logs once. Buckets where a model has no rows must
  // carry that model's key as the number 0 (not undefined), so recharts draws an unbroken line
  // that dips to 0 instead of breaking across the gap.
  const rows = [ row('claude-opus-4-8', 50_000, 10), row('claude-haiku-4-5', 50_000, 4), row('claude-opus-4-8', 250_000, 2) ];
  const pts = timeBucketedRateByModel(rows, { endMs: 600_000, windowMs: 600_000, buckets: 12, anchor: 'window' });
  for (const p of pts) {
    assert.ok('claude-opus-4-8' in p, 'opus key present in every bucket');
    assert.ok('claude-haiku-4-5' in p, 'haiku key present in every bucket');
    assert.equal(typeof p['claude-opus-4-8'], 'number', 'opus value is numeric (0 when idle)');
    assert.equal(typeof p['claude-haiku-4-5'], 'number', 'haiku value is numeric (0 when idle)');
  }
  // The buckets where haiku never logged must be exactly 0, not absent.
  const idleHaiku = pts.filter((p) => p.t !== pts.find((q) => (q['claude-haiku-4-5'] as number) > 0)?.t);
  assert.ok(idleHaiku.length > 0, 'there are idle haiku buckets to check');
  for (const p of idleHaiku) assert.equal(p['claude-haiku-4-5'], 0, 'idle haiku bucket is 0');
});

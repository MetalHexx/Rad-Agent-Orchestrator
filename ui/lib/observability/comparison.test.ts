import assert from 'node:assert';
import { computeDelta, METRICS } from './comparison';
let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n    ${e instanceof Error ? e.message : String(e)}`); failed++; }
}
test('lower candidate is an improvement for lower-better (DD-7)', () => {
  const d = computeDelta(100, 80, 'lower-better');
  assert.strictEqual(Math.round(d.pct! * 100), -20);
  assert.strictEqual(d.improved, true);
});
test('higher candidate is a regression for lower-better (DD-7)', () => {
  assert.strictEqual(computeDelta(100, 130, 'lower-better').improved, false);
});
test('equal values are neutral; neutral direction never scores (DD-7)', () => {
  assert.strictEqual(computeDelta(100, 100, 'lower-better').improved, null);
  assert.strictEqual(computeDelta(1, 2, 'neutral').pct, null);
});
test('lower cost is an improvement for cost pairs', () => {
  const d = computeDelta(10, 8, 'lower-better');
  assert.strictEqual(Math.round(d.pct! * 100), -20);
  assert.strictEqual(d.improved, true);
});
const costUsdSpec = METRICS.find((m) => m.key === 'costUsd')!;
const baseSnapshot = { worktree: null, model: null, startedAt: '', durationMs: 0, totalSpend: 0,
  tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }, toolCalls: 0, toolErrors: 0, subagents: 0, filesTouched: 0,
  costUsd: 1.5, pricingVersion: 'v1', harness: null };
test('costUsd MetricSpec reads snapshot.costUsd, is lower-better, and formats as USD', () => {
  assert.strictEqual(costUsdSpec.label, 'Cost (USD)');
  assert.strictEqual(costUsdSpec.direction, 'lower-better');
  assert.strictEqual(costUsdSpec.get(baseSnapshot), 1.5);
  assert.strictEqual(costUsdSpec.format!(1.5), '$1.50');
});
test('costUsd MetricSpec.get returns null for an unknown-priced (null costUsd) snapshot', () => {
  assert.strictEqual(costUsdSpec.get({ ...baseSnapshot, costUsd: null }), null);
});
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

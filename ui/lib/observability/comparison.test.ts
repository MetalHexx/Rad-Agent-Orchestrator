import assert from 'node:assert';
import { computeDelta } from './comparison';
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
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

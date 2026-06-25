import assert from 'node:assert';
import { toggleSelection, selectedCount, canCompare, type SelectionState } from './selection';
let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n    ${e instanceof Error ? e.message : String(e)}`); failed++; }
}
const empty: SelectionState = { baseline: null, candidate: null };
test('first pick is the baseline (DD-5)', () => {
  assert.deepStrictEqual(toggleSelection(empty, 'a'), { baseline: 'a', candidate: null });
});
test('second pick is the candidate; both selected can compare (FR-6)', () => {
  const s = toggleSelection(toggleSelection(empty, 'a'), 'b');
  assert.deepStrictEqual(s, { baseline: 'a', candidate: 'b' });
  assert.strictEqual(selectedCount(s), 2);
  assert.strictEqual(canCompare(s), true);
});
test('third pick replaces the candidate, never the baseline (DD-5)', () => {
  let s = toggleSelection(toggleSelection(empty, 'a'), 'b');
  s = toggleSelection(s, 'c');
  assert.deepStrictEqual(s, { baseline: 'a', candidate: 'c' });
});
test('clicking the baseline deselects only the baseline (DD-5)', () => {
  let s = toggleSelection(toggleSelection(empty, 'a'), 'b');
  s = toggleSelection(s, 'a');
  assert.deepStrictEqual(s, { baseline: null, candidate: 'b' });
});
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

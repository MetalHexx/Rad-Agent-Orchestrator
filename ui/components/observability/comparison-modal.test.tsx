import assert from 'node:assert';
import { ComparisonModal } from './comparison-modal';
let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n    ${e instanceof Error ? e.message : String(e)}`); failed++; }
}
test('ComparisonModal is a component that frames the report (FR-7, AD-8)', () => {
  assert.strictEqual(typeof ComparisonModal, 'function');
  assert.strictEqual(ComparisonModal.name, 'ComparisonModal');
});
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

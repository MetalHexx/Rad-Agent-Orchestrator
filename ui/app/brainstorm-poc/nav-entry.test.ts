import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const navSource = readFileSync(
  join(__dirname, '..', '..', 'components', 'layout', 'app-header-shell.tsx'),
  'utf-8',
);

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n    ${e instanceof Error ? e.message : String(e)}`); failed++; }
}

console.log('Brainstorm POC nav entry');
test('NAV_LINKS includes the /brainstorm-poc route', () => {
  assert.ok(navSource.includes('"/brainstorm-poc"') || navSource.includes("'/brainstorm-poc'"));
});
test('NAV_LINKS includes the "Brainstorm POC" label', () => {
  assert.ok(navSource.includes('Brainstorm POC'));
});
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

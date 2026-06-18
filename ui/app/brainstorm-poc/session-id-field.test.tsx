import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { SessionIdField } from './session-id-field';

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, 'session-id-field.tsx'), 'utf-8');
const panel = readFileSync(join(__dirname, 'chat-panel.tsx'), 'utf-8');

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n    ${e instanceof Error ? e.message : String(e)}`); failed++; }
}

console.log('SessionIdField');
test('SessionIdField is an exported function', () => {
  assert.strictEqual(typeof SessionIdField, 'function');
});
test('renders an editable Input bound to value + change handler (DD-3)', () => {
  assert.ok(source.includes('@/components/ui/input'));
  assert.ok(source.includes('value={sessionId}'));
  assert.ok(source.includes('onSessionIdChange'));
});
test('offers a New session reset action (FR-5)', () => {
  assert.ok(source.includes('onNewSession'));
  assert.ok(source.toLowerCase().includes('new session'));
});
test('frames the resume / hijack probe (FR-5)', () => {
  assert.ok(source.toLowerCase().includes('resume'));
});
test('chat panel mounts the field and owns the session client-side (FR-5)', () => {
  assert.ok(panel.includes('SessionIdField'));
  assert.ok(panel.includes('crypto.randomUUID'));
});
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

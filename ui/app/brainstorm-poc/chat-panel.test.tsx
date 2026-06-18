import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { ChatPanel } from './chat-panel';

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, 'chat-panel.tsx'), 'utf-8');

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n    ${e instanceof Error ? e.message : String(e)}`); failed++; }
}

console.log('ChatPanel');
test('ChatPanel is an exported function', () => {
  assert.strictEqual(typeof ChatPanel, 'function');
});
test('is a client component', () => {
  assert.ok(source.includes('"use client"') || source.includes("'use client'"));
});
test('is built from house shadcn components (DD-1)', () => {
  assert.ok(source.includes('@/components/ui/card'));
  assert.ok(source.includes('@/components/ui/scroll-area'));
  assert.ok(source.includes('@/components/ui/button'));
  assert.ok(source.includes('@/components/ui/textarea'));
});
test('talks to the POC endpoint (FR-3)', () => {
  assert.ok(source.includes('/api/brainstorm-poc'));
});
test('shows a batched thinking indicator (FR-6, DD-2)', () => {
  assert.ok(source.toLowerCase().includes('thinking'));
});
test('tracks and sends the session id (FR-4)', () => {
  assert.ok(source.includes('sessionId'));
});
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

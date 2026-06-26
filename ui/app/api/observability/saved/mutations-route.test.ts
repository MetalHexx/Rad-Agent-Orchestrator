import assert from 'node:assert';
import os from 'node:os'; import fs from 'node:fs'; import path from 'node:path';
import { saveSession } from '@rad-orchestration/telemetry';

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n    ${e instanceof Error ? e.message : String(e)}`); failed++; }
}
const SNAP = { worktree: null, model: null, startedAt: '', durationMs: 0, totalSpend: 0,
  tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }, toolCalls: 0, toolErrors: 0, subagents: 0, filesTouched: 0 };
async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apimut-'));
  process.env.RADORC_TELEMETRY_ROOT = root;
  saveSession(root, { sessionId: 's1', snapshot: SNAP });
  const route = await import('./[sessionId]/route');

  await test('PATCH renames a saved session (FR-5)', async () => {
    const res = await route.PATCH(new Request('http://x', { method: 'PATCH', body: JSON.stringify({ title: 'Run A' }) }), { params: { sessionId: 's1' } });
    assert.strictEqual(res.status, 200);
    assert.strictEqual((await res.json()).saved.title, 'Run A');
  });
  await test('PATCH on unknown session is 404 (AD-6)', async () => {
    const res = await route.PATCH(new Request('http://x', { method: 'PATCH', body: JSON.stringify({ title: 'x' }) }), { params: { sessionId: 'ghost' } });
    assert.strictEqual(res.status, 404);
  });
  await test('DELETE unsaves a session (FR-2, AD-9)', async () => {
    const res = await route.DELETE(new Request('http://x'), { params: { sessionId: 's1' } });
    assert.strictEqual(res.status, 200);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}
run();

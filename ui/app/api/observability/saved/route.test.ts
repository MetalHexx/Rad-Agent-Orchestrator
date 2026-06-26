import assert from 'node:assert';
import os from 'node:os'; import fs from 'node:fs'; import path from 'node:path';
import { saveSession } from '@rad-orchestration/telemetry';

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n    ${e instanceof Error ? e.message : String(e)}`); failed++; }
}
const SNAP = { worktree: null, model: null, startedAt: '', durationMs: 0, totalSpend: 0,
  tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }, toolCalls: 0, toolErrors: 0, subagents: 0, filesTouched: 0 };

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'api-'));
  process.env.RADORC_TELEMETRY_ROOT = root;
  saveSession(root, { sessionId: 's1', snapshot: SNAP });
  const list = await import('./route');
  const isSaved = await import('./[sessionId]/route');

  await test('GET list returns saved sessions (FR-4)', async () => {
    const res = await list.GET();
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.saved[0].sessionId, 's1');
  });
  await test('GET [sessionId] reports saved state (FR-3)', async () => {
    const yes = await (await isSaved.GET(new Request('http://x'), { params: { sessionId: 's1' } })).json();
    const no = await (await isSaved.GET(new Request('http://x'), { params: { sessionId: 'nope' } })).json();
    assert.strictEqual(yes.saved, true);
    assert.strictEqual(no.saved, false);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}
run();

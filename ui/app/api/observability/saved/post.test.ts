import assert from 'node:assert';
import os from 'node:os'; import fs from 'node:fs'; import path from 'node:path';
import { NdjsonSink } from '@rad-orchestration/telemetry';

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n    ${e instanceof Error ? e.message : String(e)}`); failed++; }
}
async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apipost-'));
  process.env.RADORC_TELEMETRY_ROOT = root;
  new NdjsonSink({ root }).write([{ schemaVersion: 1, harness: 'claude-code', usageId: 'u1', sessionId: 's1',
    timestamp: '2026-06-20T12:00:00Z', model: 'm', inputTokens: 10, outputTokens: 2, source: 'main-agent',
    pointers: { sourceFile: 'f.jsonl' } } as never]);
  const route = await import('./route');

  await test('POST with sessionId saves and computes a snapshot (FR-1, FR-9)', async () => {
    const res = await route.POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ sessionId: 's1' }) }));
    assert.strictEqual(res.status, 201);
    const body = await res.json();
    assert.strictEqual(body.saved.sessionId, 's1');
    assert.strictEqual(body.saved.title, 's1');
    assert.ok(body.saved.snapshot.totalSpend > 0);
  });
  await test('POST without sessionId is a 400 (AD-6)', async () => {
    const res = await route.POST(new Request('http://x', { method: 'POST', body: JSON.stringify({}) }));
    assert.strictEqual(res.status, 400);
    assert.strictEqual((await res.json()).error.field, 'sessionId');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}
run();

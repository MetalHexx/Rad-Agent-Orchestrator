import assert from 'node:assert';
import { listSaved, fetchIsSaved, saveSession, renameSaved, unsaveSession } from './saved-client';

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n    ${e instanceof Error ? e.message : String(e)}`); failed++; }
}
type Call = { url: string; method: string; body?: string };
function stub(json: unknown, ok = true): Call[] {
  const calls: Call[] = [];
  (globalThis as { fetch?: unknown }).fetch = async (url: string, init?: { method?: string; body?: string }) => {
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body });
    return { ok, json: async () => json } as unknown as Response;
  };
  return calls;
}
async function run() {
  await test('listSaved GETs the collection (FR-3)', async () => {
    const calls = stub({ saved: [{ sessionId: 's1' }] });
    const out = await listSaved();
    assert.strictEqual(calls[0].url, '/api/observability/saved');
    assert.strictEqual(out[0].sessionId, 's1');
  });
  await test('saveSession POSTs the id (DD-1, AD-7)', async () => {
    const calls = stub({ saved: { sessionId: 's1' } });
    await saveSession('s1');
    assert.strictEqual(calls[0].method, 'POST');
    assert.deepStrictEqual(JSON.parse(calls[0].body!), { sessionId: 's1' });
  });
  await test('fetchIsSaved GETs the session-level saved flag by id (FR-3)', async () => {
    const calls = stub({ saved: true });
    const result = await fetchIsSaved('s1');
    assert.strictEqual(calls[0].url, '/api/observability/saved/s1');
    assert.strictEqual(result, true);
  });
  await test('renameSaved PATCHes the title; unsave DELETEs (FR-3)', async () => {
    const c1 = stub({ saved: { sessionId: 's1', title: 'X' } });
    await renameSaved('s1', 'X');
    assert.strictEqual(c1[0].method, 'PATCH');
    assert.strictEqual(c1[0].url, '/api/observability/saved/s1');
    const c2 = stub({ success: true });
    await unsaveSession('s1');
    assert.strictEqual(c2[0].method, 'DELETE');
  });
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}
run();

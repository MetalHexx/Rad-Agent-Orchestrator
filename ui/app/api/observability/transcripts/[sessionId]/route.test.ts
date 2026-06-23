import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function seedRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'tx-route-'));
  const dir = join(root, 'transcripts', 'sess'); mkdirSync(dir, { recursive: true });
  const main = { transcriptId: 'sess', sessionId: 'sess', harness: 'claude-code', role: 'main', model: ['m'],
    tokens: { in: 0, out: 0, cacheRead: 0, cacheCreate: 0 }, toolSummary: { total: 0, byName: {}, errors: 0 }, filesTouched: [], events: [] };
  writeFileSync(join(dir, 'main.json'), JSON.stringify(main));
  return root;
}

test('GET tree returns the session agent tree with no-store (FR-7, AD-8, DD-2)', async () => {
  process.env.RADORC_TELEMETRY_ROOT = seedRoot();
  const { GET } = await import('./route');
  const res = await GET(new Request('http://t/api/observability/transcripts/sess'), { params: { sessionId: 'sess' } });
  const body = await res.json();
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(body.tree.length, 1);
  assert.equal(body.tree[0].transcriptId, 'sess');
});

test('GET tree on an empty store returns { tree: [] }, not an error (FR-7)', async () => {
  process.env.RADORC_TELEMETRY_ROOT = mkdtempSync(join(tmpdir(), 'tx-empty-'));
  const { GET } = await import('./route');
  const res = await GET(new Request('http://t/api/observability/transcripts/none'), { params: { sessionId: 'none' } });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { tree: [] });
});

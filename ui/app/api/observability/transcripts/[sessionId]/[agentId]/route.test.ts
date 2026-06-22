import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// seedAgent=true writes agent-a_1.json into transcripts/sess/; false leaves the dir empty.
function seedRoot(seedAgent: boolean): string {
  const root = mkdtempSync(join(tmpdir(), 'tx-agent-route-'));
  const dir = join(root, 'transcripts', 'sess'); mkdirSync(dir, { recursive: true });
  if (seedAgent) {
    const agent = { transcriptId: 'a_1', sessionId: 'sess', harness: 'claude-code', role: 'subagent', model: ['m'],
      tokens: { in: 0, out: 0, cacheRead: 0, cacheCreate: 0 }, toolSummary: { total: 0, byName: {}, errors: 0 }, filesTouched: [], events: [] };
    writeFileSync(join(dir, 'agent-a_1.json'), JSON.stringify(agent));
  }
  return root;
}

test('GET per-agent transcript returns 404 NOT_FOUND when absent (FR-7, AD-8)', async () => {
  process.env.RADORC_TELEMETRY_ROOT = seedRoot(false);
  const { GET } = await import('./route');
  const res = await GET(new Request('http://t/api/observability/transcripts/sess/missing'), { params: { sessionId: 'sess', agentId: 'missing' } });
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.error.code, 'NOT_FOUND');
});

test('GET per-agent transcript returns 200 { transcript } with no-store on a hit (FR-7, AD-8)', async () => {
  process.env.RADORC_TELEMETRY_ROOT = seedRoot(true);
  const { GET } = await import('./route');
  const res = await GET(new Request('http://t/api/observability/transcripts/sess/a_1'), { params: { sessionId: 'sess', agentId: 'a_1' } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const body = await res.json();
  assert.equal(body.transcript.transcriptId, 'a_1');
});

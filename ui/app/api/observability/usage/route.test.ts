import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('GET projects rows for the requested UTC range and drops pointers (FR-5, FR-6)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'obs-'));
  const dir = join(root, 'usage'); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'usage-2026-06-17-s1.ndjson'),
    JSON.stringify({ usageId: 'u1', sessionId: 's1', timestamp: '2026-06-17T00:00:00Z', inputTokens: 1, outputTokens: 2, pointers: { sourceFile: '/log.jsonl' } }) + '\n');
  process.env.RADORC_TELEMETRY_ROOT = root;
  const { GET } = await import('./route');
  const res = await GET(new Request('http://t/api/observability/usage?startDate=2026-06-17&endDate=2026-06-17'));
  const body = await res.json();
  assert.equal(body.rows.length, 1);
  assert.equal(body.rows[0].usageId, 'u1');
  assert.equal('pointers' in body.rows[0], false);
});

test('GET on an empty/absent store returns { rows: [] }, not an error (FR-3, DD-4)', async () => {
  process.env.RADORC_TELEMETRY_ROOT = mkdtempSync(join(tmpdir(), 'obs-empty-'));
  const { GET } = await import('./route');
  const res = await GET(new Request('http://t/api/observability/usage?startDate=2026-06-17&endDate=2026-06-17'));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { rows: [] });
});

test('GET sets Cache-Control: no-store on the response (FR-6)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'obs-nostore-'));
  const dir = join(root, 'usage'); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'usage-2026-06-17-s1.ndjson'),
    JSON.stringify({ usageId: 'u1', sessionId: 's1', timestamp: '2026-06-17T00:00:00Z', inputTokens: 1, outputTokens: 2 }) + '\n');
  process.env.RADORC_TELEMETRY_ROOT = root;
  const { GET } = await import('./route');
  const res = await GET(new Request('http://t/api/observability/usage?startDate=2026-06-17&endDate=2026-06-17'));
  assert.equal(res.headers.get('cache-control'), 'no-store', 'FR-6 requires the route to set cache: no-store');
});

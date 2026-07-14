import { describe, expect, it } from 'vitest';
import { BUILT_IN_NODE_TYPES } from '@rad-orchestration/graph-node-types';
import { compose } from '../../src/compose.js';
import { buildApp } from '../../src/http/app.js';

function buildTestApp() {
  return buildApp(compose({ dbPath: ':memory:', builtInNodeTypes: BUILT_IN_NODE_TYPES }));
}

describe('GET /health', () => {
  it('returns exactly the specified field set with real values', async () => {
    const app = buildTestApp();
    const res = await app.request('/health');
    expect(res.status).toBe(200);

    const body = (await res.json()) as { ok: boolean; data: Record<string, unknown> };
    expect(body.ok).toBe(true);
    expect(Object.keys(body.data).sort()).toEqual(
      ['dbPath', 'engine', 'pid', 'service', 'uptimeMs', 'user_version'].sort(),
    );

    expect(body.data['dbPath']).toBe(':memory:');
    expect(body.data['service']).toEqual(expect.any(String));
    expect(body.data['engine']).toEqual(expect.any(String));
    expect(body.data['pid']).toBe(process.pid);
    expect(body.data['uptimeMs']).toEqual(expect.any(Number));
    expect(body.data['user_version']).toEqual(expect.any(Number));
  });
});

describe('unknown routes', () => {
  it('return the envelope failure shape instead of a framework default page', async () => {
    const app = buildTestApp();
    const res = await app.request('/no-such-route');
    expect(res.status).toBe(404);

    const body = (await res.json()) as { ok: boolean; error?: { code: string; message: string } };
    expect(body.ok).toBe(false);
    expect(body.error).toBeDefined();
    expect(typeof body.error?.code).toBe('string');
    expect(typeof body.error?.message).toBe('string');
  });
});

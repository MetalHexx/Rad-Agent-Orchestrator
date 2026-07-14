import { describe, expect, it } from 'vitest';
import { ProjectHandle } from '../src/handle.js';
import { GraphClientError } from '../src/errors.js';
import type { GraphClientConfig } from '../src/client.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

interface SeenRequest {
  url: string;
  init?: RequestInit;
}

function configCapturing(body: unknown, status = 200): { config: GraphClientConfig; seen: SeenRequest[] } {
  const seen: SeenRequest[] = [];
  const stub = (async (url: string, init?: RequestInit) => {
    seen.push({ url, init });
    return jsonResponse(status, body);
  }) as typeof fetch;
  return { config: { baseUrl: 'http://127.0.0.1:1', fetch: stub }, seen };
}

function parsedBody(seen: SeenRequest[]): Record<string, unknown> {
  return JSON.parse(seen[0]!.init!.body as string) as Record<string, unknown>;
}

describe('ProjectHandle steer methods', () => {
  const delta = { primitive: 'add_dependency', params: {}, nodeChanges: [], edgeChanges: [] };

  it('addDependency posts { primitive, params: { from, to } } to /engine-graph/steer', async () => {
    const { config, seen } = configCapturing({ ok: true, data: delta });
    const handle = new ProjectHandle('p1', config);
    const result = await handle.addDependency('a', 'b');

    expect(seen[0]!.url).toBe('http://127.0.0.1:1/engine-graph/steer');
    expect(parsedBody(seen)).toEqual({ project: 'p1', primitive: 'add_dependency', params: { from: 'a', to: 'b' } });
    expect(result).toEqual(delta);
  });

  it('removeNode threads the strategy through untouched, including optional children', async () => {
    const { config, seen } = configCapturing({ ok: true, data: delta });
    const handle = new ProjectHandle('p1', config);
    await handle.removeNode('n1', { dependents: 'heal', children: 'promote' });

    expect(parsedBody(seen)).toEqual({
      project: 'p1',
      primitive: 'remove_node',
      params: { nodeId: 'n1', strategy: { dependents: 'heal', children: 'promote' } },
    });
  });

  it('removeNode works with only the required dependents strategy field', async () => {
    const { config, seen } = configCapturing({ ok: true, data: delta });
    const handle = new ProjectHandle('p1', config);
    await handle.removeNode('n1', { dependents: 'cascade' });

    expect(parsedBody(seen)).toEqual({
      project: 'p1',
      primitive: 'remove_node',
      params: { nodeId: 'n1', strategy: { dependents: 'cascade' } },
    });
  });

  it('moveNode posts { nodeId, newParent }', async () => {
    const { config, seen } = configCapturing({ ok: true, data: delta });
    const handle = new ProjectHandle('p1', config);
    await handle.moveNode('n1', 'n2');

    expect(parsedBody(seen)).toEqual({
      project: 'p1',
      primitive: 'move_node',
      params: { nodeId: 'n1', newParent: 'n2' },
    });
  });

  it('expand posts { node, expansion }', async () => {
    const { config, seen } = configCapturing({ ok: true, data: delta });
    const handle = new ProjectHandle('p1', config);
    await handle.expand('n1', { specs: [{ kind: 'task' }] });

    expect(parsedBody(seen)).toEqual({
      project: 'p1',
      primitive: 'expand',
      params: { node: 'n1', expansion: { specs: [{ kind: 'task' }] } },
    });
  });

  it('addCorrective posts { review, id, type, options }', async () => {
    const { config, seen } = configCapturing({ ok: true, data: delta });
    const handle = new ProjectHandle('p1', config);
    await handle.addCorrective('review1', 'fix1', 'task:fix', { note: 'x' });

    expect(parsedBody(seen)).toEqual({
      project: 'p1',
      primitive: 'add_corrective',
      params: { review: 'review1', id: 'fix1', type: 'task:fix', options: { note: 'x' } },
    });
  });

  it('reset posts { node, cascade }', async () => {
    const { config, seen } = configCapturing({ ok: true, data: delta });
    const handle = new ProjectHandle('p1', config);
    await handle.reset('n1', true);

    expect(parsedBody(seen)).toEqual({
      project: 'p1',
      primitive: 'reset',
      params: { node: 'n1', cascade: true },
    });
  });

  it('surfaces an engine legality failure (e.g. cycle) as a thrown GraphClientError', async () => {
    const { config } = configCapturing({ ok: false, error: { code: 'cycle', message: 'would create a cycle' } }, 400);
    const handle = new ProjectHandle('p1', config);

    let caught: unknown;
    try {
      await handle.addDependency('a', 'b');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(GraphClientError);
    expect((caught as GraphClientError).code).toBe('cycle');
  });
});

describe('ProjectHandle.dryRun', () => {
  it('posts { project, mutation } to /engine-graph/dry-run and unwraps the response', async () => {
    const { config, seen } = configCapturing({ ok: true, data: { valid: true, preview: { touched: ['n1'] } } });
    const handle = new ProjectHandle('p1', config);
    const result = await handle.dryRun({ kind: 'move_node', nodeId: 'n1', newParent: 'n2' });

    expect(seen[0]!.url).toBe('http://127.0.0.1:1/engine-graph/dry-run');
    expect(parsedBody(seen)).toEqual({
      project: 'p1',
      mutation: { kind: 'move_node', nodeId: 'n1', newParent: 'n2' },
    });
    expect(result).toEqual({ valid: true, preview: { touched: ['n1'] } });
  });

  it('resolves (not throws) with { valid: false, reason, preview: null } on a valid-but-rejected mutation', async () => {
    const { config } = configCapturing({ ok: true, data: { valid: false, reason: 'would create a cycle', preview: null } });
    const handle = new ProjectHandle('p1', config);
    const result = await handle.dryRun({ kind: 'add_dependency', from: 'a', to: 'b' });

    expect(result).toEqual({ valid: false, reason: 'would create a cycle', preview: null });
  });

  it('throws GraphClientError with invalid_request on a bad kind', async () => {
    const { config } = configCapturing({ ok: false, error: { code: 'invalid_request', message: 'bad kind' } }, 400);
    const handle = new ProjectHandle('p1', config);

    let caught: unknown;
    try {
      await handle.dryRun({ kind: 'add_dependency', from: 'a', to: 'b' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(GraphClientError);
    expect((caught as GraphClientError).code).toBe('invalid_request');
  });
});

describe('ProjectHandle.seed', () => {
  it('posts { project, seed: { steps } } to /engine-graph/seed and unwraps the result', async () => {
    const { config, seen } = configCapturing({ ok: true, data: { nodesCreated: 2, edgesCreated: 1 } });
    const handle = new ProjectHandle('p1', config);
    const steps = [
      { primitive: 'add_node' as const, id: 'n1', type: 'task:coding' as const, parent: 'root' },
      { primitive: 'add_dependency' as const, from: 'n1', to: 'n2' },
    ];
    const result = await handle.seed(steps);

    expect(seen[0]!.url).toBe('http://127.0.0.1:1/engine-graph/seed');
    expect(parsedBody(seen)).toEqual({ project: 'p1', seed: { steps } });
    expect(result).toEqual({ nodesCreated: 2, edgesCreated: 1 });
  });
});

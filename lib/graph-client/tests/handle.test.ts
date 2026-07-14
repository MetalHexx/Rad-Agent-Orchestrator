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

describe('ProjectHandle.submitEvent', () => {
  const envelope = {
    action: 'task:coding',
    node: 'n2',
    executor: 'spawn-sub-agent',
    instructions: 'do it',
    context: {},
    completion_event: 'task:coding.done',
    delta: { primitive: 'submit_event', params: {}, nodeChanges: [], edgeChanges: [] },
    frontier: [],
  };

  it('posts { project, node, event, payload } and unwraps the NextActionEnvelope', async () => {
    const { config, seen } = configCapturing({ ok: true, data: envelope });
    const handle = new ProjectHandle('p1', config);
    const result = await handle.submitEvent({ node: 'n1', event: 'task:coding.done', payload: { outcome: 'ok' } });

    expect(seen[0]!.url).toBe('http://127.0.0.1:1/engine-graph/submit-event');
    expect(parsedBody(seen)).toEqual({
      project: 'p1',
      node: 'n1',
      event: 'task:coding.done',
      payload: { outcome: 'ok' },
    });
    expect(result).toEqual(envelope);
  });

  it('allows a drive-only submission with both event and payload omitted', async () => {
    const { config, seen } = configCapturing({ ok: true, data: envelope });
    const handle = new ProjectHandle('p1', config);
    await handle.submitEvent({ node: 'n1' });

    expect(parsedBody(seen)).toEqual({ project: 'p1', node: 'n1' });
  });

  it('throws invalid_request (without making a request) when only one of event/payload is supplied', async () => {
    const { config, seen } = configCapturing({ ok: true, data: envelope });
    const handle = new ProjectHandle('p1', config);

    let caught: unknown;
    try {
      await handle.submitEvent({ node: 'n1', event: 'task:coding.done' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(GraphClientError);
    expect((caught as GraphClientError).code).toBe('invalid_request');
    expect(seen).toHaveLength(0);
  });
});

describe('ProjectHandle.dag', () => {
  it('gets /engine-graph/dag scoped to the project and unwraps the DagSnapshot', async () => {
    const snapshot = { nodes: [], edges: [], frontier: [], status: 'in_progress' };
    const { config, seen } = configCapturing({ ok: true, data: snapshot });
    const handle = new ProjectHandle('p1', config);
    const result = await handle.dag();

    expect(seen[0]!.url).toBe('http://127.0.0.1:1/engine-graph/dag?project=p1');
    expect(result).toEqual(snapshot);
  });
});

describe('ProjectHandle.frontier', () => {
  const view = {
    id: 'n1',
    type: 'task:coding',
    status: 'not_started',
    parent: 'root',
    order: 0,
    derivedFrom: null,
    data: {},
    presentation: { label: 'n1' },
  };

  it('gets /engine-graph/frontier with an explicit context and unwraps the NodeView[]', async () => {
    const { config, seen } = configCapturing({ ok: true, data: [view] });
    const handle = new ProjectHandle('p1', config);
    const result = await handle.frontier('n0');

    expect(seen[0]!.url).toBe('http://127.0.0.1:1/engine-graph/frontier?project=p1&context=n0');
    expect(result).toEqual([view]);
  });

  it('defaults context to the project root when omitted', async () => {
    const { config, seen } = configCapturing({ ok: true, data: [] });
    const handle = new ProjectHandle('p1', config);
    await handle.frontier();

    expect(seen[0]!.url).toBe('http://127.0.0.1:1/engine-graph/frontier?project=p1&context=root');
  });
});

describe('ProjectHandle.node', () => {
  it('gets /engine-graph/node scoped to project + node id and unwraps the NodeView', async () => {
    const view = {
      id: 'n1',
      type: 'task:coding',
      status: 'not_started',
      parent: 'root',
      order: 0,
      derivedFrom: null,
      data: {},
      presentation: { label: 'n1' },
    };
    const { config, seen } = configCapturing({ ok: true, data: view });
    const handle = new ProjectHandle('p1', config);
    const result = await handle.node('n1');

    expect(seen[0]!.url).toBe('http://127.0.0.1:1/engine-graph/node?project=p1&node=n1');
    expect(result).toEqual(view);
  });
});

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

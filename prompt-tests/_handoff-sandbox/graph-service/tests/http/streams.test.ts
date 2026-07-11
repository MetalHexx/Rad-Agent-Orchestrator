// The SSE surface (`/engine-graph/stream`, `/work-graph/stream`) — driven in-process against the
// package's own production composition root (`compose()` + `buildApp()`, real SQLite,
// `app.request()` — no socket). Each test drives exactly one subscriber's framing plus its
// cleanup on disconnect; multi-client fan-out is a hosting concern, not retested here.
import type { ChangeDelta } from '@rad-orchestration/graph-engine';
import { ROOT_NODE_ID } from '@rad-orchestration/graph-engine';
import { describe, expect, it } from 'vitest';
import { compose } from '../../src/compose.js';
import { buildApp } from '../../src/http/app.js';

function addNodeDelta(id: string): ChangeDelta {
  return {
    primitive: 'add_node',
    params: { id },
    nodeChanges: [
      {
        op: 'created',
        before: null,
        after: {
          id,
          type: 'rad-orc:task',
          status: 'not_started',
          parent: ROOT_NODE_ID,
          order: 0,
          derivedFrom: null,
          data: {},
        },
      },
    ],
    edgeChanges: [],
  };
}

function buildTestService() {
  const service = compose({ dbPath: ':memory:' });
  return { service, app: buildApp(service) };
}

/** Wraps `subscribe` on `store` so `onDeliver` fires whenever the store notifies any listener —
 * lets a test observe delivery/no-further-delivery without reaching into the store's private
 * listener set. Delegates to the store's own real `subscribe`, so the wrapped listener is genuinely
 * subject to the same `Unsubscribe` the route holds. */
function countDeliveries(store: { subscribe: (listener: (row: unknown) => void) => () => void }): {
  count: () => number;
} {
  const rawSubscribe = store.subscribe.bind(store);
  let deliveries = 0;
  store.subscribe = (listener) =>
    rawSubscribe((row) => {
      deliveries += 1;
      listener(row);
    });
  return { count: () => deliveries };
}

describe('GET /engine-graph/stream', () => {
  it('rejects a missing project query parameter', async () => {
    const { app } = buildTestService();
    const res = await app.request('/engine-graph/stream');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(false);
  });

  it('emits a change event with the committed delta and a seq id, and stops after disconnect', async () => {
    const { service, app } = buildTestService();
    const deliveries = countDeliveries(service.execStore);

    const res = await app.request('/engine-graph/stream?project=proj-a');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();

    const applied = service.execStore.apply({ projectId: 'proj-a' }, addNodeDelta('task-a'));
    expect(applied.ok).toBe(true);

    const { done, value } = await reader.read();
    expect(done).toBe(false);
    const frame = decoder.decode(value);
    expect(frame).toContain('event: change');
    expect(frame).toMatch(/id: \d+/);
    expect(frame).toContain('"project_id":"proj-a"');
    expect(frame).toContain('"primitive":"add_node"');
    expect(deliveries.count()).toBe(1);

    await reader.cancel();
    service.execStore.apply({ projectId: 'proj-a' }, addNodeDelta('task-b'));
    // The route's listener was removed from the store on abort — a later commit no longer
    // reaches it, so the wrapped delivery count stays put.
    expect(deliveries.count()).toBe(1);
  });
});

describe('GET /work-graph/stream', () => {
  it('emits a change event after a portfolio mutation, and stops after disconnect', async () => {
    const { service, app } = buildTestService();
    const deliveries = countDeliveries(service.portfolio);

    const res = await app.request('/work-graph/stream');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();

    const created = service.portfolio.createProject({ id: 'proj-a' }, null);
    expect(created.ok).toBe(true);

    const { done, value } = await reader.read();
    expect(done).toBe(false);
    const frame = decoder.decode(value);
    expect(frame).toContain('event: change');
    expect(frame).toMatch(/id: \d+/);
    expect(frame).toContain('"operation":"project.created"');
    expect(deliveries.count()).toBe(1);

    await reader.cancel();
    service.portfolio.createProject({ id: 'proj-b' }, null);
    expect(deliveries.count()).toBe(1);
  });
});

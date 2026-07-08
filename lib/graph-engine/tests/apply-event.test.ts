import { describe, expect, it } from 'vitest';
import { apply_event, InMemoryStateStore, ROOT_NODE_ID } from '../src/index.js';
import type { DagNode, EventHandler, EventToken, PrimitiveContext, ProjectScope } from '../src/index.js';

function scope(projectId: string): ProjectScope {
  return { projectId };
}

function ctxFor(projectId: string): PrimitiveContext {
  return { store: new InMemoryStateStore(), scope: scope(projectId) };
}

function seed(ctx: PrimitiveContext, nodes: DagNode[]): void {
  const result = ctx.store.apply(ctx.scope, {
    primitive: 'add_node',
    params: {},
    nodeChanges: nodes.map((after) => ({ op: 'created' as const, before: null, after })),
    edgeChanges: [],
  });
  if (!result.ok) throw new Error(`seed failed: ${result.error.message}`);
}

function node(id: string, overrides: Partial<DagNode> = {}): DagNode {
  return {
    id,
    type: 'rad-orc:task',
    status: 'not_started',
    parent: ROOT_NODE_ID,
    order: 0,
    derivedFrom: null,
    data: {},
    ...overrides,
  };
}

describe('apply_event', () => {
  it('routes to the supplied handler and commits its data change as a delta', () => {
    const ctx = ctxFor('proj-a');
    seed(ctx, [node('task-a', { data: { verdict: null } })]);
    const handler: EventHandler = (_node, event) => ({ verdict: event.endsWith('approved') ? 'approved' : null });

    const result = apply_event(ctx, 'task-a', 'rad-orc:task.review_approved', handler);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.primitive).toBe('apply_event');
    expect(result.data.nodeChanges).toEqual([
      {
        op: 'updated',
        before: node('task-a', { data: { verdict: null } }),
        after: node('task-a', { data: { verdict: 'approved' } }),
      },
    ]);
    expect(ctx.store.getNode(ctx.scope, 'task-a')?.data).toEqual({ verdict: 'approved' });
  });

  it('commits an empty delta when the handler signals no reaction', () => {
    const ctx = ctxFor('proj-a');
    seed(ctx, [node('task-a')]);
    const handler: EventHandler = () => null;

    const result = apply_event(ctx, 'task-a', 'rad-orc:task.pinged', handler);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.nodeChanges).toEqual([]);
    expect(result.data.edgeChanges).toEqual([]);
    expect(ctx.store.getNode(ctx.scope, 'task-a')?.data).toEqual({});
  });

  it('rejects (and writes nothing for) a node that does not exist', () => {
    const ctx = ctxFor('proj-a');
    const handler: EventHandler = () => ({ x: 1 });

    const result = apply_event(ctx, 'ghost', 'rad-orc:task.pinged', handler);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid_delta');
  });

  it('passes the current node and the exact event through to the handler', () => {
    const ctx = ctxFor('proj-a');
    seed(ctx, [node('task-a', { data: { count: 1 } })]);
    let seenEvent: EventToken | null = null;
    let seenNodeId: string | null = null;
    const handler: EventHandler = (n, event) => {
      seenNodeId = n.id;
      seenEvent = event;
      return null;
    };

    apply_event(ctx, 'task-a', 'rad-orc:task.pinged', handler);

    expect(seenEvent).toBe('rad-orc:task.pinged');
    expect(seenNodeId).toBe('task-a');
  });
});

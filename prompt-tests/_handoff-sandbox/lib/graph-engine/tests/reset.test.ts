import { describe, expect, it } from 'vitest';
import { reset, frontier, InMemoryStateStore, ROOT_NODE_ID } from '../src/index.js';
import type { ChangeDelta, DagNode, PrimitiveContext, ProjectScope } from '../src/index.js';

function scope(projectId: string): ProjectScope {
  return { projectId };
}

function ctxFor(projectId: string): PrimitiveContext {
  return { store: new InMemoryStateStore(), scope: scope(projectId) };
}

/** Seeds `ctx`'s scope with `nodes` (root already seeded) and `edges`, via a single raw `apply`. */
function seed(ctx: PrimitiveContext, nodes: DagNode[], edges: ChangeDelta['edgeChanges'] = []): void {
  const result = ctx.store.apply(ctx.scope, {
    primitive: 'add_node',
    params: {},
    nodeChanges: nodes.map((after) => ({ op: 'created' as const, before: null, after })),
    edgeChanges: edges,
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

describe('reset — plain re-arm', () => {
  it('flips a done node back to not_started', () => {
    const ctx = ctxFor('proj-a');
    seed(ctx, [node('review', { status: 'done' })]);

    const result = reset(ctx, 'review');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.primitive).toBe('reset');
    expect(ctx.store.getNode(ctx.scope, 'review')?.status).toBe('not_started');
  });

  it('flips an in_progress node back to not_started', () => {
    const ctx = ctxFor('proj-a');
    seed(ctx, [node('task-a', { status: 'in_progress' })]);

    const result = reset(ctx, 'task-a');

    expect(result.ok).toBe(true);
    expect(ctx.store.getNode(ctx.scope, 'task-a')?.status).toBe('not_started');
  });

  it('re-arms without forcing frontier re-entry: a still-pending predecessor holds it back', () => {
    const ctx = ctxFor('proj-a');
    seed(
      ctx,
      [
        node('phase-1'),
        node('task-a', { parent: 'phase-1', status: 'done' }),
        node('corrective-1', { parent: 'phase-1', status: 'not_started', derivedFrom: 'task-a' }),
        node('review', { status: 'done' }),
      ],
      [
        { op: 'created', before: null, after: { from: 'task-a', to: 'review', kind: 'depends_on' } },
        { op: 'created', before: null, after: { from: 'corrective-1', to: 'review', kind: 'depends_on' } },
      ],
    );

    const result = reset(ctx, 'review');

    expect(result.ok).toBe(true);
    expect(ctx.store.getNode(ctx.scope, 'review')?.status).toBe('not_started');
    const front = frontier(ctx.store.listNodes(ctx.scope), ctx.store.listEdges(ctx.scope), 'phase-1').map(
      (n) => n.id,
    );
    expect(front).toContain('corrective-1');
    expect(front).not.toContain('review'); // corrective-1 isn't done yet — review stays gated
  });

  it('rejects a node that has not run (already not_started)', () => {
    const ctx = ctxFor('proj-a');
    seed(ctx, [node('task-a')]);

    const result = reset(ctx, 'task-a');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid_delta');
  });

  it('rejects a reference to a node that does not exist', () => {
    const ctx = ctxFor('proj-a');

    const result = reset(ctx, 'ghost');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid_delta');
  });
});

describe('reset — cascade tears down a prior expansion', () => {
  it('removes the previously-seeded execution subgraph when resetting the node that expanded it', () => {
    const ctx = ctxFor('proj-a');
    seed(
      ctx,
      [
        node('explosion', { status: 'done' }),
        node('phase-1', { derivedFrom: 'explosion', status: 'done' }),
        node('task-a', { parent: 'phase-1', derivedFrom: 'explosion', status: 'done' }),
      ],
      [{ op: 'created', before: null, after: { from: 'phase-1', to: 'task-a', kind: 'depends_on' } }],
    );

    const result = reset(ctx, 'explosion', true);

    expect(result.ok).toBe(true);
    expect(ctx.store.getNode(ctx.scope, 'explosion')?.status).toBe('not_started');
    expect(ctx.store.getNode(ctx.scope, 'phase-1')).toBeNull();
    expect(ctx.store.getNode(ctx.scope, 'task-a')).toBeNull();
    expect(ctx.store.listEdges(ctx.scope)).toEqual([]);
  });

  it('cascades through an already-run dependent, tearing down that dependent`s own prior expansion too', () => {
    const ctx = ctxFor('proj-a');
    seed(
      ctx,
      [
        node('master_plan', { status: 'done' }),
        node('explosion', { status: 'done' }),
        node('phase-1', { derivedFrom: 'explosion', status: 'done' }),
        node('task-a', { parent: 'phase-1', derivedFrom: 'explosion', status: 'done' }),
      ],
      [{ op: 'created', before: null, after: { from: 'master_plan', to: 'explosion', kind: 'depends_on' } }],
    );

    const result = reset(ctx, 'master_plan', true);

    expect(result.ok).toBe(true);
    expect(ctx.store.getNode(ctx.scope, 'master_plan')?.status).toBe('not_started');
    expect(ctx.store.getNode(ctx.scope, 'explosion')?.status).toBe('not_started');
    expect(ctx.store.getNode(ctx.scope, 'phase-1')).toBeNull();
    expect(ctx.store.getNode(ctx.scope, 'task-a')).toBeNull();
    expect(ctx.store.listEdges(ctx.scope)).toEqual([{ from: 'master_plan', to: 'explosion', kind: 'depends_on' }]);
  });

  it('does not cascade past a dependent that never ran', () => {
    const ctx = ctxFor('proj-a');
    seed(
      ctx,
      [node('a', { status: 'done' }), node('b', { status: 'not_started' })],
      [{ op: 'created', before: null, after: { from: 'a', to: 'b', kind: 'depends_on' } }],
    );

    const result = reset(ctx, 'a', true);

    expect(result.ok).toBe(true);
    expect(ctx.store.getNode(ctx.scope, 'a')?.status).toBe('not_started');
    expect(ctx.store.getNode(ctx.scope, 'b')?.status).toBe('not_started');
    if (result.ok) {
      expect(result.data.nodeChanges).toHaveLength(1); // only 'a' — 'b' was untouched, not merely re-flipped
    }
  });

  it('without cascade, leaves a prior expansion in place', () => {
    const ctx = ctxFor('proj-a');
    seed(
      ctx,
      [node('explosion', { status: 'done' }), node('phase-1', { derivedFrom: 'explosion', status: 'done' })],
    );

    const result = reset(ctx, 'explosion');

    expect(result.ok).toBe(true);
    expect(ctx.store.getNode(ctx.scope, 'explosion')?.status).toBe('not_started');
    expect(ctx.store.getNode(ctx.scope, 'phase-1')).not.toBeNull();
  });
});

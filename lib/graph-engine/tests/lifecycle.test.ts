import { describe, expect, it } from 'vitest';
import { toggle, resume, frontier, InMemoryStateStore, ROOT_NODE_ID } from '../src/index.js';
import type { ChangeDelta, DagNode, PrimitiveContext, ProjectScope } from '../src/index.js';

function scope(projectId: string): ProjectScope {
  return { projectId };
}

function ctxFor(projectId: string): PrimitiveContext {
  return { store: new InMemoryStateStore(), scope: scope(projectId) };
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

function seed(ctx: PrimitiveContext, nodes: DagNode[], edges: ChangeDelta['edgeChanges'] = []): void {
  const result = ctx.store.apply(ctx.scope, {
    primitive: 'add_node',
    params: {},
    nodeChanges: nodes.map((after) => ({ op: 'created' as const, before: null, after })),
    edgeChanges: edges,
  });
  if (!result.ok) throw new Error(`seed failed: ${result.error.message}`);
}

describe('toggle', () => {
  it('disables an enabled node', () => {
    const ctx = ctxFor('proj-a');
    seed(ctx, [node('a')]);

    const result = toggle(ctx, 'a');

    expect(result.ok).toBe(true);
    expect(ctx.store.getNode(ctx.scope, 'a')?.disabled).toBe(true);
  });

  it('re-enables a disabled node', () => {
    const ctx = ctxFor('proj-a');
    seed(ctx, [node('a', { disabled: true })]);

    const result = toggle(ctx, 'a');

    expect(result.ok).toBe(true);
    expect(ctx.store.getNode(ctx.scope, 'a')?.disabled).toBe(false);
  });

  it('rejects a reference to a node that does not exist and writes nothing', () => {
    const ctx = ctxFor('proj-a');

    const result = toggle(ctx, 'ghost');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid_delta');
  });
});

describe('resume', () => {
  it('returns a halted (failed) node to not_started, stamping no anchor', () => {
    const ctx = ctxFor('proj-a');
    seed(ctx, [node('a', { status: 'failed' })]);

    const result = resume(ctx, 'a');

    expect(result.ok).toBe(true);
    const after = ctx.store.getNode(ctx.scope, 'a');
    expect(after?.status).toBe('not_started');
    expect(after?.budgetAnchor).toBeUndefined();
  });

  it('returns a halted (blocked) node to not_started, stamping no anchor even though a chain exists behind it', () => {
    const ctx = ctxFor('proj-a');
    seed(
      ctx,
      [node('task-a', { status: 'done' }), node('a', { status: 'blocked' })],
      [{ op: 'created', before: null, after: { from: 'task-a', to: 'a', kind: 'depends_on' } }],
    );

    const result = resume(ctx, 'a');

    expect(result.ok).toBe(true);
    const after = ctx.store.getNode(ctx.scope, 'a');
    expect(after?.status).toBe('not_started');
    expect(after?.budgetAnchor).toBeUndefined(); // 'a' was never disabled — resume never consulted the chain
  });

  it('clears disabled and stamps the anchor on a budget-halted review, making it frontier-eligible again', () => {
    const ctx = ctxFor('proj-a');
    seed(
      ctx,
      [
        node('phase-1'),
        node('task-a', { parent: 'phase-1', status: 'done' }),
        node('review', { status: 'not_started', disabled: true }),
      ],
      [{ op: 'created', before: null, after: { from: 'task-a', to: 'review', kind: 'depends_on' } }],
    );

    const result = resume(ctx, 'review');

    expect(result.ok).toBe(true);
    const after = ctx.store.getNode(ctx.scope, 'review');
    expect(after?.disabled).toBe(false);
    expect(after?.status).toBe('not_started'); // already idle — left as-is
    expect(after?.budgetAnchor).toBe('task-a');

    const front = frontier(ctx.store.listNodes(ctx.scope), ctx.store.listEdges(ctx.scope), ROOT_NODE_ID).map(
      (n) => n.id,
    );
    expect(front).toContain('review');
  });

  it('clears disabled on a plain disabled node with no corrective chain, stamping no anchor', () => {
    const ctx = ctxFor('proj-a');
    seed(ctx, [node('a', { disabled: true })]);

    const result = resume(ctx, 'a');

    expect(result.ok).toBe(true);
    const after = ctx.store.getNode(ctx.scope, 'a');
    expect(after?.disabled).toBe(false);
    expect(after?.status).toBe('not_started');
    expect(after?.budgetAnchor).toBeUndefined(); // resolveChainTip found no predecessor to anchor to
  });

  it('rejects a reference to a node that does not exist and writes nothing', () => {
    const ctx = ctxFor('proj-a');

    const result = resume(ctx, 'ghost');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid_delta');
  });

  it('rejects a done node, writing nothing — that axis belongs to reset, not resume', () => {
    const ctx = ctxFor('proj-a');
    seed(ctx, [node('a', { status: 'done' })]);

    const result = resume(ctx, 'a');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid_delta');
    expect(ctx.store.getNode(ctx.scope, 'a')?.status).toBe('done');
  });

  it('rejects an in_progress node, writing nothing', () => {
    const ctx = ctxFor('proj-a');
    seed(ctx, [node('a', { status: 'in_progress' })]);

    const result = resume(ctx, 'a');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid_delta');
    expect(ctx.store.getNode(ctx.scope, 'a')?.status).toBe('in_progress');
  });

  it('rejects a not_started node — it was never halted, so there is nothing to resume', () => {
    const ctx = ctxFor('proj-a');
    seed(ctx, [node('a')]);

    const result = resume(ctx, 'a');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid_delta');
  });
});

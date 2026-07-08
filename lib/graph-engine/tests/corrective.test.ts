import { describe, expect, it } from 'vitest';
import { add_corrective, resume, frontier, InMemoryStateStore, ROOT_NODE_ID } from '../src/index.js';
import type { ChangeDelta, DagNode, PrimitiveContext, ProjectScope } from '../src/index.js';
import { detectCycle } from '../src/derive/invariants.js';
import { resolveChainTip } from '../src/primitives/corrective.js';

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

/** Directly flips a node's status via a raw `apply` — the harness for pretending a node "ran". */
function markStatus(ctx: PrimitiveContext, id: string, status: DagNode['status']): void {
  const before = ctx.store.getNode(ctx.scope, id);
  if (!before) throw new Error(`markStatus: '${id}' does not exist`);
  const result = ctx.store.apply(ctx.scope, {
    primitive: 'add_node',
    params: {},
    nodeChanges: [{ op: 'updated', before, after: { ...before, status } }],
    edgeChanges: [],
  });
  if (!result.ok) throw new Error(`markStatus failed: ${result.error.message}`);
}

describe('add_corrective — first cycle', () => {
  it('births a corrective parented in the task container, gates the review on it, and resets the review', () => {
    const ctx = ctxFor('proj-a');
    seed(
      ctx,
      [node('phase-1'), node('task-a', { parent: 'phase-1', status: 'done' }), node('review', { status: 'done' })],
      [{ op: 'created', before: null, after: { from: 'task-a', to: 'review', kind: 'depends_on' } }],
    );

    const result = add_corrective(ctx, 'corrective-1', 'rad-orc:corrective', 'review');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.primitive).toBe('add_corrective');

    const corrective = ctx.store.getNode(ctx.scope, 'corrective-1');
    expect(corrective).toEqual(
      node('corrective-1', { type: 'rad-orc:corrective', parent: 'phase-1', derivedFrom: 'task-a' }),
    );
    expect(ctx.store.listEdges(ctx.scope)).toEqual(
      expect.arrayContaining([{ from: 'corrective-1', to: 'review', kind: 'depends_on' }]),
    );
    expect(ctx.store.getNode(ctx.scope, 'review')?.status).toBe('not_started');

    // The original attempt and its container stay untouched.
    expect(ctx.store.getNode(ctx.scope, 'task-a')?.status).toBe('done');
  });

  it('excludes the review from the frontier until the new corrective reaches done', () => {
    const ctx = ctxFor('proj-a');
    seed(
      ctx,
      [node('phase-1'), node('task-a', { parent: 'phase-1', status: 'done' }), node('review', { status: 'done' })],
      [{ op: 'created', before: null, after: { from: 'task-a', to: 'review', kind: 'depends_on' } }],
    );

    const result = add_corrective(ctx, 'corrective-1', 'rad-orc:corrective', 'review');
    expect(result.ok).toBe(true);

    let nodes = ctx.store.listNodes(ctx.scope);
    let edges = ctx.store.listEdges(ctx.scope);
    expect(frontier(nodes, edges, 'phase-1').map((n) => n.id)).toContain('corrective-1');
    expect(frontier(nodes, edges, ROOT_NODE_ID).map((n) => n.id)).not.toContain('review');

    markStatus(ctx, 'corrective-1', 'done');

    nodes = ctx.store.listNodes(ctx.scope);
    edges = ctx.store.listEdges(ctx.scope);
    expect(frontier(nodes, edges, ROOT_NODE_ID).map((n) => n.id)).toContain('review');
  });

  it('keeps the depends_on graph acyclic after birth', () => {
    const ctx = ctxFor('proj-a');
    seed(
      ctx,
      [node('phase-1'), node('task-a', { parent: 'phase-1', status: 'done' }), node('review', { status: 'done' })],
      [{ op: 'created', before: null, after: { from: 'task-a', to: 'review', kind: 'depends_on' } }],
    );

    add_corrective(ctx, 'corrective-1', 'rad-orc:corrective', 'review');

    expect(detectCycle(ctx.store.listEdges(ctx.scope))).toBeNull();
  });
});

describe('add_corrective — nth cycle chaining', () => {
  it('derives the next corrective from the prior corrective, not the original task', () => {
    const ctx = ctxFor('proj-a');
    seed(
      ctx,
      [node('phase-1'), node('task-a', { parent: 'phase-1', status: 'done' }), node('review', { status: 'done' })],
      [{ op: 'created', before: null, after: { from: 'task-a', to: 'review', kind: 'depends_on' } }],
    );
    add_corrective(ctx, 'corrective-1', 'rad-orc:corrective', 'review');
    markStatus(ctx, 'corrective-1', 'done');
    markStatus(ctx, 'review', 'done');

    const result = add_corrective(ctx, 'corrective-2', 'rad-orc:corrective', 'review');

    expect(result.ok).toBe(true);
    const corrective2 = ctx.store.getNode(ctx.scope, 'corrective-2');
    expect(corrective2?.derivedFrom).toBe('corrective-1');
    expect(corrective2?.parent).toBe('phase-1');
    expect(ctx.store.getNode(ctx.scope, 'review')?.status).toBe('not_started');
  });
});

describe('add_corrective — container parenting', () => {
  it('parents a task-level corrective in the task container', () => {
    const ctx = ctxFor('proj-a');
    seed(
      ctx,
      [node('phase-1'), node('task-a', { parent: 'phase-1', status: 'done' }), node('review', { status: 'done' })],
      [{ op: 'created', before: null, after: { from: 'task-a', to: 'review', kind: 'depends_on' } }],
    );

    add_corrective(ctx, 'corrective-1', 'rad-orc:corrective', 'review');

    expect(ctx.store.getNode(ctx.scope, 'corrective-1')?.parent).toBe('phase-1');
  });

  it('parents a phase-level corrective in the phase container, same as a task-level one', () => {
    const ctx = ctxFor('proj-a');
    seed(
      ctx,
      [
        node('phase-1'),
        node('phase-1-sentinel', { parent: 'phase-1', status: 'done' }),
        node('phase_review', { status: 'done' }),
      ],
      [{ op: 'created', before: null, after: { from: 'phase-1-sentinel', to: 'phase_review', kind: 'depends_on' } }],
    );

    add_corrective(ctx, 'corrective-1', 'rad-orc:corrective', 'phase_review');

    expect(ctx.store.getNode(ctx.scope, 'corrective-1')?.parent).toBe('phase-1');
  });

  it('parents a spine-level final-review corrective in the project-scoped root', () => {
    const ctx = ctxFor('proj-a');
    seed(
      ctx,
      [node('final-work', { parent: ROOT_NODE_ID, status: 'done' }), node('final_review', { status: 'done' })],
      [{ op: 'created', before: null, after: { from: 'final-work', to: 'final_review', kind: 'depends_on' } }],
    );

    add_corrective(ctx, 'corrective-1', 'rad-orc:corrective', 'final_review');

    expect(ctx.store.getNode(ctx.scope, 'corrective-1')?.parent).toBe(ROOT_NODE_ID);
  });
});

describe('add_corrective — retry budget', () => {
  it('halts (frontier-excludes the review) instead of minting once the chain depth meets the budget', () => {
    const ctx = ctxFor('proj-a');
    seed(
      ctx,
      [node('phase-1'), node('task-a', { parent: 'phase-1', status: 'done' }), node('review', { status: 'done' })],
      [{ op: 'created', before: null, after: { from: 'task-a', to: 'review', kind: 'depends_on' } }],
    );

    const first = add_corrective(ctx, 'corrective-1', 'rad-orc:corrective', 'review', { maxRetries: 1 });
    expect(first.ok).toBe(true);
    markStatus(ctx, 'corrective-1', 'done');
    markStatus(ctx, 'review', 'done');

    const before = ctx.store.listNodes(ctx.scope).length;
    const halted = add_corrective(ctx, 'corrective-2', 'rad-orc:corrective', 'review', { maxRetries: 1 });

    expect(halted.ok).toBe(true);
    if (!halted.ok) return;
    expect(halted.data.nodeChanges).toEqual([
      {
        op: 'updated',
        before: expect.objectContaining({ id: 'review' }),
        after: expect.objectContaining({ id: 'review', disabled: true }),
      },
    ]);
    expect(ctx.store.getNode(ctx.scope, 'corrective-2')).toBeNull();
    expect(ctx.store.getNode(ctx.scope, 'review')?.disabled).toBe(true);
    expect(ctx.store.listNodes(ctx.scope)).toHaveLength(before); // nothing new was minted
  });

  it('accepts the retry budget as a parameter rather than hardcoding it', () => {
    const ctx = ctxFor('proj-a');
    seed(
      ctx,
      [node('phase-1'), node('task-a', { parent: 'phase-1', status: 'done' }), node('review', { status: 'done' })],
      [{ op: 'created', before: null, after: { from: 'task-a', to: 'review', kind: 'depends_on' } }],
    );

    const halted = add_corrective(ctx, 'corrective-1', 'rad-orc:corrective', 'review', { maxRetries: 0 });

    expect(halted.ok).toBe(true);
    if (!halted.ok) return;
    expect(halted.data.params).toMatchObject({ maxRetries: 0, halted: true });
    expect(ctx.store.getNode(ctx.scope, 'corrective-1')).toBeNull();
  });
});

describe('add_corrective — validation', () => {
  it('rejects a reference to a review that does not exist', () => {
    const ctx = ctxFor('proj-a');

    const result = add_corrective(ctx, 'corrective-1', 'rad-orc:corrective', 'ghost');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid_delta');
  });

  it('rejects a review with no predecessor to derive a corrective from', () => {
    const ctx = ctxFor('proj-a');
    seed(ctx, [node('review', { status: 'done' })]);

    const result = add_corrective(ctx, 'corrective-1', 'rad-orc:corrective', 'review');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid_delta');
  });
});

describe('resolveChainTip — budgetAnchor flooring', () => {
  it('reproduces the unfloored depth when no anchor is set on the review', () => {
    const ctx = ctxFor('proj-a');
    seed(
      ctx,
      [
        node('phase-1'),
        node('task-a', { parent: 'phase-1', status: 'done' }),
        node('corrective-1', { parent: 'phase-1', status: 'done', derivedFrom: 'task-a' }),
        node('corrective-2', { parent: 'phase-1', status: 'not_started', derivedFrom: 'corrective-1' }),
        node('review', { status: 'done' }),
      ],
      [
        { op: 'created', before: null, after: { from: 'task-a', to: 'review', kind: 'depends_on' } },
        { op: 'created', before: null, after: { from: 'corrective-1', to: 'review', kind: 'depends_on' } },
        { op: 'created', before: null, after: { from: 'corrective-2', to: 'review', kind: 'depends_on' } },
      ],
    );

    const chain = resolveChainTip(
      { nodes: ctx.store.listNodes(ctx.scope), edges: ctx.store.listEdges(ctx.scope) },
      'review',
    );

    expect(chain?.tip.id).toBe('corrective-2');
    expect(chain?.depth).toBe(2);
  });

  it('floors the depth count at the anchored node without changing the resolved tip', () => {
    const ctx = ctxFor('proj-a');
    seed(
      ctx,
      [
        node('phase-1'),
        node('task-a', { parent: 'phase-1', status: 'done' }),
        node('corrective-1', { parent: 'phase-1', status: 'done', derivedFrom: 'task-a' }),
        node('corrective-2', { parent: 'phase-1', status: 'not_started', derivedFrom: 'corrective-1' }),
        node('review', { status: 'done', budgetAnchor: 'corrective-1' }),
      ],
      [
        { op: 'created', before: null, after: { from: 'task-a', to: 'review', kind: 'depends_on' } },
        { op: 'created', before: null, after: { from: 'corrective-1', to: 'review', kind: 'depends_on' } },
        { op: 'created', before: null, after: { from: 'corrective-2', to: 'review', kind: 'depends_on' } },
      ],
    );

    const chain = resolveChainTip(
      { nodes: ctx.store.listNodes(ctx.scope), edges: ctx.store.listEdges(ctx.scope) },
      'review',
    );

    expect(chain?.tip.id).toBe('corrective-2'); // tip-finding is unaffected by the anchor
    expect(chain?.depth).toBe(1); // only corrective-2 counts past the anchored corrective-1
  });
});

describe('add_corrective — after a budget-recovery resume', () => {
  it('mints a fresh corrective at measured depth 0 right after resume anchors the chain tip', () => {
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

    const resumed = resume(ctx, 'review');
    expect(resumed.ok).toBe(true);
    expect(ctx.store.getNode(ctx.scope, 'review')?.budgetAnchor).toBe('task-a');

    markStatus(ctx, 'review', 'done'); // add_corrective only re-arms a 'done'/'in_progress' review

    const result = add_corrective(ctx, 'corrective-1', 'rad-orc:corrective', 'review', { maxRetries: 1 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.params).toMatchObject({ chainDepth: 0, halted: false });
    expect(ctx.store.getNode(ctx.scope, 'corrective-1')?.derivedFrom).toBe('task-a');
  });

  it('still halts once the floored depth reaches the budget on a later cycle', () => {
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
    resume(ctx, 'review');
    markStatus(ctx, 'review', 'done');
    add_corrective(ctx, 'corrective-1', 'rad-orc:corrective', 'review', { maxRetries: 1 });
    markStatus(ctx, 'corrective-1', 'done');
    markStatus(ctx, 'review', 'done');

    const halted = add_corrective(ctx, 'corrective-2', 'rad-orc:corrective', 'review', { maxRetries: 1 });

    expect(halted.ok).toBe(true);
    if (!halted.ok) return;
    expect(halted.data.params).toMatchObject({ chainDepth: 1, halted: true });
    expect(ctx.store.getNode(ctx.scope, 'corrective-2')).toBeNull();
  });
});

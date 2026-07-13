import { describe, expect, it } from 'vitest';
import { add_corrective_gate, frontier, InMemoryStateStore, ROOT_NODE_ID } from '../src/index.js';
import type { ChangeDelta, DagNode, PrimitiveContext, ProjectScope } from '../src/index.js';
import { detectCycle } from '../src/derive/invariants.js';

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

describe('add_corrective_gate — the audit-correction mechanism', () => {
  it('births a corrective parented alongside the source, gating the downstream node on it', () => {
    const ctx = ctxFor('proj-a');
    seed(
      ctx,
      [
        node('phase-1'),
        node('plan_audit', { parent: 'phase-1', status: 'done' }),
        node('plan_approval', { status: 'not_started' }),
      ],
      [{ op: 'created', before: null, after: { from: 'plan_audit', to: 'plan_approval', kind: 'depends_on' } }],
    );

    const result = add_corrective_gate(ctx, 'plan-corrective-1', 'rad-orc:corrective', 'plan_audit', 'plan_approval');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.primitive).toBe('add_corrective_gate');

    const corrective = ctx.store.getNode(ctx.scope, 'plan-corrective-1');
    expect(corrective).toEqual(
      node('plan-corrective-1', { type: 'rad-orc:corrective', parent: 'phase-1', derivedFrom: 'plan_audit' }),
    );
    expect(ctx.store.listEdges(ctx.scope)).toEqual(
      expect.arrayContaining([{ from: 'plan-corrective-1', to: 'plan_approval', kind: 'depends_on' }]),
    );
  });

  it('never resets or otherwise touches the source — it never re-enters the frontier', () => {
    const ctx = ctxFor('proj-a');
    seed(
      ctx,
      [
        node('phase-1'),
        node('plan_audit', { parent: 'phase-1', status: 'done' }),
        node('plan_approval', { status: 'not_started' }),
      ],
      [{ op: 'created', before: null, after: { from: 'plan_audit', to: 'plan_approval', kind: 'depends_on' } }],
    );

    add_corrective_gate(ctx, 'plan-corrective-1', 'rad-orc:corrective', 'plan_audit', 'plan_approval');

    expect(ctx.store.getNode(ctx.scope, 'plan_audit')?.status).toBe('done');
    const front = frontier(ctx.store.listNodes(ctx.scope), ctx.store.listEdges(ctx.scope), 'phase-1').map(
      (n) => n.id,
    );
    expect(front).not.toContain('plan_audit');
  });

  it('holds the gate out of the frontier until the corrective reaches done, then releases it', () => {
    const ctx = ctxFor('proj-a');
    seed(
      ctx,
      [
        node('phase-1'),
        node('plan_audit', { parent: 'phase-1', status: 'done' }),
        node('plan_approval', { status: 'not_started' }),
      ],
      [{ op: 'created', before: null, after: { from: 'plan_audit', to: 'plan_approval', kind: 'depends_on' } }],
    );

    add_corrective_gate(ctx, 'plan-corrective-1', 'rad-orc:corrective', 'plan_audit', 'plan_approval');

    let nodes = ctx.store.listNodes(ctx.scope);
    let edges = ctx.store.listEdges(ctx.scope);
    expect(frontier(nodes, edges, 'phase-1').map((n) => n.id)).toContain('plan-corrective-1');
    expect(frontier(nodes, edges, ROOT_NODE_ID).map((n) => n.id)).not.toContain('plan_approval');

    markStatus(ctx, 'plan-corrective-1', 'done');

    nodes = ctx.store.listNodes(ctx.scope);
    edges = ctx.store.listEdges(ctx.scope);
    expect(frontier(nodes, edges, ROOT_NODE_ID).map((n) => n.id)).toContain('plan_approval');
  });

  it('leaves plan_approval\'s status untouched (still not_started, never reset)', () => {
    const ctx = ctxFor('proj-a');
    seed(
      ctx,
      [
        node('phase-1'),
        node('plan_audit', { parent: 'phase-1', status: 'done' }),
        node('plan_approval', { status: 'not_started' }),
      ],
      [{ op: 'created', before: null, after: { from: 'plan_audit', to: 'plan_approval', kind: 'depends_on' } }],
    );

    add_corrective_gate(ctx, 'plan-corrective-1', 'rad-orc:corrective', 'plan_audit', 'plan_approval');

    expect(ctx.store.getNode(ctx.scope, 'plan_approval')?.status).toBe('not_started');
  });

  it('keeps the depends_on graph acyclic after birth', () => {
    const ctx = ctxFor('proj-a');
    seed(
      ctx,
      [
        node('phase-1'),
        node('plan_audit', { parent: 'phase-1', status: 'done' }),
        node('plan_approval', { status: 'not_started' }),
      ],
      [{ op: 'created', before: null, after: { from: 'plan_audit', to: 'plan_approval', kind: 'depends_on' } }],
    );

    add_corrective_gate(ctx, 'plan-corrective-1', 'rad-orc:corrective', 'plan_audit', 'plan_approval');

    expect(detectCycle(ctx.store.listEdges(ctx.scope))).toBeNull();
  });
});

describe('add_corrective_gate — validation', () => {
  it('rejects a reference to a source that does not exist', () => {
    const ctx = ctxFor('proj-a');
    seed(ctx, [node('plan_approval')]);

    const result = add_corrective_gate(ctx, 'corrective-1', 'rad-orc:corrective', 'ghost', 'plan_approval');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid_delta');
  });

  it('rejects a source with no container to parent the corrective under', () => {
    const ctx = ctxFor('proj-a');
    seed(ctx, [node('plan_audit', { parent: null, status: 'done' }), node('plan_approval')]);

    const result = add_corrective_gate(ctx, 'corrective-1', 'rad-orc:corrective', 'plan_audit', 'plan_approval');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid_delta');
  });

  it('rejects a reference to a gate that does not exist', () => {
    const ctx = ctxFor('proj-a');
    seed(ctx, [node('phase-1'), node('plan_audit', { parent: 'phase-1', status: 'done' })]);

    const result = add_corrective_gate(ctx, 'corrective-1', 'rad-orc:corrective', 'plan_audit', 'ghost');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid_delta');
  });

  it('rejects a gate that has already run — too late to hold it back', () => {
    const ctx = ctxFor('proj-a');
    seed(
      ctx,
      [node('phase-1'), node('plan_audit', { parent: 'phase-1', status: 'done' }), node('plan_approval', { status: 'done' })],
    );

    const result = add_corrective_gate(ctx, 'corrective-1', 'rad-orc:corrective', 'plan_audit', 'plan_approval');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid_delta');
  });

  it('rejects an id that already exists', () => {
    const ctx = ctxFor('proj-a');
    seed(
      ctx,
      [
        node('phase-1'),
        node('plan_audit', { parent: 'phase-1', status: 'done' }),
        node('plan_approval'),
        node('dup'),
      ],
    );

    const result = add_corrective_gate(ctx, 'dup', 'rad-orc:corrective', 'plan_audit', 'plan_approval');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid_delta');
  });
});

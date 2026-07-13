import { describe, expect, it } from 'vitest';
import {
  add_corrective_gate,
  replace_expansion,
  expand,
  frontier,
  createNodeTypeRegistry,
  InMemoryStateStore,
  ROOT_NODE_ID,
} from '../src/index.js';
import type {
  ChangeDelta,
  DagNode,
  NodeTypeDefinition,
  NodeTypeRegistry,
  PrimitiveContext,
  ProjectScope,
} from '../src/index.js';

function scope(projectId: string): ProjectScope {
  return { projectId };
}

function ctxFor(projectId: string): PrimitiveContext {
  return { store: new InMemoryStateStore(), scope: scope(projectId) };
}

function stubType(name: NodeTypeDefinition['name']): NodeTypeDefinition {
  return {
    name,
    dataSchema: {},
    traits: [],
    capabilities: [],
    presentation: { label: name },
    instructions: '',
    act: () => ({ instructions: '', executor: 'noop' }),
    handle: () => ({}),
    projectStatus: () => 'not_started',
  };
}

const registry: NodeTypeRegistry = createNodeTypeRegistry([stubType('rad-orc:task'), stubType('rad-orc:phase')]);

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

/**
 * End-to-end proof of the mechanism this task ships: `plan_audit` reports `issues_found`,
 * `plan_approval` (its dependent) must not become eligible until the correction lands, the
 * correction's own completion re-explodes `phase_loop` (the unrelated origin the phases actually
 * came from) without an id collision, and `plan_audit` never re-enters the frontier throughout.
 */
describe('the audit-correction mechanism — add_corrective_gate + replace_expansion composed', () => {
  it('holds plan_approval, re-explodes the phase loop, and never re-audits', () => {
    const ctx = ctxFor('proj-a');
    seed(
      ctx,
      [
        node('phase_loop'),
        node('plan_audit', { status: 'done' }),
        node('plan_approval', { status: 'not_started' }),
      ],
      [{ op: 'created', before: null, after: { from: 'plan_audit', to: 'plan_approval', kind: 'depends_on' } }],
    );

    // The plan's phase-loop expansion, seeded before the audit ran.
    expand(ctx, registry, 'phase_loop', {
      specs: [
        { key: 'phase-1', type: 'rad-orc:phase', parent: 'phase_loop', dependsOn: [] },
        { key: 'phase-1-task-a', type: 'rad-orc:task', parent: 'phase-1', dependsOn: [] },
      ],
    });

    // The audit reports issues_found: birth a corrective that gates plan_approval, not plan_audit.
    const gated = add_corrective_gate(ctx, 'plan-corrective-1', 'rad-orc:corrective', 'plan_audit', 'plan_approval');
    expect(gated.ok).toBe(true);

    let nodes = ctx.store.listNodes(ctx.scope);
    let edges = ctx.store.listEdges(ctx.scope);
    // (1) plan_approval must not become frontier-eligible until the correction lands.
    expect(frontier(nodes, edges, ROOT_NODE_ID).map((n) => n.id)).not.toContain('plan_approval');
    // (3) plan_audit must not re-enter the frontier — it was never reset.
    expect(frontier(nodes, edges, ROOT_NODE_ID).map((n) => n.id)).not.toContain('plan_audit');
    expect(ctx.store.getNode(ctx.scope, 'plan_audit')?.status).toBe('done');

    // The correction work runs to completion.
    markStatus(ctx, 'plan-corrective-1', 'done');

    // (2) Its completion re-explodes the corrected plan: same phase-1 key, refreshed task set —
    // no id collision, because the prior expansion is torn down atomically with the re-expand.
    const replaced = replace_expansion(ctx, registry, 'phase_loop', {
      specs: [
        { key: 'phase-1', type: 'rad-orc:phase', parent: 'phase_loop', dependsOn: [] },
        { key: 'phase-1-task-a', type: 'rad-orc:task', parent: 'phase-1', dependsOn: [] },
        { key: 'phase-1-task-b', type: 'rad-orc:task', parent: 'phase-1', dependsOn: ['phase-1-task-a'] },
      ],
    });
    expect(replaced.ok).toBe(true);
    expect(ctx.store.getNode(ctx.scope, 'phase-1-task-b')).not.toBeNull();

    nodes = ctx.store.listNodes(ctx.scope);
    edges = ctx.store.listEdges(ctx.scope);
    // plan_approval is now released — its only predecessor (the corrective) is done.
    expect(frontier(nodes, edges, ROOT_NODE_ID).map((n) => n.id)).toContain('plan_approval');
    // plan_audit still never re-entered the frontier.
    expect(frontier(nodes, edges, ROOT_NODE_ID).map((n) => n.id)).not.toContain('plan_audit');
    expect(ctx.store.getNode(ctx.scope, 'plan_audit')?.status).toBe('done');
  });
});

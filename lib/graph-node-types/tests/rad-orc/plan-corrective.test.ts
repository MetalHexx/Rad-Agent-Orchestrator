import { describe, expect, it } from 'vitest';
import {
  add_corrective_gate,
  createNodeTypeRegistry,
  expand,
  frontier,
  InMemoryStateStore,
  replace_expansion,
  ROOT_NODE_ID,
} from '@rad-orchestration/graph-engine';
import type { DagNode, NodeTypeDefinition, NodeTypeRegistry, PrimitiveContext, ProjectScope } from '@rad-orchestration/graph-engine';
import { PLAN_CORRECTIVE_COMPLETED_TOKEN, PLAN_CORRECTIVE_NODE_TYPE } from '../../src/rad-orc/plan-corrective.js';

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

function node(id: string, overrides: Partial<DagNode> = {}): DagNode {
  return { id, type: 'rad-orc:task', status: 'not_started', parent: ROOT_NODE_ID, order: 0, derivedFrom: null, data: {}, ...overrides };
}

function seed(ctx: PrimitiveContext, nodes: DagNode[], edges: ReturnType<typeof node>['id'][][] = []): void {
  const result = ctx.store.apply(ctx.scope, {
    primitive: 'add_node',
    params: {},
    nodeChanges: nodes.map((after) => ({ op: 'created' as const, before: null, after })),
    edgeChanges: edges.map(([from, to]) => ({ op: 'created' as const, before: null, after: { from, to, kind: 'depends_on' as const } })),
  });
  if (!result.ok) throw new Error(`seed failed: ${result.error.message}`);
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

describe('rad-orc:plan_corrective', () => {
  it('declares an orchestrator-inline node, no spawn payload', () => {
    expect(PLAN_CORRECTIVE_NODE_TYPE.name).toBe('rad-orc:plan_corrective');
    expect(PLAN_CORRECTIVE_NODE_TYPE.traits).toEqual([]);
    expect(PLAN_CORRECTIVE_NODE_TYPE.capabilities).toEqual(['doc-read', 'doc-write']);

    const result = PLAN_CORRECTIVE_NODE_TYPE.act({
      nodeId: 'plan-audit-1-corrective-1',
      data: { masterPlanDoc: '/project/plans/MASTER-PLAN.md', reviewReportPath: '/project/reviews/plan-audit.md' },
    });
    expect(result.executor).toBe('orchestrator-inline');
    expect(result.payload).toBeUndefined();
  });

  describe('handle — completion drives replace_expansion, never a bare reset or naive expand', () => {
    it("emits T02's replace_expansion primitive against the explosion node, never reset/expand", () => {
      const expansion = { specs: [{ key: 'phase-1', type: 'rad-orc:phase' as const, parent: 'phase_loop', dependsOn: [] }] };
      const result = PLAN_CORRECTIVE_NODE_TYPE.handle({
        token: PLAN_CORRECTIVE_COMPLETED_TOKEN,
        nodeId: 'plan-audit-1-corrective-1',
        envelope: { outcome: 'ok', data: { explosionNodeId: 'phase_loop', expansion } },
      });
      expect(result).toEqual({
        dataChange: { completed: true },
        routing: { primitive: 'replace_expansion', params: { node: 'phase_loop', expansion } },
      });
    });

    it('handle ignores an unrelated token or an error outcome', () => {
      expect(
        PLAN_CORRECTIVE_NODE_TYPE.handle({
          token: 'rad-orc:plan_corrective.other',
          nodeId: 'c-1',
          envelope: { outcome: 'ok', data: {} },
        }),
      ).toEqual({});
      expect(
        PLAN_CORRECTIVE_NODE_TYPE.handle({
          token: PLAN_CORRECTIVE_COMPLETED_TOKEN,
          nodeId: 'c-1',
          envelope: { outcome: 'error', data: {} },
        }),
      ).toEqual({});
    });
  });

  it('projectStatus: done once completed, not_started otherwise', () => {
    expect(PLAN_CORRECTIVE_NODE_TYPE.projectStatus({})).toBe('not_started');
    expect(PLAN_CORRECTIVE_NODE_TYPE.projectStatus({ completed: true })).toBe('done');
  });

  it('end to end: gates plan_approval, re-explodes the phase loop on completion, and plan_audit never re-enters the frontier', () => {
    const registry: NodeTypeRegistry = createNodeTypeRegistry([stubType('rad-orc:task'), stubType('rad-orc:phase')]);
    const ctx = ctxFor('proj-a');
    seed(
      ctx,
      [node('phase_loop'), node('plan_audit', { status: 'done' }), node('plan_approval', { status: 'not_started' })],
      [['plan_audit', 'plan_approval']],
    );

    // phase_loop's original expansion, seeded before the audit ran.
    expand(ctx, registry, 'phase_loop', {
      specs: [
        { key: 'phase-1', type: 'rad-orc:phase', parent: 'phase_loop', dependsOn: [] },
        { key: 'phase-1-task-a', type: 'rad-orc:task', parent: 'phase-1', dependsOn: [] },
      ],
    });

    // plan_audit reports issues_found: birth a plan_corrective that gates plan_approval, not plan_audit.
    const gated = add_corrective_gate(ctx, 'plan-audit-1-corrective-1', PLAN_CORRECTIVE_NODE_TYPE.name, 'plan_audit', 'plan_approval', {
      data: { masterPlanDoc: '/project/plans/MASTER-PLAN.md', reviewReportPath: '/project/reviews/plan-audit.md' },
    });
    expect(gated.ok).toBe(true);

    let nodes = ctx.store.listNodes(ctx.scope);
    let edges = ctx.store.listEdges(ctx.scope);
    expect(frontier(nodes, edges, ROOT_NODE_ID).map((n) => n.id)).not.toContain('plan_approval');
    expect(frontier(nodes, edges, ROOT_NODE_ID).map((n) => n.id)).not.toContain('plan_audit');

    // The orchestrator edits the plan inline, then signals completion — handle emits T02's own
    // replace_expansion routing rather than a bare reset (would cascade back onto plan_audit) or a
    // naive expand (would collide on the prior expansion's still-live node ids).
    const expansion = {
      specs: [
        { key: 'phase-1', type: 'rad-orc:phase' as const, parent: 'phase_loop', dependsOn: [] },
        { key: 'phase-1-task-a', type: 'rad-orc:task' as const, parent: 'phase-1', dependsOn: [] },
        { key: 'phase-1-task-b', type: 'rad-orc:task' as const, parent: 'phase-1', dependsOn: ['phase-1-task-a'] },
      ],
    };
    const handled = PLAN_CORRECTIVE_NODE_TYPE.handle({
      token: PLAN_CORRECTIVE_COMPLETED_TOKEN,
      nodeId: 'plan-audit-1-corrective-1',
      envelope: { outcome: 'ok', data: { explosionNodeId: 'phase_loop', expansion } },
    });
    expect(handled.routing).toEqual({ primitive: 'replace_expansion', params: { node: 'phase_loop', expansion } });
    expect(handled.dataChange).toEqual({ completed: true });

    markStatus(ctx, 'plan-audit-1-corrective-1', 'done');

    // Carrying out `handled.routing` exactly the way a host driver would: the primitive it names.
    const replaced = replace_expansion(ctx, registry, 'phase_loop', expansion);
    expect(replaced.ok).toBe(true);
    expect(ctx.store.getNode(ctx.scope, 'phase-1-task-b')).not.toBeNull();

    nodes = ctx.store.listNodes(ctx.scope);
    edges = ctx.store.listEdges(ctx.scope);
    // plan_approval is now released — its only predecessor (the plan_corrective) is done.
    expect(frontier(nodes, edges, ROOT_NODE_ID).map((n) => n.id)).toContain('plan_approval');
    // plan_audit never re-entered the frontier throughout — it was never reset, only gated around.
    expect(frontier(nodes, edges, ROOT_NODE_ID).map((n) => n.id)).not.toContain('plan_audit');
    expect(ctx.store.getNode(ctx.scope, 'plan_audit')?.status).toBe('done');
  });
});

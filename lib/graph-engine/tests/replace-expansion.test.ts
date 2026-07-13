import { describe, expect, it } from 'vitest';
import { replace_expansion, expand, createNodeTypeRegistry, InMemoryStateStore, ROOT_NODE_ID } from '../src/index.js';
import type {
  ChangeDelta,
  DagNode,
  Expansion,
  NodeTypeDefinition,
  NodeTypeRegistry,
  PrimitiveContext,
  ProjectScope,
} from '../src/index.js';
import { detectCycle } from '../src/derive/invariants.js';

function scope(projectId: string): ProjectScope {
  return { projectId };
}

function ctxFor(projectId: string): PrimitiveContext {
  return { store: new InMemoryStateStore(), scope: scope(projectId) };
}

/** A minimal registered definition — only `name` matters to `expand`'s own resolution check. */
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

describe('replace_expansion — re-explode without an id collision', () => {
  it('reuses the exact same batch keys the prior expansion used, where a plain expand would reject', () => {
    const ctx = ctxFor('proj-a');
    seed(ctx, [node('plan')]);

    const first: Expansion = {
      specs: [
        { key: 'phase-1', type: 'rad-orc:phase', parent: 'plan', dependsOn: [] },
        { key: 'phase-1-task-a', type: 'rad-orc:task', parent: 'phase-1', dependsOn: [] },
      ],
    };
    expect(expand(ctx, registry, 'plan', first).ok).toBe(true);
    // Simulate the phases having actually run before the correction lands.
    const beforePhase = ctx.store.getNode(ctx.scope, 'phase-1');
    const beforeTask = ctx.store.getNode(ctx.scope, 'phase-1-task-a');
    if (beforePhase) ctx.store.apply(ctx.scope, {
      primitive: 'add_node',
      params: {},
      nodeChanges: [{ op: 'updated', before: beforePhase, after: { ...beforePhase, status: 'done' } }],
      edgeChanges: [],
    });
    if (beforeTask) ctx.store.apply(ctx.scope, {
      primitive: 'add_node',
      params: {},
      nodeChanges: [{ op: 'updated', before: beforeTask, after: { ...beforeTask, status: 'done' } }],
      edgeChanges: [],
    });

    // A naive re-expand with the same keys would collide.
    const naive = expand(ctx, registry, 'plan', first);
    expect(naive.ok).toBe(false);
    if (!naive.ok) expect(naive.error.code).toBe('invalid_delta');

    const corrected: Expansion = {
      specs: [
        { key: 'phase-1', type: 'rad-orc:phase', parent: 'plan', dependsOn: [] },
        { key: 'phase-1-task-a', type: 'rad-orc:task', parent: 'phase-1', dependsOn: [] },
        { key: 'phase-1-task-b', type: 'rad-orc:task', parent: 'phase-1', dependsOn: ['phase-1-task-a'] },
      ],
    };
    const result = replace_expansion(ctx, registry, 'plan', corrected);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.primitive).toBe('replace_expansion');
    expect(ctx.store.listNodes(ctx.scope)).toHaveLength(5); // root + plan + phase-1 + task-a + task-b
    expect(ctx.store.getNode(ctx.scope, 'phase-1-task-b')?.parent).toBe('phase-1');
  });

  it('resets a reused id back to not_started, re-arming the corrected work', () => {
    const ctx = ctxFor('proj-a');
    seed(ctx, [node('plan')]);
    expand(ctx, registry, 'plan', { specs: [{ key: 'phase-1', type: 'rad-orc:phase', parent: 'plan', dependsOn: [] }] });
    const before = ctx.store.getNode(ctx.scope, 'phase-1');
    if (before) {
      ctx.store.apply(ctx.scope, {
        primitive: 'add_node',
        params: {},
        nodeChanges: [{ op: 'updated', before, after: { ...before, status: 'done' } }],
        edgeChanges: [],
      });
    }

    const result = replace_expansion(ctx, registry, 'plan', {
      specs: [{ key: 'phase-1', type: 'rad-orc:phase', parent: 'plan', dependsOn: [] }],
    });

    expect(result.ok).toBe(true);
    expect(ctx.store.getNode(ctx.scope, 'phase-1')?.status).toBe('not_started');
  });

  it('removes a cone node dropped by the corrected expansion, and adds a genuinely new one', () => {
    const ctx = ctxFor('proj-a');
    seed(ctx, [node('plan')]);
    expand(ctx, registry, 'plan', {
      specs: [
        { key: 'phase-1', type: 'rad-orc:phase', parent: 'plan', dependsOn: [] },
        { key: 'phase-2', type: 'rad-orc:phase', parent: 'plan', dependsOn: ['phase-1'] },
      ],
    });

    const result = replace_expansion(ctx, registry, 'plan', {
      specs: [
        { key: 'phase-1', type: 'rad-orc:phase', parent: 'plan', dependsOn: [] },
        { key: 'phase-1b', type: 'rad-orc:phase', parent: 'plan', dependsOn: ['phase-1'] },
      ],
    });

    expect(result.ok).toBe(true);
    expect(ctx.store.getNode(ctx.scope, 'phase-2')).toBeNull();
    expect(ctx.store.getNode(ctx.scope, 'phase-1b')).not.toBeNull();
    expect(ctx.store.getNode(ctx.scope, 'phase-1')).not.toBeNull();
  });

  it('leaves an edge from outside the cone into the expanding node untouched', () => {
    const ctx = ctxFor('proj-a');
    seed(
      ctx,
      [node('gate-in', { status: 'done' }), node('plan')],
      [{ op: 'created', before: null, after: { from: 'gate-in', to: 'plan', kind: 'depends_on' } }],
    );
    expand(ctx, registry, 'plan', { specs: [{ key: 'phase-1', type: 'rad-orc:phase', parent: 'plan', dependsOn: [] }] });

    const result = replace_expansion(ctx, registry, 'plan', {
      specs: [{ key: 'phase-1', type: 'rad-orc:phase', parent: 'plan', dependsOn: [] }],
    });

    expect(result.ok).toBe(true);
    expect(ctx.store.listEdges(ctx.scope)).toEqual(
      expect.arrayContaining([{ from: 'gate-in', to: 'plan', kind: 'depends_on' }]),
    );
  });

  it('acts as a plain expand when the node never expanded anything before', () => {
    const ctx = ctxFor('proj-a');
    seed(ctx, [node('plan')]);

    const result = replace_expansion(ctx, registry, 'plan', {
      specs: [{ key: 'phase-1', type: 'rad-orc:phase', parent: 'plan', dependsOn: [] }],
    });

    expect(result.ok).toBe(true);
    expect(ctx.store.getNode(ctx.scope, 'phase-1')).not.toBeNull();
  });

  it('rejects (and writes nothing for) an expanding node that does not exist', () => {
    const ctx = ctxFor('proj-a');
    const result = replace_expansion(ctx, registry, 'ghost', {
      specs: [{ key: 'a', type: 'rad-orc:task', parent: null, dependsOn: [] }],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid_delta');
    expect(ctx.store.listNodes(ctx.scope)).toHaveLength(1); // only the seeded root
  });

  it('rejects (and writes nothing for) a spec type the registry does not resolve, leaving the prior expansion intact', () => {
    const ctx = ctxFor('proj-a');
    seed(ctx, [node('plan')]);
    expand(ctx, registry, 'plan', { specs: [{ key: 'phase-1', type: 'rad-orc:phase', parent: 'plan', dependsOn: [] }] });

    const result = replace_expansion(ctx, registry, 'plan', {
      specs: [{ key: 'phase-2', type: 'acme-qa:security-scan', parent: 'plan', dependsOn: [] }],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('unknown_node_type');
    expect(ctx.store.getNode(ctx.scope, 'phase-1')).not.toBeNull(); // nothing torn down on rejection
  });

  it('keeps the depends_on graph acyclic after a reused-key replace', () => {
    const ctx = ctxFor('proj-a');
    seed(ctx, [node('plan')]);
    expand(ctx, registry, 'plan', {
      specs: [
        { key: 'phase-1', type: 'rad-orc:phase', parent: 'plan', dependsOn: [] },
        { key: 'phase-1-task-a', type: 'rad-orc:task', parent: 'phase-1', dependsOn: [] },
      ],
    });

    replace_expansion(ctx, registry, 'plan', {
      specs: [
        { key: 'phase-1', type: 'rad-orc:phase', parent: 'plan', dependsOn: [] },
        { key: 'phase-1-task-a', type: 'rad-orc:task', parent: 'phase-1', dependsOn: [] },
        { key: 'phase-1-task-b', type: 'rad-orc:task', parent: 'phase-1', dependsOn: ['phase-1-task-a'] },
      ],
    });

    expect(detectCycle(ctx.store.listEdges(ctx.scope))).toBeNull();
  });
});

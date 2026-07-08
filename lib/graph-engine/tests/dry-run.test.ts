import { describe, expect, it } from 'vitest';
import {
  validate,
  preview,
  remove_node,
  expand,
  add_corrective,
  reset,
  createNodeTypeRegistry,
  ROOT_NODE_ID,
  createRootNode,
  InMemoryStateStore,
} from '../src/index.js';
import type {
  AddCorrectivePreview,
  ChangeDelta,
  DagEdge,
  DagNode,
  Expansion,
  GraphSnapshot,
  NodeTypeDefinition,
  NodeTypeRegistry,
  PreviewCone,
  PrimitiveContext,
  ProjectScope,
  ResetPreview,
} from '../src/index.js';

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

function dependsOn(from: string, to: string): DagEdge {
  return { from, to, kind: 'depends_on' };
}

function graph(nodes: DagNode[], edges: DagEdge[] = []): GraphSnapshot {
  return { nodes, edges };
}

describe('validate — add_dependency', () => {
  it('rejects an edge that would form a depends_on cycle', () => {
    const root = createRootNode();
    const a = node('a');
    const b = node('b');
    const g = graph([root, a, b], [dependsOn('a', 'b')]);

    const result = validate(g, { kind: 'add_dependency', from: 'b', to: 'a' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('cycle');
  });

  it('accepts a legal edge', () => {
    const root = createRootNode();
    const a = node('a');
    const b = node('b');
    const g = graph([root, a, b], []);

    const result = validate(g, { kind: 'add_dependency', from: 'a', to: 'b' });

    expect(result).toEqual({ ok: true, data: undefined });
  });
});

describe('validate — root guard', () => {
  it('rejects remove_node targeting the root', () => {
    const root = createRootNode();
    const g = graph([root], []);

    const result = validate(g, { kind: 'remove_node', nodeId: ROOT_NODE_ID, cascade: true });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('root_guarded');
  });

  it('rejects move_node targeting the root', () => {
    const root = createRootNode();
    const phase = node('phase-1');
    const g = graph([root, phase], []);

    const result = validate(g, { kind: 'move_node', nodeId: ROOT_NODE_ID, newParent: 'phase-1' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('root_guarded');
  });

  it('accepts a legal remove_node/move_node against a non-root node', () => {
    const root = createRootNode();
    const a = node('a');
    const b = node('b');
    const g = graph([root, a, b], []);

    expect(validate(g, { kind: 'remove_node', nodeId: 'a', cascade: false })).toEqual({ ok: true, data: undefined });
    expect(validate(g, { kind: 'move_node', nodeId: 'a', newParent: 'b' })).toEqual({ ok: true, data: undefined });
  });
});

describe('validate — move_node tree-shape', () => {
  it('rejects moving a node under its own descendant', () => {
    const root = createRootNode();
    const parent = node('parent');
    const child = node('child', { parent: 'parent' });
    const g = graph([root, parent, child], []);

    const result = validate(g, { kind: 'move_node', nodeId: 'parent', newParent: 'child' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('cycle');
  });
});

describe('validate — cross-axis containment/dependency guard', () => {
  it('rejects add_dependency from a descendant onto its own ancestor', () => {
    const root = createRootNode();
    const parent = node('parent');
    const child = node('child', { parent: 'parent' });
    const g = graph([root, parent, child], []);

    const result = validate(g, { kind: 'add_dependency', from: 'child', to: 'parent' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('cross_axis_cycle');
  });

  it('rejects add_dependency from an ancestor onto its own descendant', () => {
    const root = createRootNode();
    const parent = node('parent');
    const child = node('child', { parent: 'parent' });
    const g = graph([root, parent, child], []);

    const result = validate(g, { kind: 'add_dependency', from: 'parent', to: 'child' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('cross_axis_cycle');
  });

  it('rejects move_node that would newly relate an existing depends_on edge by containment', () => {
    const root = createRootNode();
    const x = node('x');
    const y = node('y');
    const g = graph([root, x, y], [dependsOn('x', 'y')]);

    const result = validate(g, { kind: 'move_node', nodeId: 'x', newParent: 'y' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('cross_axis_cycle');
  });

  it('still accepts a move_node that leaves no depends_on edge crossing containment', () => {
    const root = createRootNode();
    const x = node('x');
    const y = node('y');
    const g = graph([root, x, y], [dependsOn('x', 'y')]);

    expect(validate(g, { kind: 'move_node', nodeId: 'x', newParent: ROOT_NODE_ID })).toEqual({
      ok: true,
      data: undefined,
    });
  });
});

describe('preview — remove_node cascade cone', () => {
  it('returns exactly the descendant/dependent cone on a small branching graph', () => {
    const root = createRootNode();
    const phase = node('phase-1');
    const taskA = node('task-a', { parent: 'phase-1' });
    const taskB = node('task-b', { parent: 'phase-1' });
    const outsider = node('outsider');
    const edges = [dependsOn('task-a', 'task-b'), dependsOn('task-a', 'outsider')];
    const g = graph([root, phase, taskA, taskB, outsider], edges);

    const cone = preview(g, { kind: 'remove_node', nodeId: 'phase-1', cascade: true });

    expect(new Set(cone.nodeIds)).toEqual(new Set(['phase-1', 'task-a', 'task-b']));
    // Both edges are incident to a removed node (task-a), so both would dangle if not also removed —
    // even the one reaching 'outsider', a node outside the cone that survives.
    expect(cone.edges).toEqual(
      expect.arrayContaining([dependsOn('task-a', 'task-b'), dependsOn('task-a', 'outsider')]),
    );
    expect(cone.edges).toHaveLength(2);
  });

  it('touches only the target node when cascade is false', () => {
    const root = createRootNode();
    const phase = node('phase-1');
    const taskA = node('task-a', { parent: 'phase-1' });
    const g = graph([root, phase, taskA], []);

    const cone = preview(g, { kind: 'remove_node', nodeId: 'phase-1', cascade: false });

    expect(cone.nodeIds).toEqual(['phase-1']);
    expect(cone.edges).toEqual([]);
  });

  it('folds in the transitive dependents sweep when dependentsCascade is set', () => {
    const root = createRootNode();
    const x = node('x');
    const y = node('y');
    const yChild = node('y-child', { parent: 'y' });
    const z = node('z');
    const outsider = node('outsider'); // has no depends_on edge to/from the swept set
    const edges = [dependsOn('x', 'y'), dependsOn('y', 'z')];
    const g = graph([root, x, y, yChild, z, outsider], edges);

    const cone = preview(g, { kind: 'remove_node', nodeId: 'x', cascade: false, dependentsCascade: true });

    // 'x' itself, plus everything transitively gated on it ('y', its containment child, and 'z'
    // gated on 'y') — the exact blast radius remove_node's own dependents: 'cascade' sweep removes.
    expect(new Set(cone.nodeIds)).toEqual(new Set(['x', 'y', 'y-child', 'z']));
    expect(cone.nodeIds).not.toContain('outsider');
    expect(new Set(cone.edges)).toEqual(new Set([dependsOn('x', 'y'), dependsOn('y', 'z')]));
  });

  it('omits the dependents sweep when dependentsCascade is absent, even though the same nodes would be swept by remove_node', () => {
    const root = createRootNode();
    const x = node('x');
    const y = node('y');
    const g = graph([root, x, y], [dependsOn('x', 'y')]);

    const cone = preview(g, { kind: 'remove_node', nodeId: 'x', cascade: false });

    expect(cone.nodeIds).toEqual(['x']);
  });

  it('reports exactly the node set remove_node itself removes under a dependents: cascade strategy', () => {
    function scope(projectId: string): ProjectScope {
      return { projectId };
    }

    const store = new InMemoryStateStore();
    const ctx: PrimitiveContext = { store, scope: scope('proj-a') };
    const seeded = store.apply(ctx.scope, {
      primitive: 'add_node' as ChangeDelta['primitive'],
      params: {},
      nodeChanges: [
        { op: 'created', before: null, after: node('x') },
        { op: 'created', before: null, after: node('y') },
        { op: 'created', before: null, after: node('z') },
      ],
      edgeChanges: [
        { op: 'created', before: null, after: dependsOn('x', 'y') },
        { op: 'created', before: null, after: dependsOn('y', 'z') },
      ],
    });
    expect(seeded.ok).toBe(true);

    const g = graph(store.listNodes(ctx.scope) as DagNode[], store.listEdges(ctx.scope) as DagEdge[]);
    const cone = preview(g, { kind: 'remove_node', nodeId: 'x', cascade: false, dependentsCascade: true });

    const result = remove_node(ctx, 'x', { dependents: 'cascade' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const actuallyRemovedIds = result.data.nodeChanges
      .filter((change) => change.op === 'removed')
      .map((change) => (change.before as DagNode).id);

    expect(new Set(cone.nodeIds)).toEqual(new Set(actuallyRemovedIds));
  });
});

describe('validate/preview never mutate the store', () => {
  function scope(projectId: string): ProjectScope {
    return { projectId };
  }

  it('leaves listNodes/listEdges unchanged across a validate and a preview call', () => {
    const store = new InMemoryStateStore();
    const s = scope('proj-a');
    store.apply(s, {
      primitive: 'add_node' as ChangeDelta['primitive'],
      params: {},
      nodeChanges: [
        { op: 'created', before: null, after: node('a') },
        { op: 'created', before: null, after: node('b') },
      ],
      edgeChanges: [{ op: 'created', before: null, after: dependsOn('a', 'b') }],
    });

    const nodesBefore = store.listNodes(s);
    const edgesBefore = store.listEdges(s);
    const g = graph(nodesBefore, edgesBefore);

    validate(g, { kind: 'add_dependency', from: 'b', to: 'a' });
    preview(g, { kind: 'remove_node', nodeId: 'a', cascade: true });

    expect(store.listNodes(s)).toEqual(nodesBefore);
    expect(store.listEdges(s)).toEqual(edgesBefore);
  });
});

describe('validate — expand', () => {
  const registry: NodeTypeRegistry = createNodeTypeRegistry([stubType('rad-orc:task')]);

  it('rejects an expansion with a duplicate batch key', () => {
    const root = createRootNode();
    const container = node('container');
    const g = graph([root, container], []);
    const expansion: Expansion = {
      specs: [
        { key: 'dup', type: 'rad-orc:task', parent: 'container', dependsOn: [] },
        { key: 'dup', type: 'rad-orc:task', parent: 'container', dependsOn: [] },
      ],
    };

    const result = validate(g, { kind: 'expand', node: 'container', expansion, registry });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid_delta');
  });

  it('rejects an expansion whose batch would create a depends_on cycle among itself', () => {
    const root = createRootNode();
    const container = node('container');
    const g = graph([root, container], []);
    const expansion: Expansion = {
      specs: [
        { key: 'a', type: 'rad-orc:task', parent: 'container', dependsOn: ['b'] },
        { key: 'b', type: 'rad-orc:task', parent: 'container', dependsOn: ['a'] },
      ],
    };

    const result = validate(g, { kind: 'expand', node: 'container', expansion, registry });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('cycle');
  });

  it('accepts a legal expansion', () => {
    const root = createRootNode();
    const container = node('container');
    const g = graph([root, container], []);
    const expansion: Expansion = {
      specs: [{ key: 'child', type: 'rad-orc:task', parent: 'container', dependsOn: [] }],
    };

    const result = validate(g, { kind: 'expand', node: 'container', expansion, registry });

    expect(result).toEqual({ ok: true, data: undefined });
  });
});

describe('preview — expand', () => {
  const registry: NodeTypeRegistry = createNodeTypeRegistry([stubType('rad-orc:task')]);

  it('matches the node/edge creations expand itself commits, for a batch gated on a pre-existing node', () => {
    const store = new InMemoryStateStore();
    const ctx: PrimitiveContext = { store, scope: { projectId: 'proj-a' } };
    const seeded = store.apply(ctx.scope, {
      primitive: 'add_node' as ChangeDelta['primitive'],
      params: {},
      nodeChanges: [{ op: 'created', before: null, after: node('container') }],
      edgeChanges: [],
    });
    expect(seeded.ok).toBe(true);

    const expansion: Expansion = {
      specs: [
        { key: 'phase', type: 'rad-orc:task', parent: 'container', dependsOn: [] },
        { key: 'task-1', type: 'rad-orc:task', parent: 'phase', dependsOn: ['phase'] },
      ],
    };

    const g = graph(store.listNodes(ctx.scope) as DagNode[], store.listEdges(ctx.scope) as DagEdge[]);
    const cone: PreviewCone = preview(g, { kind: 'expand', node: 'container', expansion, registry });

    const result = expand(ctx, registry, 'container', expansion);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const actualNodeIds = result.data.nodeChanges.map((change) => (change.after as DagNode).id);
    const actualEdges = result.data.edgeChanges.map((change) => change.after as DagEdge);

    expect(new Set(cone.nodeIds)).toEqual(new Set(actualNodeIds));
    expect(cone.edges).toEqual(expect.arrayContaining(actualEdges));
    expect(cone.edges).toHaveLength(actualEdges.length);
  });

  it('reports an empty cone when the expansion itself is illegal', () => {
    const root = createRootNode();
    const g = graph([root], []);
    const expansion: Expansion = {
      specs: [{ key: 'child', type: 'acme-qa:unregistered', parent: null, dependsOn: [] }],
    };

    const cone: PreviewCone = preview(g, { kind: 'expand', node: ROOT_NODE_ID, expansion, registry });

    expect(cone).toEqual({ nodeIds: [], edges: [] });
  });
});

describe('validate — add_corrective', () => {
  it('rejects a review that is not done/in_progress (not re-armable)', () => {
    const root = createRootNode();
    const phase = node('phase-1');
    const taskA = node('task-a', { parent: 'phase-1', status: 'done' });
    const review = node('review', { status: 'not_started' });
    const g = graph([root, phase, taskA, review], [dependsOn('task-a', 'review')]);

    const result = validate(g, {
      kind: 'add_corrective',
      review: 'review',
      id: 'corrective-1',
      type: 'rad-orc:corrective',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid_delta');
  });

  it('accepts a legal add_corrective candidate', () => {
    const root = createRootNode();
    const phase = node('phase-1');
    const taskA = node('task-a', { parent: 'phase-1', status: 'done' });
    const review = node('review', { status: 'done' });
    const g = graph([root, phase, taskA, review], [dependsOn('task-a', 'review')]);

    const result = validate(g, {
      kind: 'add_corrective',
      review: 'review',
      id: 'corrective-1',
      type: 'rad-orc:corrective',
    });

    expect(result).toEqual({ ok: true, data: undefined });
  });
});

describe('preview — add_corrective', () => {
  function ctxFor(projectId: string): PrimitiveContext {
    return { store: new InMemoryStateStore(), scope: { projectId } };
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

  it('reports the corrective node, gate edge, and review reset for a within-budget call, matching the actual commit', () => {
    const ctx = ctxFor('proj-a');
    seed(
      ctx,
      [node('phase-1'), node('task-a', { parent: 'phase-1', status: 'done' }), node('review', { status: 'done' })],
      [{ op: 'created', before: null, after: dependsOn('task-a', 'review') }],
    );

    const g = graph(ctx.store.listNodes(ctx.scope) as DagNode[], ctx.store.listEdges(ctx.scope) as DagEdge[]);
    const cone: AddCorrectivePreview = preview(g, {
      kind: 'add_corrective',
      review: 'review',
      id: 'corrective-1',
      type: 'rad-orc:corrective',
      options: { maxRetries: 5 },
    });

    expect(cone.wouldHalt).toBe(false);
    expect(cone.correctiveNode).toEqual(
      expect.objectContaining({
        id: 'corrective-1',
        type: 'rad-orc:corrective',
        parent: 'phase-1',
        derivedFrom: 'task-a',
      }),
    );
    expect(cone.gateEdge).toEqual({ from: 'corrective-1', to: 'review', kind: 'depends_on' });
    expect(cone.reviewAfter).toEqual(expect.objectContaining({ id: 'review', status: 'not_started' }));

    const result = add_corrective(ctx, 'corrective-1', 'rad-orc:corrective', 'review', { maxRetries: 5 });
    expect(result.ok).toBe(true);
    expect(ctx.store.getNode(ctx.scope, 'corrective-1')).toEqual(cone.correctiveNode);
    expect(ctx.store.getNode(ctx.scope, 'review')).toEqual(cone.reviewAfter);
  });

  it('reports a would-halt outcome (no corrective, review disabled) once the retry budget is met, matching the actual commit', () => {
    const ctx = ctxFor('proj-a');
    seed(
      ctx,
      [node('phase-1'), node('task-a', { parent: 'phase-1', status: 'done' }), node('review', { status: 'done' })],
      [{ op: 'created', before: null, after: dependsOn('task-a', 'review') }],
    );

    const g = graph(ctx.store.listNodes(ctx.scope) as DagNode[], ctx.store.listEdges(ctx.scope) as DagEdge[]);
    const cone: AddCorrectivePreview = preview(g, {
      kind: 'add_corrective',
      review: 'review',
      id: 'corrective-1',
      type: 'rad-orc:corrective',
      options: { maxRetries: 0 },
    });

    expect(cone.wouldHalt).toBe(true);
    expect(cone.correctiveNode).toBeNull();
    expect(cone.gateEdge).toBeNull();
    expect(cone.reviewAfter).toEqual(expect.objectContaining({ id: 'review', disabled: true }));

    const result = add_corrective(ctx, 'corrective-1', 'rad-orc:corrective', 'review', { maxRetries: 0 });
    expect(result.ok).toBe(true);
    expect(ctx.store.getNode(ctx.scope, 'corrective-1')).toBeNull();
    expect(ctx.store.getNode(ctx.scope, 'review')).toEqual(cone.reviewAfter);
  });
});

describe('preview — reset', () => {
  it('reports the same cascade cone a real cascade reset removes/resets', () => {
    const store = new InMemoryStateStore();
    const ctx: PrimitiveContext = { store, scope: { projectId: 'proj-a' } };
    const seeded = store.apply(ctx.scope, {
      primitive: 'add_node' as ChangeDelta['primitive'],
      params: {},
      nodeChanges: [
        { op: 'created', before: null, after: node('explosion', { status: 'done' }) },
        { op: 'created', before: null, after: node('phase-1', { derivedFrom: 'explosion', status: 'done' }) },
        {
          op: 'created',
          before: null,
          after: node('task-a', { parent: 'phase-1', derivedFrom: 'explosion', status: 'done' }),
        },
      ],
      edgeChanges: [],
    });
    expect(seeded.ok).toBe(true);

    const g = graph(store.listNodes(ctx.scope) as DagNode[], store.listEdges(ctx.scope) as DagEdge[]);
    const cone: ResetPreview = preview(g, { kind: 'reset', node: 'explosion', cascade: true });

    expect(cone.resetNodeIds).toEqual(['explosion']);
    expect(new Set(cone.tornDownNodeIds)).toEqual(new Set(['phase-1', 'task-a']));

    const result = reset(ctx, 'explosion', true);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const actualReset = result.data.nodeChanges
      .filter((change) => change.op === 'updated')
      .map((change) => (change.after as DagNode).id);
    const actualTornDown = result.data.nodeChanges
      .filter((change) => change.op === 'removed')
      .map((change) => (change.before as DagNode).id);
    const actualRemovedEdges = result.data.edgeChanges.map((change) => change.before as DagEdge);

    expect(new Set(cone.resetNodeIds)).toEqual(new Set(actualReset));
    expect(new Set(cone.tornDownNodeIds)).toEqual(new Set(actualTornDown));
    expect(new Set(cone.removedEdges)).toEqual(new Set(actualRemovedEdges));
  });

  it('yields an empty cone for a non-resettable target (never ran)', () => {
    const root = createRootNode();
    const notStarted = node('a');
    const g = graph([root, notStarted], []);

    const cone: ResetPreview = preview(g, { kind: 'reset', node: 'a', cascade: true });

    expect(cone).toEqual({ resetNodeIds: [], tornDownNodeIds: [], removedEdges: [] });
  });

  it('reports only the target for a non-cascading reset, even though a dependent also ran', () => {
    const root = createRootNode();
    const a = node('a', { status: 'done' });
    const b = node('b', { status: 'done' });
    const g = graph([root, a, b], [dependsOn('a', 'b')]);

    const cone: ResetPreview = preview(g, { kind: 'reset', node: 'a', cascade: false });

    expect(cone).toEqual({ resetNodeIds: ['a'], tornDownNodeIds: [], removedEdges: [] });
  });
});

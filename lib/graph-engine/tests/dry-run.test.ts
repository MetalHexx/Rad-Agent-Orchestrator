import { describe, expect, it } from 'vitest';
import {
  validate,
  preview,
  ROOT_NODE_ID,
  createRootNode,
  InMemoryStateStore,
} from '../src/index.js';
import type { ChangeDelta, DagEdge, DagNode, GraphSnapshot, ProjectScope } from '../src/index.js';

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

import { describe, expect, it } from 'vitest';
import { InMemoryStateStore } from '../src/store/in-memory-store.js';
import { ROOT_NODE_ID, ROOT_TRAITS } from '../src/model/root.js';
import type { ProjectScope } from '../src/store/state-store.js';
import type { ChangeDelta, DagNode } from '../src/index.js';

function scope(projectId: string): ProjectScope {
  return { projectId };
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

function createDelta(nodes: DagNode[], edges: ChangeDelta['edgeChanges'] = []): ChangeDelta {
  return {
    primitive: 'add_node' as ChangeDelta['primitive'],
    params: {},
    nodeChanges: nodes.map((after) => ({ op: 'created' as const, before: null, after })),
    edgeChanges: edges,
  };
}

describe('InMemoryStateStore — seeding', () => {
  it('seeds a freshly-touched scope with exactly the project-scoped root', () => {
    const store = new InMemoryStateStore();
    const nodes = store.listNodes(scope('proj-a'));
    expect(nodes).toHaveLength(1);
    const [root] = nodes;
    expect(root.id).toBe(ROOT_NODE_ID);
    expect(root.status).toBe('in_progress');
    expect(root.parent).toBeNull();
    expect(ROOT_TRAITS).toContain('contains');
    expect(store.getNode(scope('proj-a'), ROOT_NODE_ID)).toEqual(root);
  });
});

describe('InMemoryStateStore — apply round-trip', () => {
  it('round-trips nodes and edges written via apply back out through getNode/listNodes/listEdges', () => {
    const store = new InMemoryStateStore();
    const s = scope('proj-a');
    const a = node('task-a');
    const b = node('task-b');
    const delta = createDelta([a, b], [
      { op: 'created', before: null, after: { from: 'task-a', to: 'task-b', kind: 'depends_on' } },
    ]);

    const result = store.apply(s, delta);

    expect(result.ok).toBe(true);
    expect(store.getNode(s, 'task-a')).toEqual(a);
    expect(store.getNode(s, 'task-b')).toEqual(b);
    expect(store.listNodes(s)).toHaveLength(3); // root + task-a + task-b
    expect(store.listEdges(s)).toEqual([{ from: 'task-a', to: 'task-b', kind: 'depends_on' }]);
  });

  it('applies an update and a removal transactionally', () => {
    const store = new InMemoryStateStore();
    const s = scope('proj-a');
    const original = node('task-a', { status: 'not_started' });
    store.apply(s, createDelta([original]));

    const updated = { ...original, status: 'in_progress' as const };
    const updateResult = store.apply(s, {
      primitive: 'add_node' as ChangeDelta['primitive'],
      params: {},
      nodeChanges: [{ op: 'updated', before: original, after: updated }],
      edgeChanges: [],
    });
    expect(updateResult.ok).toBe(true);
    expect(store.getNode(s, 'task-a')).toEqual(updated);

    const removeResult = store.apply(s, {
      primitive: 'add_node' as ChangeDelta['primitive'],
      params: {},
      nodeChanges: [{ op: 'removed', before: updated, after: null }],
      edgeChanges: [],
    });
    expect(removeResult.ok).toBe(true);
    expect(store.getNode(s, 'task-a')).toBeNull();
  });
});

describe('InMemoryStateStore — scope isolation', () => {
  it('keeps two scopes side-by-side without bleeding writes between them', () => {
    const store = new InMemoryStateStore();
    const a = scope('proj-a');
    const b = scope('proj-b');

    store.apply(a, createDelta([node('only-in-a')]));

    expect(store.getNode(a, 'only-in-a')).not.toBeNull();
    expect(store.getNode(b, 'only-in-a')).toBeNull();
    expect(store.listNodes(b)).toHaveLength(1); // only b's own seeded root
    expect(store.listNodes(b)[0].id).toBe(ROOT_NODE_ID);
  });
});

describe('InMemoryStateStore — transactional rollback', () => {
  it('rejects a delta that removes a non-existent node with a Result error, not a throw', () => {
    const store = new InMemoryStateStore();
    const s = scope('proj-a');

    expect(() => store.apply(s, {
      primitive: 'add_node' as ChangeDelta['primitive'],
      params: {},
      nodeChanges: [{ op: 'removed', before: node('ghost'), after: null }],
      edgeChanges: [],
    })).not.toThrow();

    const result = store.apply(s, {
      primitive: 'add_node' as ChangeDelta['primitive'],
      params: {},
      nodeChanges: [{ op: 'removed', before: node('ghost'), after: null }],
      edgeChanges: [],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid_delta');
  });

  it('leaves the store untouched when part of a mixed delta is malformed (all-or-nothing)', () => {
    const store = new InMemoryStateStore();
    const s = scope('proj-a');
    const before = store.listNodes(s);

    const result = store.apply(s, createDelta([node('good')], [
      { op: 'removed', before: { from: 'ghost-a', to: 'ghost-b', kind: 'depends_on' }, after: null },
    ]));

    expect(result.ok).toBe(false);
    expect(store.getNode(s, 'good')).toBeNull();
    expect(store.listNodes(s)).toEqual(before);
  });
});

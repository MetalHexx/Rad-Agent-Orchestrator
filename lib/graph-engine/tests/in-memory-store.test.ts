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

function delta(
  nodeChanges: ChangeDelta['nodeChanges'],
  edgeChanges: ChangeDelta['edgeChanges'] = [],
): ChangeDelta {
  return {
    primitive: 'add_node' as ChangeDelta['primitive'],
    params: {},
    nodeChanges,
    edgeChanges,
  };
}

function createDelta(nodes: DagNode[], edges: ChangeDelta['edgeChanges'] = []): ChangeDelta {
  return delta(
    nodes.map((after) => ({ op: 'created' as const, before: null, after })),
    edges,
  );
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
    const roundTripDelta = createDelta([a, b], [
      { op: 'created', before: null, after: { from: 'task-a', to: 'task-b', kind: 'depends_on' } },
    ]);

    const result = store.apply(s, roundTripDelta);

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
    const updateResult = store.apply(
      s,
      delta([{ op: 'updated', before: original, after: updated }]),
    );
    expect(updateResult.ok).toBe(true);
    expect(store.getNode(s, 'task-a')).toEqual(updated);

    const removeResult = store.apply(s, delta([{ op: 'removed', before: updated, after: null }]));
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

    expect(() =>
      store.apply(s, delta([{ op: 'removed', before: node('ghost'), after: null }])),
    ).not.toThrow();

    const result = store.apply(s, delta([{ op: 'removed', before: node('ghost'), after: null }]));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid_delta');
  });

  it('rejects an updated node change that changes id, leaving neither the old nor new node written', () => {
    const store = new InMemoryStateStore();
    const s = scope('proj-a');
    const original = node('task-a');
    store.apply(s, createDelta([original]));

    const result = store.apply(
      s,
      delta([{ op: 'updated', before: original, after: node('task-b') }]),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid_delta');
    // the identity-changing update is rejected outright — no orphaned duplicate is created
    expect(store.getNode(s, 'task-a')).toEqual(original);
    expect(store.getNode(s, 'task-b')).toBeNull();
  });

  it('rejects an updated edge change that changes identity, so no stale duplicate edge is left behind', () => {
    const store = new InMemoryStateStore();
    const s = scope('proj-a');
    const a = node('task-a');
    const b = node('task-b');
    const c = node('task-c');
    const edge = { from: 'task-a', to: 'task-b', kind: 'depends_on' as const };
    store.apply(s, createDelta([a, b, c], [{ op: 'created', before: null, after: edge }]));

    const result = store.apply(
      s,
      delta([], [{ op: 'updated', before: edge, after: { from: 'task-a', to: 'task-c', kind: 'depends_on' } }]),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid_delta');
    // the original edge survives untouched and no second edge under the new identity was written
    expect(store.listEdges(s)).toEqual([edge]);
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

describe('InMemoryStateStore — edge/node referential integrity', () => {
  it('rejects an edge whose from/to reference nodes that were never created', () => {
    const store = new InMemoryStateStore();
    const s = scope('proj-a');

    const result = store.apply(s, createDelta([], [
      { op: 'created', before: null, after: { from: 'ghost-a', to: 'ghost-b', kind: 'depends_on' } },
    ]));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid_delta');
    expect(store.listEdges(s)).toEqual([]);
  });

  it('rejects removing a node that a still-present edge references', () => {
    const store = new InMemoryStateStore();
    const s = scope('proj-a');
    const a = node('task-a');
    const b = node('task-b');
    store.apply(s, createDelta([a, b], [
      { op: 'created', before: null, after: { from: 'task-a', to: 'task-b', kind: 'depends_on' } },
    ]));

    const result = store.apply(s, delta([{ op: 'removed', before: a, after: null }]));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid_delta');
    // rejected, not cascaded: the node and its edge both survive untouched
    expect(store.getNode(s, 'task-a')).toEqual(a);
    expect(store.listEdges(s)).toEqual([{ from: 'task-a', to: 'task-b', kind: 'depends_on' }]);
  });

  it('allows removing a node when the same delta also removes its dependent edges', () => {
    const store = new InMemoryStateStore();
    const s = scope('proj-a');
    const a = node('task-a');
    const b = node('task-b');
    const edge = { from: 'task-a', to: 'task-b', kind: 'depends_on' as const };
    store.apply(s, createDelta([a, b], [{ op: 'created', before: null, after: edge }]));

    const result = store.apply(
      s,
      delta(
        [{ op: 'removed', before: a, after: null }],
        [{ op: 'removed', before: edge, after: null }],
      ),
    );

    expect(result.ok).toBe(true);
    expect(store.getNode(s, 'task-a')).toBeNull();
    expect(store.listEdges(s)).toEqual([]);
  });
});

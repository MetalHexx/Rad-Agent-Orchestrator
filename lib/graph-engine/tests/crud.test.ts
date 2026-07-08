import { describe, expect, it } from 'vitest';
import {
  add_node,
  remove_node,
  add_dependency,
  remove_dependency,
  move_node,
  set_order,
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

/** A minimal registered definition — only `name` matters to `add_node`'s own resolution check. */
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

const registry: NodeTypeRegistry = createNodeTypeRegistry([stubType('rad-orc:task')]);

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

describe('add_node', () => {
  it('inserts a leaf node under an existing parent', () => {
    const ctx = ctxFor('proj-a');

    const result = add_node(ctx, registry, 'task-a', 'rad-orc:task', ROOT_NODE_ID);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.primitive).toBe('add_node');
    expect(result.data.nodeChanges).toEqual([
      { op: 'created', before: null, after: node('task-a') },
    ]);
    expect(ctx.store.getNode(ctx.scope, 'task-a')).toEqual(node('task-a'));
  });

  it('lands the node and its gate edges in one delta, ungated until the gate clears', () => {
    const ctx = ctxFor('proj-a');
    seed(ctx, [node('setup', { status: 'not_started' })]);

    const result = add_node(ctx, registry, 'deploy', 'rad-orc:task', ROOT_NODE_ID, { dependsOn: ['setup'] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.nodeChanges).toHaveLength(1);
    expect(result.data.edgeChanges).toEqual([
      { op: 'created', before: null, after: { from: 'setup', to: 'deploy', kind: 'depends_on' } },
    ]);
    expect(ctx.store.getNode(ctx.scope, 'deploy')).not.toBeNull();
    expect(ctx.store.listEdges(ctx.scope)).toEqual([{ from: 'setup', to: 'deploy', kind: 'depends_on' }]);
  });

  it('rejects (and writes nothing for) a missing parent', () => {
    const ctx = ctxFor('proj-a');

    const result = add_node(ctx, registry, 'task-a', 'rad-orc:task', 'no-such-parent');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid_delta');
    expect(ctx.store.listNodes(ctx.scope)).toHaveLength(1); // only the seeded root
  });

  it('rejects (and writes nothing for) a type the registry does not resolve', () => {
    const ctx = ctxFor('proj-a');

    const result = add_node(ctx, registry, 'task-a', 'acme-qa:security-scan', ROOT_NODE_ID);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('unknown_node_type');
    expect(ctx.store.listNodes(ctx.scope)).toHaveLength(1); // only the seeded root
  });

  it('rejects (and writes nothing for) a duplicate id', () => {
    const ctx = ctxFor('proj-a');
    seed(ctx, [node('task-a')]);

    const result = add_node(ctx, registry, 'task-a', 'rad-orc:task', ROOT_NODE_ID);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid_delta');
  });

  it('rejects a dependsOn reference to a node that does not exist', () => {
    const ctx = ctxFor('proj-a');

    const result = add_node(ctx, registry, 'task-a', 'rad-orc:task', ROOT_NODE_ID, { dependsOn: ['ghost'] });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid_delta');
    expect(ctx.store.listNodes(ctx.scope)).toHaveLength(1);
  });
});

describe('remove_node — root guard', () => {
  it('refuses to remove the root and writes nothing', () => {
    const ctx = ctxFor('proj-a');

    const result = remove_node(ctx, ROOT_NODE_ID, { dependents: 'detach' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('root_guarded');
    expect(ctx.store.listNodes(ctx.scope)).toHaveLength(1);
  });
});

describe('remove_node — missing node', () => {
  it('rejects removing a node that does not exist', () => {
    const ctx = ctxFor('proj-a');

    const result = remove_node(ctx, 'ghost', { dependents: 'detach' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid_delta');
  });
});

describe('remove_node — heal cross-product', () => {
  it('reconnects every dependent to every dependency of the removed node (no orphaned ordering)', () => {
    const ctx = ctxFor('proj-a');
    seed(
      ctx,
      [node('c1'), node('c2'), node('x'), node('d1'), node('d2')],
      [
        { op: 'created', before: null, after: { from: 'c1', to: 'x', kind: 'depends_on' } },
        { op: 'created', before: null, after: { from: 'c2', to: 'x', kind: 'depends_on' } },
        { op: 'created', before: null, after: { from: 'x', to: 'd1', kind: 'depends_on' } },
        { op: 'created', before: null, after: { from: 'x', to: 'd2', kind: 'depends_on' } },
      ],
    );

    const result = remove_node(ctx, 'x', { dependents: 'heal' });

    expect(result.ok).toBe(true);
    expect(ctx.store.getNode(ctx.scope, 'x')).toBeNull();
    const edges = ctx.store.listEdges(ctx.scope);
    expect(new Set(edges.map((e) => `${e.from}->${e.to}`))).toEqual(
      new Set(['c1->d1', 'c1->d2', 'c2->d1', 'c2->d2']),
    );
    expect(edges).toHaveLength(4);
  });

  it('skips a healed edge that already exists rather than duplicating it', () => {
    const ctx = ctxFor('proj-a');
    seed(
      ctx,
      [node('c1'), node('x'), node('d1')],
      [
        { op: 'created', before: null, after: { from: 'c1', to: 'x', kind: 'depends_on' } },
        { op: 'created', before: null, after: { from: 'x', to: 'd1', kind: 'depends_on' } },
        { op: 'created', before: null, after: { from: 'c1', to: 'd1', kind: 'depends_on' } },
      ],
    );

    const result = remove_node(ctx, 'x', { dependents: 'heal' });

    expect(result.ok).toBe(true);
    expect(ctx.store.listEdges(ctx.scope)).toEqual([{ from: 'c1', to: 'd1', kind: 'depends_on' }]);
  });
});

describe('remove_node — cascade (children) default', () => {
  it('removes a container and every descendant, dropping every incident edge', () => {
    const ctx = ctxFor('proj-a');
    seed(
      ctx,
      [node('phase-1'), node('task-a', { parent: 'phase-1' }), node('outsider')],
      [{ op: 'created', before: null, after: { from: 'task-a', to: 'outsider', kind: 'depends_on' } }],
    );

    const result = remove_node(ctx, 'phase-1', { dependents: 'detach' });

    expect(result.ok).toBe(true);
    expect(ctx.store.listNodes(ctx.scope)).toHaveLength(2); // root + outsider
    expect(ctx.store.listEdges(ctx.scope)).toEqual([]);
  });
});

describe('remove_node — promote (children)', () => {
  it('removes only the node, re-parenting its direct children onto its own parent', () => {
    const ctx = ctxFor('proj-a');
    seed(ctx, [node('phase-1'), node('task-a', { parent: 'phase-1' })]);

    const result = remove_node(ctx, 'phase-1', { children: 'promote', dependents: 'detach' });

    expect(result.ok).toBe(true);
    expect(ctx.store.getNode(ctx.scope, 'phase-1')).toBeNull();
    expect(ctx.store.getNode(ctx.scope, 'task-a')?.parent).toBe(ROOT_NODE_ID);
  });
});

describe('remove_node — cascade (dependents)', () => {
  it('transitively removes every node gated on the removed node', () => {
    const ctx = ctxFor('proj-a');
    seed(
      ctx,
      [node('x'), node('y'), node('z')],
      [
        { op: 'created', before: null, after: { from: 'x', to: 'y', kind: 'depends_on' } },
        { op: 'created', before: null, after: { from: 'y', to: 'z', kind: 'depends_on' } },
      ],
    );

    const result = remove_node(ctx, 'x', { dependents: 'cascade' });

    expect(result.ok).toBe(true);
    expect(ctx.store.listNodes(ctx.scope)).toHaveLength(1); // only the seeded root survives
    expect(ctx.store.listEdges(ctx.scope)).toEqual([]);
  });
});

describe('remove_node — detach (dependents)', () => {
  it('drops incident edges without reconnecting or removing anything else', () => {
    const ctx = ctxFor('proj-a');
    seed(
      ctx,
      [node('c1'), node('x'), node('d1')],
      [
        { op: 'created', before: null, after: { from: 'c1', to: 'x', kind: 'depends_on' } },
        { op: 'created', before: null, after: { from: 'x', to: 'd1', kind: 'depends_on' } },
      ],
    );

    const result = remove_node(ctx, 'x', { dependents: 'detach' });

    expect(result.ok).toBe(true);
    expect(ctx.store.getNode(ctx.scope, 'x')).toBeNull();
    expect(ctx.store.getNode(ctx.scope, 'c1')).not.toBeNull();
    expect(ctx.store.getNode(ctx.scope, 'd1')).not.toBeNull();
    expect(ctx.store.listEdges(ctx.scope)).toEqual([]);
  });
});

describe('add_dependency', () => {
  it('commits a legal edge and emits a well-formed delta', () => {
    const ctx = ctxFor('proj-a');
    seed(ctx, [node('a'), node('b')]);

    const result = add_dependency(ctx, 'a', 'b');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual<ChangeDelta>({
      primitive: 'add_dependency',
      params: { from: 'a', to: 'b' },
      nodeChanges: [],
      edgeChanges: [{ op: 'created', before: null, after: { from: 'a', to: 'b', kind: 'depends_on' } }],
    });
    expect(ctx.store.listEdges(ctx.scope)).toEqual([{ from: 'a', to: 'b', kind: 'depends_on' }]);
  });

  it('rejects an edge that would form a cycle and writes nothing', () => {
    const ctx = ctxFor('proj-a');
    seed(ctx, [node('a'), node('b')], [{ op: 'created', before: null, after: { from: 'a', to: 'b', kind: 'depends_on' } }]);

    const result = add_dependency(ctx, 'b', 'a');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('cycle');
    expect(ctx.store.listEdges(ctx.scope)).toEqual([{ from: 'a', to: 'b', kind: 'depends_on' }]);
  });

  it('rejects a reference to a node that does not exist', () => {
    const ctx = ctxFor('proj-a');
    seed(ctx, [node('a')]);

    const result = add_dependency(ctx, 'a', 'ghost');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid_delta');
    expect(ctx.store.listEdges(ctx.scope)).toEqual([]);
  });
});

describe('remove_dependency', () => {
  it('removes an existing edge and emits a well-formed delta', () => {
    const ctx = ctxFor('proj-a');
    seed(ctx, [node('a'), node('b')], [{ op: 'created', before: null, after: { from: 'a', to: 'b', kind: 'depends_on' } }]);

    const result = remove_dependency(ctx, 'a', 'b');

    expect(result.ok).toBe(true);
    expect(ctx.store.listEdges(ctx.scope)).toEqual([]);
  });

  it('rejects removing an edge that does not exist and writes nothing', () => {
    const ctx = ctxFor('proj-a');
    seed(ctx, [node('a'), node('b')]);

    const result = remove_dependency(ctx, 'a', 'b');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid_delta');
  });
});

describe('move_node', () => {
  it('re-parents a node and emits a well-formed delta', () => {
    const ctx = ctxFor('proj-a');
    seed(ctx, [node('a'), node('b')]);

    const result = move_node(ctx, 'a', 'b');

    expect(result.ok).toBe(true);
    expect(ctx.store.getNode(ctx.scope, 'a')?.parent).toBe('b');
  });

  it('refuses to move the root and writes nothing', () => {
    const ctx = ctxFor('proj-a');
    seed(ctx, [node('a')]);

    const result = move_node(ctx, ROOT_NODE_ID, 'a');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('root_guarded');
  });

  it('rejects a move that would create a containment cycle and writes nothing', () => {
    const ctx = ctxFor('proj-a');
    seed(ctx, [node('parent'), node('child', { parent: 'parent' })]);

    const result = move_node(ctx, 'parent', 'child');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('cycle');
    expect(ctx.store.getNode(ctx.scope, 'parent')?.parent).toBe(ROOT_NODE_ID);
  });

  it('rejects a reference to a node that does not exist', () => {
    const ctx = ctxFor('proj-a');
    seed(ctx, [node('a')]);

    const result = move_node(ctx, 'a', 'ghost');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid_delta');
  });
});

describe('set_order', () => {
  it('reorders a node among its siblings', () => {
    const ctx = ctxFor('proj-a');
    seed(ctx, [node('a', { order: 0 })]);

    const result = set_order(ctx, 'a', 5);

    expect(result.ok).toBe(true);
    expect(ctx.store.getNode(ctx.scope, 'a')?.order).toBe(5);
  });

  it('rejects a reference to a node that does not exist', () => {
    const ctx = ctxFor('proj-a');

    const result = set_order(ctx, 'ghost', 1);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid_delta');
  });
});

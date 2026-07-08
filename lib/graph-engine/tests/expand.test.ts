import { describe, expect, it } from 'vitest';
import {
  expand,
  add_dependency,
  remove_dependency,
  createNodeTypeRegistry,
  InMemoryStateStore,
  ROOT_NODE_ID,
} from '../src/index.js';
import type {
  ChangeDelta,
  DagNode,
  Expansion,
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

describe('expand', () => {
  it('resolves a phase container + two dependent tasks gated behind a pre-existing approval node, in one delta', () => {
    const ctx = ctxFor('proj-a');
    seed(ctx, [node('phase-container'), node('approval', { status: 'done' })]);

    const expansion: Expansion = {
      specs: [
        { key: 'phase', type: 'rad-orc:phase', parent: 'phase-container', dependsOn: ['approval'] },
        { key: 'task-1', type: 'rad-orc:task', parent: 'phase', dependsOn: [] },
        { key: 'task-2', type: 'rad-orc:task', parent: 'phase', dependsOn: ['task-1'] },
      ],
    };

    const result = expand(ctx, registry, 'phase-container', expansion);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.primitive).toBe('expand');
    expect(result.data.nodeChanges).toHaveLength(3);
    expect(result.data.edgeChanges).toEqual([
      { op: 'created', before: null, after: { from: 'approval', to: 'phase', kind: 'depends_on' } },
      { op: 'created', before: null, after: { from: 'task-1', to: 'task-2', kind: 'depends_on' } },
    ]);
    expect(ctx.store.getNode(ctx.scope, 'phase')?.parent).toBe('phase-container');
    expect(ctx.store.getNode(ctx.scope, 'task-1')?.parent).toBe('phase');
    expect(ctx.store.getNode(ctx.scope, 'task-2')?.parent).toBe('phase');
    expect(ctx.store.listEdges(ctx.scope)).toHaveLength(2);
  });

  it('resolves specs by true topological order, not by their declaration order in the batch', () => {
    const ctx = ctxFor('proj-a');
    seed(ctx, [node('container')]);

    const expansion: Expansion = {
      specs: [
        { key: 'child', type: 'rad-orc:task', parent: 'phase', dependsOn: [] }, // declared before its own parent spec
        { key: 'phase', type: 'rad-orc:phase', parent: 'container', dependsOn: [] },
      ],
    };

    const result = expand(ctx, registry, 'container', expansion);

    expect(result.ok).toBe(true);
    expect(ctx.store.getNode(ctx.scope, 'child')?.parent).toBe('phase');
    expect(ctx.store.getNode(ctx.scope, 'phase')?.parent).toBe('container');
  });

  it('stamps derivedFrom to the expanding node on every new node', () => {
    const ctx = ctxFor('proj-a');
    seed(ctx, [node('container')]);
    const expansion: Expansion = {
      specs: [{ key: 'child', type: 'rad-orc:task', parent: 'container', dependsOn: [] }],
    };

    const result = expand(ctx, registry, 'container', expansion);

    expect(result.ok).toBe(true);
    expect(ctx.store.getNode(ctx.scope, 'child')?.derivedFrom).toBe('container');
  });

  it('rejects (and writes nothing for) a spec type the registry does not resolve', () => {
    const ctx = ctxFor('proj-a');
    seed(ctx, [node('container')]);
    const expansion: Expansion = {
      specs: [{ key: 'child', type: 'acme-qa:security-scan', parent: 'container', dependsOn: [] }],
    };

    const result = expand(ctx, registry, 'container', expansion);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('unknown_node_type');
    expect(ctx.store.listNodes(ctx.scope)).toHaveLength(2); // root + container only
  });

  it('rejects (and writes nothing for) an expanding node that does not exist', () => {
    const ctx = ctxFor('proj-a');
    const expansion: Expansion = { specs: [{ key: 'a', type: 'rad-orc:task', parent: null, dependsOn: [] }] };

    const result = expand(ctx, registry, 'ghost', expansion);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid_delta');
    expect(ctx.store.listNodes(ctx.scope)).toHaveLength(1); // only the seeded root
  });

  it('rejects (and writes nothing for) a spec whose parent key is missing', () => {
    const ctx = ctxFor('proj-a');
    seed(ctx, [node('container')]);
    const expansion: Expansion = {
      specs: [{ key: 'child', type: 'rad-orc:task', parent: 'no-such-key', dependsOn: [] }],
    };

    const result = expand(ctx, registry, 'container', expansion);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid_delta');
    expect(ctx.store.listNodes(ctx.scope)).toHaveLength(2); // root + container only
  });

  it('rejects (and writes nothing for) a dependsOn entry that resolves to neither a batch key nor an existing node', () => {
    const ctx = ctxFor('proj-a');
    seed(ctx, [node('container')]);
    const expansion: Expansion = {
      specs: [{ key: 'child', type: 'rad-orc:task', parent: 'container', dependsOn: ['ghost'] }],
    };

    const result = expand(ctx, registry, 'container', expansion);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid_delta');
    expect(ctx.store.listNodes(ctx.scope)).toHaveLength(2);
  });

  it('rejects (and writes nothing for) a containment cycle among batch keys', () => {
    const ctx = ctxFor('proj-a');
    seed(ctx, [node('container')]);
    const expansion: Expansion = {
      specs: [
        { key: 'a', type: 'rad-orc:task', parent: 'b', dependsOn: [] },
        { key: 'b', type: 'rad-orc:task', parent: 'a', dependsOn: [] },
      ],
    };

    const result = expand(ctx, registry, 'container', expansion);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('cycle');
    expect(ctx.store.listNodes(ctx.scope)).toHaveLength(2);
  });

  it('rejects (and writes nothing for) a duplicate batch key', () => {
    const ctx = ctxFor('proj-a');
    seed(ctx, [node('container')]);
    const expansion: Expansion = {
      specs: [
        { key: 'dup', type: 'rad-orc:task', parent: 'container', dependsOn: [] },
        { key: 'dup', type: 'rad-orc:task', parent: 'container', dependsOn: [] },
      ],
    };

    const result = expand(ctx, registry, 'container', expansion);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid_delta');
    expect(ctx.store.listNodes(ctx.scope)).toHaveLength(2);
  });

  it('rejects (and writes nothing for) a batch key that collides with an existing node id', () => {
    const ctx = ctxFor('proj-a');
    seed(ctx, [node('container'), node('existing')]);
    const expansion: Expansion = {
      specs: [{ key: 'existing', type: 'rad-orc:task', parent: 'container', dependsOn: [] }],
    };

    const result = expand(ctx, registry, 'container', expansion);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid_delta');
  });

  it('composes with a sibling remove_dependency/add_dependency re-point onto the newly expanded subgraph', () => {
    const ctx = ctxFor('proj-a');
    seed(
      ctx,
      [node('container'), node('placeholder'), node('final_review')],
      [{ op: 'created', before: null, after: { from: 'placeholder', to: 'final_review', kind: 'depends_on' } }],
    );

    const expansion: Expansion = {
      specs: [{ key: 'task-1', type: 'rad-orc:task', parent: 'container', dependsOn: [] }],
    };
    const expandResult = expand(ctx, registry, 'container', expansion);
    expect(expandResult.ok).toBe(true);

    const removed = remove_dependency(ctx, 'placeholder', 'final_review');
    expect(removed.ok).toBe(true);
    const added = add_dependency(ctx, 'task-1', 'final_review');
    expect(added.ok).toBe(true);

    expect(ctx.store.listEdges(ctx.scope)).toEqual([{ from: 'task-1', to: 'final_review', kind: 'depends_on' }]);
    expect(ctx.store.getNode(ctx.scope, 'task-1')).not.toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { createNodeTypeRegistry, engage, InMemoryStateStore, isQuiescent, readFrontier, ROOT_NODE_ID } from '../src/index.js';
import type {
  ActContext,
  ActResult,
  DagNode,
  NodeEvent,
  NodeTypeDefinition,
  PrimitiveContext,
  ProjectScope,
} from '../src/index.js';

function scope(projectId: string): ProjectScope {
  return { projectId };
}

function ctxFor(projectId: string): PrimitiveContext {
  return { store: new InMemoryStateStore(), scope: scope(projectId) };
}

/** A minimal in-test node type whose `act` always resolves to a no-op executor. */
function makeFakeNodeType(): NodeTypeDefinition {
  return {
    name: 'test:fake',
    dataSchema: {},
    traits: [],
    capabilities: [],
    presentation: { label: 'Fake' },
    act(_ctx: ActContext): ActResult {
      return { executor: 'noop' };
    },
    handle(_ev: NodeEvent) {
      return {};
    },
    projectStatus: () => 'not_started',
  };
}

function node(id: string, overrides: Partial<DagNode> = {}): DagNode {
  return {
    id,
    type: 'test:fake',
    status: 'not_started',
    parent: ROOT_NODE_ID,
    order: 0,
    derivedFrom: null,
    data: {},
    ...overrides,
  };
}

function seed(ctx: PrimitiveContext, nodes: DagNode[]): void {
  const result = ctx.store.apply(ctx.scope, {
    primitive: 'add_node',
    params: {},
    nodeChanges: nodes.map((after) => ({ op: 'created' as const, before: null, after })),
    edgeChanges: [],
  });
  if (!result.ok) throw new Error(`seed failed: ${result.error.message}`);
}

describe('engage', () => {
  it('writes the not_started -> in_progress transition and returns the act result', () => {
    const ctx = ctxFor('proj-a');
    seed(ctx, [node('task-a')]);
    const registry = createNodeTypeRegistry([makeFakeNodeType()]);

    const result = engage(ctx, registry, 'task-a');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual({ executor: 'noop' });
    expect(ctx.store.getNode(ctx.scope, 'task-a')?.status).toBe('in_progress');
  });

  it('rejects a node that does not exist', () => {
    const ctx = ctxFor('proj-a');
    const registry = createNodeTypeRegistry([makeFakeNodeType()]);

    const result = engage(ctx, registry, 'ghost');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid_delta');
  });

  it('rejects a node not currently in the frontier (an undone predecessor gates it)', () => {
    const ctx = ctxFor('proj-a');
    seed(ctx, [node('blocker', { status: 'not_started' }), node('task-a')]);
    ctx.store.apply(ctx.scope, {
      primitive: 'add_dependency',
      params: {},
      nodeChanges: [],
      edgeChanges: [{ op: 'created', before: null, after: { from: 'blocker', to: 'task-a', kind: 'depends_on' } }],
    });
    const registry = createNodeTypeRegistry([makeFakeNodeType()]);

    const result = engage(ctx, registry, 'task-a');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('not_in_frontier');
    expect(ctx.store.getNode(ctx.scope, 'task-a')?.status).toBe('not_started');
  });

  it('rejects a disabled node even though it would otherwise be frontier-eligible', () => {
    const ctx = ctxFor('proj-a');
    seed(ctx, [node('task-a', { disabled: true })]);
    const registry = createNodeTypeRegistry([makeFakeNodeType()]);

    const result = engage(ctx, registry, 'task-a');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('not_in_frontier');
  });

  it('rejects a node whose type is not registered', () => {
    const ctx = ctxFor('proj-a');
    seed(ctx, [node('task-a', { type: 'test:unregistered' })]);
    const registry = createNodeTypeRegistry([]);

    const result = engage(ctx, registry, 'task-a');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('unknown_node_type');
  });

  it('never writes in-progress for a rejected engage', () => {
    const ctx = ctxFor('proj-a');
    seed(ctx, [node('task-a', { status: 'done' })]);
    const registry = createNodeTypeRegistry([makeFakeNodeType()]);

    engage(ctx, registry, 'task-a');

    expect(ctx.store.getNode(ctx.scope, 'task-a')?.status).toBe('done');
  });
});

describe('readFrontier / isQuiescent', () => {
  it('reads the frontier straight off the store, scoped to a container', () => {
    const ctx = ctxFor('proj-a');
    seed(ctx, [node('task-a'), node('task-b', { status: 'done' })]);

    expect(readFrontier(ctx, ROOT_NODE_ID).map((n) => n.id)).toEqual(['task-a']);
  });

  it('is quiescent on an empty frontier', () => {
    const ctx = ctxFor('proj-a');
    seed(ctx, [node('task-a', { status: 'done' })]);

    expect(isQuiescent(ctx, ROOT_NODE_ID)).toBe(true);
  });

  it('is not quiescent while a node is still frontier-eligible', () => {
    const ctx = ctxFor('proj-a');
    seed(ctx, [node('task-a')]);

    expect(isQuiescent(ctx, ROOT_NODE_ID)).toBe(false);
  });

  it('becomes quiescent again once the sole frontier node has been engaged', () => {
    const ctx = ctxFor('proj-a');
    seed(ctx, [node('task-a')]);
    const registry = createNodeTypeRegistry([makeFakeNodeType()]);

    expect(isQuiescent(ctx, ROOT_NODE_ID)).toBe(false);
    engage(ctx, registry, 'task-a');
    expect(isQuiescent(ctx, ROOT_NODE_ID)).toBe(true);
  });
});

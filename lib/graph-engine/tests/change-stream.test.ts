import { describe, expect, it } from 'vitest';
import { createNodeTypeRegistry, engage, InMemoryStateStore, ROOT_NODE_ID, withChangeStream } from '../src/index.js';
import type { ActContext, ActResult, ChangeDelta, DagNode, NodeEvent, NodeTypeDefinition, PrimitiveContext } from '../src/index.js';

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

function makeFakeNodeType(): NodeTypeDefinition {
  return {
    name: 'test:fake',
    dataSchema: {},
    traits: [],
    capabilities: [],
    presentation: { label: 'Fake' },
    instructions: '',
    act(ctx: ActContext): ActResult {
      return { instructions: `run ${ctx.nodeId}`, executor: 'noop' };
    },
    handle(_ev: NodeEvent) {
      return {};
    },
    projectStatus: () => 'not_started',
  };
}

describe('withChangeStream', () => {
  it('emits one ChangeDelta per committed primitive, in commit order', () => {
    const { store, changeStream } = withChangeStream(new InMemoryStateStore());
    const ctx: PrimitiveContext = { store, scope: { projectId: 'proj-a' } };
    const registry = createNodeTypeRegistry([makeFakeNodeType()]);
    const seen: ChangeDelta[] = [];
    changeStream.subscribe((delta) => seen.push(delta));

    const first = ctx.store.apply(ctx.scope, {
      primitive: 'add_node',
      params: { id: 'task-a' },
      nodeChanges: [{ op: 'created', before: null, after: node('task-a') }],
      edgeChanges: [],
    });
    expect(first.ok).toBe(true);

    const second = engage(ctx, registry, 'task-a');
    expect(second.ok).toBe(true);

    expect(seen).toHaveLength(2);
    expect(seen[0]?.primitive).toBe('add_node');
    expect(seen[1]?.primitive).toBe('engage');
    expect(seen[1]?.nodeChanges[0]?.after?.status).toBe('in_progress');
  });

  it('stamps no seq/time/actor onto an emitted delta', () => {
    const { store, changeStream } = withChangeStream(new InMemoryStateStore());
    const ctx: PrimitiveContext = { store, scope: { projectId: 'proj-a' } };
    const seen: ChangeDelta[] = [];
    changeStream.subscribe((delta) => seen.push(delta));

    ctx.store.apply(ctx.scope, {
      primitive: 'add_node',
      params: {},
      nodeChanges: [{ op: 'created', before: null, after: node('task-a') }],
      edgeChanges: [],
    });

    expect(Object.keys(seen[0] ?? {}).sort()).toEqual(['edgeChanges', 'nodeChanges', 'params', 'primitive']);
  });

  it('emits nothing for a delta the store rejects', () => {
    const { store, changeStream } = withChangeStream(new InMemoryStateStore());
    const ctx: PrimitiveContext = { store, scope: { projectId: 'proj-a' } };
    const seen: ChangeDelta[] = [];
    changeStream.subscribe((delta) => seen.push(delta));

    const result = ctx.store.apply(ctx.scope, {
      primitive: 'remove_node',
      params: {},
      nodeChanges: [{ op: 'removed', before: node('ghost'), after: null }],
      edgeChanges: [],
    });

    expect(result.ok).toBe(false);
    expect(seen).toHaveLength(0);
  });

  it('stops delivering to a listener once it unsubscribes', () => {
    const { store, changeStream } = withChangeStream(new InMemoryStateStore());
    const ctx: PrimitiveContext = { store, scope: { projectId: 'proj-a' } };
    const seen: ChangeDelta[] = [];
    const unsubscribe = changeStream.subscribe((delta) => seen.push(delta));
    unsubscribe();

    ctx.store.apply(ctx.scope, {
      primitive: 'add_node',
      params: {},
      nodeChanges: [{ op: 'created', before: null, after: node('task-a') }],
      edgeChanges: [],
    });

    expect(seen).toHaveLength(0);
  });

  it('leaves the underlying store observable independent of the change stream', () => {
    const { store, changeStream } = withChangeStream(new InMemoryStateStore());
    const ctx: PrimitiveContext = { store, scope: { projectId: 'proj-a' } };
    void changeStream;

    ctx.store.apply(ctx.scope, {
      primitive: 'add_node',
      params: {},
      nodeChanges: [{ op: 'created', before: null, after: node('task-a') }],
      edgeChanges: [],
    });

    expect(ctx.store.getNode(ctx.scope, 'task-a')?.id).toBe('task-a');
    expect(ctx.store.listNodes(ctx.scope).map((n) => n.id)).toContain('task-a');
  });
});

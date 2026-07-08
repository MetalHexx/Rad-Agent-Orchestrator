import { describe, expect, it } from 'vitest';
import { toggle, resume, InMemoryStateStore, ROOT_NODE_ID } from '../src/index.js';
import type { DagNode, PrimitiveContext, ProjectScope } from '../src/index.js';

function scope(projectId: string): ProjectScope {
  return { projectId };
}

function ctxFor(projectId: string): PrimitiveContext {
  return { store: new InMemoryStateStore(), scope: scope(projectId) };
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

function seed(ctx: PrimitiveContext, nodes: DagNode[]): void {
  const result = ctx.store.apply(ctx.scope, {
    primitive: 'add_node',
    params: {},
    nodeChanges: nodes.map((after) => ({ op: 'created' as const, before: null, after })),
    edgeChanges: [],
  });
  if (!result.ok) throw new Error(`seed failed: ${result.error.message}`);
}

describe('toggle', () => {
  it('disables an enabled node', () => {
    const ctx = ctxFor('proj-a');
    seed(ctx, [node('a')]);

    const result = toggle(ctx, 'a');

    expect(result.ok).toBe(true);
    expect(ctx.store.getNode(ctx.scope, 'a')?.disabled).toBe(true);
  });

  it('re-enables a disabled node', () => {
    const ctx = ctxFor('proj-a');
    seed(ctx, [node('a', { disabled: true })]);

    const result = toggle(ctx, 'a');

    expect(result.ok).toBe(true);
    expect(ctx.store.getNode(ctx.scope, 'a')?.disabled).toBe(false);
  });

  it('rejects a reference to a node that does not exist and writes nothing', () => {
    const ctx = ctxFor('proj-a');

    const result = toggle(ctx, 'ghost');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid_delta');
  });
});

describe('resume', () => {
  it('returns a halted (failed) node to not_started', () => {
    const ctx = ctxFor('proj-a');
    seed(ctx, [node('a', { status: 'failed' })]);

    const result = resume(ctx, 'a');

    expect(result.ok).toBe(true);
    expect(ctx.store.getNode(ctx.scope, 'a')?.status).toBe('not_started');
  });

  it('returns a halted (blocked) node to not_started', () => {
    const ctx = ctxFor('proj-a');
    seed(ctx, [node('a', { status: 'blocked' })]);

    const result = resume(ctx, 'a');

    expect(result.ok).toBe(true);
    expect(ctx.store.getNode(ctx.scope, 'a')?.status).toBe('not_started');
  });

  it('rejects a reference to a node that does not exist and writes nothing', () => {
    const ctx = ctxFor('proj-a');

    const result = resume(ctx, 'ghost');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid_delta');
  });
});

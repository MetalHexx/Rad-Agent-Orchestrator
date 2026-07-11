import type { PrimitiveContext, ProjectScope } from '@rad-orchestration/graph-engine';
import { InMemoryStateStore, ROOT_NODE_ID, add_node, createNodeTypeRegistry } from '@rad-orchestration/graph-engine';
import { BUILT_IN_NODE_TYPES } from '@rad-orchestration/graph-node-types';
import { describe, expect, it } from 'vitest';
import { globalFrontier, isGloballyQuiescent } from '../../src/driver/frontier.js';

function scope(projectId: string): ProjectScope {
  return { projectId };
}

function ctxFor(projectId: string): PrimitiveContext {
  return { store: new InMemoryStateStore(), scope: scope(projectId) };
}

describe('globalFrontier', () => {
  it('unions readiness across every container in the graph, not just the root scope', () => {
    const ctx = ctxFor('proj-frontier');
    const registry = createNodeTypeRegistry(BUILT_IN_NODE_TYPES);

    add_node(ctx, registry, 'phase-1', 'rad-orc:phase', ROOT_NODE_ID, { data: { docPath: 'p.md', exitCriteria: ['done'] } });
    add_node(ctx, registry, 'task-a', 'rad-orc:task', 'phase-1', {
      data: { handoffDocPath: '/tasks/a.md', repos: [], complexity: 'simple', shouldCommit: true },
    });
    add_node(ctx, registry, 'plan-approval', 'rad-orc:approval', ROOT_NODE_ID, { data: { level: 'plan' } });

    // A single-scope `readFrontier(ctx, ROOT_NODE_ID)` would surface `plan-approval` but never
    // `task-a` — it lives under `phase-1`'s own scope, a distinct container. `globalFrontier`
    // must surface both from one root-rooted call.
    const frontier = globalFrontier(ctx, ROOT_NODE_ID);
    const ids = frontier.map((node) => node.id).sort();
    expect(ids).toEqual(['plan-approval', 'task-a']);
  });

  it('never lists the same node twice when it would be reachable through more than one container read', () => {
    const ctx = ctxFor('proj-frontier-dedup');
    const registry = createNodeTypeRegistry(BUILT_IN_NODE_TYPES);
    add_node(ctx, registry, 'plan-approval', 'rad-orc:approval', ROOT_NODE_ID, { data: { level: 'plan' } });

    const frontier = globalFrontier(ctx, ROOT_NODE_ID);
    expect(frontier).toHaveLength(1);
  });
});

describe('isGloballyQuiescent', () => {
  it('is false while any container still has eligible work and true once none remains', () => {
    const ctx = ctxFor('proj-quiescent');
    const registry = createNodeTypeRegistry(BUILT_IN_NODE_TYPES);
    expect(isGloballyQuiescent(ctx, ROOT_NODE_ID)).toBe(true); // nothing seeded yet

    add_node(ctx, registry, 'plan-approval', 'rad-orc:approval', ROOT_NODE_ID, { data: { level: 'plan' } });
    expect(isGloballyQuiescent(ctx, ROOT_NODE_ID)).toBe(false);
  });
});

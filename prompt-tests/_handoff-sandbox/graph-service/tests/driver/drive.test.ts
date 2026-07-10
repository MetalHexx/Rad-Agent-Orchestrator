import type { PrimitiveContext, ProjectScope } from '@rad-orchestration/graph-engine';
import { InMemoryStateStore, ROOT_NODE_ID, add_node, createNodeTypeRegistry } from '@rad-orchestration/graph-engine';
import { BUILT_IN_NODE_TYPES } from '@rad-orchestration/graph-node-types';
import { describe, expect, it } from 'vitest';
import { createFakedCapabilityPorts } from '../../src/capabilities/fakes.js';
import { advance, runToQuiescence } from '../../src/driver/drive.js';
import type { DriverScript } from '../../src/driver/resolvers.js';
import { createBuiltInResolvers } from '../../src/driver/resolvers.js';

function scope(projectId: string): ProjectScope {
  return { projectId };
}

function ctxFor(projectId: string): PrimitiveContext {
  return { store: new InMemoryStateStore(), scope: scope(projectId) };
}

const REPOS = [{ name: 'rad-orc-source', path: '/repos/rad-orc-source', branch: 'radorch/STEERABLE-DAG-2.3' }];

function taskData(handoffDocPath: string) {
  return { handoffDocPath, repos: REPOS, complexity: 'simple' as const, shouldCommit: true };
}

describe('advance — per executor kind', () => {
  it("drives a spawn-sub-agent node (rad-orc:task) not_started -> done, dispatching through the spawn-agent port", async () => {
    const ctx = ctxFor('proj-advance-task');
    const registry = createNodeTypeRegistry(BUILT_IN_NODE_TYPES);
    add_node(ctx, registry, 'task-1', 'rad-orc:task', ROOT_NODE_ID, { data: taskData('/tasks/task-1.md') });

    const ports = createFakedCapabilityPorts();
    const resolvers = createBuiltInResolvers(ports);
    const node = ctx.store.getNode(ctx.scope, 'task-1');
    if (!node) throw new Error('missing seeded node');

    const result = await advance(ctx, registry, resolvers, node);

    expect(result).toEqual({ ok: true, data: { nodeId: 'task-1', type: 'rad-orc:task' } });
    expect(ctx.store.getNode(ctx.scope, 'task-1')?.status).toBe('done');
    expect(ports.spawnAgent.spawned).toHaveLength(1);
  });

  it('drives a noop-executor node (rad-orc:explosion) to done with no spawn/run-command side effects', async () => {
    const ctx = ctxFor('proj-advance-explosion');
    const registry = createNodeTypeRegistry(BUILT_IN_NODE_TYPES);
    add_node(ctx, registry, 'master-plan', 'rad-orc:master_plan', ROOT_NODE_ID);
    add_node(ctx, registry, 'plan-approval', 'rad-orc:approval', ROOT_NODE_ID, { data: { level: 'plan' } });
    add_node(ctx, registry, 'explosion', 'rad-orc:explosion', ROOT_NODE_ID, {
      data: { cadence: { perTask: [], perPhase: [], spine: [] } },
      dependsOn: ['master-plan'],
    });

    const ports = createFakedCapabilityPorts();
    const resolvers = createBuiltInResolvers(ports);

    const masterPlanNode = ctx.store.getNode(ctx.scope, 'master-plan');
    if (!masterPlanNode) throw new Error('missing seeded node');
    expect((await advance(ctx, registry, resolvers, masterPlanNode)).ok).toBe(true);
    expect(ctx.store.getNode(ctx.scope, 'master-plan')?.status).toBe('done');

    const explosionNode = ctx.store.getNode(ctx.scope, 'explosion');
    if (!explosionNode) throw new Error('missing seeded node');
    const result = await advance(ctx, registry, resolvers, explosionNode);

    expect(result.ok).toBe(true);
    expect(ctx.store.getNode(ctx.scope, 'explosion')?.status).toBe('done');
    expect(ports.spawnAgent.spawned).toHaveLength(0);
    expect(ports.runCommand.ran).toHaveLength(0);
    // explosion's own handle-issued expansion actually landed (one phase per parsed phase).
    expect(ctx.store.getNode(ctx.scope, 'phase-1')?.type).toBe('rad-orc:phase');
  });
});

describe('advance — async-port/sync-engine ordering', () => {
  it('engages synchronously (in_progress lands) before ever awaiting a capability port call, and only commits the outcome once that await settles', async () => {
    const ctx = ctxFor('proj-advance-ordering');
    const registry = createNodeTypeRegistry(BUILT_IN_NODE_TYPES);
    add_node(ctx, registry, 'task-1', 'rad-orc:task', ROOT_NODE_ID, { data: taskData('/tasks/task-1.md') });

    const ports = createFakedCapabilityPorts();
    const resolvers = createBuiltInResolvers(ports);
    const node = ctx.store.getNode(ctx.scope, 'task-1');
    if (!node) throw new Error('missing seeded node');

    const pending = advance(ctx, registry, resolvers, node);

    // The synchronous portion of `advance` — `engage`'s `not_started -> in_progress` write — has
    // already landed even though nothing has been awaited yet; the outcome (the coder's reported
    // results, and the resulting `done` re-projection) only commits once the returned promise
    // itself is awaited below.
    expect(ctx.store.getNode(ctx.scope, 'task-1')?.status).toBe('in_progress');
    expect(ctx.store.getNode(ctx.scope, 'task-1')?.data.results).toBeUndefined();

    const result = await pending;

    expect(result.ok).toBe(true);
    expect(ctx.store.getNode(ctx.scope, 'task-1')?.status).toBe('done');
    expect(ports.spawnAgent.spawned).toHaveLength(1);
  });
});

describe('advance — rejected engage', () => {
  it('returns a structured Result failure rather than throwing when the node has fallen out of the frontier', async () => {
    const ctx = ctxFor('proj-advance-rejected');
    const registry = createNodeTypeRegistry(BUILT_IN_NODE_TYPES);
    add_node(ctx, registry, 'task-1', 'rad-orc:task', ROOT_NODE_ID, { data: taskData('/tasks/task-1.md') });

    const ports = createFakedCapabilityPorts();
    const resolvers = createBuiltInResolvers(ports);
    const node = ctx.store.getNode(ctx.scope, 'task-1');
    if (!node) throw new Error('missing seeded node');

    await advance(ctx, registry, resolvers, node); // now done — no longer frontier-eligible
    const doneNode = ctx.store.getNode(ctx.scope, 'task-1');
    if (!doneNode) throw new Error('missing seeded node');

    const result = await advance(ctx, registry, resolvers, doneNode);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('not_in_frontier');
  });
});

describe('runToQuiescence', () => {
  it('settles a linear task -> code_review -> pr chain, re-reading the whole-tree frontier every step', async () => {
    const ctx = ctxFor('proj-quiescence-chain');
    const registry = createNodeTypeRegistry(BUILT_IN_NODE_TYPES);
    add_node(ctx, registry, 'task-1', 'rad-orc:task', ROOT_NODE_ID, { data: taskData('/tasks/task-1.md') });
    add_node(ctx, registry, 'review', 'rad-orc:code_review', ROOT_NODE_ID, { data: { level: 'task' }, dependsOn: ['task-1'] });
    add_node(ctx, registry, 'pr-1', 'rad-orc:pr', ROOT_NODE_ID, { data: { repos: REPOS }, dependsOn: ['review'] });

    const ports = createFakedCapabilityPorts();
    const result = await runToQuiescence(ctx, registry, ROOT_NODE_ID, createBuiltInResolvers(ports));

    expect(result).toEqual({ settled: true, steps: 3 });
    expect(ctx.store.getNode(ctx.scope, 'task-1')?.status).toBe('done');
    expect(ctx.store.getNode(ctx.scope, 'review')?.status).toBe('done');
    expect(ctx.store.getNode(ctx.scope, 'pr-1')?.status).toBe('done');
  });

  it('returns the structured non-settle result once maxSteps is hit, rather than looping forever or throwing', async () => {
    const ctx = ctxFor('proj-quiescence-maxsteps');
    const registry = createNodeTypeRegistry(BUILT_IN_NODE_TYPES);
    add_node(ctx, registry, 'task-1', 'rad-orc:task', ROOT_NODE_ID, { data: taskData('/tasks/task-1.md') });
    add_node(ctx, registry, 'review', 'rad-orc:code_review', ROOT_NODE_ID, { data: { level: 'task' }, dependsOn: ['task-1'] });
    add_node(ctx, registry, 'pr-1', 'rad-orc:pr', ROOT_NODE_ID, { data: { repos: REPOS }, dependsOn: ['review'] });

    const ports = createFakedCapabilityPorts();
    const result = await runToQuiescence(ctx, registry, ROOT_NODE_ID, createBuiltInResolvers(ports), 1);

    expect(result.settled).toBe(false);
    if (!result.settled) {
      expect(result.steps).toBe(1);
      expect(result.remaining).toEqual(['review']);
    }
    expect(ctx.store.getNode(ctx.scope, 'task-1')?.status).toBe('done');
    expect(ctx.store.getNode(ctx.scope, 'review')?.status).toBe('not_started');
    expect(ctx.store.getNode(ctx.scope, 'pr-1')?.status).toBe('not_started');
  });

  it('the override seam: a scripted non-success verdict for one review routes an add_corrective for it, converging once the script turns approved', async () => {
    const ctx = ctxFor('proj-quiescence-corrective');
    const registry = createNodeTypeRegistry(BUILT_IN_NODE_TYPES);
    add_node(ctx, registry, 'task-1', 'rad-orc:task', ROOT_NODE_ID, { data: taskData('/tasks/task-1.md') });
    add_node(ctx, registry, 'review', 'rad-orc:code_review', ROOT_NODE_ID, { data: { level: 'task' }, dependsOn: ['task-1'] });

    const script: DriverScript = {
      reviewVerdicts: {
        review: [
          { verdict: 'changes_requested', severity: 'medium' },
          { verdict: 'approved', severity: 'none' },
        ],
      },
    };
    const ports = createFakedCapabilityPorts();
    const result = await runToQuiescence(ctx, registry, ROOT_NODE_ID, createBuiltInResolvers(ports, script));

    expect(result.settled).toBe(true);
    expect(ctx.store.getNode(ctx.scope, 'review')?.status).toBe('done');
    expect(ctx.store.getNode(ctx.scope, 'review')?.data.verdict).toBe('approved');

    const corrective = ctx.store.getNode(ctx.scope, 'review-corrective-1');
    expect(corrective?.type).toBe('rad-orc:corrective');
    expect(corrective?.derivedFrom).toBe('task-1');
    expect(corrective?.status).toBe('done');
  });
});

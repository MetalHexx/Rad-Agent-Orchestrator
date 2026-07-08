// Recovery, multi-repo PR, and plan adoption — three more angles the P05-T02 integration proof
// covers: a `rejected` verdict halts recoverably rather than erroring, a multi-repo `rad-orc:pr`
// reports the frozen per-repo shape, and `expand` appends new work onto an already-settled graph.
import type { PrimitiveContext, ProjectScope } from '@rad-orchestration/graph-engine';
import {
  InMemoryStateStore,
  ROOT_NODE_ID,
  add_node,
  createNodeTypeRegistry,
  expand,
  resume,
} from '@rad-orchestration/graph-engine';
import { describe, expect, it } from 'vitest';
import { BUILT_IN_NODE_TYPES } from '../../src/index.js';
import type { DriverScript } from '../harness/test-driver.js';
import { createBuiltInResolvers, createFakedCapabilityPorts, isGloballyQuiescent, runToQuiescence } from '../harness/test-driver.js';

function scope(projectId: string): ProjectScope {
  return { projectId };
}

function ctxFor(projectId: string): PrimitiveContext {
  return { store: new InMemoryStateStore(), scope: scope(projectId) };
}

const REPOS = [{ name: 'rad-orc-source', path: '/repos/rad-orc-source', branch: 'radorch/STEERABLE-DAG-1' }];

function taskData(handoffDocPath: string) {
  return { handoffDocPath, repos: REPOS, complexity: 'standard' as const, shouldCommit: true };
}

describe('recovery — rejected -> halt -> resume', () => {
  it('a rejected verdict halts the review (blocked, quiescent); resume re-arms it to run again and converge', async () => {
    const ctx = ctxFor('proj-recovery');
    const registry = createNodeTypeRegistry(BUILT_IN_NODE_TYPES);

    add_node(ctx, registry, 'task-a', 'rad-orc:task', ROOT_NODE_ID, { data: taskData('/tasks/task-a.md') });
    add_node(ctx, registry, 'review', 'rad-orc:code_review', ROOT_NODE_ID, { data: { level: 'task' }, dependsOn: ['task-a'] });

    const script: DriverScript = {
      reviewVerdicts: {
        review: [
          { verdict: 'rejected', severity: 'high' },
          { verdict: 'approved', severity: 'none' },
        ],
      },
    };
    const ports = createFakedCapabilityPorts();
    const resolvers = createBuiltInResolvers(ports, script);

    await runToQuiescence(ctx, registry, ROOT_NODE_ID, resolvers);

    expect(ctx.store.getNode(ctx.scope, 'review')?.status).toBe('blocked');
    expect(isGloballyQuiescent(ctx, ROOT_NODE_ID)).toBe(true); // a recoverable halt — nothing left eligible without an external event

    const resumed = resume(ctx, 'review');
    expect(resumed.ok).toBe(true);
    expect(ctx.store.getNode(ctx.scope, 'review')?.status).toBe('not_started');

    // Same resolvers/script instance — the driver's per-node verdict queue already has its 2nd entry
    // lined up, mirroring a real re-review after the operator's out-of-band recovery action.
    await runToQuiescence(ctx, registry, ROOT_NODE_ID, resolvers);

    expect(ctx.store.getNode(ctx.scope, 'review')?.status).toBe('done');
    expect(ctx.store.getNode(ctx.scope, 'review')?.data.verdict).toBe('approved');
    expect(isGloballyQuiescent(ctx, ROOT_NODE_ID)).toBe(true);
  });
});

describe('multi-repo pr — the frozen per-repo shape', () => {
  it('opens (or resolves) a PR per repo and reports back the frozen {name, pr_url} shape', async () => {
    const ctx = ctxFor('proj-pr');
    const registry = createNodeTypeRegistry(BUILT_IN_NODE_TYPES);

    const repos = [
      { name: 'rad-orc-source', path: '/repos/rad-orc-source', branch: 'radorch/STEERABLE-DAG-1', base_branch: 'main' },
      { name: 'ui-repo', path: '/repos/ui-repo', branch: 'radorch/STEERABLE-DAG-1', base_branch: 'main' },
    ];
    add_node(ctx, registry, 'pr', 'rad-orc:pr', ROOT_NODE_ID, { data: { repos } });

    const script: DriverScript = {
      prResults: {
        pr: [
          { name: 'rad-orc-source', pr_url: 'https://github.com/example/rad-orc-source/pull/1' },
          { name: 'ui-repo', pr_url: 'https://github.com/example/ui-repo/pull/7' },
        ],
      },
    };
    const ports = createFakedCapabilityPorts();
    await runToQuiescence(ctx, registry, ROOT_NODE_ID, createBuiltInResolvers(ports, script));

    const prNode = ctx.store.getNode(ctx.scope, 'pr');
    expect(prNode?.status).toBe('done');
    expect(prNode?.data.results).toEqual([
      { name: 'rad-orc-source', pr_url: 'https://github.com/example/rad-orc-source/pull/1' },
      { name: 'ui-repo', pr_url: 'https://github.com/example/ui-repo/pull/7' },
    ]);
    expect(ports.runCommand.ran).toHaveLength(2);
  });
});

describe('plan adoption — expand appends onto an already-settled graph', () => {
  it('appends an adopted task via expand after quiescence, and it runs to done too', async () => {
    const ctx = ctxFor('proj-adoption');
    const registry = createNodeTypeRegistry(BUILT_IN_NODE_TYPES);

    add_node(ctx, registry, 'task-a', 'rad-orc:task', ROOT_NODE_ID, { data: taskData('/tasks/task-a.md') });

    const ports = createFakedCapabilityPorts();
    const resolvers = createBuiltInResolvers(ports);
    await runToQuiescence(ctx, registry, ROOT_NODE_ID, resolvers);
    expect(isGloballyQuiescent(ctx, ROOT_NODE_ID)).toBe(true);

    const adopted = expand(ctx, registry, 'task-a', {
      specs: [{ key: 'adopted-task', type: 'rad-orc:task', parent: ROOT_NODE_ID, dependsOn: [], data: taskData('/tasks/adopted.md') }],
    });
    expect(adopted.ok).toBe(true);
    expect(ctx.store.getNode(ctx.scope, 'adopted-task')?.derivedFrom).toBe('task-a');
    expect(isGloballyQuiescent(ctx, ROOT_NODE_ID)).toBe(false); // adoption re-opens the frontier

    await runToQuiescence(ctx, registry, ROOT_NODE_ID, resolvers);

    expect(ctx.store.getNode(ctx.scope, 'adopted-task')?.status).toBe('done');
    expect(isGloballyQuiescent(ctx, ROOT_NODE_ID)).toBe(true);
  });
});

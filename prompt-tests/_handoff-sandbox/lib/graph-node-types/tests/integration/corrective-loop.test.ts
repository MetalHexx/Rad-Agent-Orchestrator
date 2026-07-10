// The corrective loop, driven at every level a `rad-orc:code_review` can occupy: a
// `changes_requested` verdict births an additive `rad-orc:corrective` and re-points the review back
// onto it; both the coder's dispute-only path (no commit, findings disputed in place) and its fix
// path (a genuine commit) converge on the same review re-engaging and, eventually, `approved`.
import type { PrimitiveContext, ProjectScope } from '@rad-orchestration/graph-engine';
import { InMemoryStateStore, ROOT_NODE_ID, add_node, createNodeTypeRegistry, remaining } from '@rad-orchestration/graph-engine';
import { describe, expect, it } from 'vitest';
import { BUILT_IN_NODE_TYPES } from '../../src/index.js';
import type { DriverScript } from '../harness/test-driver.js';
import { createBuiltInResolvers, createFakedCapabilityPorts, globalFrontier, runToQuiescence } from '../harness/test-driver.js';

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

describe('corrective loop — task level (both coder paths converge)', () => {
  it('a dispute-only cycle followed by a fix cycle both re-arm the same review, which finally approves', async () => {
    const ctx = ctxFor('proj-task-corrective');
    const registry = createNodeTypeRegistry(BUILT_IN_NODE_TYPES);

    add_node(ctx, registry, 'phase-1', 'rad-orc:phase', ROOT_NODE_ID, { data: { docPath: 'phases/PHASE-01.md', exitCriteria: ['done'] } });
    add_node(ctx, registry, 'task-a', 'rad-orc:task', 'phase-1', { data: taskData('/tasks/task-a.md') });
    add_node(ctx, registry, 'review', 'rad-orc:code_review', 'phase-1', { data: { level: 'task' }, dependsOn: ['task-a'] });

    const script: DriverScript = {
      reviewVerdicts: {
        review: [
          { verdict: 'changes_requested', severity: 'medium' },
          { verdict: 'changes_requested', severity: 'low' },
          { verdict: 'approved', severity: 'none' },
        ],
      },
      taskResults: {
        'task-a': [{ name: 'rad-orc-source', committed: true, commitHash: 'aaa1111', pushed: true }],
        'review-corrective-1': [{ name: 'rad-orc-source', committed: false, commitHash: null, pushed: false }], // dispute-only
        'review-corrective-2': [{ name: 'rad-orc-source', committed: true, commitHash: 'bbb2222', pushed: true }], // fix
      },
    };
    const ports = createFakedCapabilityPorts();
    await runToQuiescence(ctx, registry, ROOT_NODE_ID, createBuiltInResolvers(ports, script));

    expect(ctx.store.getNode(ctx.scope, 'review')?.status).toBe('done');
    expect(ctx.store.getNode(ctx.scope, 'review')?.data.verdict).toBe('approved');

    const disputeCorrective = ctx.store.getNode(ctx.scope, 'review-corrective-1');
    expect(disputeCorrective?.type).toBe('rad-orc:corrective');
    expect(disputeCorrective?.derivedFrom).toBe('task-a');
    expect(disputeCorrective?.parent).toBe('phase-1');
    expect(disputeCorrective?.status).toBe('done');
    expect(disputeCorrective?.data).toMatchObject({
      correctiveIndex: 1,
      handoffDocPath: '/tasks/task-a.md',
      results: [{ name: 'rad-orc-source', committed: false, commitHash: null, pushed: false }],
    });

    const fixCorrective = ctx.store.getNode(ctx.scope, 'review-corrective-2');
    expect(fixCorrective?.derivedFrom).toBe('review-corrective-1'); // additive — the chain's tip, never rewound
    expect(fixCorrective?.data).toMatchObject({
      correctiveIndex: 2,
      handoffDocPath: '/tasks/task-a.md',
      results: [{ name: 'rad-orc-source', committed: true, commitHash: 'bbb2222', pushed: true }],
    });

    expect(() => globalFrontier(ctx, ROOT_NODE_ID)).not.toThrow(); // acyclic + tree-shaped throughout
    const nodes = ctx.store.listNodes(ctx.scope);
    expect(remaining(nodes, 'phase-1')).toEqual([]);
    expect(remaining(nodes, ROOT_NODE_ID)).toEqual([]);
  });
});

describe('corrective loop — phase level', () => {
  it('an additive corrective born under the phase container converges the phase to done', async () => {
    const ctx = ctxFor('proj-phase-corrective');
    const registry = createNodeTypeRegistry(BUILT_IN_NODE_TYPES);

    add_node(ctx, registry, 'phase-2', 'rad-orc:phase', ROOT_NODE_ID, { data: { docPath: 'phases/PHASE-02.md', exitCriteria: ['done'] } });
    add_node(ctx, registry, 'task-x', 'rad-orc:task', 'phase-2', { data: taskData('/tasks/task-x.md') });
    add_node(ctx, registry, 'task-y', 'rad-orc:task', 'phase-2', { data: taskData('/tasks/task-y.md'), dependsOn: ['task-x'] });
    add_node(ctx, registry, 'phase-review', 'rad-orc:code_review', 'phase-2', { data: { level: 'phase' }, dependsOn: ['task-y'] });

    const script: DriverScript = {
      reviewVerdicts: {
        'phase-review': [
          { verdict: 'changes_requested', severity: 'high' },
          { verdict: 'approved', severity: 'none' },
        ],
      },
      taskResults: {
        'phase-review-corrective-1': [{ name: 'rad-orc-source', committed: true, commitHash: 'ccc3333', pushed: true }],
      },
    };
    const ports = createFakedCapabilityPorts();
    await runToQuiescence(ctx, registry, ROOT_NODE_ID, createBuiltInResolvers(ports, script));

    expect(ctx.store.getNode(ctx.scope, 'phase-review')?.status).toBe('done');
    const corrective = ctx.store.getNode(ctx.scope, 'phase-review-corrective-1');
    expect(corrective?.derivedFrom).toBe('task-y'); // the phase review's own predecessor — the chain's tip
    expect(corrective?.parent).toBe('phase-2');

    const nodes = ctx.store.listNodes(ctx.scope);
    expect(remaining(nodes, 'phase-2')).toEqual([]);
    expect(remaining(nodes, ROOT_NODE_ID)).toEqual([]);
  });
});

describe('corrective loop — final level', () => {
  it('an additive corrective born at the project-scoped root converges the whole project to done', async () => {
    const ctx = ctxFor('proj-final-corrective');
    const registry = createNodeTypeRegistry(BUILT_IN_NODE_TYPES);

    add_node(ctx, registry, 'task-z', 'rad-orc:task', ROOT_NODE_ID, { data: taskData('/tasks/task-z.md') });
    add_node(ctx, registry, 'final-review', 'rad-orc:code_review', ROOT_NODE_ID, { data: { level: 'final' }, dependsOn: ['task-z'] });

    const script: DriverScript = {
      reviewVerdicts: {
        'final-review': [
          { verdict: 'changes_requested', severity: 'medium' },
          { verdict: 'approved', severity: 'none' },
        ],
      },
      taskResults: {
        'final-review-corrective-1': [{ name: 'rad-orc-source', committed: true, commitHash: 'ddd4444', pushed: true }],
      },
    };
    const ports = createFakedCapabilityPorts();
    await runToQuiescence(ctx, registry, ROOT_NODE_ID, createBuiltInResolvers(ports, script));

    expect(ctx.store.getNode(ctx.scope, 'final-review')?.status).toBe('done');
    const corrective = ctx.store.getNode(ctx.scope, 'final-review-corrective-1');
    expect(corrective?.derivedFrom).toBe('task-z');
    expect(corrective?.parent).toBe(ROOT_NODE_ID);

    expect(remaining(ctx.store.listNodes(ctx.scope), ROOT_NODE_ID)).toEqual([]);
  });
});

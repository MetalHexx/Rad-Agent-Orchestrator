// Direct, resolver-free exercise of `applyOutcome`'s commit cycle (`handle` -> `apply_event` ->
// routing -> expansion -> `syncProjectedStatus`) — the full cycle a resolver always ends with,
// proven here against the engine's own primitives alone.
import type { PrimitiveContext, ProjectScope } from '@rad-orchestration/graph-engine';
import { InMemoryStateStore, ROOT_NODE_ID, add_node, createNodeTypeRegistry, engage } from '@rad-orchestration/graph-engine';
import { BUILT_IN_NODE_TYPES, CODE_REVIEW_REVIEWED_TOKEN, TASK_COMPLETED_TOKEN } from '@rad-orchestration/graph-node-types';
import { describe, expect, it } from 'vitest';
import { applyOutcome } from '../../src/driver/outcome.js';

function scope(projectId: string): ProjectScope {
  return { projectId };
}

function ctxFor(projectId: string): PrimitiveContext {
  return { store: new InMemoryStateStore(), scope: scope(projectId) };
}

const REPOS = [{ name: 'rad-orc-source', path: '/repos/rad-orc-source', branch: 'radorch/STEERABLE-DAG-2.3' }];

describe('applyOutcome', () => {
  it('commits the data patch and re-projects status to done — engage only writes in_progress, applyOutcome is what reaches done', () => {
    const ctx = ctxFor('proj-outcome-task');
    const registry = createNodeTypeRegistry(BUILT_IN_NODE_TYPES);
    add_node(ctx, registry, 'task-1', 'rad-orc:task', ROOT_NODE_ID, {
      data: { handoffDocPath: '/tasks/task-1.md', repos: REPOS, complexity: 'simple', shouldCommit: true },
    });

    expect(engage(ctx, registry, 'task-1').ok).toBe(true);
    expect(ctx.store.getNode(ctx.scope, 'task-1')?.status).toBe('in_progress');

    const results = [{ name: 'rad-orc-source', committed: true, commitHash: 'a1b2c3d', pushed: true }];
    applyOutcome(ctx, registry, 'task-1', { token: TASK_COMPLETED_TOKEN, envelope: { outcome: 'ok', data: { results } } });

    const after = ctx.store.getNode(ctx.scope, 'task-1');
    expect(after?.status).toBe('done');
    expect(after?.data.results).toEqual(results);
  });

  it('re-projects status even when the event carries no reaction — a task never gets stuck in_progress with nothing to show for it', () => {
    const ctx = ctxFor('proj-outcome-noop-event');
    const registry = createNodeTypeRegistry(BUILT_IN_NODE_TYPES);
    add_node(ctx, registry, 'task-1', 'rad-orc:task', ROOT_NODE_ID, {
      data: { handoffDocPath: '/tasks/task-1.md', repos: REPOS, complexity: 'simple', shouldCommit: true },
    });
    engage(ctx, registry, 'task-1');

    // task.handle only reacts to an 'ok' outcome, so this leaves `data` untouched — but
    // syncProjectedStatus still re-projects it, and rad-orc:task's own projectStatus reads
    // `data.completed` as its only signal (never 'in_progress'), so an unreacted event re-arms the
    // node back to not_started rather than leaving it stranded in_progress forever.
    applyOutcome(ctx, registry, 'task-1', { token: TASK_COMPLETED_TOKEN, envelope: { outcome: 'error', data: {} } });

    const after = ctx.store.getNode(ctx.scope, 'task-1');
    expect(after?.status).toBe('not_started');
    expect(after?.data.results).toBeUndefined();
  });

  it("routes 'add_corrective' and carries the chain tip's scope contract forward — the corrective is never spawned hollow", () => {
    const ctx = ctxFor('proj-outcome-corrective');
    const registry = createNodeTypeRegistry(BUILT_IN_NODE_TYPES);
    add_node(ctx, registry, 'task-a', 'rad-orc:task', ROOT_NODE_ID, {
      data: { handoffDocPath: '/tasks/task-a.md', repos: REPOS, complexity: 'standard', shouldCommit: true },
    });
    add_node(ctx, registry, 'review', 'rad-orc:code_review', ROOT_NODE_ID, {
      data: { level: 'task', reviewReportPath: 'reviews/review.md' },
      dependsOn: ['task-a'],
    });

    engage(ctx, registry, 'task-a');
    applyOutcome(ctx, registry, 'task-a', {
      token: TASK_COMPLETED_TOKEN,
      envelope: { outcome: 'ok', data: { results: [{ name: 'rad-orc-source', committed: true, commitHash: 'aaa1111', pushed: true }] } },
    });
    expect(ctx.store.getNode(ctx.scope, 'task-a')?.status).toBe('done');

    expect(engage(ctx, registry, 'review').ok).toBe(true);
    applyOutcome(ctx, registry, 'review', {
      token: CODE_REVIEW_REVIEWED_TOKEN,
      envelope: { outcome: 'ok', data: { verdict: 'changes_requested', severity: 'medium', correctiveIndex: 1, reviewReportPath: 'reviews/review.md' } },
    });

    // code_review.handle supplies only reviewReportPath/correctiveIndex on the routing request;
    // handoffDocPath/repos/complexity/shouldCommit must arrive via runRouting's own host-side
    // enrichment, carried forward from the chain tip (task-a) — never invented by the engine.
    const corrective = ctx.store.getNode(ctx.scope, 'review-corrective-1');
    expect(corrective?.type).toBe('rad-orc:corrective');
    expect(corrective?.derivedFrom).toBe('task-a');
    expect(corrective?.data).toMatchObject({
      handoffDocPath: '/tasks/task-a.md',
      repos: REPOS,
      complexity: 'standard',
      shouldCommit: true,
      reviewReportPath: 'reviews/review.md',
      correctiveIndex: 1,
    });

    // review is re-armed behind the new corrective rather than left done.
    expect(ctx.store.getNode(ctx.scope, 'review')?.status).toBe('not_started');
  });
});

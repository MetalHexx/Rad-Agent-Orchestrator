import type { DocReadPort, DocReadRequest, Envelope, PrimitiveContext, ProjectScope } from '@rad-orchestration/graph-engine';
import { InMemoryStateStore, ROOT_NODE_ID, add_node, createNodeTypeRegistry, engage } from '@rad-orchestration/graph-engine';
import { BUILT_IN_NODE_TYPES } from '@rad-orchestration/graph-node-types';
import { describe, expect, it } from 'vitest';
import { createFakedCapabilityPorts } from '../../src/capabilities/fakes.js';
import { advance, runToQuiescence } from '../../src/driver/drive.js';
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

/** A coder's relayed per-repo commit results, as the orchestrator deposits them onto a task/corrective node. */
const COMMIT_RESULTS = [{ name: 'rad-orc-source', committed: true, commitHash: 'a1b2c3d', pushed: true }];

/** A real master-plan fixture `parseMasterPlan` accepts and the explosion runner can re-slice into docs. */
const MASTER_PLAN_DOC = `# Master Plan

## Phase 1: Foundation
Doc: docs/phases/phase-1.md
Exit Criteria:
- Foundations laid

### Task 1: Scaffold the module

## Phase 2: Delivery
Doc: docs/phases/phase-2.md
Exit Criteria:
- Delivery shipped

### Task 1: Ship it
`;

/** A real review-report fixture — the verdict lives in frontmatter, exactly where the resolver reads it. */
function reviewReport(verdict: string, severity: string): string {
  return `---\nverdict: ${verdict}\nseverity: ${severity}\n---\n\n# Review Report\n\nOne running report, re-adjudicated in place.\n`;
}

describe('advance — per executor kind', () => {
  it('drives a rad-orc:task not_started -> done, dispatching the spawn and recording the relayed commit results', async () => {
    const ctx = ctxFor('proj-advance-task');
    const registry = createNodeTypeRegistry(BUILT_IN_NODE_TYPES);
    add_node(ctx, registry, 'task-1', 'rad-orc:task', ROOT_NODE_ID, { data: { ...taskData('/tasks/task-1.md'), results: COMMIT_RESULTS } });

    const ports = createFakedCapabilityPorts();
    const resolvers = createBuiltInResolvers(ports);
    const node = ctx.store.getNode(ctx.scope, 'task-1');
    if (!node) throw new Error('missing seeded node');

    const result = await advance(ctx, registry, resolvers, node);

    expect(result).toEqual({ ok: true, data: { nodeId: 'task-1', type: 'rad-orc:task' } });
    const done = ctx.store.getNode(ctx.scope, 'task-1');
    expect(done?.status).toBe('done');
    expect(done?.data.completed).toBe(true);
    expect(done?.data.results).toEqual(COMMIT_RESULTS);
    // The outward spawn fired once, carrying the stable per-node idempotency key.
    expect(ports.spawnAgent.spawned).toHaveLength(1);
    expect(ports.spawnAgent.spawned[0]?.idempotencyKey).toBe('task-1:spawn');
  });

  it('drives a rad-orc:explosion to done via the real explosion runner, expanding one phase per parsed phase', async () => {
    const ctx = ctxFor('proj-advance-explosion');
    const registry = createNodeTypeRegistry(BUILT_IN_NODE_TYPES);
    add_node(ctx, registry, 'master-plan', 'rad-orc:master_plan', ROOT_NODE_ID, { data: { docPath: 'docs/master-plan/master-plan.md' } });
    add_node(ctx, registry, 'plan-approval', 'rad-orc:approval', ROOT_NODE_ID, { data: { level: 'plan' } });
    add_node(ctx, registry, 'explosion', 'rad-orc:explosion', ROOT_NODE_ID, {
      data: { cadence: { perTask: [], perPhase: [], spine: [] } },
    });

    const ports = createFakedCapabilityPorts();
    ports.docRead.seed('docs/master-plan/master-plan.md', MASTER_PLAN_DOC);
    const resolvers = createBuiltInResolvers(ports);

    const explosionNode = ctx.store.getNode(ctx.scope, 'explosion');
    if (!explosionNode) throw new Error('missing seeded node');
    const result = await advance(ctx, registry, resolvers, explosionNode);

    expect(result.ok).toBe(true);
    expect(ctx.store.getNode(ctx.scope, 'explosion')?.status).toBe('done');
    // The runner really wrote the emitted phase/task docs; no agent/PR side effects.
    expect(ports.docWrite.writes.length).toBeGreaterThan(0);
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
    // already landed even though nothing has been awaited yet; the outcome (the `completed` flag
    // and the resulting `done` re-projection) only commits once the returned promise is awaited.
    expect(ctx.store.getNode(ctx.scope, 'task-1')?.status).toBe('in_progress');
    expect(ctx.store.getNode(ctx.scope, 'task-1')?.data.completed).toBeUndefined();

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

describe('advance — code_review verdict read off the report', () => {
  it("routes an add_corrective when the report's frontmatter verdict is changes_requested", async () => {
    const ctx = ctxFor('proj-review-changes');
    const registry = createNodeTypeRegistry(BUILT_IN_NODE_TYPES);
    add_node(ctx, registry, 'task-1', 'rad-orc:task', ROOT_NODE_ID, { data: { ...taskData('/tasks/task-1.md'), results: COMMIT_RESULTS } });
    add_node(ctx, registry, 'review', 'rad-orc:code_review', ROOT_NODE_ID, {
      data: { level: 'task', reviewReportPath: 'reviews/review.md' },
      dependsOn: ['task-1'],
    });

    const ports = createFakedCapabilityPorts();
    ports.docRead.seed('reviews/review.md', reviewReport('changes_requested', 'medium'));
    const resolvers = createBuiltInResolvers(ports);

    const task = ctx.store.getNode(ctx.scope, 'task-1');
    if (!task) throw new Error('missing seeded node');
    await advance(ctx, registry, resolvers, task); // drive the predecessor done so the review is frontier-eligible

    const review = ctx.store.getNode(ctx.scope, 'review');
    if (!review) throw new Error('missing seeded node');
    const result = await advance(ctx, registry, resolvers, review);

    expect(result.ok).toBe(true);
    // The verdict came only from the doc-read — and it births the next corrective attempt.
    expect(ctx.store.getNode(ctx.scope, 'review')?.data.verdict).toBe('changes_requested');
    const corrective = ctx.store.getNode(ctx.scope, 'review-corrective-1');
    expect(corrective?.type).toBe('rad-orc:corrective');
    expect(corrective?.derivedFrom).toBe('task-1');
    expect(ctx.store.getNode(ctx.scope, 'review')?.status).not.toBe('done');
  });

  it("advances (done) when the report's frontmatter verdict is approved, minting no corrective", async () => {
    const ctx = ctxFor('proj-review-approved');
    const registry = createNodeTypeRegistry(BUILT_IN_NODE_TYPES);
    add_node(ctx, registry, 'task-1', 'rad-orc:task', ROOT_NODE_ID, { data: { ...taskData('/tasks/task-1.md'), results: COMMIT_RESULTS } });
    add_node(ctx, registry, 'review', 'rad-orc:code_review', ROOT_NODE_ID, {
      data: { level: 'task', reviewReportPath: 'reviews/review.md' },
      dependsOn: ['task-1'],
    });

    const ports = createFakedCapabilityPorts();
    ports.docRead.seed('reviews/review.md', reviewReport('approved', 'none'));
    const resolvers = createBuiltInResolvers(ports);

    const task = ctx.store.getNode(ctx.scope, 'task-1');
    if (!task) throw new Error('missing seeded node');
    await advance(ctx, registry, resolvers, task); // drive the predecessor done so the review is frontier-eligible

    const review = ctx.store.getNode(ctx.scope, 'review');
    if (!review) throw new Error('missing seeded node');
    const result = await advance(ctx, registry, resolvers, review);

    expect(result.ok).toBe(true);
    expect(ctx.store.getNode(ctx.scope, 'review')?.status).toBe('done');
    expect(ctx.store.getNode(ctx.scope, 'review')?.data.verdict).toBe('approved');
    expect(ctx.store.getNode(ctx.scope, 'review-corrective-1')).toBeNull();
  });
});

describe('advance — approval decision relayed through the request-human capability', () => {
  it('advances (done) on a granted decision, no routing', async () => {
    const ctx = ctxFor('proj-approval-granted');
    const registry = createNodeTypeRegistry(BUILT_IN_NODE_TYPES);
    add_node(ctx, registry, 'approval-1', 'rad-orc:approval', ROOT_NODE_ID, { data: { level: 'final' } });

    const ports = createFakedCapabilityPorts();
    ports.requestHuman.seed('approval-1:decision', 'granted');
    const resolvers = createBuiltInResolvers(ports);

    const node = ctx.store.getNode(ctx.scope, 'approval-1');
    if (!node) throw new Error('missing seeded node');
    const result = await advance(ctx, registry, resolvers, node);

    expect(result.ok).toBe(true);
    expect(ctx.store.getNode(ctx.scope, 'approval-1')?.status).toBe('done');
    expect(ctx.store.getNode(ctx.scope, 'approval-1')?.data.decision).toBe('granted');
  });

  it('routes a cascade-reset of the master_plan on a plan-level denied decision', async () => {
    const ctx = ctxFor('proj-approval-denied');
    const registry = createNodeTypeRegistry(BUILT_IN_NODE_TYPES);
    add_node(ctx, registry, 'master-plan', 'rad-orc:master_plan', ROOT_NODE_ID, { data: { docPath: 'docs/master-plan/master-plan.md' } });
    add_node(ctx, registry, 'approval-1', 'rad-orc:approval', ROOT_NODE_ID, { data: { level: 'plan' } });

    const ports = createFakedCapabilityPorts();
    ports.requestHuman.seed('approval-1:decision', 'denied');
    const resolvers = createBuiltInResolvers(ports);

    // A real denial lands only after the plan was authored — engage the master_plan into a
    // resettable (`in_progress`) state so the routed cascade-reset has a live node to re-arm.
    engage(ctx, registry, 'master-plan');

    const node = ctx.store.getNode(ctx.scope, 'approval-1');
    if (!node) throw new Error('missing seeded node');
    const result = await advance(ctx, registry, resolvers, node);

    // The denied decision routed (the cascade-reset re-armed the master_plan) and the gate is blocked.
    expect(result.ok).toBe(true);
    expect(ctx.store.getNode(ctx.scope, 'approval-1')?.data.decision).toBe('denied');
    expect(ctx.store.getNode(ctx.scope, 'approval-1')?.status).toBe('blocked');
    expect(ctx.store.getNode(ctx.scope, 'master-plan')?.status).toBe('not_started');
  });
});

/** A doc-read fake that hands back a queued content per read for one path — models a running report re-adjudicated in place across corrective cycles. Every other path falls through to the base fake. */
class QueuedDocReadPort implements DocReadPort {
  constructor(
    private readonly base: DocReadPort,
    private readonly queue: readonly string[],
    private readonly path: string,
  ) {}

  private index = 0;

  async read(request: DocReadRequest): Promise<Envelope<{ readonly content: string }>> {
    if (request.path !== this.path) return this.base.read(request);
    const content = this.queue[Math.min(this.index, this.queue.length - 1)];
    this.index += 1;
    return { outcome: 'ok', data: { content } };
  }
}

describe('runToQuiescence', () => {
  it('settles a linear task -> code_review -> pr chain, the review verdict read off its report', async () => {
    const ctx = ctxFor('proj-quiescence-chain');
    const registry = createNodeTypeRegistry(BUILT_IN_NODE_TYPES);
    add_node(ctx, registry, 'task-1', 'rad-orc:task', ROOT_NODE_ID, { data: { ...taskData('/tasks/task-1.md'), results: COMMIT_RESULTS } });
    add_node(ctx, registry, 'review', 'rad-orc:code_review', ROOT_NODE_ID, { data: { level: 'task' }, dependsOn: ['task-1'] });
    add_node(ctx, registry, 'pr-1', 'rad-orc:pr', ROOT_NODE_ID, { data: { repos: REPOS }, dependsOn: ['review'] });

    const ports = createFakedCapabilityPorts();
    ports.docRead.seed('reviews/review.md', reviewReport('approved', 'none'));
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

  it('converges a corrective loop: a changes_requested report mints a corrective, and the review advances once the re-read report turns approved', async () => {
    const ctx = ctxFor('proj-quiescence-corrective');
    const registry = createNodeTypeRegistry(BUILT_IN_NODE_TYPES);
    add_node(ctx, registry, 'task-1', 'rad-orc:task', ROOT_NODE_ID, { data: taskData('/tasks/task-1.md') });
    add_node(ctx, registry, 'review', 'rad-orc:code_review', ROOT_NODE_ID, { data: { level: 'task' }, dependsOn: ['task-1'] });

    const fakes = createFakedCapabilityPorts();
    const ports = {
      ...fakes,
      docRead: new QueuedDocReadPort(fakes.docRead, [reviewReport('changes_requested', 'medium'), reviewReport('approved', 'none')], 'reviews/review.md'),
    };
    const result = await runToQuiescence(ctx, registry, ROOT_NODE_ID, createBuiltInResolvers(ports));

    expect(result.settled).toBe(true);
    expect(ctx.store.getNode(ctx.scope, 'review')?.status).toBe('done');
    expect(ctx.store.getNode(ctx.scope, 'review')?.data.verdict).toBe('approved');

    const corrective = ctx.store.getNode(ctx.scope, 'review-corrective-1');
    expect(corrective?.type).toBe('rad-orc:corrective');
    expect(corrective?.derivedFrom).toBe('task-1');
    expect(corrective?.status).toBe('done');
  });
});

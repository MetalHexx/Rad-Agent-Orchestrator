// Recovery, multi-repo PR, and plan adoption — three more angles the full integration proof
// (`seed-and-run.test.ts`) covers: a `rejected` verdict halts recoverably rather than erroring, a
// multi-repo `rad-orc:pr` reports the frozen per-repo shape, and `expand` appends new work onto an
// already-settled graph.
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
import { DECORATION_CADENCE_FIXTURE } from '../fixtures/decoration-cadence.js';
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

// A valid two-phase plan the explosion can parse — mirrors the driver's private DEFAULT_MASTER_PLAN_DOC
// so a resumed explosion, reading this back from the master plan's docPath, yields the same decorated
// subgraph ids the happy-path proof asserts.
const GOOD_MASTER_PLAN_DOC = `# Master Plan

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

describe('recovery — corrective-budget halt -> resume -> a fresh corrective converges', () => {
  it('exhausting the retry budget halts the review (disabled); resume mints a fresh corrective and it converges to done', async () => {
    const ctx = ctxFor('proj-budget-recovery');
    const registry = createNodeTypeRegistry(BUILT_IN_NODE_TYPES);

    add_node(ctx, registry, 'task-a', 'rad-orc:task', ROOT_NODE_ID, { data: taskData('/tasks/task-a.md') });
    add_node(ctx, registry, 'review', 'rad-orc:code_review', ROOT_NODE_ID, { data: { level: 'task' }, dependsOn: ['task-a'] });

    // The default engine budget (`add_corrective`'s own `DEFAULT_MAX_RETRIES`) is 5: five
    // `changes_requested` cycles mint correctives 1-5, the sixth finds the chain already at depth
    // 5 and halts instead of minting a 6th. Two more entries prove the post-resume recovery: a
    // fresh corrective minted under the reset budget, then a final approval.
    const script: DriverScript = {
      reviewVerdicts: {
        review: [
          { verdict: 'changes_requested', severity: 'low' },
          { verdict: 'changes_requested', severity: 'low' },
          { verdict: 'changes_requested', severity: 'low' },
          { verdict: 'changes_requested', severity: 'low' },
          { verdict: 'changes_requested', severity: 'low' },
          { verdict: 'changes_requested', severity: 'low' },
          { verdict: 'changes_requested', severity: 'low' },
          { verdict: 'approved', severity: 'none' },
        ],
      },
    };
    const ports = createFakedCapabilityPorts();
    const resolvers = createBuiltInResolvers(ports, script);

    await runToQuiescence(ctx, registry, ROOT_NODE_ID, resolvers);

    const halted = ctx.store.getNode(ctx.scope, 'review');
    expect(halted?.disabled).toBe(true);
    expect(halted?.status).not.toBe('done');
    expect(ctx.store.getNode(ctx.scope, 'review-corrective-5')?.status).toBe('done'); // the 5th attempt within budget
    expect(ctx.store.getNode(ctx.scope, 'review-corrective-6')).toBeNull(); // the budget-exceeding 6th mint never happened
    expect(isGloballyQuiescent(ctx, ROOT_NODE_ID)).toBe(true); // a recoverable halt — nothing left eligible without resume

    const resumed = resume(ctx, 'review');
    expect(resumed.ok).toBe(true);
    expect(ctx.store.getNode(ctx.scope, 'review')?.disabled).toBe(false);
    expect(ctx.store.getNode(ctx.scope, 'review')?.budgetAnchor).toBe('review-corrective-5'); // anchors the reset budget at the chain's tip

    await runToQuiescence(ctx, registry, ROOT_NODE_ID, resolvers);

    const freshCorrective = ctx.store.getNode(ctx.scope, 'review-corrective-7');
    expect(freshCorrective?.status).toBe('done'); // the fresh mint the reset budget allowed
    expect(freshCorrective?.derivedFrom).toBe('review-corrective-5');
    expect(ctx.store.getNode(ctx.scope, 'review')?.status).toBe('done');
    expect(ctx.store.getNode(ctx.scope, 'review')?.data.verdict).toBe('approved');
    expect(isGloballyQuiescent(ctx, ROOT_NODE_ID)).toBe(true);
  });
});

describe('recovery — explosion parse-cap halt -> resume -> re-parse -> completion', () => {
  it('a halted explosion, once a valid plan is authored and resume clears its self-disable, re-parses and expands its decorated subgraph to done — recovering from resume alone', async () => {
    const ctx = ctxFor('proj-explosion-recovery');
    const registry = createNodeTypeRegistry(BUILT_IN_NODE_TYPES);

    add_node(ctx, registry, 'master-plan', 'rad-orc:master_plan', ROOT_NODE_ID);
    add_node(ctx, registry, 'plan-approval', 'rad-orc:approval', ROOT_NODE_ID, {
      data: { level: 'plan' },
      dependsOn: ['master-plan'],
    });
    add_node(ctx, registry, 'explosion', 'rad-orc:explosion', ROOT_NODE_ID, {
      data: { cadence: DECORATION_CADENCE_FIXTURE },
      dependsOn: ['master-plan'],
    });

    // A master plan that never parses drives the explosion through its parse-retry cap to a self-disable halt.
    const ports = createFakedCapabilityPorts();
    const resolvers = createBuiltInResolvers(ports, { masterPlanDoc: '# Master Plan\n' }); // no phases — never parses
    await runToQuiescence(ctx, registry, ROOT_NODE_ID, resolvers);

    // Precondition: the node is halted (frontier-excluded) with a fresh retry window and a recorded error.
    const halted = ctx.store.getNode(ctx.scope, 'explosion');
    expect(halted?.disabled).toBe(true);
    expect(halted?.data.parseRetryCount).toBe(0); // reset at halt time — a later resume gets a fresh window
    expect(halted?.data.lastParseError).toBeTruthy();
    expect(halted?.status).toBe('not_started');
    expect(isGloballyQuiescent(ctx, ROOT_NODE_ID)).toBe(true);

    // The operator's out-of-band recovery: author a valid plan at the master plan's own docPath (which the
    // explosion reads back), then resume the explosion alone. master-plan stays done, so it never re-authors —
    // the re-parse is driven purely by resume re-arming the halted node.
    ports.docRead.seed('docs/master-plan/master-plan.md', GOOD_MASTER_PLAN_DOC);
    const writesBefore = ports.docWrite.writes.length;

    const resumed = resume(ctx, 'explosion');
    expect(resumed.ok).toBe(true);
    expect(ctx.store.getNode(ctx.scope, 'explosion')?.disabled).toBe(false);

    await runToQuiescence(ctx, registry, ROOT_NODE_ID, resolvers);

    // Full recovery: the explosion re-parsed, cleared its error, expanded, and reached done.
    const recovered = ctx.store.getNode(ctx.scope, 'explosion');
    expect(recovered?.disabled).toBe(false);
    expect(recovered?.status).toBe('done');
    expect(recovered?.data.parseRetryCount).toBe(0);
    expect(recovered?.data.lastParseError).toBeNull();
    expect(recovered?.data.expanded).toBe(true);

    // The handle-issued expansion seeded the decorated subgraph, and every node under it converged.
    expect(ctx.store.getNode(ctx.scope, 'phase-1')?.type).toBe('rad-orc:phase');
    expect(ctx.store.getNode(ctx.scope, 'phase-1-task-1')?.status).toBe('done');
    expect(ctx.store.getNode(ctx.scope, 'phase-1-task-1-code_review-0')?.status).toBe('done');
    expect(ctx.store.getNode(ctx.scope, 'spine-approval-2')?.status).toBe('done');
    expect(isGloballyQuiescent(ctx, ROOT_NODE_ID)).toBe(true);

    // Recovery came from resume alone — the master plan was never re-authored.
    expect(ports.docWrite.writes.length).toBe(writesBefore);
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

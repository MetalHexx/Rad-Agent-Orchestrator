// graph-service/tests/functional/planning-subgraph.test.ts
//
// The plan subgraph — `rad-orc:master_plan` -> `rad-orc:explosion` -> `rad-orc:plan_audit` ->
// `rad-orc:approval` (`level: 'plan'`) -> the decorated phase loop `explosion` seeds at runtime —
// driven end to end over HTTP against the durable store, real SSE, and real doc/explosion
// capabilities; only the orchestrator's own relayed decisions (`tests/fixtures/plan-relay.ts`) play
// the agent/operator role, exactly like the walking-skeleton scenarios' `autoRelay`.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BootedDaemon } from '../harness/boot.js';
import { bootDaemon } from '../harness/boot.js';
import { dag, driveToQuiescence, frontier, node, seed, steer } from '../harness/drive.js';
import type { SseCollector } from '../harness/sse.js';
import { connectSse } from '../harness/sse.js';
import {
  MALFORMED_MASTER_PLAN_DOC,
  PLAN_SUBGRAPH_IDS,
  WELL_FORMED_MASTER_PLAN_DOC,
  planSubgraphSeedSteps,
} from '../fixtures/plan-subgraph-seed.js';
import { createPlanningRelay } from '../fixtures/plan-relay.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function engagedNodeIds(sse: SseCollector): readonly string[] {
  return sse.deltas
    .filter((delta) => isRecord(delta.data) && delta.data.primitive === 'engage')
    .map((delta) => (delta.data as { params: { node: string } }).params.node);
}

describe('functional: planning subgraph', () => {
  let daemon: BootedDaemon;

  beforeEach(async () => {
    daemon = await bootDaemon();
  });

  afterEach(async () => {
    await daemon.teardown();
  });

  it('drives master_plan -> explosion -> plan_audit -> plan_approval -> the seeded phase loop to done, with docs emitted on disk', async () => {
    const project = 'planning-happy-path';
    await seed(daemon.baseUrl(), project, planSubgraphSeedSteps());

    expect((await frontier(daemon.baseUrl(), project)).map((n) => n.id)).toEqual([PLAN_SUBGRAPH_IDS.masterPlan]);

    let sse: SseCollector | undefined;
    try {
      sse = await connectSse(`${daemon.baseUrl()}/engine-graph/stream?project=${project}`);

      const resolve = createPlanningRelay(daemon, { masterPlanDocs: [WELL_FORMED_MASTER_PLAN_DOC] });
      const { steps } = await driveToQuiescence(daemon.baseUrl(), project, { resolve, maxSteps: 100 });
      expect(steps).toBeGreaterThan(0);

      const snapshot = await dag(daemon.baseUrl(), project);
      expect(snapshot.status).toBe('done');
      expect(await frontier(daemon.baseUrl(), project)).toEqual([]);

      // explosion's real docWrite emitted the phase/task docs to disk — the same slicing
      // `explosion-runner.test.ts` proves at the unit level, here proven wired end to end.
      expect(daemon.readDoc('docs/phases/phase-1.md')).toContain('## Phase 1: Foundation');
      expect(daemon.readDoc('docs/phases/phase-2.md')).toContain('## Phase 2: Delivery');
      expect(daemon.readDoc('tasks/P01-T01-SCAFFOLD-THE-MODULE.md')).toBe('### Task 1: Scaffold the module');
      expect(daemon.readDoc('tasks/P02-T01-SHIP-IT.md')).toBe('### Task 1: Ship it');
      expect(daemon.readDoc('tasks/P02-T02-WRITE-THE-DOCS.md')).toBe('### Task 2: Write the docs');

      await sse.waitForQuiet();
      // The spine's own engage order proves the frontier transition end to end: master_plan first,
      // plan_audit and plan_approval only once explosion's own auto-resolve has run.
      const ids = engagedNodeIds(sse);
      expect(ids[0]).toBe(PLAN_SUBGRAPH_IDS.masterPlan);
      expect(ids).toContain(PLAN_SUBGRAPH_IDS.planAudit);
      expect(ids).toContain(PLAN_SUBGRAPH_IDS.planApproval);
    } finally {
      sse?.close();
    }
  });

  it('recovers from a parse failure via reset(master_plan), backing up prior output before regenerating', async () => {
    const project = 'planning-parse-fail-recovery';
    await seed(daemon.baseUrl(), project, planSubgraphSeedSteps());

    // Simulate a prior run's output already sitting at one of explosion's own emitted target paths
    // — proves the composed system's backup-on-re-explode path fires end to end over HTTP, not just
    // at the capability-unit level (`explosion-runner.test.ts` already covers that).
    daemon.seedDoc('docs/phases/phase-1.md', 'STALE PRIOR PHASE 1 CONTENT');

    const resolve = createPlanningRelay(daemon, {
      masterPlanDocs: [MALFORMED_MASTER_PLAN_DOC, WELL_FORMED_MASTER_PLAN_DOC],
    });
    const { steps } = await driveToQuiescence(daemon.baseUrl(), project, { resolve, maxSteps: 100 });
    expect(steps).toBeGreaterThan(0);

    const explosion = await node(daemon.baseUrl(), project, PLAN_SUBGRAPH_IDS.explosion);
    expect(explosion.data.expanded).toBe(true);
    expect(explosion.data.parseRetryCount).toBe(0);
    expect(explosion.disabled).toBeFalsy();

    expect(daemon.readDoc('docs/phases/phase-1.md')).toContain('## Phase 1: Foundation');

    const stamps = daemon.listDir('backups');
    expect(stamps).toHaveLength(1);
    expect(daemon.readDoc(`backups/${stamps[0]}/docs/phases/phase-1.md`)).toBe('STALE PRIOR PHASE 1 CONTENT');

    expect((await dag(daemon.baseUrl(), project)).status).toBe('done');
  });

  it('mints a plan_corrective on issues_found, re-explodes without resetting plan_audit, and plan_approval proceeds off both predecessors', async () => {
    const project = 'planning-corrective-no-reaudit';
    await seed(daemon.baseUrl(), project, planSubgraphSeedSteps());

    const correctedMasterPlanDoc = `# Master Plan

## Phase 1: Foundation
Doc: docs/phases/phase-1.md
Exit Criteria:
- Foundations laid

### Task 1: Scaffold the module
### Task 2: Add tests

## Phase 2: Delivery
Doc: docs/phases/phase-2.md
Exit Criteria:
- Delivery shipped

### Task 1: Ship it
### Task 2: Write the docs
`;

    let sse: SseCollector | undefined;
    try {
      sse = await connectSse(`${daemon.baseUrl()}/engine-graph/stream?project=${project}`);

      const resolve = createPlanningRelay(daemon, {
        masterPlanDocs: [WELL_FORMED_MASTER_PLAN_DOC],
        auditVerdict: 'issues_found',
        correctedMasterPlanDoc,
      });
      const { steps } = await driveToQuiescence(daemon.baseUrl(), project, { resolve, maxSteps: 100 });
      expect(steps).toBeGreaterThan(0);

      const correctiveId = `${PLAN_SUBGRAPH_IDS.planAudit}-corrective-1`;
      const corrective = await node(daemon.baseUrl(), project, correctiveId);
      expect(corrective.type).toBe('rad-orc:plan_corrective');
      expect(corrective.derivedFrom).toBe(PLAN_SUBGRAPH_IDS.planAudit);
      expect(corrective.status).toBe('done');

      // The corrected plan's fresh batch genuinely replaced the prior expansion — the task the
      // corrected doc adds over the original is now a real graph node.
      const addedTask = await node(daemon.baseUrl(), project, 'phase-1-task-2');
      expect(addedTask.data.title).toBe('Add tests');

      // plan_audit never re-enters the frontier: its own status stays `done` from its one and only
      // audit — the gate that unblocks plan_approval is add_corrective_gate's edge onto the
      // corrective, never a reset of the audit itself.
      const audit = await node(daemon.baseUrl(), project, PLAN_SUBGRAPH_IDS.planAudit);
      expect(audit.status).toBe('done');
      expect(audit.data.verdict).toBe('issues_found');

      const approval = await node(daemon.baseUrl(), project, PLAN_SUBGRAPH_IDS.planApproval);
      expect(approval.status).toBe('done');
      expect(approval.data.decision).toBe('granted');

      expect((await dag(daemon.baseUrl(), project)).status).toBe('done');

      await sse.waitForQuiet();
      const auditEngages = sse.deltas.filter(
        (delta) =>
          isRecord(delta.data) &&
          delta.data.primitive === 'engage' &&
          isRecord(delta.data.params) &&
          delta.data.params.node === PLAN_SUBGRAPH_IDS.planAudit,
      );
      expect(auditEngages).toHaveLength(1);
    } finally {
      sse?.close();
    }
  });

  it('halts recoverably once repeated parse failures exceed the retry cap, disabling explosion rather than throwing', async () => {
    const project = 'planning-explosion-halt';
    await seed(daemon.baseUrl(), project, planSubgraphSeedSteps());

    // DEFAULT_PARSE_RETRY_LIMIT is 3: the 4th consecutive failure exceeds the cap and self-halts.
    const resolve = createPlanningRelay(daemon, {
      masterPlanDocs: [MALFORMED_MASTER_PLAN_DOC, MALFORMED_MASTER_PLAN_DOC, MALFORMED_MASTER_PLAN_DOC, MALFORMED_MASTER_PLAN_DOC],
    });
    // 1 bootstrap call (no event, engages master_plan the first time) + 4 relay cycles (each
    // authoring, then explosion's own auto-resolved parse failure) — the last of which self-halts
    // rather than resetting master_plan again.
    const { steps } = await driveToQuiescence(daemon.baseUrl(), project, { resolve, maxSteps: 20 });
    expect(steps).toBe(5);

    const explosion = await node(daemon.baseUrl(), project, PLAN_SUBGRAPH_IDS.explosion);
    expect(explosion.disabled).toBe(true);
    expect(explosion.data.parseRetryCount).toBe(0); // reset at halt time, honoring core-opacity
    expect(explosion.data.lastParseError).toBeTruthy();

    const eligible = (await frontier(daemon.baseUrl(), project)).map((n) => n.id);
    expect(eligible).not.toContain(PLAN_SUBGRAPH_IDS.explosion);
    expect(eligible).not.toContain(PLAN_SUBGRAPH_IDS.planAudit);
    expect((await dag(daemon.baseUrl(), project)).status).not.toBe('done');

    // Recoverable, never a thrown error: the operator's own steer channel lifts the halt.
    await steer(daemon.baseUrl(), project, 'resume', { node: PLAN_SUBGRAPH_IDS.explosion });
    expect((await node(daemon.baseUrl(), project, PLAN_SUBGRAPH_IDS.explosion)).disabled).toBe(false);
  });
});

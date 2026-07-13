// graph-service/tests/fixtures/plan-subgraph-seed.test.ts
//
// A light structural check on `planSubgraphSeedSteps` alone — the seeded spine's shape (order,
// dependency chain, seeded data) and that the frontier starts at `master_plan`. Driving the spine
// to completion (running the real explosion/approval cycle) is P04-T02's own functional scenario;
// this only proves the fixture stamps what it claims to.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BootedDaemon } from '../harness/boot.js';
import { bootDaemon } from '../harness/boot.js';
import { dag, frontier, seed } from '../harness/drive.js';
import { PLAN_SUBGRAPH_CADENCE, PLAN_SUBGRAPH_IDS, planSubgraphSeedSteps } from './plan-subgraph-seed.js';

describe('fixture: plan subgraph seed', () => {
  let daemon: BootedDaemon;

  beforeEach(async () => {
    daemon = await bootDaemon();
  });

  afterEach(async () => {
    await daemon.teardown();
  });

  it('seeds the spine in order, gated in a chain, with the frontier starting at master_plan', async () => {
    const project = 'plan-subgraph-seed';
    const { nodesCreated, edgesCreated } = await seed(daemon.baseUrl(), project, planSubgraphSeedSteps());
    expect(nodesCreated).toBe(3);
    expect(edgesCreated).toBe(2);

    const snapshot = await dag(daemon.baseUrl(), project);
    const byId = new Map(snapshot.nodes.map((node) => [node.id, node]));

    const masterPlan = byId.get(PLAN_SUBGRAPH_IDS.masterPlan);
    const explosion = byId.get(PLAN_SUBGRAPH_IDS.explosion);
    const planApproval = byId.get(PLAN_SUBGRAPH_IDS.planApproval);

    expect(masterPlan?.type).toBe('rad-orc:master_plan');
    expect(explosion?.type).toBe('rad-orc:explosion');
    expect(planApproval?.type).toBe('rad-orc:approval');

    // Positioned in order — the same 0..2 spine sequence buildExecutionExpansion's own phases
    // continue counting from once the phase loop expands after explosion.
    expect([masterPlan?.order, explosion?.order, planApproval?.order]).toEqual([0, 1, 2]);

    expect(explosion?.data.cadence).toEqual(PLAN_SUBGRAPH_CADENCE);
    expect(planApproval?.data.level).toBe('plan');

    // The gating chain: explosion <- master_plan <- plan_approval, one depends_on edge apiece.
    const edgeKeys = new Set(snapshot.edges.map((edge) => `${edge.kind}:${edge.from}->${edge.to}`));
    expect(edgeKeys.has(`depends_on:${PLAN_SUBGRAPH_IDS.masterPlan}->${PLAN_SUBGRAPH_IDS.explosion}`)).toBe(true);
    expect(edgeKeys.has(`depends_on:${PLAN_SUBGRAPH_IDS.explosion}->${PLAN_SUBGRAPH_IDS.planApproval}`)).toBe(true);

    // The seeded frontier is master_plan alone — explosion/plan_approval are both still gated
    // behind their own unmet depends_on predecessor.
    const initialFrontier = await frontier(daemon.baseUrl(), project);
    expect(initialFrontier.map((node) => node.id)).toEqual([PLAN_SUBGRAPH_IDS.masterPlan]);
  });
});

// graph-service/tests/functional/happy-path.test.ts
//
// Scenario 1: a linear phase → task → code_review → pr chain, driven end to end over HTTP against
// the durable store, capabilities faked. Every node reaches `done`, and the SSE stream carries the
// expected ordered `engage` + outcome deltas — the exact `<type>.<outcome>` sequence derived from
// the built-ins' own tokens (`rad-orc:task.completed`, `rad-orc:code_review.reviewed`,
// `rad-orc:pr.created`), no prior decision needed.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BootedDaemon } from '../harness/boot.js';
import { bootDaemon } from '../harness/boot.js';
import { dag, driveToQuiescence, seed } from '../harness/drive.js';
import type { SseCollector } from '../harness/sse.js';
import { connectSse } from '../harness/sse.js';
import { PHASE_CHAIN_IDS, phaseChainSeedSteps } from '../fixtures/phase-chain.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

describe('functional: happy path', () => {
  let daemon: BootedDaemon;

  beforeEach(async () => {
    daemon = await bootDaemon();
  });

  afterEach(async () => {
    await daemon.teardown();
  });

  it('drives every node in the chain to done and the SSE stream carries the ordered engage+outcome deltas', async () => {
    const project = 'happy-path';
    await seed(daemon.baseUrl(), project, phaseChainSeedSteps());

    let sse: SseCollector | undefined;
    try {
      sse = await connectSse(`${daemon.baseUrl()}/engine-graph/stream?project=${project}`);

      const { steps } = await driveToQuiescence(daemon.baseUrl(), project);
      expect(steps).toBeGreaterThan(0);

      const snapshot = await dag(daemon.baseUrl(), project);
      // `snapshot.status` is the containment roll-up over the whole tree — the one place a
      // container's (`phase-1`'s) own completion is observable; its raw persisted `status` column
      // never itself moves off `not_started` (a `contains`-trait node's status is always the
      // roll-up over its children, never its own field — see `rad-orc:phase`'s `projectStatus`).
      expect(snapshot.status).toBe('done');
      for (const id of [PHASE_CHAIN_IDS.task, PHASE_CHAIN_IDS.review, PHASE_CHAIN_IDS.pr]) {
        expect(snapshot.nodes.find((candidate) => candidate.id === id)?.status).toBe('done');
      }

      await sse.waitForQuiet();

      // The row-emission hook fires synchronously per commit, well before `submit-event`'s own
      // response returns — every outcome-carrying `apply_event` row (as opposed to the separate
      // status-resync row `syncProjectedStatus` also commits) names its token via `params.event`.
      const outcomeTokens = sse.deltas
        .filter(
          (delta) =>
            isRecord(delta.data) &&
            delta.data.primitive === 'apply_event' &&
            isRecord(delta.data.params) &&
            typeof delta.data.params.event === 'string',
        )
        .map((delta) => (delta.data as { params: { event: string } }).params.event);
      expect(outcomeTokens).toEqual(['rad-orc:task.completed', 'rad-orc:code_review.reviewed', 'rad-orc:pr.created']);

      const engagedNodeIds = sse.deltas
        .filter((delta) => isRecord(delta.data) && delta.data.primitive === 'engage')
        .map((delta) => (delta.data as { params: { node: string } }).params.node);
      expect(engagedNodeIds).toEqual([PHASE_CHAIN_IDS.task, PHASE_CHAIN_IDS.review, PHASE_CHAIN_IDS.pr]);
    } finally {
      sse?.close();
    }
  });
});

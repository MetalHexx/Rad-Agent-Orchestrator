// graph-service/tests/functional/corrective-loop.test.ts
//
// Scenario 3: a `changes_requested` verdict — the same `rad-orc:code_review.reviewed` token, only
// `envelope.data.verdict` flipped; there is no distinct token — births an additive
// `rad-orc:corrective`, carrying the chain-tip scope contract forward; driving that corrective, then
// a follow-up `approved` verdict, converges the review to `done`.
//
// `add_corrective`'s own precondition only re-arms a `done`/`in_progress` review (never a
// `not_started` one), so the daemon's own faked capability ports are first let auto-resolve the
// review's very first cycle to `approved` — a throwaway intermediate state, never asserted on its
// own — purely to reach a review the client's own explicit `changes_requested` override may then
// reopen, exactly as a stakeholder re-flagging an already-approved review would.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BootedDaemon } from '../harness/boot.js';
import { bootDaemon } from '../harness/boot.js';
import { driveToQuiescence, frontier, node, seed, submitEvent } from '../harness/drive.js';
import type { SseCollector } from '../harness/sse.js';
import { connectSse } from '../harness/sse.js';
import { PHASE_CHAIN_IDS, phaseChainThroughReviewSeedSteps } from '../fixtures/phase-chain.js';

const CODE_REVIEW_REVIEWED_TOKEN = 'rad-orc:code_review.reviewed';
const TASK_COMPLETED_TOKEN = 'rad-orc:task.completed';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

describe('functional: corrective loop', () => {
  let daemon: BootedDaemon;

  beforeEach(async () => {
    daemon = await bootDaemon();
  });

  afterEach(async () => {
    await daemon.teardown();
  });

  it('mints an additive corrective with the chain-tip scope contract carried forward, then a follow-up approved verdict converges the review', async () => {
    const project = 'corrective-loop';
    await seed(daemon.baseUrl(), project, phaseChainThroughReviewSeedSteps());

    await driveToQuiescence(daemon.baseUrl(), project);
    expect((await node(daemon.baseUrl(), project, PHASE_CHAIN_IDS.review)).status).toBe('done');

    let sse: SseCollector | undefined;
    try {
      // Connected after the throwaway auto-resolved cycle, so the stream carries exactly the
      // corrective-mint sequence this scenario is about: the client's own `changes_requested`
      // verdict, the corrective's mint + completion, and the follow-up `approved` verdict.
      sse = await connectSse(`${daemon.baseUrl()}/engine-graph/stream?project=${project}`);

      await submitEvent(daemon.baseUrl(), project, PHASE_CHAIN_IDS.review, {
        event: CODE_REVIEW_REVIEWED_TOKEN,
        payload: {
          outcome: 'ok',
          data: { verdict: 'changes_requested', severity: 'medium', correctiveIndex: 1, reviewReportPath: 'reviews/review-1.md' },
        },
      });

      const correctiveId = `${PHASE_CHAIN_IDS.review}-corrective-1`;
      const corrective = await node(daemon.baseUrl(), project, correctiveId);
      expect(corrective.type).toBe('rad-orc:corrective');
      expect(corrective.derivedFrom).toBe(PHASE_CHAIN_IDS.task);
      expect(corrective.parent).toBe(PHASE_CHAIN_IDS.phase);
      // The chain-tip scope contract (handoff doc, repos, complexity, commit directive) carried
      // forward from `task-1`, the review's own chain tip — never re-invented by the corrective.
      expect(corrective.data).toMatchObject({
        handoffDocPath: '/tasks/task-1.md',
        complexity: 'standard',
        shouldCommit: true,
      });

      const reopenedReview = await node(daemon.baseUrl(), project, PHASE_CHAIN_IDS.review);
      expect(reopenedReview.status).toBe('not_started');
      expect(reopenedReview.data.verdict).toBe('changes_requested');

      const { steps } = await driveToQuiescence(daemon.baseUrl(), project);
      expect(steps).toBeGreaterThan(0);

      const finalCorrective = await node(daemon.baseUrl(), project, correctiveId);
      expect(finalCorrective.status).toBe('done');
      const finalReview = await node(daemon.baseUrl(), project, PHASE_CHAIN_IDS.review);
      expect(finalReview.status).toBe('done');
      expect(finalReview.data.verdict).toBe('approved');

      expect(await frontier(daemon.baseUrl(), project)).toEqual([]);

      await sse.waitForQuiet();

      // The mint itself: the engine's own `add_corrective` primitive, births `correctiveId` gating
      // `review-1`.
      const mintDeltas = sse.deltas.filter((delta) => isRecord(delta.data) && delta.data.primitive === 'add_corrective');
      expect(mintDeltas).toHaveLength(1);
      expect(mintDeltas[0].data).toMatchObject({ params: { id: correctiveId, review: PHASE_CHAIN_IDS.review } });

      // The ordered outcome sequence: the client's own `changes_requested` verdict, the
      // corrective's own completion, then the follow-up `approved` verdict — the same
      // `params.event`-carrying filter `happy-path.test.ts` uses, excluding the separate
      // status-resync rows `syncProjectedStatus` also commits.
      const outcomeTokens = sse.deltas
        .filter(
          (delta) =>
            isRecord(delta.data) &&
            delta.data.primitive === 'apply_event' &&
            isRecord(delta.data.params) &&
            typeof delta.data.params.event === 'string',
        )
        .map((delta) => (delta.data as { params: { event: string } }).params.event);
      expect(outcomeTokens).toEqual([CODE_REVIEW_REVIEWED_TOKEN, TASK_COMPLETED_TOKEN, CODE_REVIEW_REVIEWED_TOKEN]);

      // The corrective is engaged first (born already frontier-eligible), then the review once
      // more — its own reopening (`add_corrective`'s reset to `not_started`) is a data patch, not
      // itself an `engage`; the review only re-enters the frontier, and gets engaged, once its
      // gating corrective reaches `done`.
      const engagedNodeIds = sse.deltas
        .filter((delta) => isRecord(delta.data) && delta.data.primitive === 'engage')
        .map((delta) => (delta.data as { params: { node: string } }).params.node);
      expect(engagedNodeIds).toEqual([correctiveId, PHASE_CHAIN_IDS.review]);
    } finally {
      sse?.close();
    }
  });
});

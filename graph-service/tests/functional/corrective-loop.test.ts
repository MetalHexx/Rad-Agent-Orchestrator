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
import { PHASE_CHAIN_IDS, phaseChainThroughReviewSeedSteps } from '../fixtures/phase-chain.js';

const CODE_REVIEW_REVIEWED_TOKEN = 'rad-orc:code_review.reviewed';

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
  });
});

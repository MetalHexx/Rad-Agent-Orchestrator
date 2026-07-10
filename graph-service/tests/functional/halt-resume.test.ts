// graph-service/tests/functional/halt-resume.test.ts
//
// Scenario 4: a `rejected` verdict halts the review recoverably (`blocked`, frontier-excluded — not
// a thrown error). The daemon is then killed mid-run (no graceful shutdown) and reopened on the
// same on-disk SQLite file: the persisted graph state is byte-identical across that boundary. A
// `steer resume` re-arms the halted review, and driving it to quiescence converges it to `done`.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BootedDaemon } from '../harness/boot.js';
import { bootDaemon } from '../harness/boot.js';
import { dag, driveToQuiescence, frontier, node, seed, steer, submitEvent } from '../harness/drive.js';
import { PHASE_CHAIN_IDS, phaseChainThroughReviewSeedSteps } from '../fixtures/phase-chain.js';

const CODE_REVIEW_REVIEWED_TOKEN = 'rad-orc:code_review.reviewed';

describe('functional: halt -> resume + restart durability', () => {
  let daemon: BootedDaemon;

  beforeEach(async () => {
    daemon = await bootDaemon();
  });

  afterEach(async () => {
    await daemon.teardown();
  });

  it('halts recoverably, survives a hard kill + reopen on the same DB file with byte-identical state, then resumes to done', async () => {
    const project = 'halt-resume';
    await seed(daemon.baseUrl(), project, phaseChainThroughReviewSeedSteps());

    // A throwaway intermediate cycle (same rationale as the corrective-loop scenario): the daemon's
    // own faked capability ports auto-resolve the review's first cycle to `approved`, so the
    // client's own explicit `rejected` override below has a `done`/`in_progress` review to reopen.
    await driveToQuiescence(daemon.baseUrl(), project);

    await submitEvent(daemon.baseUrl(), project, PHASE_CHAIN_IDS.review, {
      event: CODE_REVIEW_REVIEWED_TOKEN,
      payload: { outcome: 'ok', data: { verdict: 'rejected', severity: 'high' } },
    });

    const halted = await node(daemon.baseUrl(), project, PHASE_CHAIN_IDS.review);
    expect(halted.status).toBe('blocked');

    const eligibleWhileHalted = await frontier(daemon.baseUrl(), project);
    expect(eligibleWhileHalted.map((candidate) => candidate.id)).not.toContain(PHASE_CHAIN_IDS.review);

    const beforeKill = await dag(daemon.baseUrl(), project);

    await daemon.restart(); // a hard kill (no graceful SIGINT/SIGTERM handshake) + a fresh `compose()` reopening the same on-disk SQLite file

    const afterRestart = await dag(daemon.baseUrl(), project);
    expect(afterRestart).toEqual(beforeKill);

    await steer(daemon.baseUrl(), project, 'resume', { node: PHASE_CHAIN_IDS.review });
    expect((await node(daemon.baseUrl(), project, PHASE_CHAIN_IDS.review)).status).toBe('not_started');

    const { steps } = await driveToQuiescence(daemon.baseUrl(), project);
    expect(steps).toBeGreaterThan(0);

    const finalReview = await node(daemon.baseUrl(), project, PHASE_CHAIN_IDS.review);
    expect(finalReview.status).toBe('done');
    expect(finalReview.data.verdict).toBe('approved');
  });
});

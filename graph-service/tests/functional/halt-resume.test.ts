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
import type { SseCollector } from '../harness/sse.js';
import { connectSse } from '../harness/sse.js';
import { PHASE_CHAIN_IDS, REVIEW_REPORT_PATH, phaseChainThroughReviewSeedSteps, reviewReportDoc } from '../fixtures/phase-chain.js';

const CODE_REVIEW_REVIEWED_TOKEN = 'rad-orc:code_review.reviewed';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function outcomeTokensOf(sse: SseCollector): readonly string[] {
  return sse.deltas
    .filter(
      (delta) =>
        isRecord(delta.data) &&
        delta.data.primitive === 'apply_event' &&
        isRecord(delta.data.params) &&
        typeof delta.data.params.event === 'string',
    )
    .map((delta) => (delta.data as { params: { event: string } }).params.event);
}

describe('functional: halt -> resume + restart durability', () => {
  let daemon: BootedDaemon;

  beforeEach(async () => {
    daemon = await bootDaemon();
  });

  afterEach(async () => {
    await daemon.teardown();
  });

  // This scenario is the one functional test that pays for a full daemon restart plus two
  // `driveToQuiescence` cycles and two SSE `waitForQuiet` windows in sequence — it ran at
  // 4.8s/5s (vitest's default `testTimeout`) even in a clean CI run, so it flaked under any
  // extra runner load. The other functional tests stay well under a second; only this one
  // needs the wider budget.
  it('halts recoverably, survives a hard kill + reopen on the same DB file with byte-identical state, then resumes to done', async () => {
    const project = 'halt-resume';
    await seed(daemon.baseUrl(), project, phaseChainThroughReviewSeedSteps());
    // The service reads the review verdict off its report — stage an approved one for the auto-resolve.
    daemon.seedDoc(REVIEW_REPORT_PATH, reviewReportDoc('approved', 'none'));

    // A throwaway intermediate cycle (same rationale as the corrective-loop scenario): the daemon's
    // own faked capability ports auto-resolve the review's first cycle to `approved`, so the
    // client's own explicit `rejected` override below has a `done`/`in_progress` review to reopen.
    await driveToQuiescence(daemon.baseUrl(), project);

    // Connected after the throwaway auto-resolved cycle, so the stream carries exactly the
    // explicit `rejected` halt this scenario is about.
    let preHaltSse: SseCollector | undefined;
    try {
      preHaltSse = await connectSse(`${daemon.baseUrl()}/engine-graph/stream?project=${project}`);

      await submitEvent(daemon.baseUrl(), project, PHASE_CHAIN_IDS.review, {
        event: CODE_REVIEW_REVIEWED_TOKEN,
        payload: { outcome: 'ok', data: { verdict: 'rejected', severity: 'high' } },
      });

      const halted = await node(daemon.baseUrl(), project, PHASE_CHAIN_IDS.review);
      expect(halted.status).toBe('blocked');

      const eligibleWhileHalted = await frontier(daemon.baseUrl(), project);
      expect(eligibleWhileHalted.map((candidate) => candidate.id)).not.toContain(PHASE_CHAIN_IDS.review);

      await preHaltSse.waitForQuiet();
      expect(outcomeTokensOf(preHaltSse)).toEqual([CODE_REVIEW_REVIEWED_TOKEN]);
    } finally {
      // The socket dies with the kill below regardless — closed explicitly ahead of that so
      // teardown is deliberate rather than incidental.
      preHaltSse?.close();
    }

    const beforeKill = await dag(daemon.baseUrl(), project);

    await daemon.restart(); // a hard kill (no graceful SIGINT/SIGTERM handshake) + a fresh `compose()` reopening the same on-disk SQLite file
    // The faked docRead is in-memory, lost with the killed process — restage the report the resumed review re-reads.
    daemon.seedDoc(REVIEW_REPORT_PATH, reviewReportDoc('approved', 'none'));

    const afterRestart = await dag(daemon.baseUrl(), project);
    expect(afterRestart).toEqual(beforeKill);

    await steer(daemon.baseUrl(), project, 'resume', { node: PHASE_CHAIN_IDS.review });
    expect((await node(daemon.baseUrl(), project, PHASE_CHAIN_IDS.review)).status).toBe('not_started');

    // A fresh connection is unavoidable here — the pre-kill socket died with the daemon — so this
    // proves the SSE path itself survives a restart, not merely that the same connection persists.
    let postResumeSse: SseCollector | undefined;
    try {
      postResumeSse = await connectSse(`${daemon.baseUrl()}/engine-graph/stream?project=${project}`);

      const { steps } = await driveToQuiescence(daemon.baseUrl(), project);
      expect(steps).toBeGreaterThan(0);

      const finalReview = await node(daemon.baseUrl(), project, PHASE_CHAIN_IDS.review);
      expect(finalReview.status).toBe('done');
      expect(finalReview.data.verdict).toBe('approved');

      await postResumeSse.waitForQuiet();
      expect(outcomeTokensOf(postResumeSse)).toEqual([CODE_REVIEW_REVIEWED_TOKEN]);
    } finally {
      postResumeSse?.close();
    }
  }, 15_000);
});

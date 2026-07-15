// graph-service/tests/functional/parallel-frontier.test.ts
//
// Scenario 2: two sibling tasks with no dependency between them prove the parallel-native model
// over the wire — both are simultaneously frontier-eligible while both are still `not_started`
// (i.e. before either has even engaged, let alone completed), and driving them concurrently over
// HTTP never trips a would-be single-active-node lock; both independently converge to `done`. The
// SSE stream is asserted too: both siblings' `engage` and `rad-orc:task.completed` deltas must
// arrive, in either order — the concurrent drive never guarantees which sibling settles first.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BootedDaemon } from '../harness/boot.js';
import { bootDaemon } from '../harness/boot.js';
import { addWorktree, dag, frontier, seed, submitEvent } from '../harness/drive.js';
import type { SseCollector } from '../harness/sse.js';
import { connectSse } from '../harness/sse.js';
import { PARALLEL_TASK_IDS, parallelTasksSeedSteps } from '../fixtures/parallel-tasks.js';

const TASK_COMPLETED_EVENT = {
  event: 'rad-orc:task.completed',
  payload: { outcome: 'ok' as const, data: { results: [{ name: 'rad-orc-source', committed: true, commitHash: 'abc123', pushed: true }] } },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

describe('functional: parallel frontier', () => {
  let daemon: BootedDaemon;

  beforeEach(async () => {
    daemon = await bootDaemon();
  });

  afterEach(async () => {
    await daemon.teardown();
  });

  it('both siblings are simultaneously frontier-eligible before either completes, then both independently reach done', async () => {
    const project = 'parallel-frontier';
    await seed(daemon.baseUrl(), project, parallelTasksSeedSteps());
    await addWorktree(daemon.baseUrl(), project, 'rad-orc-source');

    const eligible = await frontier(daemon.baseUrl(), project);
    expect(eligible.map((candidate) => candidate.id).sort()).toEqual([PARALLEL_TASK_IDS.a, PARALLEL_TASK_IDS.b].sort());
    // Both are simultaneously eligible while both are still `not_started` — neither has been
    // engaged (let alone completed) yet, so nothing here could ever have serialized them.
    for (const candidate of eligible) expect(candidate.status).toBe('not_started');

    let sse: SseCollector | undefined;
    try {
      sse = await connectSse(`${daemon.baseUrl()}/engine-graph/stream?project=${project}`);

      // Drive both without sequentially awaiting one before starting the other — over the wire,
      // neither request needs to wait on the other's completion. `rad-orc:task`'s executor is
      // `spawn-sub-agent`, never `noop`, so the drive loop only engages-and-stops each sibling on
      // the first call; the second relays its completion explicitly, as a real orchestrator would.
      await Promise.all([
        submitEvent(daemon.baseUrl(), project, PARALLEL_TASK_IDS.a),
        submitEvent(daemon.baseUrl(), project, PARALLEL_TASK_IDS.b),
      ]);
      await Promise.all([
        submitEvent(daemon.baseUrl(), project, PARALLEL_TASK_IDS.a, TASK_COMPLETED_EVENT),
        submitEvent(daemon.baseUrl(), project, PARALLEL_TASK_IDS.b, TASK_COMPLETED_EVENT),
      ]);

      const snapshot = await dag(daemon.baseUrl(), project);
      expect(snapshot.nodes.find((candidate) => candidate.id === PARALLEL_TASK_IDS.a)?.status).toBe('done');
      expect(snapshot.nodes.find((candidate) => candidate.id === PARALLEL_TASK_IDS.b)?.status).toBe('done');
      expect(snapshot.status).toBe('done');
      expect(await frontier(daemon.baseUrl(), project)).toEqual([]);

      await sse.waitForQuiet();

      // Both siblings' `engage` deltas must have arrived — order is whichever the concurrent
      // drive happened to settle, never asserted here.
      const engagedNodeIds = sse.deltas
        .filter((delta) => isRecord(delta.data) && delta.data.primitive === 'engage')
        .map((delta) => (delta.data as { params: { node: string } }).params.node);
      expect(engagedNodeIds.slice().sort()).toEqual([PARALLEL_TASK_IDS.a, PARALLEL_TASK_IDS.b].sort());

      // Both siblings' completion outcomes must have arrived on the stream too.
      const completedNodeIds = sse.deltas
        .filter(
          (delta) =>
            isRecord(delta.data) &&
            delta.data.primitive === 'apply_event' &&
            isRecord(delta.data.params) &&
            delta.data.params.event === 'rad-orc:task.completed',
        )
        .map((delta) => (delta.data as { params: { node: string } }).params.node);
      expect(completedNodeIds.slice().sort()).toEqual([PARALLEL_TASK_IDS.a, PARALLEL_TASK_IDS.b].sort());
    } finally {
      sse?.close();
    }
  });
});

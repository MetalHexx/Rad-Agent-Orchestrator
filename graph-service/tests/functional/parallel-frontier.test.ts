// graph-service/tests/functional/parallel-frontier.test.ts
//
// Scenario 2: two sibling tasks with no dependency between them prove the parallel-native model
// over the wire — both are simultaneously frontier-eligible while both are still `not_started`
// (i.e. before either has even engaged, let alone completed), and driving them concurrently over
// HTTP never trips a would-be single-active-node lock; both independently converge to `done`.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BootedDaemon } from '../harness/boot.js';
import { bootDaemon } from '../harness/boot.js';
import { dag, frontier, seed, submitEvent } from '../harness/drive.js';
import { PARALLEL_TASK_IDS, parallelTasksSeedSteps } from '../fixtures/parallel-tasks.js';

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

    const eligible = await frontier(daemon.baseUrl(), project);
    expect(eligible.map((candidate) => candidate.id).sort()).toEqual([PARALLEL_TASK_IDS.a, PARALLEL_TASK_IDS.b].sort());
    // Both are simultaneously eligible while both are still `not_started` — neither has been
    // engaged (let alone completed) yet, so nothing here could ever have serialized them.
    for (const candidate of eligible) expect(candidate.status).toBe('not_started');

    // Drive both without sequentially awaiting one before starting the other — over the wire,
    // neither request needs to wait on the other's completion.
    await Promise.all([
      submitEvent(daemon.baseUrl(), project, PARALLEL_TASK_IDS.a),
      submitEvent(daemon.baseUrl(), project, PARALLEL_TASK_IDS.b),
    ]);

    const snapshot = await dag(daemon.baseUrl(), project);
    expect(snapshot.nodes.find((candidate) => candidate.id === PARALLEL_TASK_IDS.a)?.status).toBe('done');
    expect(snapshot.nodes.find((candidate) => candidate.id === PARALLEL_TASK_IDS.b)?.status).toBe('done');
    expect(snapshot.status).toBe('done');
    expect(await frontier(daemon.baseUrl(), project)).toEqual([]);
  });
});

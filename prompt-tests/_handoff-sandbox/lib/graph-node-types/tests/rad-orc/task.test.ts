import { describe, expect, it } from 'vitest';
import type { AgentSpawnRequest } from '@rad-orchestration/graph-engine';
import { TASK_COMPLETED_TOKEN, TASK_NODE_TYPE } from '../../src/rad-orc/task.js';

const SEEDED_DATA = {
  handoffDocPath: '/project/tasks/EXAMPLE-TASK-P04-T04.md',
  repos: [{ name: 'rad-orc-source', path: '/repos/rad-orc-source', branch: 'radorch/STEERABLE-DAG-1' }],
  complexity: 'complex' as const,
  shouldCommit: true,
};

describe('rad-orc:task', () => {
  it('declares a spawn-sub-agent executor and doc-read/git-facts/spawn-agent capabilities', () => {
    expect(TASK_NODE_TYPE.name).toBe('rad-orc:task');
    expect(TASK_NODE_TYPE.traits).toEqual([]);
    expect(TASK_NODE_TYPE.capabilities).toEqual(['doc-read', 'git-facts', 'spawn-agent']);
  });

  it("act.payload matches the frozen coder AgentSpawnRequest shape", () => {
    const result = TASK_NODE_TYPE.act({ nodeId: 'task-1', data: SEEDED_DATA });
    expect(result.executor).toBe('spawn-sub-agent');
    const payload = result.payload as AgentSpawnRequest;
    expect(payload).toEqual({
      kind: 'coder',
      handoffDoc: SEEDED_DATA.handoffDocPath,
      complexity: 'complex',
      repos: SEEDED_DATA.repos,
      shouldCommit: true,
      reviewReportPath: undefined,
    });
  });

  it('act carries reviewReportPath through when seeded (a task already gated behind an open review)', () => {
    const result = TASK_NODE_TYPE.act({
      nodeId: 'task-1',
      data: { ...SEEDED_DATA, reviewReportPath: '/project/reviews/P04-T04.md' },
    });
    const payload = result.payload as AgentSpawnRequest;
    expect(payload.reviewReportPath).toBe('/project/reviews/P04-T04.md');
  });

  it('defaults complexity to standard when unseeded or unrecognized', () => {
    const result = TASK_NODE_TYPE.act({ nodeId: 'task-1', data: { ...SEEDED_DATA, complexity: 'bogus' } });
    expect((result.payload as AgentSpawnRequest).complexity).toBe('standard');
  });

  it('handle records the coder\'s per-repo commit results on rad-orc:task.completed', () => {
    const results = [{ name: 'rad-orc-source', committed: true, commitHash: 'a1b2c3d', pushed: true }];
    const result = TASK_NODE_TYPE.handle({
      token: TASK_COMPLETED_TOKEN,
      nodeId: 'task-1',
      envelope: { outcome: 'ok', data: { results } },
    });
    expect(result).toEqual({ dataChange: { completed: true, results } });
  });

  it('handle ignores an unrelated token or an error outcome', () => {
    expect(
      TASK_NODE_TYPE.handle({ token: 'rad-orc:task.other', nodeId: 'task-1', envelope: { outcome: 'ok', data: {} } }),
    ).toEqual({});
    expect(
      TASK_NODE_TYPE.handle({ token: TASK_COMPLETED_TOKEN, nodeId: 'task-1', envelope: { outcome: 'error', data: {} } }),
    ).toEqual({});
  });

  it('projectStatus: done once completed, not_started otherwise', () => {
    expect(TASK_NODE_TYPE.projectStatus({})).toBe('not_started');
    expect(TASK_NODE_TYPE.projectStatus({ completed: true })).toBe('done');
  });
});

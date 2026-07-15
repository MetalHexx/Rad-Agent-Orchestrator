import { describe, expect, it } from 'vitest';
import type { SpawnPayload } from '@rad-orchestration/graph-engine';
import { TASK_COMPLETED_TOKEN, TASK_DATA_SCHEMA, TASK_NODE_TYPE } from '../../src/rad-orc/task.js';

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

  it('carries exactly one instruction pointing at the rad-execute-coding-task skill, and act returns no instructions key', () => {
    expect(TASK_NODE_TYPE.instructions).toContain('rad-execute-coding-task');
    const result = TASK_NODE_TYPE.act({ nodeId: 'task-1', data: SEEDED_DATA, nodes: [], edges: [] });
    expect(result).not.toHaveProperty('instructions');
  });

  it("act.payload matches the frozen spawn contract's key names, with no `kind` field", () => {
    const result = TASK_NODE_TYPE.act({ nodeId: 'task-1', data: SEEDED_DATA, nodes: [], edges: [] });
    expect(result.executor).toBe('spawn-sub-agent');
    const payload = result.payload as SpawnPayload;
    expect(payload).toEqual({
      agent: 'coder',
      handoff_doc: SEEDED_DATA.handoffDocPath,
      repos: SEEDED_DATA.repos,
      should_commit: true,
    });
    expect(payload).not.toHaveProperty('kind');
    expect(payload).not.toHaveProperty('review_report_path');
  });

  it('act carries review_report_path through when seeded, rather than omitting or nulling it', () => {
    const result = TASK_NODE_TYPE.act({
      nodeId: 'task-1',
      data: { ...SEEDED_DATA, reviewReportPath: '/project/reviews/P04-T04.md' },
      nodes: [],
      edges: [],
    });
    const payload = result.payload as SpawnPayload;
    expect(payload.review_report_path).toBe('/project/reviews/P04-T04.md');
  });

  it('act omits review_report_path entirely (never null) when the node carries none', () => {
    const result = TASK_NODE_TYPE.act({ nodeId: 'task-1', data: SEEDED_DATA, nodes: [], edges: [] });
    const payload = result.payload as SpawnPayload;
    expect('review_report_path' in payload).toBe(false);
  });

  it.each([
    ['simple', 'coder-junior'],
    ['standard', 'coder'],
    ['complex', 'coder'],
  ] as const)('resolves the %s complexity tier to agent %s, never escalating a first dispatch', (complexity, agent) => {
    const result = TASK_NODE_TYPE.act({ nodeId: 'task-1', data: { ...SEEDED_DATA, complexity }, nodes: [], edges: [] });
    expect((result.payload as SpawnPayload).agent).toBe(agent);
  });

  it('defaults complexity to standard when unseeded or unrecognized', () => {
    const result = TASK_NODE_TYPE.act({ nodeId: 'task-1', data: { ...SEEDED_DATA, complexity: 'bogus' }, nodes: [], edges: [] });
    expect((result.payload as SpawnPayload).agent).toBe('coder');
  });

  it('never escalates even if a correctiveIndex somehow sits on a first dispatch\'s own data', () => {
    const result = TASK_NODE_TYPE.act({
      nodeId: 'task-1',
      data: { ...SEEDED_DATA, complexity: 'simple' as const, correctiveIndex: 5, maxRetries: 5 },
      nodes: [],
      edges: [],
    });
    expect((result.payload as SpawnPayload).agent).toBe('coder-junior');
  });

  it('declares resolve hints on repos, handoffDocPath, and reviewReportPath', () => {
    expect(TASK_DATA_SCHEMA.repos.resolve).toBe('worktree-repo-set');
    expect(TASK_DATA_SCHEMA.handoffDocPath.resolve).toBe('project-doc-path');
    expect(TASK_DATA_SCHEMA.reviewReportPath.resolve).toBe('project-doc-path');
  });

  it('declares the task.completed payload schema', () => {
    expect(TASK_NODE_TYPE.completionPayloadSchema).toEqual([
      { name: 'repos', flag: false },
      { name: 'branch', flag: true },
    ]);
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

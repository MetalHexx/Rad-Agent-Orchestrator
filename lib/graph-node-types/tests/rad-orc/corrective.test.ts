import { describe, expect, it } from 'vitest';
import type { SpawnPayload } from '@rad-orchestration/graph-engine';
import {
  InMemoryStateStore,
  ROOT_NODE_ID,
  add_corrective,
} from '@rad-orchestration/graph-engine';
import type { DagNode, PrimitiveContext, ProjectScope } from '@rad-orchestration/graph-engine';
import { TASK_COMPLETED_TOKEN } from '../../src/rad-orc/task.js';
import { CORRECTIVE_DATA_SCHEMA, CORRECTIVE_NODE_TYPE } from '../../src/rad-orc/corrective.js';

const SEEDED_DATA = {
  handoffDocPath: '/project/tasks/EXAMPLE-TASK-P04-T04.md',
  repos: [{ name: 'rad-orc-source', path: '/repos/rad-orc-source', branch: 'radorch/STEERABLE-DAG-1' }],
  complexity: 'standard' as const,
  shouldCommit: true,
  reviewReportPath: '/project/reviews/P04-T04.md',
  correctiveIndex: 1,
};

describe('rad-orc:corrective', () => {
  it('declares a spawn-sub-agent executor and doc-read/git-facts/spawn-agent capabilities', () => {
    expect(CORRECTIVE_NODE_TYPE.name).toBe('rad-orc:corrective');
    expect(CORRECTIVE_NODE_TYPE.traits).toEqual([]);
    expect(CORRECTIVE_NODE_TYPE.capabilities).toEqual(['doc-read', 'git-facts', 'spawn-agent']);
  });

  it('carries exactly one instruction pointing at the rad-execute-coding-task skill, and act returns no instructions key', () => {
    expect(CORRECTIVE_NODE_TYPE.instructions).toContain('rad-execute-coding-task');
    const result = CORRECTIVE_NODE_TYPE.act({ nodeId: 'task-1-corrective-1', data: SEEDED_DATA, nodes: [], edges: [] });
    expect(result).not.toHaveProperty('instructions');
  });

  it('act.payload carries the same scope contract plus review_report_path and corrective_index, with no `kind` field', () => {
    const result = CORRECTIVE_NODE_TYPE.act({ nodeId: 'task-1-corrective-1', data: SEEDED_DATA, nodes: [], edges: [] });
    expect(result.executor).toBe('spawn-sub-agent');
    const payload = result.payload as SpawnPayload;
    expect(payload).toEqual({
      agent: 'coder',
      handoff_doc: SEEDED_DATA.handoffDocPath,
      repos: SEEDED_DATA.repos,
      should_commit: true,
      review_report_path: SEEDED_DATA.reviewReportPath,
      corrective_index: 1,
    });
    expect(payload).not.toHaveProperty('kind');
  });

  it('escalates to coder-senior at the budget edge, reading maxRetries off its own data', () => {
    const result = CORRECTIVE_NODE_TYPE.act({
      nodeId: 'task-1-corrective-4',
      data: { ...SEEDED_DATA, complexity: 'simple' as const, correctiveIndex: 4, maxRetries: 5 },
      nodes: [],
      edges: [],
    });
    expect((result.payload as SpawnPayload).agent).toBe('coder-senior');
  });

  it('stays at base tier with plenty of budget remaining', () => {
    const result = CORRECTIVE_NODE_TYPE.act({
      nodeId: 'task-1-corrective-1',
      data: { ...SEEDED_DATA, complexity: 'simple' as const, correctiveIndex: 1, maxRetries: 5 },
      nodes: [],
      edges: [],
    });
    expect((result.payload as SpawnPayload).agent).toBe('coder-junior');
  });

  it('declares resolve hints on repos, handoffDocPath, and reviewReportPath, and declares maxRetries as computed', () => {
    expect(CORRECTIVE_DATA_SCHEMA.repos.resolve).toBe('worktree-repo-set');
    expect(CORRECTIVE_DATA_SCHEMA.handoffDocPath.resolve).toBe('project-doc-path');
    expect(CORRECTIVE_DATA_SCHEMA.reviewReportPath.resolve).toBe('project-doc-path');
    expect(CORRECTIVE_DATA_SCHEMA.reviewReportPath.level).toBe('required');
    expect(CORRECTIVE_DATA_SCHEMA.maxRetries).toEqual({
      kind: 'number',
      level: 'computed',
      description: CORRECTIVE_DATA_SCHEMA.maxRetries.description,
    });
  });

  it('declares the task.completed payload schema', () => {
    expect(CORRECTIVE_NODE_TYPE.completionPayloadSchema).toEqual([
      { name: 'repos', flag: false },
      { name: 'branch', flag: true },
    ]);
  });

  it("handle records the coder's per-repo commit results on the same rad-orc:task.completed contract a task uses", () => {
    const results = [{ name: 'rad-orc-source', committed: true, commitHash: 'e4f5a6b', pushed: true }];
    const result = CORRECTIVE_NODE_TYPE.handle({
      token: TASK_COMPLETED_TOKEN,
      nodeId: 'task-1-corrective-1',
      envelope: { outcome: 'ok', data: { results } },
    });
    expect(result).toEqual({ dataChange: { completed: true, results } });
  });

  it('handle ignores an unrelated token or an error outcome', () => {
    expect(
      CORRECTIVE_NODE_TYPE.handle({ token: 'rad-orc:corrective.other', nodeId: 'c-1', envelope: { outcome: 'ok', data: {} } }),
    ).toEqual({});
    expect(
      CORRECTIVE_NODE_TYPE.handle({ token: TASK_COMPLETED_TOKEN, nodeId: 'c-1', envelope: { outcome: 'error', data: {} } }),
    ).toEqual({});
  });

  it('projectStatus: done once completed, not_started otherwise', () => {
    expect(CORRECTIVE_NODE_TYPE.projectStatus({})).toBe('not_started');
    expect(CORRECTIVE_NODE_TYPE.projectStatus({ completed: true })).toBe('done');
  });

  it("is born additive by the engine's own add_corrective — derivedFrom the prior attempt, review re-armed", () => {
    function scope(projectId: string): ProjectScope {
      return { projectId };
    }
    function ctxFor(projectId: string): PrimitiveContext {
      return { store: new InMemoryStateStore(), scope: scope(projectId) };
    }
    function node(id: string, overrides: Partial<DagNode> = {}): DagNode {
      return { id, type: 'rad-orc:task', status: 'not_started', parent: ROOT_NODE_ID, order: 0, derivedFrom: null, data: {}, ...overrides };
    }

    const ctx = ctxFor('proj-a');
    const seedResult = ctx.store.apply(ctx.scope, {
      primitive: 'add_node',
      params: {},
      nodeChanges: [
        { op: 'created', before: null, after: node('phase-1') },
        { op: 'created', before: null, after: node('task-a', { parent: 'phase-1', status: 'done' }) },
        { op: 'created', before: null, after: node('review', { type: 'rad-orc:code_review', status: 'done' }) },
      ],
      edgeChanges: [{ op: 'created', before: null, after: { from: 'task-a', to: 'review', kind: 'depends_on' } }],
    });
    if (!seedResult.ok) throw new Error('seed failed');

    const result = add_corrective(ctx, 'review-corrective-1', CORRECTIVE_NODE_TYPE.name, 'review', {
      data: { ...SEEDED_DATA },
    });

    expect(result.ok).toBe(true);
    const corrective = ctx.store.getNode(ctx.scope, 'review-corrective-1');
    expect(corrective?.type).toBe('rad-orc:corrective');
    expect(corrective?.derivedFrom).toBe('task-a');
    expect(corrective?.parent).toBe('phase-1');
    expect(corrective?.data).toEqual({ ...SEEDED_DATA, maxRetries: 5 });
    expect(ctx.store.getNode(ctx.scope, 'review')?.status).toBe('not_started');
  });
});

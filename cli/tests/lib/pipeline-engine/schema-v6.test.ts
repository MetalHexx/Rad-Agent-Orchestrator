import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { validateStateSchema } from '../../../src/lib/pipeline-engine/schema-validator.js';
import { makeV6State } from '../../helpers/state-factory.js';

describe('state schema v6 (FR-9, FR-10, NFR-4)', () => {
  it('accepts a task iteration entry with a per-repo repos array', () => {
    const state = makeV6State({ taskRepos: [{ name: 'backend', commit_hash: null }] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(validateStateSchema(state as any)).toEqual([]);
  });
  it('tolerates a blank repo name (NFR-4)', () => {
    const state = makeV6State({ taskRepos: [{ name: '', commit_hash: 'abc1234' }] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(validateStateSchema(state as any)).toEqual([]);
  });
  it('rejects an entry that still carries the removed commit_hash scalar', () => {
    const state = makeV6State({ taskRepos: [{ name: 'backend', commit_hash: null }] }) as Record<string, unknown>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const phaseLoop = (state.graph as any).nodes.phase_loop;
    const taskEntry = phaseLoop.iterations[0].nodes.task_loop.iterations[0];
    delete taskEntry.repos;
    taskEntry.commit_hash = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(validateStateSchema(state as any).length).toBeGreaterThan(0);
  });
  it('deletes the duplicated skill-tree schema copies (FR-13)', () => {
    const skillSchemas = path.resolve(__dirname, '../../../../harness-files/skills/rad-orchestration/schemas');
    expect(fs.existsSync(path.join(skillSchemas, 'orchestration-state-v5.schema.json'))).toBe(false);
    expect(fs.existsSync(path.join(skillSchemas, 'legacy', 'state-v4.schema.json'))).toBe(false);
  });
});

describe('StepNodeState corrective hosting fields (P01-T01)', () => {
  function makeFinalReviewState(stepExtra: Record<string, unknown>): Record<string, unknown> {
    const state = makeV6State({ taskRepos: [] }) as Record<string, unknown>;
    const graph = state.graph as Record<string, unknown>;
    const nodes = graph.nodes as Record<string, unknown>;
    nodes.final_review = {
      kind: 'step',
      status: 'not_started',
      doc_path: null,
      retries: 0,
      ...stepExtra,
    };
    return state;
  }

  it('accepts a final_review step with both fields absent (pre-change shape, unchanged)', () => {
    const state = makeFinalReviewState({});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(validateStateSchema(state as any)).toEqual([]);
  });

  it('accepts a final_review step carrying corrective_tasks: [] and corrective_budget_origin: 0', () => {
    const state = makeFinalReviewState({ corrective_tasks: [], corrective_budget_origin: 0 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(validateStateSchema(state as any)).toEqual([]);
  });

  it('accepts a final_review step carrying only corrective_tasks (corrective_budget_origin absent)', () => {
    const state = makeFinalReviewState({ corrective_tasks: [] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(validateStateSchema(state as any)).toEqual([]);
  });

  it('rejects an undeclared sibling property on StepNodeState (closed-object premise)', () => {
    const state = makeFinalReviewState({ not_a_real_field: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(validateStateSchema(state as any).length).toBeGreaterThan(0);
  });
});

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { getMutation } from '../../../../src/lib/pipeline-engine/mutations.js';
import { validateState } from '../../../../src/lib/pipeline-engine/validator.js';
import { useRealCatalog } from '../helpers/catalog.js';
import type { PipelineState, OrchestrationConfig, PipelineTemplate, EventContext } from '../../../../src/lib/pipeline-engine/types.js';

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });
beforeEach(() => { cleanups.push(useRealCatalog()); });

const cfg = { limits: { max_retries_per_task: 3, max_consecutive_review_rejections: 3 } } as unknown as OrchestrationConfig;
const tmpl = { id: '', version: '', description: '', nodes: [] } as unknown as PipelineTemplate;

function projectGraph2State(): PipelineState {
  const completedTask = (hash: string | null) => ({
    index: 0, status: 'completed', doc_path: null, repos: [{ name: 'rad-orc-source', commit_hash: hash }], corrective_tasks: [],
    nodes: { task_executor: { kind: 'step', status: 'completed', doc_path: null, retries: 0 }, commit: { kind: 'step', status: 'completed', doc_path: null, retries: 0 } },
  });
  const phase = (index: number, hash: string | null, correctives: unknown[]) => ({
    index, status: index === 3 ? 'in_progress' : 'completed', doc_path: null, repos: [{ name: 'rad-orc-source', commit_hash: null }],
    corrective_tasks: correctives,
    nodes: { task_loop: { kind: 'for_each_task', status: 'completed', iterations: [completedTask(hash)] } },
  });
  return {
    pipeline: { source_control: { worktree_name: 'PROJECT-GRAPH-2', auto_commit: 'never', auto_pr: 'never', repos: [{ name: 'rad-orc-source', branch: 'PROJECT-GRAPH-2', base_branch: 'main', remote_url: null, compare_url: null, pr_url: null }] } },
    graph: {
      status: 'in_progress',
      current_node_path: 'phase_loop[3].corrective_tasks[1].commit',
      nodes: {
        phase_loop: {
          kind: 'for_each_phase', status: 'in_progress',
          iterations: [
            phase(0, '64f9c236', []),
            phase(1, 'aaaa1111', []),
            phase(2, 'bbbb2222', []),
            phase(3, 'cccc3333', [
              { index: 1, status: 'in_progress', reason: 'phase review', injected_after: 'phase_review',
                repos: [{ name: 'rad-orc-source', commit_hash: null }],
                nodes: { commit: { kind: 'step', status: 'in_progress', doc_path: null, retries: 0 } } },
            ]),
          ],
        },
      },
    },
  } as unknown as PipelineState;
}

describe('PROJECT-GRAPH-2 stale-context replay (FR-12)', () => {
  it('rejects the stale P01-T01 echo and leaves the genuine hash unchanged (FR-12, DD-1)', () => {
    const state = projectGraph2State();
    const mut = getMutation('commit_completed')!;
    // P04-T02: signal is now array-shaped; scalar commit_hash retired.
    const ctx = { event: 'commit_completed', project_dir: '', config_path: '',
      repos: [{ name: 'rad-orc-source', committed: true, commitHash: '1436cd63', pushed: true }],
      phase: 1, task: 1 } as unknown as EventContext;
    // Layer 1 (handler guard) — the stale echo against finalized P01-T01 throws.
    expect(() => mut(state, ctx, cfg, tmpl)).toThrow(/overwrite|immutable|finalized/i);
    // The genuine P01-T01 hash is untouched.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p01 = (state as any).graph.nodes.phase_loop.iterations[0].nodes.task_loop.iterations[0];
    expect(p01.repos[0].commit_hash).toBe('64f9c236');
  });

  it('the validator catch net also flags the corrupting diff (FR-12, AD-2, AD-3)', () => {
    const prev = projectGraph2State();
    const poisoned = projectGraph2State();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (poisoned as any).graph.nodes.phase_loop.iterations[0].nodes.task_loop.iterations[0].repos[0].commit_hash = '1436cd63';
    const errors = validateState(prev, poisoned, cfg, tmpl);
    expect(errors.some(e => /commit_hash|immutable/i.test(e))).toBe(true);
  });
});

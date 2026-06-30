import { describe, it, expect } from 'vitest';
import { getMutation } from '../../../src/lib/pipeline-engine/mutations.js';
import type {
  OrchestrationConfig,
  PipelineState,
  PipelineTemplate,
  IterationEntry,
  SourceControlState,
} from '../../../src/lib/pipeline-engine/types.js';

describe('source_control_init retirement (FR-6, AD-2)', () => {
  it('no longer registers a SOURCE_CONTROL_INIT mutation', () => {
    expect(getMutation('source_control_init')).toBeUndefined();
  });
});

// ── Shared test fixtures ──────────────────────────────────────────────────────

const cfg = {
  limits: { max_retries_per_task: 3, max_consecutive_review_rejections: 3 },
} as unknown as OrchestrationConfig;

// Minimal template carrying for_each_phase → for_each_task body so the
// commit_completed mutation can navigate iterations.
const tmpl = {
  id: 't', version: '1', description: '',
  nodes: [
    {
      id: 'phase_loop', kind: 'for_each_phase', label: 'P', source_doc_ref: '', total_field: 'total_phases', depends_on: [],
      body: [
        {
          id: 'task_loop', kind: 'for_each_task', label: 'T', source_doc_ref: '', tasks_field: 'tasks', depends_on: [],
          body: [
            { id: 'task_gate', kind: 'gate' },
            { id: 'task_executor', kind: 'step' },
            { id: 'commit', kind: 'step' },
            { id: 'code_review', kind: 'step' },
          ],
        },
      ],
    },
  ],
} as unknown as PipelineTemplate;

const step = (status: string) => ({ kind: 'step', status, doc_path: null, retries: 0 });
const gate = (status: string, active = false) => ({ kind: 'gate', status, gate_active: active });

// ── Two-repo state factory ────────────────────────────────────────────────────

/**
 * Builds a minimal PipelineState with one phase, one task, and a task iteration
 * seeded with repos: [{name:'fake-api'},{name:'fake-ui'}]. The commit node is
 * in_progress so commit_completed can land.
 */
function buildTwoRepoState(): PipelineState {
  return {
    $schema: 'orchestration-state-v6',
    project: { name: 'test', created: '2026-01-01T00:00:00.000Z', updated: '2026-01-01T00:00:00.000Z' },
    config: {
      gate_mode: 'task',
      limits: { max_retries_per_task: 3, max_consecutive_review_rejections: 3 },
      source_control: { auto_commit: 'always', auto_pr: 'never' },
    },
    pipeline: {
      gate_mode: 'task',
      source_control: null,
      current_tier: 'execution',
      halt_reason: null,
    },
    graph: {
      template_id: 't',
      status: 'in_progress',
      current_node_path: 'phase_loop[0].task_loop[0].commit',
      nodes: {
        phase_loop: {
          kind: 'for_each_phase',
          status: 'in_progress',
          iterations: [
            {
              index: 0,
              status: 'in_progress',
              doc_path: null,
              repos: [],
              corrective_tasks: [],
              nodes: {
                task_loop: {
                  kind: 'for_each_task',
                  status: 'in_progress',
                  iterations: [
                    {
                      index: 0,
                      status: 'in_progress',
                      doc_path: null,
                      repos: [
                        { name: 'fake-api', commit_hash: null },
                        { name: 'fake-ui', commit_hash: null },
                      ],
                      corrective_tasks: [],
                      nodes: {
                        task_gate:     gate('completed', true),
                        task_executor: step('completed'),
                        commit:        step('in_progress'),
                        code_review:   step('not_started'),
                      },
                    } as IterationEntry,
                  ],
                },
                phase_gate:   gate('not_started'),
                phase_review: step('not_started'),
              },
            },
          ],
        },
      },
    },
  } as unknown as PipelineState;
}

/**
 * Returns the task IterationEntry for phase P, task T (1-based) from a state.
 */
function taskIteration(state: PipelineState, phase: number, task: number): IterationEntry {
  const phaseLoop = state.graph.nodes['phase_loop'] as {
    iterations: Array<{ nodes: { task_loop: { iterations: IterationEntry[] } } }>;
  };
  return phaseLoop.iterations[phase - 1].nodes.task_loop.iterations[task - 1];
}

// ── processEvent-based helpers (uses getMutation directly for isolation) ──────

/**
 * Drives a two-repo state through commit_completed via getMutation (no IOAdapter).
 * Returns the post-mutation state.
 */
function applyCommitCompleted(
  state: PipelineState,
  ctx: Record<string, unknown>,
): PipelineState {
  const fn = getMutation('commit_completed');
  if (!fn) throw new Error('commit_completed mutation not registered');
  const { state: next } = fn(state, ctx as never, cfg, tmpl);
  return next;
}

// ── commit_completed by-name tests ────────────────────────────────────────────

describe('commit_completed per-repo by-name mutation (FR-7, AD-4)', () => {
  it('commit_completed writes each hash to the matching repo by name (FR-7, AD-4)', () => {
    const state = buildTwoRepoState();
    const next = applyCommitCompleted(state, {
      phase: 1, task: 1,
      repos: [
        { name: 'fake-ui', committed: true, commitHash: 'uihash1', pushed: true },
        { name: 'fake-api', committed: true, commitHash: 'apihash1', pushed: true },
      ],
    });
    const ti = taskIteration(next, 1, 1);
    expect(ti.repos.find(r => r.name === 'fake-api')!.commit_hash).toBe('apihash1');
    expect(ti.repos.find(r => r.name === 'fake-ui')!.commit_hash).toBe('uihash1');
  });

  it('a committed:false skip does not reject the signal (FR-7)', () => {
    const state = buildTwoRepoState();
    expect(() => applyCommitCompleted(state, {
      phase: 1, task: 1,
      repos: [
        { name: 'fake-api', committed: true, commitHash: 'apihash1', pushed: true },
        { name: 'fake-ui', committed: false, commitHash: null, pushed: false },
      ],
    })).not.toThrow();
  });

  it('rejects a malformed row: commitHash present but committed:false (relay dropped the flag)', () => {
    const state = buildTwoRepoState();
    // A real commit whose `committed` flag was dropped in relay must fail loud,
    // not silently skip (the MR-5-TEST footgun). The CLI guarantees
    // committed:false ⇒ commitHash:null, so this only fires on a mis-relayed payload.
    expect(() => applyCommitCompleted(state, {
      phase: 1, task: 1,
      repos: [
        { name: 'fake-api', committed: false, commitHash: 'apihash1', pushed: false },
      ],
    })).toThrow(/committed/i);
  });

  it('rejects a committed:true row carrying no commit hash (relay dropped the hash)', () => {
    const state = buildTwoRepoState();
    // committed:true ⇒ commitHash must be present. A null hash here would silently
    // record nothing, collapsing the reviewer's diff scope. Symmetric with the
    // committed:false-with-hash guard — fail loud on the mis-relay.
    expect(() => applyCommitCompleted(state, {
      phase: 1, task: 1,
      repos: [
        { name: 'fake-api', committed: true, commitHash: null, pushed: true },
      ],
    })).toThrow(/commit_completed refused.*commit hash/is);
  });

  it('rejects a missing/empty repos[] payload (would complete recording zero hashes)', () => {
    const state = buildTwoRepoState();
    // An empty array — or an absent repos key — must not silently complete the
    // commit node. The legitimate clean-skip case is a non-empty array of
    // committed:false rows, not an empty array.
    expect(() => applyCommitCompleted(state, { phase: 1, task: 1, repos: [] }))
      .toThrow(/commit_completed refused.*repos\[\]/is);
    expect(() => applyCommitCompleted(state, { phase: 1, task: 1 }))
      .toThrow(/commit_completed refused.*repos\[\]/is);
  });
});

// ── Two-repo state factory for PR tests ──────────────────────────────────────

/**
 * Builds a minimal PipelineState with source_control.repos containing
 * [{name:'fake-api',...},{name:'fake-ui',...}] and final_pr in_progress.
 */
function buildTwoPrRepoState(): PipelineState {
  return {
    $schema: 'orchestration-state-v6',
    project: { name: 'test', created: '2026-01-01T00:00:00.000Z', updated: '2026-01-01T00:00:00.000Z' },
    config: {
      gate_mode: 'task',
      limits: { max_retries_per_task: 3, max_consecutive_review_rejections: 3 },
      source_control: { auto_commit: 'always', auto_pr: 'always' },
    },
    pipeline: {
      gate_mode: 'task',
      source_control: {
        worktree_name: 'test',
        auto_commit: 'always',
        auto_pr: 'always',
        repos: [
          { name: 'fake-api', branch: 'radorch/test', base_branch: 'main', remote_url: null, compare_url: null, pr_url: null },
          { name: 'fake-ui',  branch: 'radorch/test', base_branch: 'main', remote_url: null, compare_url: null, pr_url: null },
        ],
      },
      current_tier: 'execution',
      halt_reason: null,
    },
    graph: {
      template_id: 't',
      status: 'in_progress',
      current_node_path: 'final_pr',
      nodes: {
        final_pr: { kind: 'step', status: 'in_progress', doc_path: null, retries: 0 },
      },
    },
  } as unknown as PipelineState;
}

/**
 * Returns a mutable IO-like object pre-seeded with a two-repo PR state.
 * Mutation is applied via applyPrCreated (getMutation isolation pattern).
 */
function driveTwoRepoProjectToPr(): { currentState: PipelineState | null } {
  return { currentState: buildTwoPrRepoState() };
}

/**
 * Applies the pr_created mutation via getMutation directly (IOAdapter isolation).
 * Updates io.currentState with the post-mutation state.
 */
function applyPrCreated(
  io: { currentState: PipelineState | null },
  ctx: Record<string, unknown>,
): void {
  const fn = getMutation('pr_created');
  if (!fn) throw new Error('pr_created mutation not registered');
  const { state: next } = fn(io.currentState!, ctx as never, cfg, tmpl);
  io.currentState = next;
}

// ── pr_created by-name tests ──────────────────────────────────────────────────

describe('pr_created per-repo pr_url by-name mutation (FR-9, FR-10, AD-4)', () => {
  it('pr_created writes each pr_url to the matching source_control repo by name (FR-10, AD-4)', () => {
    const io = driveTwoRepoProjectToPr(); // source_control.repos: [{name:'fake-api'},{name:'fake-ui'}]
    applyPrCreated(io, {
      repos: [
        { name: 'fake-ui', pr_url: 'https://x/ui/2' },
        { name: 'fake-api', pr_url: 'https://x/api/1' },
      ],
    });
    const sc = io.currentState!.pipeline.source_control!;
    expect(sc.repos.find((r: SourceControlState['repos'][number]) => r.name === 'fake-api')!.pr_url).toBe('https://x/api/1');
    expect(sc.repos.find((r: SourceControlState['repos'][number]) => r.name === 'fake-ui')!.pr_url).toBe('https://x/ui/2');
    expect(sc).not.toHaveProperty('pr_url');
  });
});

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
// task_completed mutation can navigate iterations.
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
 * seeded with repos: [{name:'fake-api'},{name:'fake-ui'}]. task_executor is
 * in_progress and source_control.auto_commit is 'always', so task_completed both
 * completes the executor and records the folded per-repo commit hashes.
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
      source_control: {
        worktree_name: 'test',
        auto_commit: 'always',
        auto_pr: 'never',
        repos: [
          { name: 'fake-api', branch: 'radorch/test', base_branch: 'main', remote_url: null, compare_url: null, pr_url: null },
          { name: 'fake-ui', branch: 'radorch/test', base_branch: 'main', remote_url: null, compare_url: null, pr_url: null },
        ],
      },
      current_tier: 'execution',
      halt_reason: null,
    },
    graph: {
      template_id: 't',
      status: 'in_progress',
      current_node_path: 'phase_loop[0].task_loop[0].task_executor',
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
                        task_executor: step('in_progress'),
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
 * Drives a two-repo state through task_completed via getMutation (no IOAdapter).
 * Returns the post-mutation state.
 */
function applyTaskCompleted(
  state: PipelineState,
  ctx: Record<string, unknown>,
): PipelineState {
  const fn = getMutation('task_completed');
  if (!fn) throw new Error('task_completed mutation not registered');
  const { state: next } = fn(state, ctx as never, cfg, tmpl);
  return next;
}

// ── task_completed per-repo hash recording ───────────────────────────────────
// task_completed completes task_executor and records the coder's per-repo commit
// result (relayed on `context.repos`): each committed repo's hash is written to
// the matching iteration entry by name, refused when off-branch or already final.

describe('task_completed per-repo hash recording (commit fold)', () => {
  it('completes task_executor and writes each hash to the matching repo by name', () => {
    const state = buildTwoRepoState();
    const next = applyTaskCompleted(state, {
      phase: 1, task: 1,
      repos: [
        { name: 'fake-ui', committed: true, commitHash: 'uihash1', pushed: true },
        { name: 'fake-api', committed: true, commitHash: 'apihash1', pushed: true },
      ],
    });
    const ti = taskIteration(next, 1, 1);
    expect(ti.nodes.task_executor.status).toBe('completed');
    expect(ti.repos.find(r => r.name === 'fake-api')!.commit_hash).toBe('apihash1');
    expect(ti.repos.find(r => r.name === 'fake-ui')!.commit_hash).toBe('uihash1');
  });

  it('a committed:false skip does not reject the signal', () => {
    const state = buildTwoRepoState();
    expect(() => applyTaskCompleted(state, {
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
    // not silently skip. A well-formed commit report guarantees
    // committed:false ⇒ commitHash:null, so this only fires on a mis-relayed payload.
    expect(() => applyTaskCompleted(state, {
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
    expect(() => applyTaskCompleted(state, {
      phase: 1, task: 1,
      repos: [
        { name: 'fake-api', committed: true, commitHash: null, pushed: true },
      ],
    })).toThrow(/task_completed refused.*commit hash/is);
  });
});

describe('task_completed empty-payload gate (commit fold — R3 inverted precondition)', () => {
  it('rejects a missing/empty repos[] payload when commit is enabled (auto_commit != never)', () => {
    const state = buildTwoRepoState(); // auto_commit: 'always'
    // With commit on, the coder always relays a per-repo array (even committed:false
    // rows for a "nothing changed" task). An empty/absent payload is a relay bug.
    expect(() => applyTaskCompleted(state, { phase: 1, task: 1, repos: [] }))
      .toThrow(/task_completed refused.*repos\[\]/is);
    expect(() => applyTaskCompleted(state, { phase: 1, task: 1 }))
      .toThrow(/task_completed refused.*repos\[\]/is);
  });

  it('accepts an empty/absent payload when commit is off (auto_commit=never) and still completes the task', () => {
    const state = buildTwoRepoState();
    state.pipeline.source_control!.auto_commit = 'never';
    let next!: PipelineState;
    expect(() => { next = applyTaskCompleted(state, { phase: 1, task: 1 }); }).not.toThrow();
    const ti = taskIteration(next, 1, 1);
    expect(ti.nodes.task_executor.status).toBe('completed');
    // No commit was expected, so no hash is recorded.
    expect(ti.repos.every(r => r.commit_hash === null)).toBe(true);
  });

  it('rejects a non-empty repos[] payload when commit is off (auto_commit=never) — mirror of the empty-on gate', () => {
    const state = buildTwoRepoState();
    state.pipeline.source_control!.auto_commit = 'never';
    // Commit is off, so the task must carry no payload. A non-empty repos[] here is a
    // relay bug — recording it would silently attach a commit the policy said to skip.
    expect(() => applyTaskCompleted(state, {
      phase: 1, task: 1,
      repos: [{ name: 'fake-api', committed: true, commitHash: 'abc1234', pushed: false }],
    })).toThrow(/task_completed refused.*repos\[\]/is);
  });

  it('rejects a non-empty repos[] payload when source_control is unset (commit off)', () => {
    const state = buildTwoRepoState();
    // No source-control seal at all ⇒ commit is off. Same contract: no payload allowed.
    state.pipeline.source_control = null;
    expect(() => applyTaskCompleted(state, {
      phase: 1, task: 1,
      repos: [{ name: 'fake-api', committed: true, commitHash: 'abc1234', pushed: false }],
    })).toThrow(/task_completed refused/i);
  });
});

describe('task_completed hash immutability (commit fold — R3 security catch-net)', () => {
  function seedFinalizedApiHash(): PipelineState {
    const state = buildTwoRepoState();
    taskIteration(state, 1, 1).repos.find(r => r.name === 'fake-api')!.commit_hash = '64f9c236';
    return state;
  }

  it('rejects a different-hash overwrite of a finalized entry and leaves the hash unchanged', () => {
    const state = seedFinalizedApiHash();
    expect(() => applyTaskCompleted(state, {
      phase: 1, task: 1,
      repos: [{ name: 'fake-api', committed: true, commitHash: '1436cd63', pushed: true }],
    })).toThrow(/immutable|overwrite|already recorded|finalized/i);
    // The durable hash on the original state is untouched by the rejected attempt.
    expect(taskIteration(state, 1, 1).repos.find(r => r.name === 'fake-api')!.commit_hash).toBe('64f9c236');
  });

  it('allows an idempotent retry writing the same hash', () => {
    const state = seedFinalizedApiHash();
    const next = applyTaskCompleted(state, {
      phase: 1, task: 1,
      repos: [{ name: 'fake-api', committed: true, commitHash: '64f9c236', pushed: true }],
    });
    expect(taskIteration(next, 1, 1).repos.find(r => r.name === 'fake-api')!.commit_hash).toBe('64f9c236');
  });

  it('allows the first write when the existing hash is null', () => {
    const next = applyTaskCompleted(buildTwoRepoState(), {
      phase: 1, task: 1,
      repos: [{ name: 'fake-api', committed: true, commitHash: 'abc1234', pushed: true }],
    });
    expect(taskIteration(next, 1, 1).repos.find(r => r.name === 'fake-api')!.commit_hash).toBe('abc1234');
  });
});

describe('task_completed on-branch record-time guard (commit fold — R3 security)', () => {
  it('records when the reported branch matches the intended task branch', () => {
    const next = applyTaskCompleted(buildTwoRepoState(), {
      phase: 1, task: 1, branch: 'radorch/test',
      repos: [{ name: 'fake-api', committed: true, commitHash: 'onbr123', pushed: true }],
    });
    expect(taskIteration(next, 1, 1).repos.find(r => r.name === 'fake-api')!.commit_hash).toBe('onbr123');
  });

  it('refuses a commit reported off the intended branch and records nothing', () => {
    const state = buildTwoRepoState();
    expect(() => applyTaskCompleted(state, {
      phase: 1, task: 1, branch: 'radorch/wrong',
      repos: [{ name: 'fake-api', committed: true, commitHash: 'offbr99', pushed: true }],
    })).toThrow(/task_completed refused.*off the intended branch/is);
    // Nothing recorded on the original state — the rejection is atomic.
    expect(taskIteration(state, 1, 1).repos.find(r => r.name === 'fake-api')!.commit_hash).toBeNull();
  });

  it('is a no-op when the signal carries no branch (the coder-step check is the primary gate)', () => {
    const next = applyTaskCompleted(buildTwoRepoState(), {
      phase: 1, task: 1,
      repos: [{ name: 'fake-api', committed: true, commitHash: 'nobr123', pushed: true }],
    });
    expect(taskIteration(next, 1, 1).repos.find(r => r.name === 'fake-api')!.commit_hash).toBe('nobr123');
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

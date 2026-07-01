import { describe, it, expect } from 'vitest';
import os from 'node:os';
import { enrichActionContext, resolveActivePhaseIndex, resolveActiveTaskIndex, type EnrichmentInput } from '../../../src/lib/pipeline-engine/context-enrichment.js';
import { makeV6State } from '../../helpers/state-factory.js';
import type { PipelineState, OrchestrationConfig } from '../../../src/lib/pipeline-engine/types.js';

// Minimal runtime input for spawn_master_plan — that branch only reads `action`
// and `walkerContext` now. The remaining fields are required structurally on
// `EnrichmentInput`, so we stub-and-cast rather than fabricate a full
// `PipelineState`/`OrchestrationConfig`.
function makeInput(): EnrichmentInput {
  return {
    action: 'spawn_master_plan',
    walkerContext: {},
    state: { graph: { nodes: {} }, pipeline: {} } as unknown as EnrichmentInput['state'],
    config: { limits: {} } as unknown as EnrichmentInput['config'],
    cliContext: {},
  };
}

/**
 * Build a v6 state with one task iteration whose repos[0].commit_hash is set.
 * Used to test that spawn_code_reviewer reads head_sha from repos[0].commit_hash (FR-26).
 */
function stateWithTaskCommit(repoName: string, commitHash: string): PipelineState {
  const s = makeV6State({ taskRepos: [{ name: repoName, commit_hash: commitHash }] });
  // Mark the phase and task iterations as in_progress so resolveActivePhaseIndex
  // and resolveActiveTaskIndex resolve to phase=1, task=1.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const phaseIter = (s as any).graph.nodes.phase_loop.iterations[0];
  phaseIter.status = 'in_progress';
  phaseIter.nodes.task_loop.iterations[0].status = 'in_progress';
  // Seed source_control.repos[] so buildReposArray can derive per-repo entries.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (s as any).pipeline.source_control = {
    worktree_name: 'test-project',
    auto_commit: 'always',
    auto_pr: 'always',
    repos: [{ name: repoName, branch: 'radorch/test', base_branch: 'main', remote_url: null, compare_url: null, pr_url: null }],
  };
  return s as unknown as PipelineState;
}

function makeEnrichmentInput(action: string, state: PipelineState): EnrichmentInput {
  return {
    action,
    walkerContext: {},
    state,
    config: { limits: {} } as unknown as EnrichmentInput['config'],
    cliContext: {},
  };
}

describe('context-enrichment spawn_master_plan', () => {
  it('enriches with the planner step only — no limits, no repository_skills_block', () => {
    const r = enrichActionContext(makeInput());
    expect(r.step).toBe('master_plan');
    expect(r).not.toHaveProperty('limits');
    expect(r).not.toHaveProperty('repository_skills_block');
  });
});

describe('context-enrichment spawn_code_reviewer head_sha (FR-26)', () => {
  it('reads head_sha from repos[0].commit_hash for spawn_code_reviewer (FR-26)', () => {
    const ctx = enrichActionContext(makeEnrichmentInput('spawn_code_reviewer', stateWithTaskCommit('backend', 'def5678')));
    // FR-26: spawn_code_reviewer now emits per-repo repos[] with head_sha on each
    // entry instead of a top-level scalar head_sha (replaced in P03-T01).
    expect(Array.isArray(ctx.repos)).toBe(true);
    expect((ctx.repos as Array<Record<string, unknown>>)[0].head_sha).toBe('def5678');
  });
});

// Build a phase loop where every regular iteration is `completed` (so the
// pre-fix resolvers fall through to `return 1`) but phase index 4 carries an
// in_progress phase-scope corrective — the PROJECT-GRAPH-2 shape.
function stateWithPhaseCorrective(): PipelineState {
  const completedTaskLoop = {
    kind: 'for_each_task',
    status: 'completed',
    iterations: [
      { index: 0, status: 'completed', doc_path: null, repos: [], corrective_tasks: [], nodes: {} },
    ],
  };
  const mkPhase = (index: number, status: string, correctives: unknown[]) => ({
    index,
    status,
    doc_path: null,
    repos: [],
    corrective_tasks: correctives,
    nodes: { task_loop: structuredClone(completedTaskLoop) },
  });
  return {
    graph: {
      nodes: {
        phase_loop: {
          kind: 'for_each_phase',
          status: 'in_progress',
          iterations: [
            mkPhase(0, 'completed', []),
            mkPhase(1, 'completed', []),
            mkPhase(2, 'completed', []),
            mkPhase(3, 'in_progress', [
              { index: 1, status: 'in_progress', reason: 'r', injected_after: 'phase_review', nodes: {}, repos: [] },
            ]),
          ],
        },
      },
    },
  } as unknown as PipelineState;
}

function stateResolvingToOne(): PipelineState {
  return {
    graph: {
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
                    { index: 0, status: 'in_progress', doc_path: null, repos: [], corrective_tasks: [], nodes: {} },
                  ],
                },
              },
            },
          ],
        },
      },
    },
  } as unknown as PipelineState;
}

describe('corrective-aware resolvers (FR-1, FR-2, NFR-1)', () => {
  it('resolves the active phase-scope corrective phase, not node 1 (FR-1)', () => {
    const state = stateWithPhaseCorrective();
    expect(resolveActivePhaseIndex(state)).toBe(4);
    expect(resolveActiveTaskIndex(state, 4)).toBe(1);
  });

  it('fails loud when no active node can be resolved (FR-2)', () => {
    // All phases completed, no correctives, no in_progress/not_started.
    const state = stateWithPhaseCorrective();
    (state as unknown as { graph: { nodes: { phase_loop: { iterations: { status: string; corrective_tasks: unknown[] }[] } } } })
      .graph.nodes.phase_loop.iterations.forEach(it => { it.status = 'completed'; it.corrective_tasks = []; });
    expect(() => resolveActivePhaseIndex(state)).toThrow(/no active phase|unresolved/i);
  });

  it('still resolves to phase 1 / task 1 when that is genuinely correct (NFR-1)', () => {
    const state = stateResolvingToOne();
    expect(resolveActivePhaseIndex(state)).toBe(1);
    expect(resolveActiveTaskIndex(state, 1)).toBe(1);
  });
});

const cfg = { limits: {} } as unknown as OrchestrationConfig;

import { validateBaseShaChronology } from '../../../src/lib/pipeline-engine/context-enrichment.js';

describe('project_base_sha chronology invariant (FR-7, NFR-4)', () => {
  it('rejects a base SHA whose chronological position is not earliest (FR-7)', () => {
    // Traversal order picks the poisoned P04 hash first, but git says it is #12.
    const commits = ['1436cd63', '64f9c236', 'e9d71bc5'];
    const ordinal = new Map([['64f9c236', 1], ['e9d71bc5', 5], ['1436cd63', 12]]);
    const err = validateBaseShaChronology(commits, ordinal);
    expect(err).toMatch(/base.*sha|chronolog/i);
  });

  it('accepts a base SHA that is the chronologically earliest (FR-7)', () => {
    const commits = ['64f9c236', 'e9d71bc5', '1436cd63'];
    const ordinal = new Map([['64f9c236', 1], ['e9d71bc5', 5], ['1436cd63', 12]]);
    expect(validateBaseShaChronology(commits, ordinal)).toBeNull();
  });
});

describe('spawn_final_reviewer base/head SHA derivation — ≤1 commit short-circuit (FR-7, NFR-4)', () => {
  // With 0–1 collected commit hashes a chronology violation is impossible, so
  // the enrichment must not depend on `git` (the rev-list invocation is skipped).
  // worktree_path points at a throwaway non-git directory to prove the path does
  // not require a git repository when there is nothing to order.
  function finalReviewState(commitHash: string | null): PipelineState {
    const s = makeV6State({ taskRepos: [{ name: 'backend', commit_hash: commitHash }] });
    const mutable = s as unknown as { pipeline: Record<string, unknown> };
    mutable.pipeline = {
      ...mutable.pipeline,
      source_control: {
        worktree_path: os.tmpdir(),
        worktree_name: 'test-project',
        auto_commit: 'always',
        auto_pr: 'always',
        repos: [{ name: 'backend', branch: 'b', base_branch: 'main', remote_url: null, compare_url: null, pr_url: null }],
      },
    };
    return s as unknown as PipelineState;
  }

  it('returns null base/head per repo and no error when no commits were collected (auto-commit off)', () => {
    const out = enrichActionContext(makeEnrichmentInput('spawn_final_reviewer', finalReviewState(null)));
    expect(Array.isArray(out.repos)).toBe(true);
    const repo = (out.repos as Array<Record<string, unknown>>)[0];
    expect(repo.project_base_sha ?? null).toBeNull();
    expect(repo.project_head_sha ?? null).toBeNull();
    expect(out.error).toBeUndefined();
  });

  it('returns the single commit as both base and head per repo with no error (one commit)', () => {
    const out = enrichActionContext(makeEnrichmentInput('spawn_final_reviewer', finalReviewState('abc12345')));
    expect(Array.isArray(out.repos)).toBe(true);
    const repo = (out.repos as Array<Record<string, unknown>>)[0];
    expect(repo.project_base_sha).toBe('abc12345');
    expect(repo.project_head_sha).toBe('abc12345');
    expect(out.error).toBeUndefined();
  });
});

describe('per-action repos[] enrichment (FR-1, FR-2, FR-3)', () => {
  const DEFAULT_CONFIG = { limits: {} } as unknown as OrchestrationConfig;

  function buildTwoRepoExecState(): PipelineState {
    const taskRepos = [
      { name: 'fake-api', commit_hash: 'apihash1' },
      { name: 'fake-ui', commit_hash: 'uihash1' },
    ];
    const state = {
      graph: {
        nodes: {
          phase_loop: {
            kind: 'for_each_phase',
            status: 'in_progress',
            iterations: [
              {
                index: 0,
                status: 'in_progress',
                doc_path: null,
                repos: taskRepos.map(r => ({ name: r.name, commit_hash: null })),
                corrective_tasks: [],
                nodes: {
                  task_loop: {
                    kind: 'for_each_task',
                    status: 'in_progress',
                    iterations: [
                      {
                        index: 0,
                        status: 'in_progress',
                        doc_path: '/fake/handoff.md',
                        repos: taskRepos,
                        corrective_tasks: [],
                        nodes: {},
                      },
                    ],
                  },
                },
              },
            ],
          },
        },
      },
      pipeline: {
        gate_mode: null,
        current_tier: 'execution',
        halt_reason: null,
        source_control: {
          worktree_name: 'MULTI-REPO-5',
          auto_commit: 'always',
          auto_pr: 'always',
          repos: [
            { name: 'fake-api', branch: 'radorch/MULTI-REPO-5', base_branch: 'main', remote_url: null, compare_url: null, pr_url: null },
            { name: 'fake-ui', branch: 'radorch/MULTI-REPO-5', base_branch: 'main', remote_url: null, compare_url: null, pr_url: null },
          ],
        },
      },
      project: { name: 'MULTI-REPO-5' },
    } as unknown as PipelineState;
    return state;
  }

  it('execute_task emits a repos[] array with a per-repo path and branch (FR-1, FR-2)', () => {
    const state = buildTwoRepoExecState(); // helper seeds repos[] on the active task iteration
    const ctx = enrichActionContext({ action: 'execute_task', walkerContext: {}, state, config: DEFAULT_CONFIG, cliContext: {} });
    expect(Array.isArray(ctx.repos)).toBe(true);
    expect(ctx.repos).toHaveLength(2);
    for (const r of ctx.repos as Array<Record<string, unknown>>) {
      expect(typeof r.name).toBe('string');
      expect(typeof r.path).toBe('string');
      expect(r).toHaveProperty('branch');
    }
  });

  it('execute_task throws when source_control is uninitialized (empty repos[]) — fail loud, not silent', () => {
    const state = buildTwoRepoExecState();
    // Simulate source-control init never having run: no per-repo entries to derive a path from.
    (state.pipeline.source_control as { repos: unknown[] }).repos = [];
    expect(() => enrichActionContext({ action: 'execute_task', walkerContext: {}, state, config: DEFAULT_CONFIG, cliContext: {} }))
      .toThrow(/source-control|not initialized|no repos/i);
  });

  it('spawn_code_reviewer groups head_sha per repo (FR-3)', () => {
    const state = buildTwoRepoExecState();
    const ctx = enrichActionContext({ action: 'spawn_code_reviewer', walkerContext: {}, state, config: DEFAULT_CONFIG, cliContext: {} });
    expect(ctx.repos).toEqual([
      expect.objectContaining({ name: 'fake-api', head_sha: 'apihash1' }),
      expect.objectContaining({ name: 'fake-ui', head_sha: 'uihash1' }),
    ]);
  });
});

describe('enrichment readers migrate to repos[] (FR-21, FR-22)', () => {
  it('final-approval lists every repo PR from source_control.repos[], no top-level pr_url', () => {
    // Minimal state stub — request_final_approval only reads state.pipeline.source_control.
    // createScaffoldedState() was the handoff-specified factory but importing parity-states.ts
    // introduces engine.ts into the same module graph as context-enrichment.ts, creating a
    // circular dependency (engine.ts → context-enrichment.ts → already loading). Using a stub
    // avoids the circular dep while keeping the behavioral assertion identical (see Execution Notes).
    const state = { graph: { nodes: {} }, pipeline: {} } as unknown as PipelineState;
    state.pipeline.source_control = {
      worktree_name: 'MR-5', auto_commit: 'always', auto_pr: 'always',
      repos: [
        { name: 'fake-api', branch: 'b', base_branch: 'main', remote_url: null, compare_url: null, pr_url: 'https://x/api/1' },
        { name: 'fake-ui', branch: 'b', base_branch: 'main', remote_url: null, compare_url: null, pr_url: 'https://x/ui/2' },
      ],
    } as never;
    const ctx = enrichActionContext({
      action: 'request_final_approval', walkerContext: {}, state, config: cfg, cliContext: {},
    });
    expect(ctx.repos).toEqual([
      { name: 'fake-api', pr_url: 'https://x/api/1' },
      { name: 'fake-ui', pr_url: 'https://x/ui/2' },
    ]);
    expect(ctx).not.toHaveProperty('pr_url');
  });
});

describe('execute_task corrective early-return emits repos[] (FR-1)', () => {
  const DEFAULT_CONFIG = { limits: {} } as unknown as OrchestrationConfig;

  /**
   * Build a state whose active task loop is under a phase-scope corrective that
   * is `in_progress` and carries a non-empty `doc_path`. The corrective early-return
   * path in `execute_task` resolves this doc_path and returns early WITHOUT the
   * default `repos: buildReposArray(state)` — which is the bug being fixed.
   */
  function stateWithActivePhaseScopeCorrective(): PipelineState {
    const completedTaskLoop = {
      kind: 'for_each_task',
      status: 'completed',
      iterations: [
        { index: 0, status: 'completed', doc_path: '/fake/handoff.md', repos: [{ name: 'my-api', commit_hash: 'abc123' }], corrective_tasks: [], nodes: {} },
      ],
    };
    return {
      graph: {
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
                corrective_tasks: [
                  {
                    index: 1,
                    status: 'in_progress',
                    reason: 'phase review requested changes',
                    injected_after: 'phase_review',
                    nodes: {},
                    repos: [],
                    doc_path: '/fake/corrective-handoff.md',
                  },
                ],
                nodes: { task_loop: completedTaskLoop },
              },
            ],
          },
        },
      },
      pipeline: {
        gate_mode: null,
        current_tier: 'execution',
        halt_reason: null,
        source_control: {
          worktree_name: 'test-project',
          auto_commit: 'always',
          auto_pr: 'always',
          repos: [
            { name: 'my-api', branch: 'radorch/test', base_branch: 'main', remote_url: null, compare_url: null, pr_url: null },
          ],
        },
      },
      project: { name: 'test-project' },
    } as unknown as PipelineState;
  }

  it('execute_task corrective path emits repos[] array with at least one named entry (FR-1)', () => {
    const state = stateWithActivePhaseScopeCorrective();
    const ctx = enrichActionContext({ action: 'execute_task', walkerContext: {}, state, config: DEFAULT_CONFIG, cliContext: {} });
    // The corrective early-return path must emit repos[] just like the default path.
    expect(Array.isArray(ctx.repos)).toBe(true);
    const repos = ctx.repos as Array<Record<string, unknown>>;
    expect(repos.length).toBeGreaterThanOrEqual(1);
    expect(typeof repos[0].name).toBe('string');
    expect(repos[0]).toHaveProperty('path');
  });
});

describe('spawn_phase_reviewer per-repo SHA grouping (FR-3)', () => {
  const DEFAULT_CONFIG = { limits: {} } as unknown as OrchestrationConfig;

  /**
   * Build a two-repo, two-task state for spawn_phase_reviewer.
   * - Task 0 (first): api=first_api_sha, ui=first_ui_sha
   * - Task 1 (last):  api=last_api_sha,  ui=last_ui_sha
   * The phase reviewer should group:
   *   repos[api].phase_first_sha = first_api_sha, repos[api].phase_head_sha = last_api_sha
   *   repos[ui].phase_first_sha  = first_ui_sha,  repos[ui].phase_head_sha  = last_ui_sha
   */
  function buildTwoRepoPhaseReviewerState(): PipelineState {
    return {
      graph: {
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
                    status: 'completed',
                    iterations: [
                      {
                        index: 0,
                        status: 'completed',
                        doc_path: '/fake/t01.md',
                        repos: [
                          { name: 'fake-api', commit_hash: 'first_api_sha' },
                          { name: 'fake-ui', commit_hash: 'first_ui_sha' },
                        ],
                        corrective_tasks: [],
                        nodes: {},
                      },
                      {
                        index: 1,
                        status: 'completed',
                        doc_path: '/fake/t02.md',
                        repos: [
                          { name: 'fake-api', commit_hash: 'last_api_sha' },
                          { name: 'fake-ui', commit_hash: 'last_ui_sha' },
                        ],
                        corrective_tasks: [],
                        nodes: {},
                      },
                    ],
                  },
                },
              },
            ],
          },
        },
      },
      pipeline: {
        gate_mode: null,
        current_tier: 'execution',
        halt_reason: null,
        source_control: {
          worktree_name: 'MULTI-REPO-5',
          auto_commit: 'always',
          auto_pr: 'always',
          repos: [
            { name: 'fake-api', branch: 'radorch/MULTI-REPO-5', base_branch: 'main', remote_url: null, compare_url: null, pr_url: null },
            { name: 'fake-ui', branch: 'radorch/MULTI-REPO-5', base_branch: 'main', remote_url: null, compare_url: null, pr_url: null },
          ],
        },
      },
      project: { name: 'MULTI-REPO-5' },
    } as unknown as PipelineState;
  }

  it('spawn_phase_reviewer groups phase_first_sha and phase_head_sha per repo (FR-3)', () => {
    const state = buildTwoRepoPhaseReviewerState();
    const ctx = enrichActionContext({ action: 'spawn_phase_reviewer', walkerContext: {}, state, config: DEFAULT_CONFIG, cliContext: {} });
    expect(Array.isArray(ctx.repos)).toBe(true);
    const repos = ctx.repos as Array<Record<string, unknown>>;
    const apiEntry = repos.find(r => r.name === 'fake-api');
    const uiEntry = repos.find(r => r.name === 'fake-ui');
    // First task iteration's commit hashes become phase_first_sha
    expect(apiEntry?.phase_first_sha).toBe('first_api_sha');
    expect(uiEntry?.phase_first_sha).toBe('first_ui_sha');
    // Last task iteration's commit hashes become phase_head_sha
    expect(apiEntry?.phase_head_sha).toBe('last_api_sha');
    expect(uiEntry?.phase_head_sha).toBe('last_ui_sha');
  });
});

describe('per-repo chronology and final SHAs (FR-3, FR-4)', () => {
  const DEFAULT_CONFIG = { limits: {} } as unknown as OrchestrationConfig;

  function buildTwoRepoProjectWithCommits(): PipelineState {
    // api: [a1, a2], ui: [u1, u2] — two phases, each with one task iteration carrying two repos
    return {
      graph: {
        nodes: {
          phase_loop: {
            kind: 'for_each_phase',
            status: 'completed',
            iterations: [
              {
                index: 0,
                status: 'completed',
                doc_path: null,
                repos: [],
                corrective_tasks: [],
                nodes: {
                  task_loop: {
                    kind: 'for_each_task',
                    status: 'completed',
                    iterations: [
                      {
                        index: 0,
                        status: 'completed',
                        doc_path: null,
                        repos: [
                          { name: 'fake-api', commit_hash: 'a1' },
                          { name: 'fake-ui', commit_hash: 'u1' },
                        ],
                        corrective_tasks: [],
                        nodes: {},
                      },
                    ],
                  },
                },
              },
              {
                index: 1,
                status: 'completed',
                doc_path: null,
                repos: [],
                corrective_tasks: [],
                nodes: {
                  task_loop: {
                    kind: 'for_each_task',
                    status: 'completed',
                    iterations: [
                      {
                        index: 0,
                        status: 'completed',
                        doc_path: null,
                        repos: [
                          { name: 'fake-api', commit_hash: 'a2' },
                          { name: 'fake-ui', commit_hash: 'u2' },
                        ],
                        corrective_tasks: [],
                        nodes: {},
                      },
                    ],
                  },
                },
              },
            ],
          },
        },
      },
      pipeline: {
        gate_mode: null,
        current_tier: 'execution',
        halt_reason: null,
        source_control: {
          worktree_name: 'MULTI-REPO-5',
          auto_commit: 'always',
          auto_pr: 'always',
          repos: [
            { name: 'fake-api', branch: 'radorch/MULTI-REPO-5', base_branch: 'main', remote_url: null, compare_url: null, pr_url: null },
            { name: 'fake-ui', branch: 'radorch/MULTI-REPO-5', base_branch: 'main', remote_url: null, compare_url: null, pr_url: null },
          ],
        },
      },
      project: { name: 'MULTI-REPO-5' },
    } as unknown as PipelineState;
  }

  it('final reviewer groups base/head SHAs per repo (FR-3)', () => {
    const state = buildTwoRepoProjectWithCommits(); // api: [a1,a2], ui: [u1,u2]
    const ctx = enrichActionContext({ action: 'spawn_final_reviewer', walkerContext: {}, state, config: DEFAULT_CONFIG, cliContext: {} });
    expect(ctx.repos).toEqual([
      expect.objectContaining({ name: 'fake-api', project_base_sha: 'a1', project_head_sha: 'a2' }),
      expect.objectContaining({ name: 'fake-ui', project_base_sha: 'u1', project_head_sha: 'u2' }),
    ]);
  });

  it('validateBaseShaChronology names the offending repo on a per-repo violation (FR-4)', () => {
    const ordinal = new Map([['aaaa1111', 2], ['bbbb2222', 1]]);
    const err = validateBaseShaChronology(['aaaa1111', 'bbbb2222'], ordinal, 'fake-api');
    expect(err).toMatch(/fake-api/);
  });
});

describe('execute_task surfaces complexity and should_commit to the coder spawn', () => {
  const DEFAULT_CONFIG = { limits: {} } as unknown as OrchestrationConfig;

  function execStateWithComplexity(complexity?: 'simple' | 'standard' | 'complex'): PipelineState {
    const taskIter: Record<string, unknown> = {
      index: 0,
      status: 'in_progress',
      doc_path: '/fake/handoff.md',
      repos: [{ name: 'backend', commit_hash: null }],
      corrective_tasks: [],
      nodes: {},
    };
    if (complexity !== undefined) taskIter.complexity = complexity;
    return {
      graph: {
        nodes: {
          phase_loop: {
            kind: 'for_each_phase',
            status: 'in_progress',
            iterations: [
              {
                index: 0,
                status: 'in_progress',
                doc_path: null,
                repos: [{ name: 'backend', commit_hash: null }],
                corrective_tasks: [],
                nodes: { task_loop: { kind: 'for_each_task', status: 'in_progress', iterations: [taskIter] } },
              },
            ],
          },
        },
      },
      pipeline: {
        gate_mode: null,
        current_tier: 'execution',
        halt_reason: null,
        source_control: {
          worktree_name: 'test-project',
          auto_commit: 'always',
          auto_pr: 'always',
          repos: [{ name: 'backend', branch: 'radorch/test', base_branch: 'main', remote_url: null, compare_url: null, pr_url: null }],
        },
      },
      project: { name: 'test-project' },
    } as unknown as PipelineState;
  }

  it('reads complexity from the seeded task iteration', () => {
    const ctx = enrichActionContext({ action: 'execute_task', walkerContext: {}, state: execStateWithComplexity('complex'), config: DEFAULT_CONFIG, cliContext: {} });
    expect(ctx.complexity).toBe('complex');
  });

  it('defaults to standard when the task iteration lacks complexity', () => {
    const ctx = enrichActionContext({ action: 'execute_task', walkerContext: {}, state: execStateWithComplexity(undefined), config: DEFAULT_CONFIG, cliContext: {} });
    expect(ctx.complexity).toBe('standard');
  });

  it('surfaces should_commit=true when auto_commit is not never', () => {
    // execStateWithComplexity seeds source_control.auto_commit = 'always'.
    const ctx = enrichActionContext({ action: 'execute_task', walkerContext: {}, state: execStateWithComplexity('standard'), config: DEFAULT_CONFIG, cliContext: {} });
    expect(ctx.should_commit).toBe(true);
  });

  it('surfaces should_commit=false when auto_commit is never', () => {
    const state = execStateWithComplexity('standard');
    state.pipeline.source_control!.auto_commit = 'never';
    const ctx = enrichActionContext({ action: 'execute_task', walkerContext: {}, state, config: DEFAULT_CONFIG, cliContext: {} });
    expect(ctx.should_commit).toBe(false);
  });
});

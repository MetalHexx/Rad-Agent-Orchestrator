import { describe, it, expect, vi } from 'vitest';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { enrichActionContext, resolveActivePhaseIndex, resolveActiveTaskIndex, type EnrichmentInput } from '../../../src/lib/pipeline-engine/context-enrichment.js';
import { makeV6State } from '../../helpers/state-factory.js';
import type { PipelineState, OrchestrationConfig } from '../../../src/lib/pipeline-engine/types.js';
import { userDataPaths } from '../../../src/lib/paths.js';
import { writeLocal } from '@rad-orchestration/repo-registry';
import { createGitFixture } from './helpers/git-fixture.js';

// Module-boundary mock: resolveRequirementsDoc (context-enrichment.ts) reads real
// paths via userDataPaths() + WorkGraphService, so isolate it here rather than
// against the developer's real ~/.radorc. No pre-existing paths-mock lived in
// this test dir — established here, mirroring the temp-dir isolation the sibling
// composer/engine tests already use.
vi.mock('../../../src/lib/paths.js', () => ({
  userDataPaths: vi.fn(),
}));

function mockUserDataPathsRoot(root: string): void {
  vi.mocked(userDataPaths).mockReturnValue({
    root,
    installJson: path.join(root, 'install.json'),
    orchestrationYml: path.join(root, 'orchestration.yml'),
    ui: path.join(root, 'ui'),
    templates: path.join(root, 'templates'),
    projects: path.join(root, 'projects'),
    sideProjects: path.join(root, 'side-projects'),
    worktrees: path.join(root, 'worktrees'),
    logs: path.join(root, 'logs'),
    runtime: path.join(root, 'runtime'),
    telemetry: path.join(root, 'telemetry'),
    bootstrapLock: path.join(root, 'runtime', 'bootstrap.lock'),
    actionEvents: path.join(root, 'action-events'),
  });
}

interface FixtureRepoSpec {
  /** Repo name recorded in `pipeline.source_control.repos[]`. */
  name: string;
  /** One entry per commit, applied in chronological order. */
  commitFiles: Record<string, string>[];
}

/**
 * Binds one or more real, independent git fixtures as the resolved worktree
 * path for the given repo names — the three-part recipe `buildReposArray`'s
 * worktree resolution actually requires: a `state.json` seeded on disk under
 * a fresh mocked `~/.radorc` root, `writeLocal` registering each repo's local
 * clone path, and `in_place: true` on each source-control repo entry (without
 * it, resolution falls back to the convention worktree path instead of the
 * bound fixture). Returns the created fixtures keyed by repo name and the
 * `pipeline.source_control` object callers embed into their own state.
 */
function bindFixtureRepos(
  projectName: string,
  specs: FixtureRepoSpec[],
): {
  fixtures: Record<string, ReturnType<typeof createGitFixture>>;
  sourceControl: Record<string, unknown>;
  cleanup: () => void;
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ce-final-review-'));
  mockUserDataPathsRoot(root);

  const fixtures: Record<string, ReturnType<typeof createGitFixture>> = {};
  const localPaths: Record<string, string> = {};
  const repos = specs.map(spec => {
    const fixture = createGitFixture({
      commits: spec.commitFiles.map((files, i) => ({ message: `${spec.name}-${i}`, files })),
    });
    fixtures[spec.name] = fixture;
    localPaths[spec.name] = fixture.repoPath;
    return { name: spec.name, branch: 'radorch/test', base_branch: 'main', remote_url: null, compare_url: null, pr_url: null, in_place: true };
  });

  const sourceControl = {
    worktree_name: projectName,
    auto_commit: 'always',
    auto_pr: 'always',
    repos,
  };

  const projectDir = path.join(root, 'projects', projectName);
  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'state.json'), JSON.stringify({
    project: { name: projectName },
    pipeline: { source_control: sourceControl },
    graph: { nodes: {} },
  }));
  writeLocal({ root, localPaths });

  return {
    fixtures,
    sourceControl,
    cleanup: () => {
      for (const fixture of Object.values(fixtures)) fixture.cleanup();
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

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

import { validateCommitsReachableFromHead } from '../../../src/lib/pipeline-engine/context-enrichment.js';

describe('commit-range reachability against git history', () => {
  it('rejects a commit that is not reachable from HEAD', () => {
    // 'deadbeef' never resolved in the ordinal map — git history doesn't contain it.
    const commits = ['64f9c236', 'deadbeef', 'e9d71bc5'];
    const ordinal = new Map([['64f9c236', 1], ['e9d71bc5', 5]]);
    const err = validateCommitsReachableFromHead(commits, ordinal);
    expect(err).toMatch(/deadbeef/);
  });

  it('accepts a commit range where every commit resolves in the ordinal map', () => {
    const commits = ['64f9c236', 'e9d71bc5', '1436cd63'];
    const ordinal = new Map([['64f9c236', 1], ['e9d71bc5', 5], ['1436cd63', 12]]);
    expect(validateCommitsReachableFromHead(commits, ordinal)).toBeNull();
  });

  it('rejects an abbreviated commit whose prefix matches more than one full SHA, instead of silently picking one', () => {
    // 'abc1234' is a genuine prefix of both full SHAs below — an ambiguous
    // abbreviation must be rejected, not resolved to whichever the map
    // iterates first (mirroring git's own refusal to resolve ambiguous
    // abbreviated object names).
    const commits = ['abc1234'];
    const ordinal = new Map([
      ['abc1234000000000000000000000000000000aa', 3],
      ['abc1234000000000000000000000000000000bb', 7],
    ]);
    const err = validateCommitsReachableFromHead(commits, ordinal, 'fake-api');
    expect(err).toMatch(/ambiguous/i);
    expect(err).toContain('fake-api');
    expect(err).toContain('abc1234');
  });
});

describe('spawn_final_reviewer base/head SHA derivation — 0–1 commit repos', () => {
  // With 0 collected commit hashes there is nothing to validate or order, so
  // the enrichment must not depend on `git` (the rev-list invocation is
  // skipped entirely). worktree_path points at a throwaway non-git directory
  // to prove the path does not require a git repository when there are no
  // commits at all.
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

  // A single accumulated commit still runs the same git-read + reachability
  // check as a multi-commit repo — only the reorder step is skipped for it —
  // so this must be exercised against a real fixture repo, not a fabricated
  // hash at a non-git path.
  it('returns the single commit as both base and head per repo, validated against real git history (one commit)', () => {
    const { fixtures, sourceControl, cleanup } = bindFixtureRepos('test-project', [
      { name: 'backend', commitFiles: [{ 'f.txt': '1' }] },
    ]);
    try {
      const [c0] = fixtures['backend'].commits;
      const s = makeV6State({ taskRepos: [{ name: 'backend', commit_hash: c0.sha }] });
      const mutable = s as unknown as { pipeline: Record<string, unknown> };
      mutable.pipeline = { ...mutable.pipeline, source_control: sourceControl };

      const out = enrichActionContext(makeEnrichmentInput('spawn_final_reviewer', s as unknown as PipelineState));
      expect(Array.isArray(out.repos)).toBe(true);
      const repo = (out.repos as Array<Record<string, unknown>>)[0];
      expect(repo.project_base_sha).toBe(c0.sha);
      expect(repo.project_head_sha).toBe(c0.sha);
      expect(out.error).toBeUndefined();
    } finally {
      cleanup();
    }
  });

  it('rejects a single accumulated commit that is not reachable from a real repo\'s HEAD', () => {
    const { sourceControl, cleanup } = bindFixtureRepos('test-project', [
      { name: 'backend', commitFiles: [{ 'f.txt': '1' }] },
    ]);
    try {
      const bogusSha = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
      const s = makeV6State({ taskRepos: [{ name: 'backend', commit_hash: bogusSha }] });
      const mutable = s as unknown as { pipeline: Record<string, unknown> };
      mutable.pipeline = { ...mutable.pipeline, source_control: sourceControl };

      const out = enrichActionContext(makeEnrichmentInput('spawn_final_reviewer', s as unknown as PipelineState));
      expect(typeof out.error).toBe('string');
      expect(out.error as string).toContain('backend');
      expect(out.error as string).toContain(bogusSha);
      expect(out).not.toHaveProperty('repos');
    } finally {
      cleanup();
    }
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

  /**
   * Per the Master Plan's "one repo per task" authoring policy, a phase's
   * tasks routinely target *different* repos — task 0 touches only fake-api,
   * task 1 touches only fake-ui. Neither repo appears in both the first and
   * last task, so a first/last-task-only lookup would leave one SHA null for
   * each repo. Both repos must still get real first/head SHAs by scanning
   * every task iteration in the phase.
   */
  function buildDisjointRepoPhaseReviewerState(): PipelineState {
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
                          { name: 'fake-api', commit_hash: 'only_api_sha' },
                        ],
                        corrective_tasks: [],
                        nodes: {},
                      },
                      {
                        index: 1,
                        status: 'completed',
                        doc_path: '/fake/t02.md',
                        repos: [
                          { name: 'fake-ui', commit_hash: 'only_ui_sha' },
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

  it('spawn_phase_reviewer still resolves both SHAs when tasks target disjoint repos', () => {
    const state = buildDisjointRepoPhaseReviewerState();
    const ctx = enrichActionContext({ action: 'spawn_phase_reviewer', walkerContext: {}, state, config: DEFAULT_CONFIG, cliContext: {} });
    const repos = ctx.repos as Array<Record<string, unknown>>;
    const apiEntry = repos.find(r => r.name === 'fake-api');
    const uiEntry = repos.find(r => r.name === 'fake-ui');
    // fake-api only appears in task 0 (the first task) — a first/last-task-only
    // lookup would still find phase_first_sha here, but must not miss phase_head_sha.
    expect(apiEntry?.phase_first_sha).toBe('only_api_sha');
    expect(apiEntry?.phase_head_sha).toBe('only_api_sha');
    // fake-ui only appears in task 1 (the last task) — a first/last-task-only
    // lookup would still find phase_head_sha here, but must not miss phase_first_sha.
    expect(uiEntry?.phase_first_sha).toBe('only_ui_sha');
    expect(uiEntry?.phase_head_sha).toBe('only_ui_sha');
  });
});

describe('per-repo commit-range ordering against real git history', () => {
  const DEFAULT_CONFIG = { limits: {} } as unknown as OrchestrationConfig;

  function twoRepoState(
    projectName: string,
    sourceControl: Record<string, unknown>,
    apiHashes: [string, string],
    uiHashes: [string, string],
  ): PipelineState {
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
                          { name: 'fake-api', commit_hash: apiHashes[0] },
                          { name: 'fake-ui', commit_hash: uiHashes[0] },
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
                          { name: 'fake-api', commit_hash: apiHashes[1] },
                          { name: 'fake-ui', commit_hash: uiHashes[1] },
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
      pipeline: { gate_mode: null, current_tier: 'execution', halt_reason: null, source_control: sourceControl },
      project: { name: projectName },
    } as unknown as PipelineState;
  }

  it('final reviewer groups base/head SHAs per repo', () => {
    const { fixtures, sourceControl, cleanup } = bindFixtureRepos('CE-FINAL-GROUPING', [
      { name: 'fake-api', commitFiles: [{ 'api.txt': '1' }, { 'api.txt': '2' }] },
      { name: 'fake-ui', commitFiles: [{ 'ui.txt': '1' }, { 'ui.txt': '2' }] },
    ]);
    try {
      const [apiC0, apiC1] = fixtures['fake-api'].commits;
      const [uiC0, uiC1] = fixtures['fake-ui'].commits;
      const state = twoRepoState('CE-FINAL-GROUPING', sourceControl, [apiC0.sha, apiC1.sha], [uiC0.sha, uiC1.sha]);
      const ctx = enrichActionContext({ action: 'spawn_final_reviewer', walkerContext: {}, state, config: DEFAULT_CONFIG, cliContext: {} });
      expect(ctx.repos).toEqual([
        expect.objectContaining({ name: 'fake-api', project_base_sha: apiC0.sha, project_head_sha: apiC1.sha }),
        expect.objectContaining({ name: 'fake-ui', project_base_sha: uiC0.sha, project_head_sha: uiC1.sha }),
      ]);
    } finally {
      cleanup();
    }
  });

  it('validateCommitsReachableFromHead names the offending repo on a per-repo violation', () => {
    // 'aaaa1111' has no entry in the ordinal map — unreachable from HEAD.
    const ordinal = new Map([['bbbb2222', 1]]);
    const err = validateCommitsReachableFromHead(['aaaa1111', 'bbbb2222'], ordinal, 'fake-api');
    expect(err).toMatch(/fake-api/);
  });

  it('final reviewer range extends over a step-hosted final corrective genuinely last in real history', () => {
    const { fixtures, sourceControl, cleanup } = bindFixtureRepos('CE-CORRECTIVE-LAST', [
      { name: 'fake-api', commitFiles: [{ 'api.txt': '1' }, { 'api.txt': '2' }, { 'api.txt': '3' }] },
      { name: 'fake-ui', commitFiles: [{ 'ui.txt': '1' }, { 'ui.txt': '2' }, { 'ui.txt': '3' }] },
    ]);
    try {
      const [apiC0, apiC1, apiC2] = fixtures['fake-api'].commits;
      const [uiC0, uiC1, uiC2] = fixtures['fake-ui'].commits;
      const state = twoRepoState('CE-CORRECTIVE-LAST', sourceControl, [apiC0.sha, apiC1.sha], [uiC0.sha, uiC1.sha]);
      // A prior final corrective hosted on `final_review`, whose commit is
      // genuinely the newest in real git history (fixture commit index 2) —
      // walk order and real history agree, so the range is unchanged.
      (state.graph.nodes as Record<string, unknown>).final_review = {
        kind: 'step',
        status: 'completed',
        doc_path: '/fake/final-review.md',
        retries: 0,
        hosts_correctives: true,
        corrective_tasks: [
          {
            index: 1,
            status: 'completed',
            reason: 'final review requested changes',
            injected_after: 'final_review',
            nodes: {},
            repos: [
              { name: 'fake-api', commit_hash: apiC2.sha },
              { name: 'fake-ui', commit_hash: uiC2.sha },
            ],
            doc_path: '/fake/final-corrective-handoff.md',
          },
        ],
      };
      const ctx = enrichActionContext({ action: 'spawn_final_reviewer', walkerContext: {}, state, config: DEFAULT_CONFIG, cliContext: {} });
      expect(ctx.repos).toEqual([
        expect.objectContaining({ name: 'fake-api', project_base_sha: apiC0.sha, project_head_sha: apiC2.sha }),
        expect.objectContaining({ name: 'fake-ui', project_base_sha: uiC0.sha, project_head_sha: uiC2.sha }),
      ]);
    } finally {
      cleanup();
    }
  });
});

describe('spawn_final_reviewer corrects the head across an amendment that reopens phase_loop', () => {
  const DEFAULT_CONFIG = { limits: {} } as unknown as OrchestrationConfig;

  it('yields the later phase commit as project_head_sha when a completed final corrective precedes it in real history', () => {
    const { fixtures, sourceControl, cleanup } = bindFixtureRepos('CE-AMEND-HEAD', [
      { name: 'my-repo', commitFiles: [{ 'f.txt': '0' }, { 'f.txt': '1' }, { 'f.txt': '2' }] },
    ]);
    try {
      // Real chronological order: c0 (oldest) → c1 → c2 (newest). c1 is a final
      // corrective that already completed; c2 is a later phase's commit, added
      // by an amendment that reopened `phase_loop` after that corrective ran —
      // so walk order places c2 before c1, even though c2 is chronologically
      // the newest commit in the repo.
      const [c0, c1, c2] = fixtures['my-repo'].commits;
      const state = {
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
                        { index: 0, status: 'completed', doc_path: null, repos: [{ name: 'my-repo', commit_hash: c0.sha }], corrective_tasks: [], nodes: {} },
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
                        { index: 0, status: 'completed', doc_path: null, repos: [{ name: 'my-repo', commit_hash: c2.sha }], corrective_tasks: [], nodes: {} },
                      ],
                    },
                  },
                },
              ],
            },
            final_review: {
              kind: 'step',
              status: 'completed',
              doc_path: '/fake/final-review.md',
              retries: 0,
              hosts_correctives: true,
              corrective_tasks: [
                {
                  index: 1,
                  status: 'completed',
                  reason: 'final review requested changes',
                  injected_after: 'final_review',
                  nodes: {},
                  repos: [{ name: 'my-repo', commit_hash: c1.sha }],
                  doc_path: '/fake/final-corrective-handoff.md',
                },
              ],
            },
          },
        },
        pipeline: { gate_mode: null, current_tier: 'execution', halt_reason: null, source_control: sourceControl },
        project: { name: 'CE-AMEND-HEAD' },
      } as unknown as PipelineState;

      const ctx = enrichActionContext({ action: 'spawn_final_reviewer', walkerContext: {}, state, config: DEFAULT_CONFIG, cliContext: {} });
      expect(ctx.repos).toEqual([
        expect.objectContaining({ name: 'my-repo', project_base_sha: c0.sha, project_head_sha: c2.sha }),
      ]);
    } finally {
      cleanup();
    }
  });
});

describe('spawn_final_reviewer rejects an unreadable or unlocatable commit range', () => {
  const DEFAULT_CONFIG = { limits: {} } as unknown as OrchestrationConfig;

  function twoCommitPhaseState(projectName: string, repoName: string, sourceControl: Record<string, unknown>, hashes: [string, string]): PipelineState {
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
                      { index: 0, status: 'completed', doc_path: null, repos: [{ name: repoName, commit_hash: hashes[0] }], corrective_tasks: [], nodes: {} },
                      { index: 1, status: 'completed', doc_path: null, repos: [{ name: repoName, commit_hash: hashes[1] }], corrective_tasks: [], nodes: {} },
                    ],
                  },
                },
              },
            ],
          },
        },
      },
      pipeline: { gate_mode: null, current_tier: 'execution', halt_reason: null, source_control: sourceControl },
      project: { name: projectName },
    } as unknown as PipelineState;
  }

  it('names the repo and the path when the repo history cannot be read', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ce-final-review-'));
    const notAGitRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'ce-not-a-repo-'));
    try {
      mockUserDataPathsRoot(root);
      const projectName = 'CE-UNREADABLE-HISTORY';
      const repoName = 'backend';

      const sourceControl = {
        worktree_name: projectName,
        auto_commit: 'always',
        auto_pr: 'always',
        repos: [{ name: repoName, branch: 'radorch/test', base_branch: 'main', remote_url: null, compare_url: null, pr_url: null, in_place: true }],
      };
      const projectDir = path.join(root, 'projects', projectName);
      fs.mkdirSync(projectDir, { recursive: true });
      fs.writeFileSync(path.join(projectDir, 'state.json'), JSON.stringify({
        project: { name: projectName },
        pipeline: { source_control: sourceControl },
        graph: { nodes: {} },
      }));
      writeLocal({ root, localPaths: { [repoName]: notAGitRepo } });

      const state = twoCommitPhaseState(projectName, repoName, sourceControl, ['aaaaaaa', 'bbbbbbb']);
      const ctx = enrichActionContext({ action: 'spawn_final_reviewer', walkerContext: {}, state, config: DEFAULT_CONFIG, cliContext: {} });

      expect(typeof ctx.error).toBe('string');
      expect(ctx.error as string).toContain(repoName);
      expect(ctx.error as string).toContain(notAGitRepo);
      expect(ctx.error as string).toMatch(/confirm|re-run/i);
      expect(ctx).not.toHaveProperty('repos');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(notAGitRepo, { recursive: true, force: true });
    }
  });

  it('names the repo and the commit when a commit is not reachable from a real repo\'s HEAD', () => {
    const { fixtures, sourceControl, cleanup } = bindFixtureRepos('CE-UNLOCATABLE', [
      { name: 'backend', commitFiles: [{ 'f.txt': '0' }, { 'f.txt': '1' }] },
    ]);
    try {
      const bogusSha = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
      const state = twoCommitPhaseState('CE-UNLOCATABLE', 'backend', sourceControl, [fixtures['backend'].commits[0].sha, bogusSha]);
      const ctx = enrichActionContext({ action: 'spawn_final_reviewer', walkerContext: {}, state, config: DEFAULT_CONFIG, cliContext: {} });

      expect(typeof ctx.error).toBe('string');
      expect(ctx.error as string).toContain('backend');
      expect(ctx.error as string).toContain(bogusSha);
      expect(ctx.error as string).toContain(fixtures['backend'].repoPath);
      expect(ctx.error as string).toMatch(/confirm|re-run/i);
      expect(ctx).not.toHaveProperty('repos');
    } finally {
      cleanup();
    }
  });

  it('halts naming the repo when its worktree path cannot be resolved, instead of falling back to the process cwd', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ce-final-review-'));
    try {
      mockUserDataPathsRoot(root);
      // No `writeLocal` registration for 'backend' — resolveWorktrees finds no
      // matching entry, so buildReposArray leaves this repo's path as ''.
      const s = makeV6State({ taskRepos: [{ name: 'backend', commit_hash: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef' }] });
      const mutable = s as unknown as { pipeline: Record<string, unknown> };
      mutable.pipeline = {
        ...mutable.pipeline,
        source_control: {
          worktree_name: 'test-project',
          auto_commit: 'always',
          auto_pr: 'always',
          repos: [{ name: 'backend', branch: 'radorch/test', base_branch: 'main', remote_url: null, compare_url: null, pr_url: null }],
        },
      };

      const out = enrichActionContext(makeEnrichmentInput('spawn_final_reviewer', s as unknown as PipelineState));

      expect(typeof out.error).toBe('string');
      expect(out.error as string).toContain('backend');
      expect(out.error as string).not.toContain(process.cwd());
      expect(out).not.toHaveProperty('repos');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('spawn_final_reviewer commit-range derivation is independent of stored hash width', () => {
  const DEFAULT_CONFIG = { limits: {} } as unknown as OrchestrationConfig;

  function twoCommitState(projectName: string, repoName: string, sourceControl: Record<string, unknown>, hashes: [string, string]): PipelineState {
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
                      { index: 0, status: 'completed', doc_path: null, repos: [{ name: repoName, commit_hash: hashes[0] }], corrective_tasks: [], nodes: {} },
                      { index: 1, status: 'completed', doc_path: null, repos: [{ name: repoName, commit_hash: hashes[1] }], corrective_tasks: [], nodes: {} },
                    ],
                  },
                },
              },
            ],
          },
        },
      },
      pipeline: { gate_mode: null, current_tier: 'execution', halt_reason: null, source_control: sourceControl },
      project: { name: projectName },
    } as unknown as PipelineState;
  }

  it('derives the same commit range for 7-character and 8-or-longer stored hashes', () => {
    const { fixtures, sourceControl, cleanup } = bindFixtureRepos('CE-HASH-WIDTH', [
      { name: 'backend', commitFiles: [{ 'f.txt': '0' }, { 'f.txt': '1' }] },
    ]);
    try {
      const [c0, c1] = fixtures['backend'].commits;

      const shortState = twoCommitState('CE-HASH-WIDTH', 'backend', sourceControl, [c0.sha.slice(0, 7), c1.sha.slice(0, 7)]);
      const shortCtx = enrichActionContext({ action: 'spawn_final_reviewer', walkerContext: {}, state: shortState, config: DEFAULT_CONFIG, cliContext: {} });
      const shortRepo = (shortCtx.repos as Array<Record<string, unknown>>)[0];
      expect(shortCtx.error).toBeUndefined();
      expect(shortRepo.project_base_sha).toBe(c0.sha.slice(0, 7));
      expect(shortRepo.project_head_sha).toBe(c1.sha.slice(0, 7));

      const wideState = twoCommitState('CE-HASH-WIDTH', 'backend', sourceControl, [c0.sha.slice(0, 10), c1.sha.slice(0, 10)]);
      const wideCtx = enrichActionContext({ action: 'spawn_final_reviewer', walkerContext: {}, state: wideState, config: DEFAULT_CONFIG, cliContext: {} });
      const wideRepo = (wideCtx.repos as Array<Record<string, unknown>>)[0];
      expect(wideCtx.error).toBeUndefined();
      expect(wideRepo.project_base_sha).toBe(c0.sha.slice(0, 10));
      expect(wideRepo.project_head_sha).toBe(c1.sha.slice(0, 10));

      // Both widths identify the same underlying commits as base/head.
      expect(c0.sha.startsWith(shortRepo.project_base_sha as string)).toBe(true);
      expect(c1.sha.startsWith(shortRepo.project_head_sha as string)).toBe(true);
    } finally {
      cleanup();
    }
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

  // The identity nulls the completion-command renderer keys off (R6). Asserted
  // here at the enrichment seam so the two corrective scopes are separated by an
  // executed test rather than by reading the sentinel block: only the phase scope
  // loses its task number.
  function correctiveEntry(): Record<string, unknown> {
    return { index: 1, status: 'in_progress', reason: 'r', doc_path: '/fake/corrective.md', nodes: {}, repos: [] };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const phaseIterOf = (s: PipelineState): any => (s as any).graph.nodes.phase_loop.iterations[0];

  it('nulls task_number and stamps the P{NN}-PHASE sentinel for a phase-scope corrective', () => {
    const state = execStateWithComplexity('standard');
    phaseIterOf(state).corrective_tasks = [correctiveEntry()];
    const ctx = enrichActionContext({ action: 'execute_task', walkerContext: {}, state, config: DEFAULT_CONFIG, cliContext: {} });
    expect(ctx.phase_number).toBe(1);
    expect(ctx.task_number).toBeNull();
    expect(ctx.task_id).toBe('P01-PHASE');
  });

  it('keeps the real task_number for a task-scope corrective', () => {
    const state = execStateWithComplexity('standard');
    phaseIterOf(state).nodes.task_loop.iterations[0].corrective_tasks = [correctiveEntry()];
    const ctx = enrichActionContext({ action: 'execute_task', walkerContext: {}, state, config: DEFAULT_CONFIG, cliContext: {} });
    expect(ctx.phase_number).toBe(1);
    expect(ctx.task_number).toBe(1);
    expect(ctx.task_id).toBe('P01-T01');
  });
});

describe('spawn_final_reviewer requirements_doc resolution via work-graph (P01-T01)', () => {
  function stateForProject(projectName: string): PipelineState {
    return {
      graph: { nodes: {} },
      pipeline: {},
      project: { name: projectName },
    } as unknown as PipelineState;
  }

  it('carries requirements_doc as the project-relative filename when the doc exists on disk', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ce-requirements-'));
    mockUserDataPathsRoot(root);
    const projectName = 'REQ-DOC-PRESENT';
    const projectDir = path.join(root, 'projects', projectName);
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, `${projectName}-REQUIREMENTS.md`), '# requirements');

    const ctx = enrichActionContext(makeEnrichmentInput('spawn_final_reviewer', stateForProject(projectName)));
    expect(ctx.requirements_doc).toBe(`${projectName}-REQUIREMENTS.md`);
  });

  it('carries requirements_doc as null when the project has no requirements doc', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ce-requirements-'));
    mockUserDataPathsRoot(root);
    const projectName = 'REQ-DOC-ABSENT';
    const projectDir = path.join(root, 'projects', projectName);
    fs.mkdirSync(projectDir, { recursive: true });

    const ctx = enrichActionContext(makeEnrichmentInput('spawn_final_reviewer', stateForProject(projectName)));
    expect(ctx.requirements_doc).toBeNull();
  });
});

describe('final-scope corrective sentinel — absent phase identity, no handoff_doc key (P01 review Finding 1)', () => {
  const DEFAULT_CONFIG = { limits: {} } as unknown as OrchestrationConfig;

  /**
   * Build a state with an open final corrective hosted on `final_review`
   * (kind: 'step', hosts_correctives: true, corrective_tasks: [...]). No
   * phase_loop/task_loop iterations are needed — the final-scope resolver
   * short-circuits before any phase resolution runs.
   */
  function stateWithActiveFinalCorrective(): PipelineState {
    return {
      graph: {
        nodes: {
          final_review: {
            kind: 'step',
            status: 'in_progress',
            doc_path: '/fake/final-review.md',
            retries: 0,
            hosts_correctives: true,
            corrective_tasks: [
              {
                index: 1,
                status: 'in_progress',
                reason: 'final review requested changes',
                injected_after: 'final_review',
                nodes: {},
                repos: [{ name: 'my-api', commit_hash: 'corr123' }],
                doc_path: '/fake/final-corrective-handoff.md',
                review_report_path: '/fake/final-review.md',
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

  it('execute_task at final scope carries a null phase_number/phase_id sentinel and omits handoff_doc entirely', () => {
    const state = stateWithActiveFinalCorrective();
    const ctx = enrichActionContext({ action: 'execute_task', walkerContext: {}, state, config: DEFAULT_CONFIG, cliContext: {} });
    expect(ctx.task_id).toBe('FINAL');
    expect(ctx.task_number).toBeNull();
    expect(ctx.phase_number).toBeNull();
    expect(ctx.phase_id).toBeNull();
    expect(ctx.corrective_index).toBe(1);
    expect(ctx.review_report_path).toBe('/fake/final-review.md');
    expect(Object.hasOwn(ctx, 'handoff_doc')).toBe(false);
  });

  it('spawn_code_reviewer at final scope carries the same sentinel, is_correction, and omits handoff_doc entirely', () => {
    const state = stateWithActiveFinalCorrective();
    const ctx = enrichActionContext({ action: 'spawn_code_reviewer', walkerContext: {}, state, config: DEFAULT_CONFIG, cliContext: {} });
    expect(ctx.task_id).toBe('FINAL');
    expect(ctx.task_number).toBeNull();
    expect(ctx.phase_number).toBeNull();
    expect(ctx.phase_id).toBeNull();
    expect(ctx.is_correction).toBe(true);
    expect(ctx.corrective_index).toBe(1);
    expect(Object.hasOwn(ctx, 'handoff_doc')).toBe(false);
    const repos = ctx.repos as Array<Record<string, unknown>>;
    expect(repos.find(r => r.name === 'my-api')?.head_sha).toBe('corr123');
  });

  it('gate_task at final scope returns the base sentinel without throwing', () => {
    const state = stateWithActiveFinalCorrective();
    const ctx = enrichActionContext({ action: 'gate_task', walkerContext: {}, state, config: DEFAULT_CONFIG, cliContext: {} });
    expect(ctx.task_id).toBe('FINAL');
    expect(ctx.phase_number).toBeNull();
    expect(ctx.phase_id).toBeNull();
  });

  /**
   * When a fresh window opens, `corrective_budget_origin` advances past spent
   * history entries. `corrective_index` must read window-relative
   * (entry.index - budgetOrigin), never the raw ever-growing index.
   */
  function stateWithWindowedFinalCorrective(): PipelineState {
    const base = stateWithActiveFinalCorrective();
    const finalReview = base.graph.nodes.final_review as unknown as {
      corrective_tasks: unknown[];
      corrective_budget_origin?: number;
    };
    finalReview.corrective_tasks = [
      { index: 1, status: 'completed', reason: 'spent history', injected_after: 'final_review', nodes: {}, repos: [{ name: 'my-api', commit_hash: 'old1' }] },
      { index: 2, status: 'completed', reason: 'spent history', injected_after: 'final_review', nodes: {}, repos: [{ name: 'my-api', commit_hash: 'old2' }] },
      {
        index: 3,
        status: 'in_progress',
        reason: 'final review requested changes (new window)',
        injected_after: 'final_review',
        nodes: {},
        repos: [{ name: 'my-api', commit_hash: 'corr123' }],
        doc_path: '/fake/final-corrective-handoff.md',
        review_report_path: '/fake/final-review.md',
      },
    ];
    finalReview.corrective_budget_origin = 2;
    return base;
  }

  it('execute_task at final scope reports corrective_index window-relative after a budget-origin advance', () => {
    const state = stateWithWindowedFinalCorrective();
    const ctx = enrichActionContext({ action: 'execute_task', walkerContext: {}, state, config: DEFAULT_CONFIG, cliContext: {} });
    expect(ctx.corrective_index).toBe(1);
  });

  it('spawn_code_reviewer at final scope reports corrective_index window-relative after a budget-origin advance', () => {
    const state = stateWithWindowedFinalCorrective();
    const ctx = enrichActionContext({ action: 'spawn_code_reviewer', walkerContext: {}, state, config: DEFAULT_CONFIG, cliContext: {} });
    expect(ctx.corrective_index).toBe(1);
  });
});

// The derivation being right is worth little if the dispatch wiring drops the path:
// repos[].path is the only working directory a spawned coder ever sees.
describe('execute_task repos[] carries the clone path for an in_place repo', () => {
  const DEFAULT_CONFIG = { limits: {} } as unknown as OrchestrationConfig;
  const REPO = 'rad-orc-source';

  function seedProject(root: string, inPlace: boolean): PipelineState {
    const projectDir = path.join(root, 'projects', 'test-project');
    fs.mkdirSync(projectDir, { recursive: true });
    const sourceControl = {
      worktree_name: 'test-project',
      auto_commit: 'always',
      auto_pr: 'always',
      repos: [{ name: REPO, branch: 'radorch/test', base_branch: 'main', remote_url: null, compare_url: null, pr_url: null, ...(inPlace ? { in_place: true } : {}) }],
    };
    // WorkGraphService derives from state.json on disk, not the in-memory state,
    // so the binding has to be seeded in both places.
    fs.writeFileSync(path.join(projectDir, 'state.json'), JSON.stringify({
      project: { name: 'test-project' },
      pipeline: { source_control: sourceControl },
      graph: { nodes: {} },
    }));

    const s = makeV6State({ taskRepos: [{ name: REPO, commit_hash: 'abc1234' }] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const phaseIter = (s as any).graph.nodes.phase_loop.iterations[0];
    phaseIter.status = 'in_progress';
    phaseIter.nodes.task_loop.iterations[0].status = 'in_progress';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (s as any).pipeline.source_control = sourceControl;
    return s as unknown as PipelineState;
  }

  function enrichedRepos(state: PipelineState): Array<Record<string, unknown>> {
    const ctx = enrichActionContext({ action: 'execute_task', walkerContext: {}, state, config: DEFAULT_CONFIG, cliContext: {} });
    return ctx.repos as Array<Record<string, unknown>>;
  }

  it('dispatches the registered clone path when the repo is bound in place', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ce-inplace-'));
    mockUserDataPathsRoot(root);
    const clonePath = path.join(root, 'clones', REPO);
    writeLocal({ root, localPaths: { [REPO]: clonePath } });

    expect(enrichedRepos(seedProject(root, true))[0].path).toBe(clonePath);
  });

  it('still dispatches the convention worktree path when the repo is not bound in place', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ce-inplace-'));
    mockUserDataPathsRoot(root);
    writeLocal({ root, localPaths: { [REPO]: path.join(root, 'clones', REPO) } });

    expect(enrichedRepos(seedProject(root, false))[0].path).toBe(path.join(root, 'worktrees', 'test-project', REPO));
  });
});

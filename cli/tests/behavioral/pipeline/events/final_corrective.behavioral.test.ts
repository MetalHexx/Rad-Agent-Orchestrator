// cli/tests/behavioral/pipeline/events/final_corrective.behavioral.test.ts
//
// Full-engine-flow coverage for a FINAL-scope corrective, driven through the
// CLI command layer (the `{ ok, data, error }` envelope the orchestrator
// actually consumes) rather than the engine function directly. This is the
// coverage that catches an engine that validates in isolation but stalls,
// loops, or advances early when driven: birth (final_review_completed),
// coder spawn (task_completed), re-review (code_review_completed), closure,
// and advance — end to end, with no manual state edits between signals.
//
// Uses all three EXECUTION_TEMPLATE_BODY* shapes from fixtures/execution-template.ts:
//   - EXECUTION_TEMPLATE_BODY               — default: hosts_correctives: true,
//     task-loop body = task_gate → task_executor → code_review.
//   - EXECUTION_TEMPLATE_BODY_NO_DECLARATION — final_review carries no
//     hosts_correctives key (the stale per-project-snapshot shape).
//   - EXECUTION_TEMPLATE_BODY_LOWER_TIER     — task-loop body = task_executor
//     only (pins single-attempt closure, not an accidental stall on an
//     absent code_review step).
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, afterEach, beforeEach, expect } from 'vitest';
import { buildWorld } from '../helpers/world.js';
import { captureEnvelope } from '../helpers/capture.js';
import { useRealCatalog } from '../helpers/catalog.js';
import { assertPromptForEnvelopeAction } from '../helpers/prompt.js';
import { pipelineSignalCommand } from '../../../../src/commands/pipeline/signal.js';
import { runCommand } from '../../../../src/framework/command.js';
import {
  EXECUTION_TEMPLATE_BODY,
  EXECUTION_TEMPLATE_BODY_NO_DECLARATION,
  EXECUTION_TEMPLATE_BODY_LOWER_TIER,
  EXECUTION_TEMPLATE_BODY_WITH_PR_GATE,
} from './fixtures/execution-template.js';

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });
beforeEach(() => { cleanups.push(useRealCatalog()); });

// ── World / signal plumbing (mirrors corrective-advance.behavioral.test.ts) ──

async function signal(projectDir: string, configPath: string, argv: string[]) {
  return captureEnvelope(async () => {
    await runCommand(pipelineSignalCommand, {
      argv: [...argv, '--project-dir', projectDir, '--config', configPath],
      env: { ...process.env, RADORCH_NO_LOG: '1', RADORCH_TEMPLATES_DIR: projectDir },
      isTTY: false, stderr: process.stderr,
    });
  });
}

function makeWorld(
  templateBody: string,
  state: unknown,
  sideFiles: Array<{ path: string; contents: string }> = [],
  configOverrides: Record<string, unknown> = {},
) {
  const w = buildWorld({
    template: { id: 'syn-exec', body: templateBody },
    state: state as Parameters<typeof buildWorld>[0]['state'],
    config: {
      default_template: 'syn-exec',
      human_gates: { after_planning: true, execution_mode: 'autonomous', after_final_review: true },
      ...configOverrides,
    },
    sideFiles,
  });
  cleanups.push(w.cleanup);
  return w;
}

function readState(projectDir: string) {
  return JSON.parse(fs.readFileSync(path.join(projectDir, 'state.json'), 'utf8'));
}

// ── Base state builders ───────────────────────────────────────────────────────
//
// Both builders seed a project frame with every phase already completed and
// `final_review` sitting `in_progress` as the frontier — the exact shape a
// live project is in the instant the final reviewer's report lands. Gate mode
// is `autonomous` so task_gate auto-approves and the corrective's own body
// resolves straight to `execute_task` on the very signal that births it.

const ORIGINAL_COMMIT_HASH = 'origHash1';

function baseCompletedPipelineState(finalReviewOverrides: Record<string, unknown> = {}, currentNodePath = 'final_review') {
  return {
    $schema: 'orchestration-state-v6',
    project: { name: 'cli-behavioral', created: '2024-01-01T00:00:00.000Z', updated: '2024-01-01T00:00:00.000Z' },
    config: {
      gate_mode: 'autonomous',
      limits: { max_retries_per_task: 3 },
      source_control: { auto_commit: 'always', auto_pr: 'never' },
    },
    pipeline: {
      gate_mode: 'autonomous',
      source_control: {
        worktree_name: 'cli-behavioral',
        auto_commit: 'always',
        auto_pr: 'never',
        repos: [{ name: 'backend', branch: 'feature/final-syn', base_branch: 'main', remote_url: null, compare_url: null, pr_url: null }],
      },
      current_tier: 'execution',
      halt_reason: null,
    },
    graph: {
      template_id: 'syn-exec',
      status: 'in_progress',
      current_node_path: currentNodePath,
      nodes: {
        gate_mode_selection: { kind: 'gate', status: 'completed', gate_active: false },
        phase_loop: {
          kind: 'for_each_phase',
          status: 'completed',
          iterations: [
            {
              index: 0, status: 'completed', doc_path: null, repos: [], corrective_tasks: [],
              nodes: {
                task_loop: {
                  kind: 'for_each_task',
                  status: 'completed',
                  iterations: [
                    {
                      index: 0, status: 'completed', doc_path: null,
                      repos: [{ name: 'backend', commit_hash: ORIGINAL_COMMIT_HASH }],
                      corrective_tasks: [],
                      nodes: {
                        task_gate:     { kind: 'gate', status: 'completed', gate_active: false },
                        task_executor: { kind: 'step', status: 'completed', doc_path: null, retries: 0 },
                        code_review:   { kind: 'step', status: 'completed', doc_path: null, retries: 0 },
                      },
                    },
                  ],
                },
                phase_gate:   { kind: 'gate', status: 'completed', gate_active: false },
                phase_review: { kind: 'step', status: 'completed', doc_path: null, retries: 0 },
              },
            },
          ],
        },
        final_review:        { kind: 'step', status: 'in_progress', doc_path: null, retries: 0, ...finalReviewOverrides },
        final_approval_gate: { kind: 'gate', status: 'not_started', gate_active: false },
      },
    },
  };
}

function lowerTierCompletedPipelineState(finalReviewOverrides: Record<string, unknown> = {}) {
  return {
    $schema: 'orchestration-state-v6',
    project: { name: 'cli-behavioral', created: '2024-01-01T00:00:00.000Z', updated: '2024-01-01T00:00:00.000Z' },
    config: {
      gate_mode: 'autonomous',
      limits: { max_retries_per_task: 3 },
      source_control: { auto_commit: 'always', auto_pr: 'never' },
    },
    pipeline: {
      gate_mode: 'autonomous',
      source_control: {
        worktree_name: 'cli-behavioral',
        auto_commit: 'always',
        auto_pr: 'never',
        repos: [{ name: 'backend', branch: 'feature/final-syn', base_branch: 'main', remote_url: null, compare_url: null, pr_url: null }],
      },
      current_tier: 'execution',
      halt_reason: null,
    },
    graph: {
      template_id: 'syn-exec',
      status: 'in_progress',
      current_node_path: 'final_review',
      nodes: {
        gate_mode_selection: { kind: 'gate', status: 'completed', gate_active: false },
        phase_loop: {
          kind: 'for_each_phase',
          status: 'completed',
          iterations: [
            {
              index: 0, status: 'completed', doc_path: null, repos: [], corrective_tasks: [],
              nodes: {
                task_loop: {
                  kind: 'for_each_task',
                  status: 'completed',
                  iterations: [
                    {
                      index: 0, status: 'completed', doc_path: null,
                      repos: [{ name: 'backend', commit_hash: ORIGINAL_COMMIT_HASH }],
                      corrective_tasks: [],
                      // No task_gate, no code_review — the lower-tier template
                      // declares neither.
                      nodes: {
                        task_executor: { kind: 'step', status: 'completed', doc_path: null, retries: 0 },
                      },
                    },
                  ],
                },
                phase_gate:   { kind: 'gate', status: 'completed', gate_active: false },
                phase_review: { kind: 'step', status: 'completed', doc_path: null, retries: 0 },
              },
            },
          ],
        },
        final_review:        { kind: 'step', status: 'in_progress', doc_path: null, retries: 0, ...finalReviewOverrides },
        final_approval_gate: { kind: 'gate', status: 'not_started', gate_active: false },
      },
    },
  };
}

/** A step-hosted final-scope corrective entry, mirroring the default body's
 *  task_gate → task_executor → code_review shape. */
function correctiveEntry(opts: {
  index: number;
  status: string;
  taskExecutor: string;
  codeReview: string;
  reviewReportPath?: string | null;
  commitHash?: string | null;
}) {
  return {
    index: opts.index,
    reason: opts.index === 1 ? 'Final review requested changes' : 'Code review requested changes',
    injected_after: opts.index === 1 ? 'final_review' : 'code_review',
    status: opts.status,
    doc_path: null,
    review_report_path: opts.reviewReportPath ?? null,
    repos: opts.commitHash !== undefined ? [{ name: 'backend', commit_hash: opts.commitHash }] : [],
    nodes: {
      task_gate:     { kind: 'gate', status: 'completed', gate_active: false },
      task_executor: { kind: 'step', status: opts.taskExecutor, doc_path: null, retries: 0 },
      code_review:   { kind: 'step', status: opts.codeReview, doc_path: null, retries: 0 },
    },
  };
}

// ── Side-file doc contents ────────────────────────────────────────────────────

const FINAL_REVIEW_DOC = 'final-review.md';
const CHANGES_REQUESTED_DOC = `---\nverdict: changes_requested\n---\nFinal review requested changes.\n`;
const APPROVED_FINAL_REVIEW_DOC = `---\nverdict: approved\n---\nFinal review approved.\n`;
const FIRST_CR_DOC = 'reports/final-cr-1.md';
const APPROVED_CR_DOC = `---\nverdict: approved\n---\nFinal corrective code review — approved.\n`;
const SECOND_CR_DOC = 'reports/final-cr-2.md';
const CHANGES_REQUESTED_CR_DOC = `---\nverdict: changes_requested\n---\nFinal corrective code review — requests further changes.\n`;

// ── The three-signal cycle, envelope-asserted at each step ───────────────────

describe('final-scope corrective — full three-signal cycle driven through the CLI envelope', () => {
  it('final_review_completed(changes_requested) -> task_completed -> code_review_completed(approved) drives to a completed final_review with no manual state edits', async () => {
    const w = makeWorld(EXECUTION_TEMPLATE_BODY, baseCompletedPipelineState(), [
      { path: FINAL_REVIEW_DOC, contents: CHANGES_REQUESTED_DOC },
      { path: FIRST_CR_DOC, contents: APPROVED_CR_DOC },
    ]);
    const finalReviewDocAbs = path.join(w.projectDir, FINAL_REVIEW_DOC);
    const crDocAbs = path.join(w.projectDir, FIRST_CR_DOC);

    // 1. final_review_completed(changes_requested) births the corrective; the
    //    SAME walk drives straight into its body (task_gate auto-approves
    //    under gate_mode=autonomous), landing on task_executor.
    let env = await signal(w.projectDir, w.configPath, [
      '--event', 'final_review_completed', '--doc-path', finalReviewDocAbs, '--verdict', 'changes_requested',
    ]);
    expect(env.ok, env.error?.message).toBe(true);
    let data = env.data as { action: string; context: Record<string, unknown> };
    expect(data.action).toBe('execute_task');
    expect(data.context.task_id).toBe('FINAL');
    expect(Object.hasOwn(data.context, 'handoff_doc')).toBe(false);
    expect(data.context.review_report_path).toBe(finalReviewDocAbs.replace(/\\/g, '/'));
    assertPromptForEnvelopeAction(env);

    let onDisk = readState(w.projectDir);
    let host = onDisk.graph.nodes.final_review;
    expect(host.status).toBe('in_progress');
    expect(host.corrective_tasks).toHaveLength(1);
    expect(host.corrective_tasks[0].status).toBe('in_progress');
    expect(host.corrective_tasks[0].nodes).toMatchObject({
      task_gate: { status: 'completed' },
      task_executor: { status: 'in_progress' },
      code_review: { status: 'not_started' },
    });

    // 2. task_completed — records the corrective's OWN commit hash (distinct
    //    from the original task iteration's) and advances to code review.
    env = await signal(w.projectDir, w.configPath, [
      '--event', 'task_completed',
      '--repos', JSON.stringify([{ name: 'backend', committed: true, commitHash: 'finalcorr1', pushed: true }]),
      '--branch', 'feature/final-syn',
    ]);
    expect(env.ok, env.error?.message).toBe(true);
    data = env.data as { action: string; context: Record<string, unknown> };
    expect(data.action).toBe('spawn_code_reviewer');
    expect(data.context.is_correction).toBe(true);
    const repos = data.context.repos as Array<Record<string, unknown>>;
    expect(repos.find((r) => r.name === 'backend')?.head_sha).toBe('finalcorr1');
    assertPromptForEnvelopeAction(env);

    onDisk = readState(w.projectDir);
    host = onDisk.graph.nodes.final_review;
    expect(host.corrective_tasks[0].nodes.task_executor.status).toBe('completed');
    expect(host.corrective_tasks[0].nodes.code_review.status).toBe('in_progress');
    expect(host.corrective_tasks[0].repos[0].commit_hash).toBe('finalcorr1');
    // The ORIGINAL task iteration's commit hash is untouched by the
    // corrective's own write-destination.
    const originalIter = onDisk.graph.nodes.phase_loop.iterations[0].nodes.task_loop.iterations[0];
    expect(originalIter.repos[0].commit_hash).toBe(ORIGINAL_COMMIT_HASH);

    // 3. code_review_completed(approved) — closes the corrective's body,
    //    completes final_review, and the walker advances to the final
    //    approval gate (the PR conditional's child in a richer template).
    env = await signal(w.projectDir, w.configPath, [
      '--event', 'code_review_completed', '--doc-path', crDocAbs, '--verdict', 'approved',
    ]);
    expect(env.ok, env.error?.message).toBe(true);
    data = env.data as { action: string };
    expect(data.action).toBe('request_final_approval');
    assertPromptForEnvelopeAction(env);

    onDisk = readState(w.projectDir);
    host = onDisk.graph.nodes.final_review;
    expect(host.status).toBe('completed');
    expect(host.verdict).toBe('approved');
    expect(host.corrective_tasks[0].status).toBe('completed');
    expect(onDisk.graph.nodes.final_approval_gate.gate_active).toBe(true);
  });
});

// ── Separate case: the walker prefers the open corrective ────────────────────

describe('walker prefers an open final corrective over re-emitting spawn_final_reviewer', () => {
  it('start resumes into the corrective\'s task_executor frontier instead of re-spawning the final reviewer', async () => {
    const state = baseCompletedPipelineState({
      corrective_tasks: [correctiveEntry({
        index: 1, status: 'in_progress', taskExecutor: 'in_progress', codeReview: 'not_started',
        reviewReportPath: 'final-review.md',
      })],
    }, 'final_review.corrective_tasks[1].task_executor');
    const w = makeWorld(EXECUTION_TEMPLATE_BODY, state);

    const env = await signal(w.projectDir, w.configPath, ['--event', 'start']);

    expect(env.ok, env.error?.message).toBe(true);
    const data = env.data as { action: string };
    expect(data.action).toBe('execute_task');
    expect(data.action).not.toBe('spawn_final_reviewer');
  });
});

// ── Separate case: the undeclared-host halt ──────────────────────────────────

describe('undeclared-host halt (no-declaration variant)', () => {
  it('changes_requested against a template snapshot with no hosts_correctives halts, naming the stale snapshot', async () => {
    const w = makeWorld(EXECUTION_TEMPLATE_BODY_NO_DECLARATION, baseCompletedPipelineState(), [
      { path: FINAL_REVIEW_DOC, contents: CHANGES_REQUESTED_DOC },
    ]);
    const finalReviewDocAbs = path.join(w.projectDir, FINAL_REVIEW_DOC);

    const env = await signal(w.projectDir, w.configPath, [
      '--event', 'final_review_completed', '--doc-path', finalReviewDocAbs, '--verdict', 'changes_requested',
    ]);

    expect(env.ok, env.error?.message).toBe(true);
    const data = env.data as { action: string; context: Record<string, unknown> };
    expect(data.action).toBe('display_halted');
    const details = data.context.details as string;
    expect(details).toMatch(/predates/i);
    expect(details).toMatch(/snapshot/i);
    expect(details).toMatch(/hosts_correctives/);
    assertPromptForEnvelopeAction(env);

    const onDisk = readState(w.projectDir);
    expect(onDisk.graph.status).toBe('halted');
    expect(onDisk.graph.nodes.final_review.corrective_tasks ?? []).toHaveLength(0);
  });
});

// ── Separate case: single-attempt closure on the lower-tier variant ──────────

describe('single-attempt closure (lower-tier variant, task_executor-only body)', () => {
  it('closes the corrective and completes final_review after task_executor alone, with no code_review step', async () => {
    const w = makeWorld(EXECUTION_TEMPLATE_BODY_LOWER_TIER, lowerTierCompletedPipelineState(), [
      { path: FINAL_REVIEW_DOC, contents: CHANGES_REQUESTED_DOC },
    ]);
    const finalReviewDocAbs = path.join(w.projectDir, FINAL_REVIEW_DOC);

    let env = await signal(w.projectDir, w.configPath, [
      '--event', 'final_review_completed', '--doc-path', finalReviewDocAbs, '--verdict', 'changes_requested',
    ]);
    expect(env.ok, env.error?.message).toBe(true);
    let data = env.data as { action: string };
    expect(data.action).toBe('execute_task');

    let onDisk = readState(w.projectDir);
    const entryNodes = onDisk.graph.nodes.final_review.corrective_tasks[0].nodes;
    expect(Object.keys(entryNodes)).toEqual(['task_executor']);
    expect(entryNodes.task_executor.status).toBe('in_progress');

    env = await signal(w.projectDir, w.configPath, [
      '--event', 'task_completed',
      '--repos', JSON.stringify([{ name: 'backend', committed: true, commitHash: 'lowertier1', pushed: true }]),
      '--branch', 'feature/final-syn',
    ]);
    expect(env.ok, env.error?.message).toBe(true);
    data = env.data as { action: string };
    // Single-attempt closure: no code_review step exists in this template, so
    // the corrective closes immediately and the walker advances straight to
    // the final approval gate — not a stall waiting on an absent review step.
    expect(data.action).toBe('request_final_approval');

    onDisk = readState(w.projectDir);
    const host = onDisk.graph.nodes.final_review;
    expect(host.status).toBe('completed');
    expect(host.corrective_tasks[0].status).toBe('completed');
    expect(host.corrective_tasks[0].repos[0].commit_hash).toBe('lowertier1');
  });
});

// ── Separate case: closure resolves into the real PR conditional ────────────
//
// Finding 1 (P02 phase review): the default three-signal cycle only proxies
// "PR conditional unblocked" via final_approval_gate.gate_active. This case
// drives the same three signals against a template carrying a real
// `pr_gate` conditional (mirroring runtime-config/templates/high.yml) and
// asserts the walker actually resolves into the conditional's `true` branch
// — the `final_pr` step's `invoke_source_control_pr` action — rather than
// stopping at a proxy gate flag.

function withPrGateState(finalReviewOverrides: Record<string, unknown> = {}) {
  const state = baseCompletedPipelineState(finalReviewOverrides) as {
    pipeline: { source_control: Record<string, unknown> };
    graph: { nodes: Record<string, unknown> };
  };
  // auto_pr != 'never' so pr_gate's condition (state_ref pipeline.source_control.auto_pr, neq never) takes the true branch.
  state.pipeline.source_control.auto_pr = 'always';
  state.graph.nodes.pr_gate = { kind: 'conditional', status: 'not_started', branch_taken: null };
  state.graph.nodes.final_pr = { kind: 'step', status: 'not_started', doc_path: null, retries: 0 };
  return state;
}

describe('final-scope corrective closure resolves into the real PR conditional (pr_gate variant)', () => {
  it('code_review_completed(approved) closes the corrective, completes final_review, and resolves pr_gate into final_pr', async () => {
    const w = makeWorld(EXECUTION_TEMPLATE_BODY_WITH_PR_GATE, withPrGateState(), [
      { path: FINAL_REVIEW_DOC, contents: CHANGES_REQUESTED_DOC },
      { path: FIRST_CR_DOC, contents: APPROVED_CR_DOC },
    ]);
    const finalReviewDocAbs = path.join(w.projectDir, FINAL_REVIEW_DOC);
    const crDocAbs = path.join(w.projectDir, FIRST_CR_DOC);

    let env = await signal(w.projectDir, w.configPath, [
      '--event', 'final_review_completed', '--doc-path', finalReviewDocAbs, '--verdict', 'changes_requested',
    ]);
    expect(env.ok, env.error?.message).toBe(true);

    env = await signal(w.projectDir, w.configPath, [
      '--event', 'task_completed',
      '--repos', JSON.stringify([{ name: 'backend', committed: true, commitHash: 'finalcorr1', pushed: true }]),
      '--branch', 'feature/final-syn',
    ]);
    expect(env.ok, env.error?.message).toBe(true);

    env = await signal(w.projectDir, w.configPath, [
      '--event', 'code_review_completed', '--doc-path', crDocAbs, '--verdict', 'approved',
    ]);
    expect(env.ok, env.error?.message).toBe(true);
    const data = env.data as { action: string };
    // The walker falls through final_review (now completed) straight into
    // pr_gate, resolves its condition true, and returns the true branch's
    // final_pr action — not a proxy gate flag.
    expect(data.action).toBe('invoke_source_control_pr');
    assertPromptForEnvelopeAction(env);

    const onDisk = readState(w.projectDir);
    expect(onDisk.graph.nodes.final_review.status).toBe('completed');
    expect(onDisk.graph.nodes.pr_gate.branch_taken).toBe('true');
    expect(onDisk.graph.nodes.final_pr.status).toBe('in_progress');
  });
});

// ── Fixture state snapshots: first, second, budget-exhausted, pre-change ─────

describe('final-scope corrective retry ladder — fixture state snapshots', () => {
  it('first attempt: start resumes into corrective_tasks[0] (index 1) mid-flight', async () => {
    const state = baseCompletedPipelineState({
      corrective_tasks: [correctiveEntry({
        index: 1, status: 'in_progress', taskExecutor: 'in_progress', codeReview: 'not_started',
        reviewReportPath: 'final-review.md',
      })],
    }, 'final_review.corrective_tasks[1].task_executor');
    const w = makeWorld(EXECUTION_TEMPLATE_BODY, state);

    const env = await signal(w.projectDir, w.configPath, ['--event', 'start']);

    expect(env.ok, env.error?.message).toBe(true);
    const data = env.data as { action: string; context: Record<string, unknown> };
    expect(data.action).toBe('execute_task');
    expect(data.context.corrective_index).toBe(1);
  });

  it('second attempt: start resumes into corrective_tasks[1] (index 2) after the first attempt closed', async () => {
    const state = baseCompletedPipelineState({
      corrective_tasks: [
        correctiveEntry({ index: 1, status: 'completed', taskExecutor: 'completed', codeReview: 'completed', reviewReportPath: 'final-review.md' }),
        correctiveEntry({ index: 2, status: 'in_progress', taskExecutor: 'in_progress', codeReview: 'not_started', reviewReportPath: 'reports/final-cr-1.md' }),
      ],
    }, 'final_review.corrective_tasks[2].task_executor');
    const w = makeWorld(EXECUTION_TEMPLATE_BODY, state);

    const env = await signal(w.projectDir, w.configPath, ['--event', 'start']);

    expect(env.ok, env.error?.message).toBe(true);
    const data = env.data as { action: string; context: Record<string, unknown> };
    expect(data.action).toBe('execute_task');
    expect(data.context.corrective_index).toBe(2);
  });

  it('budget-exhausted: a third changes_requested beyond max_retries_per_task=2 halts, naming the window and the ceiling', async () => {
    const state = baseCompletedPipelineState({
      corrective_tasks: [
        correctiveEntry({ index: 1, status: 'completed', taskExecutor: 'completed', codeReview: 'completed', reviewReportPath: 'final-review.md' }),
        correctiveEntry({ index: 2, status: 'in_progress', taskExecutor: 'completed', codeReview: 'in_progress', reviewReportPath: 'reports/final-cr-1.md' }),
      ],
    });
    const w = makeWorld(EXECUTION_TEMPLATE_BODY, state, [
      { path: SECOND_CR_DOC, contents: CHANGES_REQUESTED_CR_DOC },
    ], { limits: { max_retries_per_task: 2 } });
    const crDocAbs = path.join(w.projectDir, SECOND_CR_DOC);

    const env = await signal(w.projectDir, w.configPath, [
      '--event', 'code_review_completed', '--doc-path', crDocAbs, '--verdict', 'changes_requested',
    ]);

    expect(env.ok, env.error?.message).toBe(true);
    const data = env.data as { action: string; context: Record<string, unknown> };
    expect(data.action).toBe('display_halted');
    const details = data.context.details as string;
    expect(details).toMatch(/budget exhausted/i);
    expect(details).toMatch(/max_retries_per_task=2/);

    const onDisk = readState(w.projectDir);
    expect(onDisk.graph.nodes.final_review.corrective_tasks).toHaveLength(2);
    expect(onDisk.graph.status).toBe('halted');
  });

  it('pre-change compatibility: a final_review node carrying neither hosts_correctives nor corrective_tasks completes normally on an approved verdict', async () => {
    // Deliberately BOTH fields absent — the true pre-feature shape every
    // in-flight project's state.json carries, not merely an empty array.
    const state = baseCompletedPipelineState();
    const w = makeWorld(EXECUTION_TEMPLATE_BODY_NO_DECLARATION, state, [
      { path: FINAL_REVIEW_DOC, contents: APPROVED_FINAL_REVIEW_DOC },
    ]);
    const finalReviewDocAbs = path.join(w.projectDir, FINAL_REVIEW_DOC);

    const env = await signal(w.projectDir, w.configPath, [
      '--event', 'final_review_completed', '--doc-path', finalReviewDocAbs, '--verdict', 'approved',
    ]);

    expect(env.ok, env.error?.message).toBe(true);
    const data = env.data as { action: string };
    expect(data.action).toBe('request_final_approval');

    const onDisk = readState(w.projectDir);
    expect(onDisk.graph.nodes.final_review.status).toBe('completed');
    expect(onDisk.pipeline.current_tier).toBe('review');
  });
});

/**
 * corrective-helpers.ts — fixture helpers for corrective-commit integration tests.
 *
 * `driveTwoRepoTaskCorrective`: drives the pipeline to a state where phase 1 task 1
 * has an active task-scope corrective entry with `repos: []`. The corrective is born
 * via a `code_review_completed` carrying a raw `changes_requested` verdict.
 *
 * `activeCorrective`: returns the latest (active) corrective task entry for a given
 * phase/task from the mock IO state.
 *
 * These are consumed by `corrective-commit-multirepo.test.ts` which verifies that
 * the P04-T02 create-or-match-by-name write works across the corrective site (FR-7,
 * NFR-6).
 */

import { processEvent } from '../../../../src/lib/pipeline-engine/engine.js';
import type {
  CorrectiveTaskEntry,
  ForEachPhaseNodeState,
  ForEachTaskNodeState,
  IterationEntry,
} from '../../../../src/lib/pipeline-engine/types.js';
import {
  PROJECT_DIR,
  TEST_PATH_CONTEXT,
  DEFAULT_CONFIG,
  createMockIOWithConfig,
  createConfig,
  completePlanningSteps,
  seedDoc,
  seedExplosionStateFor,
  codeReviewDoc,
  phaseReviewDoc,
  DOC_STORE,
  type MockIO,
} from './parity-states.js';
import type { StepNodeState } from '../../../../src/lib/pipeline-engine/types.js';

// ── driveTwoRepoTaskCorrective ────────────────────────────────────────────────

/**
 * Drives the pipeline from scaffold through phase 1 task 1, firing
 * `code_review_completed` with a raw `changes_requested` verdict so that a
 * task-scope corrective is born with `repos: []`. The corrective carries the
 * ORIGINAL task handoff as its `doc_path` and the review report as its
 * `review_report_path`. Returns MockIO positioned at the corrective-active tier
 * (corrective is `in_progress`, waiting for task_executor to complete).
 *
 * The source-control state carries two repos (`fake-api` and `fake-ui`) so
 * the corrective tests can assert create-or-match-by-name across both entries
 * (FR-7, NFR-6).
 *
 * Implementation note: the second `processEvent('start')` after
 * `seedExplosionStateFor` triggers the cursor-honesty tripwire because the
 * stored cursor ('plan_approval_gate') disagrees with the in_progress marker
 * derived after the walker advances task_executor. We bypass this by directly
 * scaffolding the task-iteration body nodes and updating the cursor to the
 * known post-walk value before continuing with subsequent events.
 */
export function driveTwoRepoTaskCorrective(): MockIO {
  const io = createMockIOWithConfig(null, DEFAULT_CONFIG);
  processEvent('start', PROJECT_DIR, {}, io, TEST_PATH_CONTEXT);

  // Complete planning steps so plan_approved can proceed.
  const state = io.currentState!;
  completePlanningSteps(state, 'explode_master_plan');
  const mpDoc = (state.graph.nodes['master_plan'] as StepNodeState).doc_path!;
  seedDoc(mpDoc, { total_phases: 1, total_tasks: 1 });

  const planResult = processEvent(
    'plan_approved',
    PROJECT_DIR,
    { doc_path: mpDoc },
    io,
    TEST_PATH_CONTEXT,
  );

  // Pass through gate_mode_selection if present (ask mode).
  if (planResult.action === 'ask_gate_mode') {
    processEvent('gate_mode_set', PROJECT_DIR, { gate_mode: 'task' }, io, TEST_PATH_CONTEXT);
    io.currentState!.pipeline.gate_mode = null;
  }

  // Set source control with two repos (fake-api + fake-ui) so task_completed
  // can write to both entries by name via the create-or-match path.
  // Write through io.writeState so the private currentState is updated.
  const withSC = structuredClone(io.currentState!);
  withSC.pipeline.source_control = {
    worktree_name: 'PARITY-TEST',
    auto_commit: 'always',
    auto_pr: 'never',
    repos: [
      {
        name: 'fake-api',
        branch: 'radorch/p',
        base_branch: 'main',
        remote_url: null,
        compare_url: null,
        pr_url: null,
      },
      {
        name: 'fake-ui',
        branch: 'radorch/p',
        base_branch: 'main',
        remote_url: null,
        compare_url: null,
        pr_url: null,
      },
    ],
  };
  io.writeState(PROJECT_DIR, withSC);

  // Seed the explosion state (phase/task iterations + docs).
  seedExplosionStateFor(io, 1, 1);

  // ── Manually advance to execution tier to bypass the cursor tripwire ──────
  //
  // Calling processEvent('start') here triggers a post-walk validation failure:
  // the walker advances task_executor to in_progress, making the derived cursor
  // 'phase_loop[0].task_loop[0].task_executor', but the stored cursor is still
  // 'plan_approval_gate' (set by plan_approved). The engine rejects the write.
  //
  // Fix: directly scaffold the task-iteration body nodes and update both the
  // node statuses and the stored cursor to the known post-expansion values.
  // This is exactly what the engine would write if the cursor were correct.
  {
    const patched = structuredClone(io.currentState!);
    const phaseLoop = patched.graph.nodes['phase_loop'] as ForEachPhaseNodeState;
    const phaseIter = phaseLoop.iterations[0];
    phaseIter.status = 'in_progress';

    const taskLoop = phaseIter.nodes['task_loop'] as ForEachTaskNodeState;
    taskLoop.status = 'in_progress';

    const taskIter = taskLoop.iterations[0];
    taskIter.status = 'in_progress';

    // Scaffold the task-loop body nodes that the walker would produce.
    // The template body order is: task_executor, code_review, task_gate.
    taskIter.nodes = {
      task_executor: { kind: 'step', status: 'in_progress', doc_path: null, retries: 0 },
      code_review:   { kind: 'step', status: 'not_started', doc_path: null, retries: 0 },
      task_gate:     { kind: 'gate', status: 'not_started', gate_active: false },
    };

    // Advance the cursor to match the in_progress marker (satisfies the
    // post-walk honesty invariant enforced by subsequent events' pre-walk
    // validateState calls).
    patched.graph.current_node_path = 'phase_loop[0].task_loop[0].task_executor';

    io.writeState(PROJECT_DIR, patched);
  }

  // ── Drive task 1: task_completed (with commit result) → code_review(changes_requested) ──

  // 1. task_completed: advances task_executor → completed and records the coder's
  //    per-repo commit hashes on the task iteration (auto_commit=always), then the
  //    walker advances to code review.
  processEvent(
    'task_completed',
    PROJECT_DIR,
    {
      phase: 1,
      task: 1,
      branch: 'radorch/p',
      repos: [
        { name: 'fake-api', committed: true, commitHash: 'apihash1', pushed: true },
        { name: 'fake-ui',  committed: true, commitHash: 'uihash1',  pushed: true },
      ],
    },
    io,
    TEST_PATH_CONTEXT,
  );

  // 2. Seed the code review doc with a raw changes_requested verdict.
  const reviewDoc = codeReviewDoc(1, 1);
  DOC_STORE[reviewDoc.replace(/\\/g, '/')] = {
    frontmatter: {
      verdict: 'changes_requested',
      reason: 'Code review requested changes — multirepo corrective test',
    },
    content: '# Code Review\n\nRequested changes.',
  };

  // 3. Fire code_review_completed with changes_requested to birth the corrective.
  processEvent(
    'code_review_completed',
    PROJECT_DIR,
    {
      phase: 1,
      task: 1,
      doc_path: reviewDoc,
    },
    io,
    TEST_PATH_CONTEXT,
  );

  return io;
}

// ── activeCorrective ──────────────────────────────────────────────────────────

/**
 * Returns the latest (active) corrective task entry for the given phase/task
 * from the current state. The corrective is expected to be `in_progress` or
 * `not_started` with `repos: []` as born.
 *
 * Throws if no corrective entries exist for the given phase/task.
 */
export function activeCorrective(io: MockIO, phase: number, task: number): CorrectiveTaskEntry {
  const state = io.currentState!;
  const phaseLoopNode = state.graph.nodes['phase_loop'] as ForEachPhaseNodeState;
  const phaseIter = phaseLoopNode.iterations[phase - 1];
  const taskLoopNode = phaseIter.nodes['task_loop'] as ForEachTaskNodeState;
  const taskIter = taskLoopNode.iterations[task - 1];

  const correctives = taskIter.corrective_tasks;
  if (correctives.length === 0) {
    throw new Error(
      `activeCorrective: no corrective_tasks found for phase=${phase} task=${task}. ` +
      `Did driveTwoRepoTaskCorrective() complete successfully?`,
    );
  }

  // Return the latest entry (the active one).
  return correctives[correctives.length - 1];
}

// ── driveTwoRepoFinalCorrective ───────────────────────────────────────────────

const FINAL_CORRECTIVE_CONFIG = createConfig({
  source_control: { auto_commit: 'always', auto_pr: 'never' },
  human_gates: { execution_mode: 'task', after_final_review: true },
});

/**
 * Drives a two-repo project through the full execution loop — task, code
 * review (approved), phase review (approved) — to `final_review`, then fires
 * `final_review_completed` with a raw `changes_requested` verdict so a
 * final-scope corrective is born on `graph.nodes.final_review.corrective_tasks`.
 * Returns MockIO positioned with that corrective's `task_executor` ready to
 * receive `task_completed` at scope `final`.
 *
 * The original phase-1/task-1 iteration's `repos` carries commit hashes
 * recorded during this drive (`origapi1` / `origui1`) — the final-scope write-
 * destination tests assert these stay byte-identical after the final-scope
 * event fires.
 *
 * Mirrors `driveTwoRepoProjectEndToEnd`'s (engine.integration.test.ts)
 * manual-advance pattern to bypass the cursor-honesty tripwire, the same way
 * `driveTwoRepoTaskCorrective` above does.
 */
export function driveTwoRepoFinalCorrective(): MockIO {
  const io = createMockIOWithConfig(null, FINAL_CORRECTIVE_CONFIG);
  processEvent('start', PROJECT_DIR, {}, io, TEST_PATH_CONTEXT);

  const state = io.currentState!;
  completePlanningSteps(state, 'explode_master_plan');
  const mpDoc = (state.graph.nodes['master_plan'] as StepNodeState).doc_path!;
  seedDoc(mpDoc, { total_phases: 1, total_tasks: 1 });

  const planResult = processEvent('plan_approved', PROJECT_DIR, { doc_path: mpDoc }, io, TEST_PATH_CONTEXT);
  if (planResult.action === 'ask_gate_mode') {
    processEvent('gate_mode_set', PROJECT_DIR, { gate_mode: 'task' }, io, TEST_PATH_CONTEXT);
  }

  // Two-repo source control (fake-api + fake-ui).
  {
    const withSC = structuredClone(io.currentState!);
    withSC.pipeline.source_control = {
      worktree_name: 'PARITY-TEST',
      auto_commit: 'always',
      auto_pr: 'never',
      repos: [
        { name: 'fake-api', branch: 'radorch/p', base_branch: 'main', remote_url: null, compare_url: null, pr_url: null },
        { name: 'fake-ui', branch: 'radorch/p', base_branch: 'main', remote_url: null, compare_url: null, pr_url: null },
      ],
    };
    io.writeState(PROJECT_DIR, withSC);
  }

  seedExplosionStateFor(io, 1, 1);

  // Override the task iteration's repos to carry both fake-api and fake-ui
  // (seedExplosionStateFor defaults to a single rad-orc-source-shaped entry).
  {
    const patched = structuredClone(io.currentState!);
    const phaseLoop = patched.graph.nodes['phase_loop'] as ForEachPhaseNodeState;
    const taskLoop = phaseLoop.iterations[0].nodes['task_loop'] as ForEachTaskNodeState;
    taskLoop.iterations[0].repos = [
      { name: 'fake-api', commit_hash: null },
      { name: 'fake-ui', commit_hash: null },
    ];
    io.writeState(PROJECT_DIR, patched);
  }

  // Manually advance to execution tier (bypass the cursor-honesty tripwire).
  {
    const patched = structuredClone(io.currentState!);
    const phaseLoop = patched.graph.nodes['phase_loop'] as ForEachPhaseNodeState;
    const phaseIter = phaseLoop.iterations[0];
    phaseIter.status = 'in_progress';

    const taskLoop = phaseIter.nodes['task_loop'] as ForEachTaskNodeState;
    taskLoop.status = 'in_progress';

    const taskIter = taskLoop.iterations[0];
    taskIter.status = 'in_progress';

    taskIter.nodes = {
      task_executor: { kind: 'step', status: 'in_progress', doc_path: null, retries: 0 },
      code_review: { kind: 'step', status: 'not_started', doc_path: null, retries: 0 },
      task_gate: { kind: 'gate', status: 'not_started', gate_active: false },
    };

    patched.graph.current_node_path = 'phase_loop[0].task_loop[0].task_executor';
    io.writeState(PROJECT_DIR, patched);
  }

  // Original task: commit, review, phase review — all approved, so the ORIGINAL
  // task iteration's `repos` carries the hashes the final-scope test asserts
  // stay untouched by the final-scope event.
  processEvent('task_completed', PROJECT_DIR, {
    phase: 1, task: 1, branch: 'radorch/p',
    repos: [
      { name: 'fake-api', committed: true, commitHash: 'origapi1', pushed: true },
      { name: 'fake-ui', committed: true, commitHash: 'origui1', pushed: true },
    ],
  }, io, TEST_PATH_CONTEXT);

  const reviewDoc = codeReviewDoc(1, 1);
  seedDoc(reviewDoc);
  let result = processEvent('code_review_completed', PROJECT_DIR, {
    phase: 1, task: 1, doc_path: reviewDoc, verdict: 'approved',
  }, io, TEST_PATH_CONTEXT);
  if (result.action === 'gate_task') {
    result = processEvent('task_gate_approved', PROJECT_DIR, { phase: 1, task: 1 }, io, TEST_PATH_CONTEXT);
  }

  const prvDoc = phaseReviewDoc(1);
  seedDoc(prvDoc);
  result = processEvent('phase_review_completed', PROJECT_DIR, {
    phase: 1, doc_path: prvDoc, verdict: 'approved', exit_criteria_met: true,
  }, io, TEST_PATH_CONTEXT);
  if (result.action === 'gate_phase') {
    result = processEvent('phase_gate_approved', PROJECT_DIR, { phase: 1 }, io, TEST_PATH_CONTEXT);
  }

  // final_review is now in_progress (result.action === 'spawn_final_reviewer').
  // Birth a final-scope corrective off it with a raw changes_requested verdict.
  const finalReviewDoc = PROJECT_DIR + '/final-review.md';
  seedDoc(finalReviewDoc);
  processEvent('final_review_completed', PROJECT_DIR, {
    doc_path: finalReviewDoc,
    verdict: 'changes_requested',
    reason: 'Final review requested changes',
  }, io, TEST_PATH_CONTEXT);

  return io;
}

// ── activeFinalCorrective / originalTaskIteration ─────────────────────────────

/**
 * Returns the latest (active) corrective task entry hosted on `final_review`.
 * Throws if `final_review` carries no corrective entries.
 */
export function activeFinalCorrective(io: MockIO): CorrectiveTaskEntry {
  const state = io.currentState!;
  const finalReview = state.graph.nodes['final_review'] as StepNodeState;
  const correctives = finalReview.corrective_tasks ?? [];
  if (correctives.length === 0) {
    throw new Error('activeFinalCorrective: no corrective_tasks found on final_review.');
  }
  return correctives[correctives.length - 1];
}

/**
 * Returns the ORIGINAL (non-corrective) task iteration for the given
 * phase/task — used to assert its `repos` stay byte-identical after a
 * final-scope event lands its write on the corrective instead.
 */
export function originalTaskIteration(io: MockIO, phase: number, task: number): IterationEntry {
  const state = io.currentState!;
  const phaseLoopNode = state.graph.nodes['phase_loop'] as ForEachPhaseNodeState;
  const phaseIter = phaseLoopNode.iterations[phase - 1];
  const taskLoopNode = phaseIter.nodes['task_loop'] as ForEachTaskNodeState;
  return taskLoopNode.iterations[task - 1];
}

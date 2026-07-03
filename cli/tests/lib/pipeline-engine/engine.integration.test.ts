/**
 * engine.integration.test.ts
 *
 * End-to-end behavioral integration tests for the pipeline engine's multi-repo
 * flow. Exercises the full execute+commit → review → pr_created(repos[]) path
 * (the coder's per-repo commit result rides task_completed) and verifies that
 * per-repo commit hashes and pr_urls land in the v6 repos[] shape (NFR-6, FR-7).
 */
import { describe, it, expect } from 'vitest';
import { processEvent } from '../../../src/lib/pipeline-engine/engine.js';
import type {
  ForEachPhaseNodeState,
  ForEachTaskNodeState,
  IterationEntry,
} from '../../../src/lib/pipeline-engine/types.js';
import {
  PROJECT_DIR,
  TEST_PATH_CONTEXT,
  createConfig,
  createMockIOWithConfig,
  completePlanningSteps,
  seedDoc,
  seedExplosionStateFor,
  codeReviewDoc,
  phaseReviewDoc,
  type MockIO,
} from './fixtures/parity-states.js';
import type { StepNodeState } from '../../../src/lib/pipeline-engine/types.js';

// Config for the two-repo end-to-end test: deterministic gate flow (no ask_gate_mode
// dialogs for task/phase gates), always auto-commit and auto-PR so the coder commits
// and the PR step fires unconditionally. after_final_review: true is kept to exercise
// the full template path including final_approval_gate.
const TWO_REPO_CONFIG = createConfig({
  source_control: { auto_commit: 'always', auto_pr: 'always' },
  human_gates: { execution_mode: 'task', after_final_review: true },
});

// ── activeTaskIteration helper ────────────────────────────────────────────────

/**
 * Returns the task IterationEntry for phase P, task T (1-based) from the mock IO state.
 */
function activeTaskIteration(io: MockIO, phase: number, task: number): IterationEntry {
  const state = io.currentState!;
  const phaseLoop = state.graph.nodes['phase_loop'] as ForEachPhaseNodeState;
  const taskLoop = phaseLoop.iterations[phase - 1].nodes['task_loop'] as ForEachTaskNodeState;
  return taskLoop.iterations[task - 1];
}

// ── driveTwoRepoProjectEndToEnd ───────────────────────────────────────────────

/**
 * Drives a two-repo project through the full execution loop:
 *   start → plan_approved → (source_control init with two repos) →
 *   task_completed(repos[fake-api, fake-ui]) → code_review_completed(approved) →
 *   phase_review_completed(approved) → pr_created(repos[fake-api, fake-ui])
 *
 * Returns MockIO positioned after pr_created, with:
 *   - task iteration repos carrying commit hashes for both repos
 *   - pipeline.source_control.repos carrying pr_url for both repos
 *
 * Reuses parity-states.ts fixtures and follows the same manual-advance
 * pattern as driveTwoRepoTaskCorrective to bypass the cursor tripwire.
 */
export function driveTwoRepoProjectEndToEnd(): MockIO {
  const io = createMockIOWithConfig(null, TWO_REPO_CONFIG);
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

  // With execution_mode: 'task', gate_mode_selection auto-approves (task is in
  // auto_approve_modes), so plan_approved returns the next execution action
  // directly without a gate dialog. Handle the rare case where it still fires.
  if (planResult.action === 'ask_gate_mode') {
    processEvent('gate_mode_set', PROJECT_DIR, { gate_mode: 'task' }, io, TEST_PATH_CONTEXT);
  }

  // Initialize source control with two repos (fake-api + fake-ui).
  {
    const withSC = structuredClone(io.currentState!);
    withSC.pipeline.source_control = {
      worktree_name: 'PARITY-TEST',
      auto_commit: 'always',
      auto_pr: 'always',
      repos: [
        {
          name: 'fake-api',
          branch: 'radorch/PARITY-TEST',
          base_branch: 'main',
          remote_url: null,
          compare_url: null,
          pr_url: null,
        },
        {
          name: 'fake-ui',
          branch: 'radorch/PARITY-TEST',
          base_branch: 'main',
          remote_url: null,
          compare_url: null,
          pr_url: null,
        },
      ],
    };
    io.writeState(PROJECT_DIR, withSC);
  }

  // Seed explosion state: 1 phase, 1 task — but we need two repos on the task iteration.
  seedExplosionStateFor(io, 1, 1);

  // Override the task iteration repos to carry both fake-api and fake-ui
  // (seedExplosionStateFor defaults to rad-orc-source single-repo shape).
  {
    const patched = structuredClone(io.currentState!);
    const phaseLoop = patched.graph.nodes['phase_loop'] as ForEachPhaseNodeState;
    const phaseIter = phaseLoop.iterations[0];
    const taskLoop = phaseIter.nodes['task_loop'] as ForEachTaskNodeState;
    const taskIter = taskLoop.iterations[0];
    taskIter.repos = [
      { name: 'fake-api', commit_hash: null },
      { name: 'fake-ui', commit_hash: null },
    ];
    io.writeState(PROJECT_DIR, patched);
  }

  // Manually advance to execution tier (bypass cursor tripwire — same pattern
  // as driveTwoRepoTaskCorrective in corrective-helpers.ts).
  {
    const patched = structuredClone(io.currentState!);
    const phaseLoop = patched.graph.nodes['phase_loop'] as ForEachPhaseNodeState;
    const phaseIter = phaseLoop.iterations[0];
    phaseIter.status = 'in_progress';

    const taskLoop = phaseIter.nodes['task_loop'] as ForEachTaskNodeState;
    taskLoop.status = 'in_progress';

    const taskIter = taskLoop.iterations[0];
    taskIter.status = 'in_progress';

    // Scaffold task-loop body nodes (matches the execution template body order).
    taskIter.nodes = {
      task_executor: { kind: 'step', status: 'in_progress', doc_path: null, retries: 0 },
      code_review:   { kind: 'step', status: 'not_started', doc_path: null, retries: 0 },
      task_gate:     { kind: 'gate', status: 'not_started', gate_active: false },
    };

    // Advance the stored cursor to match the in_progress marker.
    patched.graph.current_node_path = 'phase_loop[0].task_loop[0].task_executor';
    io.writeState(PROJECT_DIR, patched);
  }

  // 1. task_completed with the two-repo commit result: marks task_executor
  //    completed, records each repo's commit hash on the task iteration, then
  //    the walker advances to code review.
  processEvent(
    'task_completed',
    PROJECT_DIR,
    {
      phase: 1,
      task: 1,
      branch: 'radorch/PARITY-TEST',
      repos: [
        { name: 'fake-api', committed: true, commitHash: 'apihash1', pushed: true },
        { name: 'fake-ui', committed: true, commitHash: 'uihash1', pushed: true },
      ],
    },
    io,
    TEST_PATH_CONTEXT,
  );

  // 2. code_review_completed with approved verdict.
  const reviewDoc = codeReviewDoc(1, 1);
  seedDoc(reviewDoc);
  let afterReview = processEvent(
    'code_review_completed',
    PROJECT_DIR,
    {
      phase: 1,
      task: 1,
      doc_path: reviewDoc,
      verdict: 'approved',
    },
    io,
    TEST_PATH_CONTEXT,
  );

  // If task gate fires, approve it to reach phase_review.
  if (afterReview.action === 'gate_task') {
    afterReview = processEvent(
      'task_gate_approved',
      PROJECT_DIR,
      { phase: 1, task: 1 },
      io,
      TEST_PATH_CONTEXT,
    );
  }

  // 3. phase_review_completed with approved verdict.
  const prvDoc = phaseReviewDoc(1);
  seedDoc(prvDoc);
  let afterPhaseReview = processEvent(
    'phase_review_completed',
    PROJECT_DIR,
    {
      phase: 1,
      doc_path: prvDoc,
      verdict: 'approved',
      exit_criteria_met: true,
    },
    io,
    TEST_PATH_CONTEXT,
  );

  // If phase gate fires, approve it to reach final_review.
  if (afterPhaseReview.action === 'gate_phase') {
    afterPhaseReview = processEvent(
      'phase_gate_approved',
      PROJECT_DIR,
      { phase: 1 },
      io,
      TEST_PATH_CONTEXT,
    );
  }

  // 4. final_review_completed: the template requires final_review before pr_gate.
  if (afterPhaseReview.action === 'spawn_final_reviewer') {
    const finalReviewDocPath = PROJECT_DIR + '/final-review.md';
    seedDoc(finalReviewDocPath);
    afterPhaseReview = processEvent(
      'final_review_completed',
      PROJECT_DIR,
      {
        doc_path: finalReviewDocPath,
        verdict: 'approved',
        exit_criteria_met: true,
      },
      io,
      TEST_PATH_CONTEXT,
    );
  }

  // 5. If PR step fires (invoke_source_control_pr), signal pr_created with two repos.
  if (afterPhaseReview.action === 'invoke_source_control_pr') {
    processEvent(
      'pr_created',
      PROJECT_DIR,
      {
        repos: [
          { name: 'fake-api', pr_url: 'https://github.com/org/fake-api/pull/1' },
          { name: 'fake-ui', pr_url: 'https://github.com/org/fake-ui/pull/2' },
        ],
      },
      io,
      TEST_PATH_CONTEXT,
    );
  }

  return io;
}

// ── Integration tests ─────────────────────────────────────────────────────────

describe('multi-repo end-to-end: execute+commit → review → PR (NFR-6, FR-7)', () => {
  it('multi-repo run records per-repo commit hashes and pr_urls (NFR-6, FR-7)', () => {
    const io = driveTwoRepoProjectEndToEnd(); // execute+commit → review → pr_created(repos[])
    const ti = activeTaskIteration(io, 1, 1);
    expect(ti.repos.map(r => r.commit_hash).filter(Boolean).length).toBe(2);
    const sc = io.currentState!.pipeline.source_control!;
    expect(sc.repos.every(r => typeof r.pr_url === 'string')).toBe(true);
  });
});

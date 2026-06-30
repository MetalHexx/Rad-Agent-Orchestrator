// cli/tests/behavioral/pipeline/events/commit.behavioral.test.ts
// Covers commit_started and commit_completed events (FR-3, FR-8, DD-2).
// NFR-5: if the state schema changes, update the seeded states below accordingly.
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { buildWorld } from '../helpers/world.js';
import { captureEnvelope } from '../helpers/capture.js';
import { assertEnvelopeStateSideFiles } from '../helpers/assert.js';
import { useRealCatalog } from '../helpers/catalog.js';
import { assertPromptForEnvelopeAction } from '../helpers/prompt.js';
import { pipelineSignalCommand } from '../../../../src/commands/pipeline/signal.js';
import { runCommand } from '../../../../src/framework/command.js';
import { getMutation } from '../../../../src/lib/pipeline-engine/mutations.js';
import { makeV6State } from '../../../helpers/state-factory.js';
import { resolveActivePhaseIndex } from '../../../../src/lib/pipeline-engine/context-enrichment.js';
import type { PipelineState, OrchestrationConfig, PipelineTemplate, EventContext } from '../../../../src/lib/pipeline-engine/types.js';

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });
beforeEach(() => { cleanups.push(useRealCatalog()); });

// Synthetic template that includes a commit step in the task body.
// commit_started / commit_completed are NOT out-of-band events; they require
// template indexing so the engine can resolve the node path.
const COMMIT_TEMPLATE_BODY = `template:
  id: syn-exec-commit
  version: "1.0.0"
  description: "Synthetic execution template with commit step for behavioral tests"
nodes:
  - id: gate_mode_selection
    kind: gate
    label: "Gate Mode Selection"
    mode_ref: human_gates.execution_mode
    action_if_needed: gate_task
    approved_event: gate_mode_set
    auto_approve_modes: [task, phase, autonomous]
    depends_on: []
  - id: phase_loop
    kind: for_each_phase
    label: "Phase Execution Loop"
    source_doc_ref: "$.nodes.master_plan.doc_path"
    total_field: total_phases
    depends_on: [gate_mode_selection]
    body:
      - id: task_loop
        kind: for_each_task
        label: "Task Execution Loop"
        source_doc_ref: "$.current_phase.doc_path"
        tasks_field: tasks
        depends_on: []
        body:
          - id: task_gate
            kind: gate
            label: "Task Gate"
            mode_ref: human_gates.execution_mode
            action_if_needed: gate_task
            approved_event: task_gate_approved
            auto_approve_modes: [phase, autonomous]
            depends_on: []
          - id: task_executor
            kind: step
            label: "Execute Task"
            action: execute_task
            events: { completed: task_completed }
            depends_on: [task_gate]
          - id: commit
            kind: step
            label: "Commit"
            action: invoke_source_control_commit
            events: { completed: commit_completed }
            depends_on: [task_executor]
          - id: code_review
            kind: step
            label: "Code Review"
            action: spawn_code_reviewer
            events: { completed: code_review_completed }
            doc_output_field: doc_path
            depends_on: [commit]
      - id: phase_gate
        kind: gate
        label: "Phase Gate"
        mode_ref: human_gates.execution_mode
        action_if_needed: gate_phase
        approved_event: phase_gate_approved
        auto_approve_modes: [task, autonomous]
        depends_on: [task_loop]
      - id: phase_review
        kind: step
        label: "Phase Review"
        action: spawn_phase_reviewer
        events: { completed: phase_review_completed }
        doc_output_field: doc_path
        depends_on: [phase_gate]
  - id: final_review
    kind: step
    label: "Final Review"
    action: spawn_final_reviewer
    events: { completed: final_review_completed }
    doc_output_field: doc_path
    depends_on: [phase_loop]
  - id: final_approval_gate
    kind: gate
    label: "Final Approval Gate"
    mode_ref: human_gates.after_final_review
    action_if_needed: request_final_approval
    approved_event: final_approved
    auto_approve_modes: []
    depends_on: [final_review]
`;

// State with commit in_progress (ready for commit_completed).
// v6 schema: iterations carry repos[] instead of the removed commit_hash scalar.
const afterCommitStartedState = {
  $schema: 'orchestration-state-v6',
  project: { name: 'cli-behavioral', created: '2024-01-01T00:00:00.000Z', updated: '2024-01-01T00:00:00.000Z' },
  config: {
    gate_mode: 'task',
    limits: { max_retries_per_task: 3, max_consecutive_review_rejections: 3 },
    source_control: { auto_commit: 'never', auto_pr: 'never' },
  },
  pipeline: {
    gate_mode: 'task',
    source_control: {
      worktree_name: 'cli-behavioral',
      auto_commit: 'never',
      auto_pr: 'never',
      repos: [
        { name: 'rad-orc-source', branch: 'feature/syn', base_branch: 'main', remote_url: null, compare_url: null, pr_url: null },
      ],
    },
    current_tier: 'execution',
    halt_reason: null,
  },
  graph: {
    template_id: 'syn-exec-commit',
    status: 'in_progress',
    current_node_path: 'phase_loop[0].task_loop[0].commit',
    nodes: {
      gate_mode_selection: { kind: 'gate', status: 'completed', gate_active: false },
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
                    repos: [],
                    corrective_tasks: [],
                    nodes: {
                      task_gate:     { kind: 'gate', status: 'completed', gate_active: true },
                      task_executor: { kind: 'step', status: 'completed', doc_path: null, retries: 0 },
                      commit:        { kind: 'step', status: 'in_progress', doc_path: null, retries: 0 },
                      code_review:   { kind: 'step', status: 'not_started', doc_path: null, retries: 0 },
                    },
                  },
                ],
              },
              phase_gate:   { kind: 'gate', status: 'not_started', gate_active: false },
              phase_review: { kind: 'step', status: 'not_started', doc_path: null, retries: 0 },
            },
          },
        ],
      },
      final_review:        { kind: 'step', status: 'not_started', doc_path: null, retries: 0 },
      final_approval_gate: { kind: 'gate', status: 'not_started', gate_active: false },
    },
  },
};

// ── Lightweight mutation-level helpers (FR-25, AD-10) ────────────────────────
// These helpers drive the COMMIT_COMPLETED mutation directly against a seeded
// v6 state, bypassing filesystem IO. Used by the per-repo hash tests below.

function seedSingleRepoTask(repoName: string): Record<string, unknown> {
  const base = makeV6State({ taskRepos: [{ name: repoName, commit_hash: null }] });
  // Mark phase and task iterations as in_progress and seed the commit step node
  // so the COMMIT_COMPLETED mutation can resolve the node and write the hash.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const phaseIter = (base as any).graph.nodes.phase_loop.iterations[0];
  phaseIter.status = 'in_progress';
  const taskIter = phaseIter.nodes.task_loop.iterations[0];
  taskIter.status = 'in_progress';
  taskIter.nodes['commit'] = { kind: 'step', status: 'in_progress', doc_path: null, retries: 0 };
  return base;
}

function drive(
  state: Record<string, unknown>,
  opts: { event: string; commit_hash: string; repo_name: string; phase: number; task: number },
): Record<string, unknown> {
  const mut = getMutation(opts.event);
  if (!mut) throw new Error(`No mutation registered for event: ${opts.event}`);
  // P04-T02: signal is now array-shaped (repos[]); scalar commit_hash retired.
  const ctx: EventContext = {
    event: opts.event,
    project_dir: '',
    config_path: '',
    repos: [{ name: opts.repo_name, committed: true, commitHash: opts.commit_hash, pushed: true }],
    phase: opts.phase,
    task: opts.task,
  };
  const minimalConfig = {
    limits: { max_retries_per_task: 3, max_consecutive_review_rejections: 3 },
    gate_mode: 'task',
    source_control: { auto_commit: 'never', auto_pr: 'never' },
  } as unknown as OrchestrationConfig;
  const minimalTemplate = { id: '', version: '', description: '', nodes: [] } as unknown as PipelineTemplate;
  const result = mut(state as unknown as PipelineState, ctx, minimalConfig, minimalTemplate);
  return result.state as unknown as Record<string, unknown>;
}

function firstTaskIteration(state: Record<string, unknown>): Record<string, unknown> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = (state as any).graph.nodes.phase_loop;
  return g.iterations[0].nodes.task_loop.iterations[0] as Record<string, unknown>;
}

// Per FR-11, `commit_started` is no longer accepted as an event; step
// transition to in_progress now happens via the optimistic write in
// processEvent (FR-10). The behavioral arm for that signal was deleted with
// the event identifier itself; the completed arm below carries the remaining
// behavior coverage for the commit step.

describe('commit_completed — per-repo hash write (FR-25, AD-10)', () => {
  it('writes the commit hash into repos[0] for a single-repo task (FR-25, AD-10)', () => {
    const after = drive(seedSingleRepoTask('backend'), { event: 'commit_completed', commit_hash: 'abc1234', repo_name: 'backend', phase: 1, task: 1 });
    const taskIter = firstTaskIteration(after);
    expect(taskIter.repos[0].commit_hash).toBe('abc1234');
    expect('commit_hash' in taskIter).toBe(false);
  });
});

describe('commit_completed overwrite protection (FR-5, FR-6, NFR-2, DD-1)', () => {
  it('rejects a different-hash overwrite of a finalized node and leaves the hash unchanged (FR-5, FR-6, DD-1)', () => {
    // Seed a task whose repos[0].commit_hash is already finalized.
    const seeded = seedSingleRepoTask('backend');
    firstTaskIteration(seeded).repos[0].commit_hash = '64f9c236';
    expect(() =>
      drive(seeded, { event: 'commit_completed', commit_hash: '1436cd63', repo_name: 'backend', phase: 1, task: 1 })
    ).toThrow(/immutable|overwrite|already recorded|finalized/i);
    // The durable hash must be untouched by the rejected attempt.
    expect(firstTaskIteration(seeded).repos[0].commit_hash).toBe('64f9c236');
  });

  it('allows an idempotent retry writing the same hash (NFR-2)', () => {
    const seeded = seedSingleRepoTask('backend');
    firstTaskIteration(seeded).repos[0].commit_hash = '64f9c236';
    const after = drive(seeded, { event: 'commit_completed', commit_hash: '64f9c236', repo_name: 'backend', phase: 1, task: 1 });
    expect(firstTaskIteration(after).repos[0].commit_hash).toBe('64f9c236');
  });

  it('allows the first write when the existing hash is null (FR-5)', () => {
    const after = drive(seedSingleRepoTask('backend'), { event: 'commit_completed', commit_hash: 'abc1234', repo_name: 'backend', phase: 1, task: 1 });
    expect(firstTaskIteration(after).repos[0].commit_hash).toBe('abc1234');
  });
});

describe('commit_completed event (FR-3, FR-8, DD-2)', () => {
  it('commit_completed marks commit.status = completed and writes commit_hash onto task iteration', async () => {
    const w = buildWorld({
      template: { id: 'syn-exec-commit', body: COMMIT_TEMPLATE_BODY },
      state: afterCommitStartedState,
      config: { default_template: 'syn-exec-commit', human_gates: { after_planning: true, execution_mode: 'task', after_final_review: true } },
      sideFiles: [],
    });
    cleanups.push(w.cleanup);
    // P04-T02: signal is now array-shaped; pass --repos JSON instead of --commit-hash.
    const reposJson = JSON.stringify([{ name: 'rad-orc-source', committed: true, commitHash: 'abc1234', pushed: true }]);
    const env = await captureEnvelope(async () => {
      await runCommand(pipelineSignalCommand, {
        argv: [
          '--event', 'commit_completed',
          '--phase', '1', '--task', '1',
          '--repos', reposJson,
          '--project-dir', w.projectDir,
          '--config', w.configPath,
        ],
        env: { ...process.env, RADORCH_NO_LOG: '1', RADORCH_TEMPLATES_DIR: w.projectDir },
        isTTY: false, stderr: process.stderr,
      });
    });
    // Assert envelope ok and state template_id via helper (partial-array limitation).
    assertEnvelopeStateSideFiles(env, {
      projectDir: w.projectDir,
      envelope: { ok: true },
      state: { graph: { template_id: 'syn-exec-commit' } },
      sideFiles: [],
    });
    // Assert commit_hash written onto task iteration.repos[0] via direct state.json read (v6 schema).
    // The task iteration starts with repos:[] so the mutation creates the entry by name.
    const onDisk = JSON.parse(fs.readFileSync(path.join(w.projectDir, 'state.json'), 'utf8'));
    const taskIteration = onDisk.graph.nodes.phase_loop.iterations[0].nodes.task_loop.iterations[0];
    const repoEntry = taskIteration.repos.find((r: { name: string }) => r.name === 'rad-orc-source');
    expect(repoEntry?.commit_hash, 'task_iteration[0].repos[rad-orc-source].commit_hash').toBe('abc1234');
    // FR-4, FR-23 — after commit_completed the walker advances to the next
    // step (spawn_code_reviewer per the template); the composed prompt
    // carries that action's completion event from the real catalog.
    assertPromptForEnvelopeAction(env);
  });
});

function seedPhaseCorrective(repoName: string): Record<string, unknown> {
  const base = seedSingleRepoTask(repoName);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const phaseIter = (base as any).graph.nodes.phase_loop.iterations[0];
  phaseIter.nodes.task_loop.status = 'completed';
  phaseIter.nodes.task_loop.iterations[0].status = 'completed';
  phaseIter.corrective_tasks = [
    {
      index: 1, status: 'in_progress', reason: 'phase review', injected_after: 'phase_review',
      repos: [{ name: repoName, commit_hash: null }],
      nodes: { commit: { kind: 'step', status: 'in_progress', doc_path: null, retries: 0 } },
    },
  ];
  return base;
}

describe('phase-corrective commit path (FR-11, NFR-1)', () => {
  it('writes the commit hash onto the active phase corrective, not the task iteration (FR-11)', () => {
    const after = drive(seedPhaseCorrective('backend'), { event: 'commit_completed', commit_hash: 'cor1234', repo_name: 'backend', phase: 1, task: 1 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const phaseIter = (after as any).graph.nodes.phase_loop.iterations[0];
    expect(phaseIter.corrective_tasks[0].repos[0].commit_hash).toBe('cor1234');
    // The genuine task iteration hash is untouched (still null).
    expect(phaseIter.nodes.task_loop.iterations[0].repos[0].commit_hash).toBeNull();
  });

  it('resolves the active node to the corrective phase identity (FR-11)', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const state = seedPhaseCorrective('backend') as any;
    expect(resolveActivePhaseIndex(state)).toBe(1);
  });
});

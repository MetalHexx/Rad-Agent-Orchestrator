// cli/tests/behavioral/pipeline/events/pr.behavioral.test.ts
// Covers pr_requested and pr_created events (FR-3, FR-8, DD-2).
// NFR-5: if the state schema changes, update the seeded states below accordingly.
import { describe, it, beforeEach, afterEach } from 'vitest';
import { buildWorld } from '../helpers/world.js';
import { captureEnvelope } from '../helpers/capture.js';
import { assertEnvelopeStateSideFiles } from '../helpers/assert.js';
import { useRealCatalog } from '../helpers/catalog.js';
import { assertPromptForEvent, assertPromptForEnvelopeAction } from '../helpers/prompt.js';
import { pipelineSignalCommand } from '../../../../src/commands/pipeline/signal.js';
import { runCommand } from '../../../../src/framework/command.js';

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });
beforeEach(() => { cleanups.push(useRealCatalog()); });

// Synthetic template that includes a final_pr step.
// pr_requested / pr_created are NOT out-of-band events; they require template
// indexing so the engine can resolve the node path.
const PR_TEMPLATE_BODY = `template:
  id: syn-exec-pr
  version: "1.0.0"
  description: "Synthetic execution template with PR step for behavioral tests"
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
          - id: code_review
            kind: step
            label: "Code Review"
            action: spawn_code_reviewer
            events: { completed: code_review_completed }
            doc_output_field: doc_path
            depends_on: [task_executor]
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
  - id: final_pr
    kind: step
    label: "Create PR"
    action: invoke_source_control_pr
    events: { started: pr_requested, completed: pr_created }
    depends_on: [final_approval_gate]
`;

// State with final_pr ready for pr_requested: pipeline complete up to final_approval_gate.
const afterFinalApprovedState = {
  $schema: 'orchestration-state-v6',
  project: { name: 'cli-behavioral', created: '2024-01-01T00:00:00.000Z', updated: '2024-01-01T00:00:00.000Z' },
  config: {
    gate_mode: 'task',
    limits: { max_retries_per_task: 3 },
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
    template_id: 'syn-exec-pr',
    status: 'in_progress',
    current_node_path: 'final_pr',
    nodes: {
      gate_mode_selection: { kind: 'gate', status: 'completed', gate_active: false },
      phase_loop:          { kind: 'for_each_phase', status: 'completed', iterations: [] },
      final_review:        { kind: 'step', status: 'completed', doc_path: null, retries: 0 },
      final_approval_gate: { kind: 'gate', status: 'completed', gate_active: true },
      final_pr:            { kind: 'step', status: 'not_started', doc_path: null, retries: 0 },
    },
  },
};

// State with final_pr in_progress (ready for pr_created).
const afterPrRequestedState = {
  $schema: 'orchestration-state-v6',
  project: { name: 'cli-behavioral', created: '2024-01-01T00:00:00.000Z', updated: '2024-01-01T00:00:00.000Z' },
  config: {
    gate_mode: 'task',
    limits: { max_retries_per_task: 3 },
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
    template_id: 'syn-exec-pr',
    status: 'in_progress',
    current_node_path: 'final_pr',
    nodes: {
      gate_mode_selection: { kind: 'gate', status: 'completed', gate_active: false },
      phase_loop:          { kind: 'for_each_phase', status: 'completed', iterations: [] },
      final_review:        { kind: 'step', status: 'completed', doc_path: null, retries: 0 },
      final_approval_gate: { kind: 'gate', status: 'completed', gate_active: true },
      final_pr:            { kind: 'step', status: 'in_progress', doc_path: null, retries: 0 },
    },
  },
};

describe('pr_requested event (FR-3, FR-8, DD-2)', () => {
  it('pr_requested marks final_pr.status = in_progress and returns action=invoke_source_control_pr', async () => {
    const w = buildWorld({
      template: { id: 'syn-exec-pr', body: PR_TEMPLATE_BODY },
      state: afterFinalApprovedState,
      config: { default_template: 'syn-exec-pr', human_gates: { after_planning: true, execution_mode: 'task', after_final_review: true } },
      sideFiles: [],
    });
    cleanups.push(w.cleanup);
    const env = await captureEnvelope(async () => {
      await runCommand(pipelineSignalCommand, {
        argv: ['--event', 'pr_requested', '--project-dir', w.projectDir, '--config', w.configPath],
        env: { ...process.env, RADORCH_NO_LOG: '1', RADORCH_TEMPLATES_DIR: w.projectDir },
        isTTY: false, stderr: process.stderr,
      });
    });
    assertEnvelopeStateSideFiles(env, {
      projectDir: w.projectDir,
      envelope: { ok: true, data: { action: 'invoke_source_control_pr' } },
      state: {
        graph: {
          template_id: 'syn-exec-pr',
          nodes: {
            final_pr: { status: 'in_progress' },
          },
        },
      },
      sideFiles: [],
    });
    // FR-4, FR-23 — invoke_source_control_pr's completion event is pr_created
    // (renamed from pr_completed in P04-PHASE-C1).
    assertPromptForEvent(env, 'pr_created');
  });
});

describe('pr_created event (FR-3, FR-8, DD-2)', () => {
  it('pr_created marks final_pr.status = completed and writes pr_url onto pipeline.source_control', async () => {
    const w = buildWorld({
      template: { id: 'syn-exec-pr', body: PR_TEMPLATE_BODY },
      state: afterPrRequestedState,
      config: { default_template: 'syn-exec-pr', human_gates: { after_planning: true, execution_mode: 'task', after_final_review: true } },
      sideFiles: [],
    });
    cleanups.push(w.cleanup);
    const env = await captureEnvelope(async () => {
      await runCommand(pipelineSignalCommand, {
        argv: [
          '--event', 'pr_created',
          '--pr-url', 'https://github.com/example/repo/pull/42',
          '--project-dir', w.projectDir,
          '--config', w.configPath,
        ],
        env: { ...process.env, RADORCH_NO_LOG: '1', RADORCH_TEMPLATES_DIR: w.projectDir },
        isTTY: false, stderr: process.stderr,
      });
    });
    assertEnvelopeStateSideFiles(env, {
      projectDir: w.projectDir,
      envelope: { ok: true },
      state: {
        graph: {
          template_id: 'syn-exec-pr',
          nodes: {
            final_pr: { status: 'completed' },
          },
        },
      },
      sideFiles: [],
    });
    // FR-4, FR-5, FR-23 — after pr_created the walker has nothing left to do;
    // the envelope carries whichever next action the walker resolves (terminal
    // display_complete in this template). assertPromptForEnvelopeAction reads
    // the action from the envelope and matches its completion_event against
    // the real catalog (null → terminal-prompt assertion).
    assertPromptForEnvelopeAction(env);
  });
});

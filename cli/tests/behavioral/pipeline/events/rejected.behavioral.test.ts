// cli/tests/behavioral/pipeline/events/rejected.behavioral.test.ts
// Covers plan_rejected, gate_rejected, and final_rejected events (FR-3, FR-9, DD-2).
// All three route through pipelineSignalCommand as out-of-band events (AD-4, AD-11).
// NFR-5: if the state schema changes, update the seeded states below accordingly.
import { describe, it, beforeEach, afterEach } from 'vitest';
import { buildWorld } from '../helpers/world.js';
import { captureEnvelope } from '../helpers/capture.js';
import { assertEnvelopeStateSideFiles } from '../helpers/assert.js';
import { useRealCatalog } from '../helpers/catalog.js';
import { assertPromptForEnvelopeAction } from '../helpers/prompt.js';
import { pipelineSignalCommand } from '../../../../src/commands/pipeline/signal.js';
import { runCommand } from '../../../../src/framework/command.js';
import { EXECUTION_TEMPLATE_BODY } from './fixtures/execution-template.js';
import { PLANNING_TEMPLATE_BODY } from './fixtures/planning-template.js';

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });
beforeEach(() => { cleanups.push(useRealCatalog()); });

// State at plan_approval_gate (plan ready for approval or rejection).
// Uses the planning template which defines master_plan and plan_approval_gate.
const atPlanApprovalGateState = {
  $schema: 'orchestration-state-v6',
  project: { name: 'cli-behavioral', created: '2024-01-01T00:00:00.000Z', updated: '2024-01-01T00:00:00.000Z' },
  config: {
    gate_mode: 'task',
    limits: { max_retries_per_task: 3, max_consecutive_review_rejections: 3 },
    source_control: { auto_commit: 'never', auto_pr: 'never' },
  },
  pipeline: { gate_mode: 'task', source_control: null, current_tier: 'planning', halt_reason: null },
  graph: {
    template_id: 'syn-planning',
    status: 'in_progress',
    current_node_path: 'plan_approval_gate',
    nodes: {
      requirements:       { kind: 'step', status: 'completed', doc_path: 'reqs.md', retries: 0 },
      master_plan:        { kind: 'step', status: 'completed', doc_path: 'plan.md', retries: 0 },
      explode_master_plan: { kind: 'step', status: 'completed', doc_path: null, retries: 0 },
      plan_approval_gate: { kind: 'gate', status: 'not_started', gate_active: true },
    },
  },
};

// State at final_approval_gate (final review done, awaiting approval or rejection).
const atFinalApprovalGateState = {
  $schema: 'orchestration-state-v6',
  project: { name: 'cli-behavioral', created: '2024-01-01T00:00:00.000Z', updated: '2024-01-01T00:00:00.000Z' },
  config: {
    gate_mode: 'task',
    limits: { max_retries_per_task: 3, max_consecutive_review_rejections: 3 },
    source_control: { auto_commit: 'never', auto_pr: 'never' },
  },
  pipeline: { gate_mode: 'task', source_control: null, current_tier: 'review', halt_reason: null },
  graph: {
    template_id: 'syn-exec',
    status: 'in_progress',
    current_node_path: 'final_approval_gate',
    nodes: {
      gate_mode_selection: { kind: 'gate', status: 'completed', gate_active: false },
      phase_loop:          { kind: 'for_each_phase', status: 'completed', iterations: [] },
      final_review:        { kind: 'step', status: 'completed', doc_path: null, retries: 0 },
      final_approval_gate: { kind: 'gate', status: 'not_started', gate_active: true },
    },
  },
};

// State mid-execution for gate_rejected (task gate active, about to be rejected).
const atTaskGateActiveState = {
  $schema: 'orchestration-state-v6',
  project: { name: 'cli-behavioral', created: '2024-01-01T00:00:00.000Z', updated: '2024-01-01T00:00:00.000Z' },
  config: {
    gate_mode: 'task',
    limits: { max_retries_per_task: 3, max_consecutive_review_rejections: 3 },
    source_control: { auto_commit: 'never', auto_pr: 'never' },
  },
  pipeline: { gate_mode: 'task', source_control: null, current_tier: 'execution', halt_reason: null },
  graph: {
    template_id: 'syn-exec',
    status: 'in_progress',
    current_node_path: 'phase_loop[0].task_loop[0].task_gate',
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
                      task_gate:     { kind: 'gate', status: 'not_started', gate_active: true },
                      task_executor: { kind: 'step', status: 'not_started', doc_path: null, retries: 0 },
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

describe('plan_rejected event (FR-3, FR-9, DD-2)', () => {
  it('plan_rejected resets master_plan and plan_approval_gate and preserves pipeline.halt_reason = null', async () => {
    const w = buildWorld({
      template: { id: 'syn-planning', body: PLANNING_TEMPLATE_BODY },
      state: atPlanApprovalGateState,
      config: { default_template: 'syn-planning', human_gates: { after_planning: true, execution_mode: 'task', after_final_review: true } },
      sideFiles: [],
    });
    cleanups.push(w.cleanup);
    const env = await captureEnvelope(async () => {
      await runCommand(pipelineSignalCommand, {
        argv: ['--event', 'plan_rejected', '--project-dir', w.projectDir, '--config', w.configPath],
        env: { ...process.env, RADORCH_NO_LOG: '1', RADORCH_TEMPLATES_DIR: w.projectDir },
        isTTY: false, stderr: process.stderr,
      });
    });
    assertEnvelopeStateSideFiles(env, {
      projectDir: w.projectDir,
      envelope: { ok: true },
      state: {
        graph: { template_id: 'syn-planning' },
        pipeline: { halt_reason: null },
      },
      sideFiles: [],
    });
    // FR-4, FR-23 — remediation action's completion event resolved from catalog.
    assertPromptForEnvelopeAction(env);
  });
});

describe('gate_rejected event (FR-3, FR-9, DD-2)', () => {
  it('gate_rejected sets graph.status = halted and writes pipeline.halt_reason with gate type and reason', async () => {
    const w = buildWorld({
      template: { id: 'syn-exec', body: EXECUTION_TEMPLATE_BODY },
      state: atTaskGateActiveState,
      config: { default_template: 'syn-exec', human_gates: { after_planning: true, execution_mode: 'task', after_final_review: true } },
      sideFiles: [],
    });
    cleanups.push(w.cleanup);
    const env = await captureEnvelope(async () => {
      await runCommand(pipelineSignalCommand, {
        argv: [
          '--event', 'gate_rejected',
          '--gate-type', 'task',
          '--reason', 'Task not ready for execution',
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
        graph: { status: 'halted' },
        pipeline: { halt_reason: 'Gate rejected (task): Task not ready for execution' },
      },
      sideFiles: [],
    });
    // FR-4, FR-5, FR-23 — gate_rejected halts the pipeline; next action is
    // display_halted (terminal) per the catalog.
    assertPromptForEnvelopeAction(env);
  });
});

describe('final_rejected event (FR-3, FR-9, DD-2)', () => {
  it('final_rejected resets final_review and final_approval_gate and preserves pipeline.halt_reason = null', async () => {
    const w = buildWorld({
      template: { id: 'syn-exec', body: EXECUTION_TEMPLATE_BODY },
      state: atFinalApprovalGateState,
      config: { default_template: 'syn-exec', human_gates: { after_planning: true, execution_mode: 'task', after_final_review: true } },
      sideFiles: [],
    });
    cleanups.push(w.cleanup);
    const env = await captureEnvelope(async () => {
      await runCommand(pipelineSignalCommand, {
        argv: ['--event', 'final_rejected', '--project-dir', w.projectDir, '--config', w.configPath],
        env: { ...process.env, RADORCH_NO_LOG: '1', RADORCH_TEMPLATES_DIR: w.projectDir },
        isTTY: false, stderr: process.stderr,
      });
    });
    assertEnvelopeStateSideFiles(env, {
      projectDir: w.projectDir,
      envelope: { ok: true },
      state: {
        graph: { template_id: 'syn-exec' },
        pipeline: { halt_reason: null },
      },
      sideFiles: [],
    });
    // FR-4, FR-23 — remediation action's completion event resolved from catalog.
    assertPromptForEnvelopeAction(env);
  });
});

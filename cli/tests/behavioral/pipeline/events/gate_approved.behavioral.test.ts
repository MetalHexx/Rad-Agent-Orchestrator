// cli/tests/behavioral/pipeline/events/gate_approved.behavioral.test.ts
// Covers task_gate_approved and phase_gate_approved events (FR-3, FR-9, DD-2).
// NFR-5: if the state schema changes, update the seeded states below accordingly.
import { describe, it, beforeEach, afterEach } from 'vitest';
import { buildWorld } from '../helpers/world.js';
import { captureEnvelope } from '../helpers/capture.js';
import { assertEnvelopeStateSideFiles } from '../helpers/assert.js';
import { useRealCatalog } from '../helpers/catalog.js';
import { assertPromptForEvent } from '../helpers/prompt.js';
import { pipelineSignalCommand } from '../../../../src/commands/pipeline/signal.js';
import { runCommand } from '../../../../src/framework/command.js';
import { EXECUTION_TEMPLATE_BODY } from './fixtures/execution-template.js';

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });
beforeEach(() => { cleanups.push(useRealCatalog()); });

// State for task_gate_approved: phase_loop[0].task_loop[0].task_gate is not_started with gate_active=true.
// gate_mode_selection is completed; phase[0] is in_progress; task[0] is in_progress; task_gate is pending.
const afterTaskGateActiveState = {
  $schema: 'orchestration-state-v6',
  project: { name: 'cli-behavioral', created: '2024-01-01T00:00:00.000Z', updated: '2024-01-01T00:00:00.000Z' },
  config: {
    gate_mode: 'task',
    limits: { max_retries_per_task: 3 },
    source_control: { auto_commit: 'never', auto_pr: 'never' },
  },
  // SC is initialized before execution; seed it so execute_task enrichment
  // resolves a repo (empty repos[] now fails loud — MR-5-TEST regression guard).
  pipeline: {
    gate_mode: 'task',
    source_control: {
      worktree_name: 'cli-behavioral',
      auto_commit: 'never',
      auto_pr: 'never',
      repos: [{ name: 'cli-behavioral', branch: 'main', base_branch: 'main', remote_url: null, compare_url: null, pr_url: null }],
    },
    current_tier: 'execution',
    halt_reason: null,
  },
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
              phase_gate:    { kind: 'gate', status: 'not_started', gate_active: false },
              phase_review:  { kind: 'step', status: 'not_started', doc_path: null, retries: 0 },
            },
          },
        ],
      },
      final_review:        { kind: 'step', status: 'not_started', doc_path: null, retries: 0 },
      final_approval_gate: { kind: 'gate', status: 'not_started', gate_active: false },
    },
  },
};

// State for phase_gate_approved: task_loop completed; phase_gate is pending.
const afterTaskLoopCompletedState = {
  $schema: 'orchestration-state-v6',
  project: { name: 'cli-behavioral', created: '2024-01-01T00:00:00.000Z', updated: '2024-01-01T00:00:00.000Z' },
  config: {
    gate_mode: 'task',
    limits: { max_retries_per_task: 3 },
    source_control: { auto_commit: 'never', auto_pr: 'never' },
  },
  // SC is initialized before execution; seed it so execute_task enrichment
  // resolves a repo (empty repos[] now fails loud — MR-5-TEST regression guard).
  pipeline: {
    gate_mode: 'task',
    source_control: {
      worktree_name: 'cli-behavioral',
      auto_commit: 'never',
      auto_pr: 'never',
      repos: [{ name: 'cli-behavioral', branch: 'main', base_branch: 'main', remote_url: null, compare_url: null, pr_url: null }],
    },
    current_tier: 'execution',
    halt_reason: null,
  },
  graph: {
    template_id: 'syn-exec',
    status: 'in_progress',
    current_node_path: 'phase_loop[0].phase_gate',
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
                status: 'completed',
                iterations: [
                  {
                    index: 0,
                    status: 'completed',
                    doc_path: null,
                    repos: [],
                    corrective_tasks: [],
                    nodes: {
                      task_gate:     { kind: 'gate', status: 'completed', gate_active: true },
                      task_executor: { kind: 'step', status: 'completed', doc_path: null, retries: 0 },
                      code_review:   { kind: 'step', status: 'completed', doc_path: null, retries: 0 },
                    },
                  },
                ],
              },
              phase_gate:   { kind: 'gate', status: 'not_started', gate_active: true },
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

describe('task_gate_approved event (FR-3, FR-9, DD-2)', () => {
  it('task_gate_approved marks task_gate completed and returns execute_task action', async () => {
    const w = buildWorld({
      template: { id: 'syn-exec', body: EXECUTION_TEMPLATE_BODY },
      state: afterTaskGateActiveState,
      config: { default_template: 'syn-exec', human_gates: { after_planning: true, execution_mode: 'task', after_final_review: true } },
      sideFiles: [],
    });
    cleanups.push(w.cleanup);
    const env = await captureEnvelope(async () => {
      await runCommand(pipelineSignalCommand, {
        argv: ['--event', 'gate_approved', '--gate-type', 'task', '--phase', '1', '--task', '1', '--project-dir', w.projectDir, '--config', w.configPath],
        env: { ...process.env, RADORCH_NO_LOG: '1', RADORCH_TEMPLATES_DIR: w.projectDir },
        isTTY: false, stderr: process.stderr,
      });
    });
    assertEnvelopeStateSideFiles(env, {
      projectDir: w.projectDir,
      envelope: { ok: true, data: { action: 'execute_task' } },
      state: {
        graph: {
          template_id: 'syn-exec',
        },
      },
      sideFiles: [],
    });
    // FR-4, FR-23 — execute_task's completion event is task_completed.
    assertPromptForEvent(env, 'task_completed');
  });
});

describe('phase_gate_approved event (FR-3, FR-9, DD-2)', () => {
  it('phase_gate_approved marks phase_gate completed and returns spawn_phase_reviewer action', async () => {
    const w = buildWorld({
      template: { id: 'syn-exec', body: EXECUTION_TEMPLATE_BODY },
      state: afterTaskLoopCompletedState,
      config: { default_template: 'syn-exec', human_gates: { after_planning: true, execution_mode: 'task', after_final_review: true } },
      sideFiles: [],
    });
    cleanups.push(w.cleanup);
    const env = await captureEnvelope(async () => {
      await runCommand(pipelineSignalCommand, {
        argv: ['--event', 'gate_approved', '--gate-type', 'phase', '--phase', '1', '--project-dir', w.projectDir, '--config', w.configPath],
        env: { ...process.env, RADORCH_NO_LOG: '1', RADORCH_TEMPLATES_DIR: w.projectDir },
        isTTY: false, stderr: process.stderr,
      });
    });
    assertEnvelopeStateSideFiles(env, {
      projectDir: w.projectDir,
      envelope: { ok: true, data: { action: 'spawn_phase_reviewer' } },
      state: {
        graph: {
          template_id: 'syn-exec',
        },
      },
      sideFiles: [],
    });
    // FR-4, FR-23 — spawn_phase_reviewer's completion event is phase_review_completed.
    assertPromptForEvent(env, 'phase_review_completed');
  });
});

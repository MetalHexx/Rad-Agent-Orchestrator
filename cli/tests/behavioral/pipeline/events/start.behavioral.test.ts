// cli/tests/behavioral/pipeline/events/start.behavioral.test.ts
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { buildWorld } from '../helpers/world.js';
import { captureEnvelope } from '../helpers/capture.js';
import { assertEnvelopeStateSideFiles } from '../helpers/assert.js';
import { useRealCatalog } from '../helpers/catalog.js';
import { assertPromptForEvent } from '../helpers/prompt.js';
import { pipelineSignalCommand } from '../../../../src/commands/pipeline/signal.js';
import { runCommand } from '../../../../src/framework/command.js';
import { PLANNING_TEMPLATE_BODY } from './fixtures/planning-template.js';
import { EXECUTION_TEMPLATE_BODY } from './fixtures/execution-template.js';

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });
beforeEach(() => { cleanups.push(useRealCatalog()); });

// Seed mirroring the live PUBLISH-TEST-1 repro: task_executor is in_progress
// after the orchestrator fired `execution_started` and lost session context
// before the coder finished. `start` must re-emit `execute_task` so resume is
// a true frontier query — per references/pipeline-guide.md lines 32 and 128.
const taskExecutorInProgressState = {
  $schema: 'orchestration-state-v6',
  project: { name: 'cli-behavioral', created: '2024-01-01T00:00:00.000Z', updated: '2024-01-01T00:00:00.000Z' },
  config: {
    gate_mode: 'task',
    limits: { max_retries_per_task: 3 },
    source_control: { auto_commit: 'never', auto_pr: 'never' },
  },
  // Source control is always initialized by the time a task is the frontier;
  // seed it so execute_task enrichment resolves a repo (an empty repos[] now
  // fails loud — the MR-5-TEST regression guard).
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
    current_node_path: 'phase_loop[0].task_loop[0].task_executor',
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
                      task_executor: { kind: 'step', status: 'in_progress', doc_path: null, retries: 0 },
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

// Seed mirroring the live AIOPS-300-PROJECT-AMEND-2 repro: an amendment added
// a phase after phase_loop had already completed, and the merge left the
// cursor as the bare container id 'phase_loop' rather than a concrete leaf
// path. Resume must heal the cursor from the in_progress markers instead of
// trusting the stale echoed value.
const amendedPhaseContainerCursorState = {
  $schema: 'orchestration-state-v6',
  project: { name: 'cli-behavioral', created: '2024-01-01T00:00:00.000Z', updated: '2024-01-01T00:00:00.000Z' },
  config: {
    gate_mode: 'autonomous',
    limits: { max_retries_per_task: 3 },
    source_control: { auto_commit: 'never', auto_pr: 'never' },
  },
  pipeline: {
    // Autonomous so the new phase's task_gate auto-approves and the walk
    // reaches task_executor directly — isolating the assertion to the
    // cursor-healing behavior rather than gate mechanics.
    gate_mode: 'autonomous',
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
    current_node_path: 'phase_loop',
    nodes: {
      gate_mode_selection: { kind: 'gate', status: 'completed', gate_active: false },
      phase_loop: {
        kind: 'for_each_phase',
        status: 'in_progress',
        iterations: [
          {
            index: 0,
            status: 'completed',
            doc_path: null,
            repos: [],
            corrective_tasks: [],
            nodes: {
              task_loop:    { kind: 'for_each_task', status: 'completed', iterations: [] },
              phase_gate:   { kind: 'gate', status: 'completed', gate_active: false },
              phase_review: { kind: 'step', status: 'completed', doc_path: null, retries: 0 },
            },
          },
          // The phase an amendment added after the loop had already completed.
          {
            index: 1,
            status: 'not_started',
            doc_path: null,
            repos: [],
            corrective_tasks: [],
            nodes: {
              task_loop: {
                kind: 'for_each_task',
                status: 'not_started',
                iterations: [
                  {
                    index: 0,
                    status: 'not_started',
                    doc_path: null,
                    repos: [],
                    corrective_tasks: [],
                    nodes: {
                      task_gate:     { kind: 'gate', status: 'not_started', gate_active: false },
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

describe('start event (FR-3, DD-2)', () => {
  it('start event with a synthetic planning template writes state.json and returns action=spawn_master_plan', async () => {
    const w = buildWorld({
      template: { id: 'syn-planning', body: PLANNING_TEMPLATE_BODY },
      state: null,
      config: { default_template: 'syn-planning' },
      // Provide the template as syn-planning.yml so the engine can load it for a new project
      sideFiles: [{ path: 'syn-planning.yml', contents: PLANNING_TEMPLATE_BODY }],
    });
    cleanups.push(w.cleanup);
    const env = await captureEnvelope(async () => {
      await runCommand(pipelineSignalCommand, {
        argv: ['--event', 'start', '--project-dir', w.projectDir, '--template', 'syn-planning', '--config', w.configPath],
        env: { ...process.env, RADORCH_NO_LOG: '1', RADORCH_TEMPLATES_DIR: w.projectDir },
        isTTY: false, stderr: process.stderr,
      });
    });
    assertEnvelopeStateSideFiles(env, {
      projectDir: w.projectDir,
      envelope: { ok: true, data: { action: 'spawn_master_plan' } },
      state: { $schema: 'orchestration-state-v6', graph: { template_id: 'syn-planning', nodes: { master_plan: { status: 'in_progress' } } } },
      sideFiles: [],
    });
    // FR-4, FR-23 — engine composes the spawn_master_plan prompt with
    // completion_event=master_plan_completed (per the action catalog).
    assertPromptForEvent(env, 'master_plan_completed');
  });

  it('start event resumes an in-progress task_executor by re-emitting action=execute_task', async () => {
    const w = buildWorld({
      template: { id: 'syn-exec', body: EXECUTION_TEMPLATE_BODY },
      state: structuredClone(taskExecutorInProgressState),
      config: { default_template: 'syn-exec', human_gates: { after_planning: true, execution_mode: 'task', after_final_review: true } },
      sideFiles: [],
    });
    cleanups.push(w.cleanup);
    const env = await captureEnvelope(async () => {
      await runCommand(pipelineSignalCommand, {
        argv: ['--event', 'start', '--project-dir', w.projectDir, '--config', w.configPath],
        env: { ...process.env, RADORCH_NO_LOG: '1', RADORCH_TEMPLATES_DIR: w.projectDir },
        isTTY: false, stderr: process.stderr,
      });
    });
    assertEnvelopeStateSideFiles(env, {
      projectDir: w.projectDir,
      envelope: { ok: true, data: { action: 'execute_task' } },
      state: { graph: { template_id: 'syn-exec', status: 'in_progress' } },
      sideFiles: [],
    });
    // FR-4, FR-23 — execute_task completion is task_completed.
    assertPromptForEvent(env, 'task_completed');
    // start preserves the in_progress frontier — no node-status mutation.
    // Targeted read because partialDeepEqual treats array members as strict
    // toEqual, which would force restating every sibling field in the iteration.
    const onDisk = JSON.parse(fs.readFileSync(path.join(w.projectDir, 'state.json'), 'utf8'));
    const taskExecutor = onDisk.graph.nodes.phase_loop.iterations[0].nodes.task_loop.iterations[0].nodes.task_executor;
    expect(taskExecutor.status).toBe('in_progress');
    expect(taskExecutor.retries).toBe(0);
  });

  it('start is idempotent on an in-progress frontier (two consecutive calls return the same envelope)', async () => {
    const w = buildWorld({
      template: { id: 'syn-exec', body: EXECUTION_TEMPLATE_BODY },
      state: structuredClone(taskExecutorInProgressState),
      config: { default_template: 'syn-exec', human_gates: { after_planning: true, execution_mode: 'task', after_final_review: true } },
      sideFiles: [],
    });
    cleanups.push(w.cleanup);
    const fire = async () => captureEnvelope(async () => {
      await runCommand(pipelineSignalCommand, {
        argv: ['--event', 'start', '--project-dir', w.projectDir, '--config', w.configPath],
        env: { ...process.env, RADORCH_NO_LOG: '1', RADORCH_TEMPLATES_DIR: w.projectDir },
        isTTY: false, stderr: process.stderr,
      });
    });
    const first = await fire() as { ok: boolean; data: { action: string; context: unknown } };
    const second = await fire() as { ok: boolean; data: { action: string; context: unknown } };
    expect(second.data.action).toBe(first.data.action);
    expect(second.data.context).toEqual(first.data.context);
    // FR-4 — idempotent re-emission still carries the composed prompt.
    assertPromptForEvent(first, 'task_completed');
    assertPromptForEvent(second, 'task_completed');
    // And the node state has not advanced past in_progress.
    const onDisk = JSON.parse(fs.readFileSync(path.join(w.projectDir, 'state.json'), 'utf8'));
    expect(onDisk.graph.nodes.phase_loop.iterations[0].nodes.task_loop.iterations[0].nodes.task_executor.status).toBe('in_progress');
  });

  it('start heals a bare container cursor left by an amendment merge instead of tripping the honesty check', async () => {
    const w = buildWorld({
      template: { id: 'syn-exec', body: EXECUTION_TEMPLATE_BODY },
      state: structuredClone(amendedPhaseContainerCursorState),
      config: { default_template: 'syn-exec', human_gates: { after_planning: true, execution_mode: 'task', after_final_review: true } },
      sideFiles: [],
    });
    cleanups.push(w.cleanup);
    const env = await captureEnvelope(async () => {
      await runCommand(pipelineSignalCommand, {
        argv: ['--event', 'start', '--project-dir', w.projectDir, '--config', w.configPath],
        env: { ...process.env, RADORCH_NO_LOG: '1', RADORCH_TEMPLATES_DIR: w.projectDir },
        isTTY: false, stderr: process.stderr,
      });
    });
    // No tripwire: the engine recomputes the cursor from the in_progress
    // markers before validating, so the stale 'phase_loop' echo never reaches
    // the honesty check.
    assertEnvelopeStateSideFiles(env, {
      projectDir: w.projectDir,
      envelope: { ok: true, data: { action: 'execute_task' } },
      state: { graph: { template_id: 'syn-exec', current_node_path: 'phase_loop[1].task_loop[0].task_executor' } },
      sideFiles: [],
    });
    assertPromptForEvent(env, 'task_completed');
  });
});

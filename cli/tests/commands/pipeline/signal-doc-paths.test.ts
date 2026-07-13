// cli/tests/commands/pipeline/signal-doc-paths.test.ts
//
// Behavioral coverage for the engine-envelope doc-path resolution seam
// (attachPromptIfActionResolved → resolveDocPaths). Drives execute_task,
// spawn_code_reviewer, spawn_phase_reviewer, spawn_final_reviewer, and a
// corrective path carrying review_report_path through `pipeline signal`,
// asserting the returned data.context carries absolute doc-path fields
// while state.json keeps storing them relative.
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { buildWorld } from '../../behavioral/pipeline/helpers/world.js';
import { captureEnvelope } from '../../behavioral/pipeline/helpers/capture.js';
import { useRealCatalog } from '../../behavioral/pipeline/helpers/catalog.js';
import { pipelineSignalCommand } from '../../../src/commands/pipeline/signal.js';
import { runCommand } from '../../../src/framework/command.js';
import { EXECUTION_TEMPLATE_BODY } from '../../behavioral/pipeline/events/fixtures/execution-template.js';

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });
beforeEach(() => { cleanups.push(useRealCatalog()); });

function readState(projectDir: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(projectDir, 'state.json'), 'utf8'));
}

async function signal(projectDir: string, configPath: string, argv: string[]) {
  return captureEnvelope(async () => {
    await runCommand(pipelineSignalCommand, {
      argv: [...argv, '--project-dir', projectDir, '--config', configPath],
      env: { ...process.env, RADORCH_NO_LOG: '1', RADORCH_TEMPLATES_DIR: projectDir },
      isTTY: false, stderr: process.stderr,
    });
  });
}

const TASK_HANDOFF_DOC = 'tasks/p1-t1.md';
const PHASE_PLAN_DOC = 'phases/p1-plan.md';

describe('doc-path resolution at the engine envelope seam', () => {
  it('gate_approved (gate-type task) → execute_task: handoff_doc is absolute in the envelope, relative on disk (gate command path inherits the same funnel)', async () => {
    const state = {
      $schema: 'orchestration-state-v6',
      project: { name: 'cli-behavioral', created: '2024-01-01T00:00:00.000Z', updated: '2024-01-01T00:00:00.000Z' },
      config: { gate_mode: 'task', limits: { max_retries_per_task: 3 }, source_control: { auto_commit: 'never', auto_pr: 'never' } },
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
                index: 0, status: 'in_progress', doc_path: null, repos: [], corrective_tasks: [],
                nodes: {
                  task_loop: {
                    kind: 'for_each_task',
                    status: 'in_progress',
                    iterations: [
                      {
                        index: 0, status: 'in_progress', doc_path: TASK_HANDOFF_DOC, repos: [], corrective_tasks: [],
                        nodes: {
                          task_gate: { kind: 'gate', status: 'not_started', gate_active: true },
                          task_executor: { kind: 'step', status: 'not_started', doc_path: null, retries: 0 },
                          code_review: { kind: 'step', status: 'not_started', doc_path: null, retries: 0 },
                        },
                      },
                    ],
                  },
                  phase_gate: { kind: 'gate', status: 'not_started', gate_active: false },
                  phase_review: { kind: 'step', status: 'not_started', doc_path: null, retries: 0 },
                },
              },
            ],
          },
          final_review: { kind: 'step', status: 'not_started', doc_path: null, retries: 0 },
          final_approval_gate: { kind: 'gate', status: 'not_started', gate_active: false },
        },
      },
    };

    const w = buildWorld({
      template: { id: 'syn-exec', body: EXECUTION_TEMPLATE_BODY },
      state,
      config: { default_template: 'syn-exec', human_gates: { after_planning: true, execution_mode: 'task', after_final_review: true } },
      sideFiles: [],
    });
    cleanups.push(w.cleanup);

    const env = await signal(w.projectDir, w.configPath, ['--event', 'gate_approved', '--gate-type', 'task', '--phase', '1', '--task', '1']);
    expect(env.ok, (env.error as { message?: string } | undefined)?.message).toBe(true);
    const data = env.data as { action: string; context: Record<string, unknown> };
    expect(data.action).toBe('execute_task');
    expect(data.context['handoff_doc']).toBe(path.join(w.projectDir, TASK_HANDOFF_DOC));

    // R3 — state stays relative: the persisted task iteration's doc_path is untouched.
    const onDisk = readState(w.projectDir) as { graph: { nodes: { phase_loop: { iterations: Array<{ nodes: { task_loop: { iterations: Array<{ doc_path: string }> } } }> } } } };
    const persistedDocPath = onDisk.graph.nodes.phase_loop.iterations[0].nodes.task_loop.iterations[0].doc_path;
    expect(persistedDocPath).toBe(TASK_HANDOFF_DOC);
  });

  it('task_completed → spawn_code_reviewer: handoff_doc is absolute in the envelope', async () => {
    const state = {
      $schema: 'orchestration-state-v6',
      project: { name: 'cli-behavioral', created: '2024-01-01T00:00:00.000Z', updated: '2024-01-01T00:00:00.000Z' },
      config: { gate_mode: 'task', limits: { max_retries_per_task: 3 }, source_control: { auto_commit: 'never', auto_pr: 'never' } },
      pipeline: { gate_mode: 'task', source_control: null, current_tier: 'execution', halt_reason: null },
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
                index: 0, status: 'in_progress', doc_path: null, repos: [], corrective_tasks: [],
                nodes: {
                  task_loop: {
                    kind: 'for_each_task',
                    status: 'in_progress',
                    iterations: [
                      {
                        index: 0, status: 'in_progress', doc_path: TASK_HANDOFF_DOC, repos: [], corrective_tasks: [],
                        nodes: {
                          task_gate: { kind: 'gate', status: 'completed', gate_active: true },
                          task_executor: { kind: 'step', status: 'in_progress', doc_path: null, retries: 0 },
                          code_review: { kind: 'step', status: 'not_started', doc_path: null, retries: 0 },
                        },
                      },
                    ],
                  },
                  phase_gate: { kind: 'gate', status: 'not_started', gate_active: false },
                  phase_review: { kind: 'step', status: 'not_started', doc_path: null, retries: 0 },
                },
              },
            ],
          },
          final_review: { kind: 'step', status: 'not_started', doc_path: null, retries: 0 },
          final_approval_gate: { kind: 'gate', status: 'not_started', gate_active: false },
        },
      },
    };

    const w = buildWorld({
      template: { id: 'syn-exec', body: EXECUTION_TEMPLATE_BODY },
      state,
      config: { default_template: 'syn-exec', human_gates: { after_planning: true, execution_mode: 'task', after_final_review: true } },
      sideFiles: [],
    });
    cleanups.push(w.cleanup);

    const env = await signal(w.projectDir, w.configPath, ['--event', 'task_completed', '--phase', '1', '--task', '1']);
    expect(env.ok, (env.error as { message?: string } | undefined)?.message).toBe(true);
    const data = env.data as { action: string; context: Record<string, unknown> };
    expect(data.action).toBe('spawn_code_reviewer');
    expect(data.context['handoff_doc']).toBe(path.join(w.projectDir, TASK_HANDOFF_DOC));
  });

  it('gate_approved (gate-type phase) → spawn_phase_reviewer: phase_plan_doc is absolute in the envelope', async () => {
    const state = {
      $schema: 'orchestration-state-v6',
      project: { name: 'cli-behavioral', created: '2024-01-01T00:00:00.000Z', updated: '2024-01-01T00:00:00.000Z' },
      config: { gate_mode: 'task', limits: { max_retries_per_task: 3 }, source_control: { auto_commit: 'never', auto_pr: 'never' } },
      pipeline: { gate_mode: 'task', source_control: null, current_tier: 'execution', halt_reason: null },
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
                index: 0, status: 'in_progress', doc_path: PHASE_PLAN_DOC, repos: [], corrective_tasks: [],
                nodes: {
                  task_loop: {
                    kind: 'for_each_task',
                    status: 'completed',
                    iterations: [
                      {
                        index: 0, status: 'completed', doc_path: null, repos: [], corrective_tasks: [],
                        nodes: {
                          task_gate: { kind: 'gate', status: 'completed', gate_active: true },
                          task_executor: { kind: 'step', status: 'completed', doc_path: null, retries: 0 },
                          code_review: { kind: 'step', status: 'completed', doc_path: null, retries: 0 },
                        },
                      },
                    ],
                  },
                  phase_gate: { kind: 'gate', status: 'not_started', gate_active: true },
                  phase_review: { kind: 'step', status: 'not_started', doc_path: null, retries: 0 },
                },
              },
            ],
          },
          final_review: { kind: 'step', status: 'not_started', doc_path: null, retries: 0 },
          final_approval_gate: { kind: 'gate', status: 'not_started', gate_active: false },
        },
      },
    };

    const w = buildWorld({
      template: { id: 'syn-exec', body: EXECUTION_TEMPLATE_BODY },
      state,
      config: { default_template: 'syn-exec', human_gates: { after_planning: true, execution_mode: 'task', after_final_review: true } },
      sideFiles: [],
    });
    cleanups.push(w.cleanup);

    const env = await signal(w.projectDir, w.configPath, ['--event', 'gate_approved', '--gate-type', 'phase', '--phase', '1']);
    expect(env.ok, (env.error as { message?: string } | undefined)?.message).toBe(true);
    const data = env.data as { action: string; context: Record<string, unknown> };
    expect(data.action).toBe('spawn_phase_reviewer');
    expect(data.context['phase_plan_doc']).toBe(path.join(w.projectDir, PHASE_PLAN_DOC));
  });

  it('phase_review_completed → spawn_final_reviewer: phase_plan_paths elements are absolute in the envelope', async () => {
    const state = {
      $schema: 'orchestration-state-v6',
      project: { name: 'cli-behavioral', created: '2024-01-01T00:00:00.000Z', updated: '2024-01-01T00:00:00.000Z' },
      config: { gate_mode: 'task', limits: { max_retries_per_task: 3 }, source_control: { auto_commit: 'never', auto_pr: 'never' } },
      pipeline: { gate_mode: 'task', source_control: null, current_tier: 'execution', halt_reason: null },
      graph: {
        template_id: 'syn-exec',
        status: 'in_progress',
        current_node_path: 'phase_loop[0].phase_review',
        nodes: {
          gate_mode_selection: { kind: 'gate', status: 'completed', gate_active: false },
          phase_loop: {
            kind: 'for_each_phase',
            status: 'in_progress',
            iterations: [
              {
                index: 0, status: 'in_progress', doc_path: PHASE_PLAN_DOC, repos: [], corrective_tasks: [],
                nodes: {
                  task_loop: {
                    kind: 'for_each_task',
                    status: 'completed',
                    iterations: [
                      {
                        index: 0, status: 'completed', doc_path: null, repos: [], corrective_tasks: [],
                        nodes: {
                          task_gate: { kind: 'gate', status: 'completed', gate_active: true },
                          task_executor: { kind: 'step', status: 'completed', doc_path: null, retries: 0 },
                          code_review: { kind: 'step', status: 'completed', doc_path: null, retries: 0 },
                        },
                      },
                    ],
                  },
                  phase_gate: { kind: 'gate', status: 'completed', gate_active: true },
                  phase_review: { kind: 'step', status: 'in_progress', doc_path: null, retries: 0 },
                },
              },
            ],
          },
          final_review: { kind: 'step', status: 'not_started', doc_path: null, retries: 0 },
          final_approval_gate: { kind: 'gate', status: 'not_started', gate_active: false },
        },
      },
    };

    const REVIEW_DOC_PATH = 'phase-review.md';
    const REVIEW_DOC_CONTENTS = `---\nverdict: approved\nexit_criteria_met: true\n---\nPhase review content.\n`;
    const w = buildWorld({
      template: { id: 'syn-exec', body: EXECUTION_TEMPLATE_BODY },
      state,
      config: { default_template: 'syn-exec', human_gates: { after_planning: true, execution_mode: 'task', after_final_review: true } },
      sideFiles: [{ path: REVIEW_DOC_PATH, contents: REVIEW_DOC_CONTENTS }],
    });
    cleanups.push(w.cleanup);

    const reviewDocAbsPath = path.join(w.projectDir, REVIEW_DOC_PATH);
    const env = await signal(w.projectDir, w.configPath, ['--event', 'phase_review_completed', '--verdict', 'approved', '--doc-path', reviewDocAbsPath, '--phase', '1']);
    expect(env.ok, (env.error as { message?: string } | undefined)?.message).toBe(true);
    const data = env.data as { action: string; context: Record<string, unknown> };
    expect(data.action).toBe('spawn_final_reviewer');
    expect(data.context['phase_plan_paths']).toEqual([path.join(w.projectDir, PHASE_PLAN_DOC)]);
    // requirements_doc has no persisted state field — resolveRequirementsDoc
    // returns null when the project is unregistered (as in this sandboxed
    // world). Per the allow-list rule, null passes through unresolved.
    const requirementsDoc = data.context['requirements_doc'];
    expect(requirementsDoc === null || (typeof requirementsDoc === 'string' && path.isAbsolute(requirementsDoc))).toBe(true);
  });

  it('corrective task_completed → spawn_code_reviewer: handoff_doc AND review_report_path are both absolute in the envelope, relative on disk', async () => {
    const REVIEW_REPORT_DOC = 'reports/p1-t1-review.md';
    const state = {
      $schema: 'orchestration-state-v6',
      project: { name: 'cli-behavioral', created: '2024-01-01T00:00:00.000Z', updated: '2024-01-01T00:00:00.000Z' },
      config: { gate_mode: 'autonomous', limits: { max_retries_per_task: 3 }, source_control: { auto_commit: 'always', auto_pr: 'never' } },
      pipeline: {
        gate_mode: 'autonomous',
        source_control: {
          worktree_name: 'cli-behavioral',
          auto_commit: 'always',
          auto_pr: 'never',
          repos: [{ name: 'backend', branch: 'feature/syn', base_branch: 'main', remote_url: null, compare_url: null, pr_url: null }],
        },
        current_tier: 'execution',
        halt_reason: null,
      },
      graph: {
        template_id: 'syn-exec',
        status: 'in_progress',
        current_node_path: 'phase_loop[0].task_loop[0].corrective_tasks[1].task_executor',
        nodes: {
          gate_mode_selection: { kind: 'gate', status: 'completed', gate_active: false },
          phase_loop: {
            kind: 'for_each_phase',
            status: 'in_progress',
            iterations: [
              {
                index: 0, status: 'in_progress', doc_path: null, repos: [], corrective_tasks: [],
                nodes: {
                  task_loop: {
                    kind: 'for_each_task',
                    status: 'in_progress',
                    iterations: [
                      {
                        index: 0,
                        status: 'in_progress',
                        doc_path: TASK_HANDOFF_DOC,
                        repos: [{ name: 'backend', commit_hash: 'aaa1111' }],
                        corrective_tasks: [
                          {
                            index: 1,
                            reason: 'code review requested changes',
                            injected_after: 'code_review',
                            status: 'in_progress',
                            doc_path: TASK_HANDOFF_DOC,
                            review_report_path: REVIEW_REPORT_DOC,
                            repos: [{ name: 'backend', commit_hash: null }],
                            nodes: {
                              task_gate: { kind: 'gate', status: 'completed', gate_active: true },
                              task_executor: { kind: 'step', status: 'in_progress', doc_path: null, retries: 0 },
                              code_review: { kind: 'step', status: 'not_started', doc_path: null, retries: 0 },
                            },
                          },
                        ],
                        nodes: {
                          task_gate: { kind: 'gate', status: 'completed', gate_active: true },
                          task_executor: { kind: 'step', status: 'completed', doc_path: null, retries: 0 },
                          code_review: { kind: 'step', status: 'completed', doc_path: null, retries: 0 },
                        },
                      },
                    ],
                  },
                  phase_gate: { kind: 'gate', status: 'not_started', gate_active: false },
                  phase_review: { kind: 'step', status: 'not_started', doc_path: null, retries: 0 },
                },
              },
            ],
          },
          final_review: { kind: 'step', status: 'not_started', doc_path: null, retries: 0 },
          final_approval_gate: { kind: 'gate', status: 'not_started', gate_active: false },
        },
      },
    };

    const w = buildWorld({
      template: { id: 'syn-exec', body: EXECUTION_TEMPLATE_BODY },
      state,
      config: { default_template: 'syn-exec', human_gates: { after_planning: true, execution_mode: 'autonomous', after_final_review: true } },
      sideFiles: [],
    });
    cleanups.push(w.cleanup);

    const env = await signal(w.projectDir, w.configPath, [
      '--event', 'task_completed', '--phase', '1', '--task', '1',
      '--repos', JSON.stringify([{ name: 'backend', committed: true, commitHash: 'cor1234', pushed: true }]),
      '--branch', 'feature/syn',
    ]);
    expect(env.ok, (env.error as { message?: string } | undefined)?.message).toBe(true);
    const data = env.data as { action: string; context: Record<string, unknown> };
    expect(data.action).toBe('spawn_code_reviewer');
    expect(data.context['handoff_doc']).toBe(path.join(w.projectDir, TASK_HANDOFF_DOC));
    expect(data.context['review_report_path']).toBe(path.join(w.projectDir, REVIEW_REPORT_DOC));

    // R3 — state stays relative: the persisted corrective's doc_path and
    // review_report_path are untouched by envelope-time resolution.
    const onDisk = readState(w.projectDir) as {
      graph: { nodes: { phase_loop: { iterations: Array<{ nodes: { task_loop: { iterations: Array<{ corrective_tasks: Array<{ doc_path: string; review_report_path: string }> }> } } }> } } };
    };
    const corrective = onDisk.graph.nodes.phase_loop.iterations[0].nodes.task_loop.iterations[0].corrective_tasks[0];
    expect(corrective.doc_path).toBe(TASK_HANDOFF_DOC);
    expect(corrective.review_report_path).toBe(REVIEW_REPORT_DOC);
  });
});

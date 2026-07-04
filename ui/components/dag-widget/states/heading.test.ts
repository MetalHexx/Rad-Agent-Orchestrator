import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveCardHeading } from './heading';
import { resolveStateView } from '../resolver';
import type { NodesRecord, ProjectStateV5 } from '@/types/state';

const noopDeps = { onDocClick: () => {}, compareUrlByRepo: {}, projectName: 'demo' };

function makeState(nodes: NodesRecord, currentNodePath: string): ProjectStateV5 {
  return {
    $schema: 'orchestration-state-v5',
    project: { name: 'demo', created: '2026-01-01', updated: '2026-01-01' },
    config: {
      gate_mode: 'task',
      limits: { max_phases: 3, max_tasks_per_phase: 5, max_retries_per_task: 2 },
      source_control: { auto_commit: 'never', auto_pr: 'never' },
    },
    pipeline: { gate_mode: 'task', source_control: null, current_tier: 'execution', halt_reason: null },
    graph: { template_id: 'std', status: 'in_progress', current_node_path: currentNodePath, nodes },
  };
}

function makeWorkStateNodes(
  taskDocPath: string | null,
  taskIndex: number,
  phaseDocPath: string,
  phaseIndex: number,
): NodesRecord {
  return {
    phase_loop: {
      kind: 'for_each_phase',
      status: 'in_progress',
      iterations: [
        {
          index: phaseIndex,
          status: 'in_progress',
          doc_path: phaseDocPath,
          corrective_tasks: [],
          repos: [],
          nodes: {
            task_loop: {
              kind: 'for_each_task',
              status: 'in_progress',
              iterations: [
                {
                  index: taskIndex,
                  status: 'in_progress',
                  doc_path: taskDocPath,
                  corrective_tasks: [],
                  repos: [],
                  nodes: {
                    task_executor: { kind: 'step', status: 'in_progress', doc_path: null, retries: 0 },
                  },
                },
              ],
            },
          },
        },
      ],
    },
  };
}

test('deriveCardHeading strips the "Task N — " prefix and prepends "Coding: " for the Coding state', () => {
  const nodes = makeWorkStateNodes(
    'tasks/DEMO-TASK-P01-T03-INSTALLER-MANIFESTS.md',
    2,
    'phases/DEMO-PHASE-01-SETUP.md',
    0,
  );
  const state = makeState(nodes, 'phase_loop.iter0.task_loop.iter2.task_executor');
  const { ctx } = resolveStateView(state, undefined, noopDeps);
  assert.equal(ctx.stateId, 'coding');
  assert.deepEqual(deriveCardHeading(ctx), { heading: 'Coding: Installer Manifests', meta: 'Phase 1 · Task 3' });
});

test('deriveCardHeading falls back to the bare "Task N" (still prefixed) when the doc path carries no parseable title', () => {
  const nodes = makeWorkStateNodes(null, 0, 'phases/DEMO-PHASE-01-SETUP.md', 0);
  const state = makeState(nodes, 'phase_loop.iter0.task_loop.iter0.task_executor');
  const { ctx } = resolveStateView(state, undefined, noopDeps);
  assert.deepEqual(deriveCardHeading(ctx), { heading: 'Coding: Task 1', meta: 'Phase 1 · Task 1' });
});

test('deriveCardHeading prepends "Reviewing: " for the Reviewing state', () => {
  const nodes: NodesRecord = {
    phase_loop: {
      kind: 'for_each_phase',
      status: 'in_progress',
      iterations: [
        {
          index: 0,
          status: 'in_progress',
          doc_path: 'phases/DEMO-PHASE-01-SETUP.md',
          corrective_tasks: [],
          repos: [],
          nodes: {
            task_loop: {
              kind: 'for_each_task',
              status: 'in_progress',
              iterations: [
                {
                  index: 2,
                  status: 'in_progress',
                  doc_path: 'tasks/DEMO-TASK-P01-T03-INSTALLER-MANIFESTS.md',
                  corrective_tasks: [],
                  repos: [],
                  nodes: {
                    task_executor: { kind: 'step', status: 'completed', doc_path: null, retries: 0 },
                    code_review: { kind: 'step', status: 'in_progress', doc_path: null, retries: 0, verdict: null },
                  },
                },
              ],
            },
          },
        },
      ],
    },
  };
  const state = makeState(nodes, 'phase_loop.iter0.task_loop.iter2.code_review');
  const { ctx } = resolveStateView(state, undefined, noopDeps);
  assert.equal(ctx.stateId, 'reviewing');
  assert.deepEqual(deriveCardHeading(ctx), { heading: 'Reviewing: Installer Manifests', meta: 'Phase 1 · Task 3' });
});

test('deriveCardHeading prepends "Correcting: " for the Corrective state', () => {
  const nodes: NodesRecord = {
    phase_loop: {
      kind: 'for_each_phase',
      status: 'in_progress',
      iterations: [
        {
          index: 0,
          status: 'in_progress',
          doc_path: 'phases/DEMO-PHASE-01-SETUP.md',
          corrective_tasks: [],
          repos: [],
          nodes: {
            task_loop: {
              kind: 'for_each_task',
              status: 'in_progress',
              iterations: [
                {
                  index: 0,
                  status: 'in_progress',
                  doc_path: 'tasks/DEMO-TASK-P01-T01-AUTH-GUARD.md',
                  repos: [],
                  corrective_tasks: [
                    {
                      index: 1,
                      status: 'in_progress',
                      doc_path: 'tasks/DEMO-CT-P01-T01.md',
                      reason: 'fix it',
                      injected_after: 'code_review',
                      repos: [],
                      nodes: {
                        task_executor: { kind: 'step', status: 'in_progress', doc_path: null, retries: 0 },
                      },
                    },
                  ],
                  nodes: {
                    task_executor: { kind: 'step', status: 'completed', doc_path: null, retries: 0 },
                  },
                },
              ],
            },
          },
        },
      ],
    },
  };
  const state = makeState(nodes, 'phase_loop.iter0.task_loop.iter0.ct1.task_executor');
  const { ctx } = resolveStateView(state, undefined, noopDeps);
  assert.equal(ctx.stateId, 'corrective');
  assert.deepEqual(deriveCardHeading(ctx), { heading: 'Correcting: Auth Guard', meta: 'Phase 1 · Task 1' });
});

test('deriveCardHeading strips the "Phase N — " prefix and prepends "Phase Review: " for the Phase Review state', () => {
  const nodes: NodesRecord = {
    phase_loop: {
      kind: 'for_each_phase',
      status: 'in_progress',
      iterations: [
        {
          index: 1,
          status: 'in_progress',
          doc_path: 'phases/DEMO-PHASE-02-OVERVIEW-FACET.md',
          corrective_tasks: [],
          repos: [],
          nodes: {
            phase_review: { kind: 'step', status: 'in_progress', doc_path: null, retries: 0 },
          },
        },
      ],
    },
  };
  const state = makeState(nodes, 'phase_loop.iter1.phase_review');
  const { ctx } = resolveStateView(state, undefined, noopDeps);
  assert.equal(ctx.stateId, 'phase-review');
  assert.deepEqual(deriveCardHeading(ctx), { heading: 'Phase Review: Overview Facet', meta: 'Phase 2' });
});

test('deriveCardHeading carries no meta for a milestone state', () => {
  const nodes: NodesRecord = {
    plan_approval_gate: { kind: 'gate', status: 'not_started', gate_active: true },
  };
  const state = makeState(nodes, 'plan_approval_gate');
  const { ctx } = resolveStateView(state, undefined, noopDeps);
  assert.equal(ctx.stateId, 'plan-approval');
  assert.deepEqual(deriveCardHeading(ctx), { heading: 'Plan Approval Gate', meta: null });
});

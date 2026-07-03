import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveStateId, resolveStateView } from './resolver';
import type { ProjectStateV5, NodesRecord, GraphStatus } from '@/types/state';

// A rich graph so a single fixture exercises every mapping path: top-level
// planning steps + gates, a phase iteration carrying a task loop, a task
// iteration carrying a corrective task, and the completion nodes.
const RICH_NODES: NodesRecord = {
  master_plan: { kind: 'step', status: 'completed', doc_path: 'DEMO-MASTER-PLAN.md', retries: 0 },
  explode_master_plan: { kind: 'step', status: 'completed', doc_path: null, retries: 0 },
  plan_approval_gate: { kind: 'gate', status: 'completed', gate_active: false },
  gate_mode_selection: { kind: 'gate', status: 'completed', gate_active: false },
  phase_loop: {
    kind: 'for_each_phase',
    status: 'in_progress',
    iterations: [
      {
        index: 0,
        status: 'in_progress',
        doc_path: 'phases/DEMO-PHASE-01-SETUP.md',
        corrective_tasks: [],
        repos: [{ name: 'api', commit_hash: 'phasehash' }],
        nodes: {
          task_loop: {
            kind: 'for_each_task',
            status: 'in_progress',
            iterations: [
              {
                index: 0,
                status: 'in_progress',
                doc_path: 'tasks/DEMO-TASK-P01-T01-AUTH.md',
                repos: [{ name: 'api', commit_hash: 'taskhash' }],
                corrective_tasks: [
                  {
                    index: 1,
                    reason: 'code review found issues',
                    injected_after: 'code_review',
                    status: 'in_progress',
                    repos: [{ name: 'api', commit_hash: 'cthash' }],
                    nodes: {
                      task_executor: { kind: 'step', status: 'in_progress', doc_path: null, retries: 0 },
                      code_review: { kind: 'step', status: 'not_started', doc_path: null, retries: 0 },
                    },
                  },
                ],
                nodes: {
                  task_executor: { kind: 'step', status: 'in_progress', doc_path: null, retries: 0 },
                  code_review: { kind: 'step', status: 'not_started', doc_path: 'reviews/r.md', retries: 0 },
                  task_gate: { kind: 'gate', status: 'not_started', gate_active: false },
                },
              },
            ],
          },
          phase_review: { kind: 'step', status: 'not_started', doc_path: null, retries: 0 },
          phase_gate: { kind: 'gate', status: 'not_started', gate_active: false },
        },
      },
    ],
  },
  final_review: { kind: 'step', status: 'not_started', doc_path: null, retries: 0 },
  final_approval_gate: { kind: 'gate', status: 'not_started', gate_active: false },
};

function makeState(currentNodePath: string | null, status: GraphStatus = 'in_progress'): ProjectStateV5 {
  return {
    $schema: 'orchestration-state-v5',
    project: { name: 'demo', created: '2026-01-01', updated: '2026-01-01' },
    config: {
      gate_mode: 'task',
      limits: { max_phases: 3, max_tasks_per_phase: 3, max_retries_per_task: 2 },
      source_control: { auto_commit: 'never', auto_pr: 'never' },
    },
    pipeline: { gate_mode: 'task', source_control: null, current_tier: 'execution', halt_reason: null },
    graph: { template_id: 'std', status, current_node_path: currentNodePath, nodes: RICH_NODES },
  };
}

const TASK_PATH = 'phase_loop.iter0.task_loop.iter0';
const noopDeps = { onDocClick: () => {}, compareUrlByRepo: {}, projectName: 'demo' };

// ─── node id / kind → StateId mapping ────────────────────────────────────────

test('top-level master_plan maps to planning', () => {
  assert.equal(resolveStateId(makeState('master_plan')), 'planning');
});

test('plan_approval_gate maps to plan-approval', () => {
  assert.equal(resolveStateId(makeState('plan_approval_gate')), 'plan-approval');
});

test('task_executor leaf under the task loop maps to coding', () => {
  assert.equal(resolveStateId(makeState(`${TASK_PATH}.task_executor`)), 'coding');
});

test('code_review leaf under the task loop maps to reviewing', () => {
  assert.equal(resolveStateId(makeState(`${TASK_PATH}.code_review`)), 'reviewing');
});

test('phase_review leaf maps to phase-review', () => {
  assert.equal(resolveStateId(makeState('phase_loop.iter0.phase_review')), 'phase-review');
});

test('final_review maps to final-review', () => {
  assert.equal(resolveStateId(makeState('final_review')), 'final-review');
});

// ─── corrective — the Blocker-class regression guard ─────────────────────────

test('a .ct{N}. corrective path resolves to corrective, not the leaf mapping', () => {
  // Leaf is task_executor (would map to coding) but the ct1 segment wins.
  assert.equal(resolveStateId(makeState(`${TASK_PATH}.ct1.task_executor`)), 'corrective');
});

test('a .ct{N}. corrective path whose leaf is code_review still resolves to corrective', () => {
  assert.equal(resolveStateId(makeState(`${TASK_PATH}.ct1.code_review`)), 'corrective');
});

test('resolveStateView surfaces the corrective node object and flags on the context', () => {
  const { ctx } = resolveStateView(makeState(`${TASK_PATH}.ct1.code_review`), undefined, noopDeps);
  assert.equal(ctx.stateId, 'corrective');
  assert.equal(ctx.isCorrective, true);
  assert.equal(ctx.nodeId, 'code_review');
  assert.ok(ctx.node && ctx.node.kind === 'step');
  assert.equal(ctx.correctiveEntry?.index, 1);
  // repos come from the innermost corrective entry.
  assert.deepEqual(ctx.repos, [{ name: 'api', commit_hash: 'cthash' }]);
});

// ─── skip-set resolves away ──────────────────────────────────────────────────

for (const skipPath of [
  'phase_loop',
  'gate_mode_selection',
  'explode_master_plan',
  `${TASK_PATH}.task_gate`,
  'final_approval_gate',
]) {
  test(`skip-set node "${skipPath}" resolves to fallback`, () => {
    assert.equal(resolveStateId(makeState(skipPath)), 'fallback');
  });
}

// ─── unknown / empty ─────────────────────────────────────────────────────────

test('an unknown leaf resolves to fallback', () => {
  assert.equal(resolveStateId(makeState('some_unmapped_node')), 'fallback');
});

test('a stale path into a missing iteration resolves to fallback', () => {
  assert.equal(resolveStateId(makeState('phase_loop.iter7.task_loop.iter0.task_executor')), 'fallback');
});

test('a null current_node_path (not completed) resolves to fallback', () => {
  assert.equal(resolveStateId(makeState(null)), 'fallback');
});

// ─── completed graph wins over the node ──────────────────────────────────────

test('a completed graph resolves to complete regardless of the active node', () => {
  assert.equal(resolveStateId(makeState(`${TASK_PATH}.task_executor`, 'completed')), 'complete');
});

test('a completed graph with a null path still resolves to complete', () => {
  assert.equal(resolveStateId(makeState(null, 'completed')), 'complete');
});

// ─── focus overrides current_node_path ───────────────────────────────────────

test('an explicit focus overrides current_node_path', () => {
  const state = makeState('master_plan');
  assert.equal(resolveStateId(state, `${TASK_PATH}.code_review`), 'reviewing');
});

// ─── view registry: coding/reviewing/corrective are registered; milestones are not ──

test('resolveStateView returns the fallback view for a mapped-but-unregistered state', () => {
  // phase_review maps to "phase-review", but no phase-review view is registered yet.
  const { view, ctx } = resolveStateView(makeState('phase_loop.iter0.phase_review'), undefined, noopDeps);
  assert.equal(ctx.stateId, 'phase-review');
  assert.equal(view.id, 'fallback');
});

test('resolveStateView returns the registered coding view for task_executor', () => {
  const { view, ctx } = resolveStateView(makeState(`${TASK_PATH}.task_executor`), undefined, noopDeps);
  assert.equal(ctx.stateId, 'coding');
  assert.equal(view.id, 'coding');
});

test('resolveStateView derives phase name and progress from the phase loop', () => {
  const { ctx } = resolveStateView(makeState('master_plan'), undefined, noopDeps);
  assert.equal(ctx.phaseName, 'Phase 1 — Setup');
  assert.deepEqual(ctx.phaseProgress, { completed: 0, total: 1 });
});

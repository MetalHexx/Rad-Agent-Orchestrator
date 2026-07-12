import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveStateId, resolveStateView, normalizeNodePath } from './resolver';
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
        corrective_tasks: [
          {
            index: 2,
            reason: 'phase review found a cross-task regression',
            injected_after: 'phase_review',
            status: 'in_progress',
            repos: [{ name: 'api', commit_hash: 'phasecthash' }],
            nodes: {
              task_executor: { kind: 'step', status: 'in_progress', doc_path: null, retries: 0 },
              code_review: { kind: 'step', status: 'not_started', doc_path: null, retries: 0 },
            },
          },
        ],
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
  pr_gate: { kind: 'conditional', status: 'not_started', branch_taken: null },
  final_pr: { kind: 'step', status: 'not_started', doc_path: null, retries: 0 },
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

// ─── normalizeNodePath: engine bracket grammar → resolver segment grammar ────

test('normalizeNodePath rewrites a bracketed task_executor path to segment form', () => {
  assert.equal(
    normalizeNodePath('phase_loop[0].task_loop[0].task_executor'),
    'phase_loop.iter0.task_loop.iter0.task_executor',
  );
});

test('normalizeNodePath rewrites a bracketed code_review path to segment form', () => {
  assert.equal(
    normalizeNodePath('phase_loop[0].task_loop[0].code_review'),
    'phase_loop.iter0.task_loop.iter0.code_review',
  );
});

test('normalizeNodePath rewrites a bracketed phase_review path to segment form', () => {
  assert.equal(normalizeNodePath('phase_loop[0].phase_review'), 'phase_loop.iter0.phase_review');
});

test('normalizeNodePath rewrites corrective_tasks[N] before the loop brackets, keeping the 1-based index', () => {
  assert.equal(
    normalizeNodePath('phase_loop[0].task_loop[0].corrective_tasks[1].task_executor'),
    'phase_loop.iter0.task_loop.iter0.ct1.task_executor',
  );
});

test('normalizeNodePath is a no-op on already-segmented iterN/ctN input', () => {
  const segmented = 'phase_loop.iter0.task_loop.iter0.ct1.task_executor';
  assert.equal(normalizeNodePath(segmented), segmented);
});

test('normalizeNodePath is a no-op on a bracket-free top-level id', () => {
  assert.equal(normalizeNodePath('final_review'), 'final_review');
  assert.equal(normalizeNodePath('plan_approval_gate'), 'plan_approval_gate');
});

test('normalizeNodePath strips a conditional branch prefix so the flat child leaf resolves', () => {
  // pr_gate is a conditional; final_pr lives flat in the root record, not nested
  // under pr_gate. Dropping the `pr_gate.branches.true.` prefix lets walkPath find it.
  assert.equal(normalizeNodePath('pr_gate.branches.true.final_pr'), 'final_pr');
  assert.equal(normalizeNodePath('pr_gate.branches.false.final_pr'), 'final_pr');
});

// ─── resolveStateId with real (bracket-format) engine paths ─────────────────
// The engine writes current_node_path in bracket-index notation; these guard
// the actual bug (bracketed paths falling to fallback) rather than only the
// pre-normalized segment form the rest of this file exercises.

test('a bracket-format task_executor path resolves to coding', () => {
  assert.equal(resolveStateId(makeState('phase_loop[0].task_loop[0].task_executor')), 'coding');
});

test('a bracket-format code_review path resolves to reviewing', () => {
  assert.equal(resolveStateId(makeState('phase_loop[0].task_loop[0].code_review')), 'reviewing');
});

test('a bracket-format phase_review path resolves to phase-review', () => {
  assert.equal(resolveStateId(makeState('phase_loop[0].phase_review')), 'phase-review');
});

test('a bracket-format corrective_tasks[N] path resolves to corrective', () => {
  assert.equal(
    resolveStateId(makeState('phase_loop[0].task_loop[0].corrective_tasks[1].task_executor')),
    'corrective',
  );
});

test('a bracket-format path into a missing iteration still resolves to fallback', () => {
  assert.equal(resolveStateId(makeState('phase_loop[9].task_loop[0].task_executor')), 'fallback');
});

// ─── node id / kind → StateId mapping ────────────────────────────────────────

test('top-level master_plan maps to planning', () => {
  assert.equal(resolveStateId(makeState('master_plan')), 'planning');
});

test('plan_approval_gate maps to plan-approval', () => {
  assert.equal(resolveStateId(makeState('plan_approval_gate')), 'plan-approval');
});

// ─── planning → plan-approval advancement when the gate is active ──────────

test('a planning leaf advances to plan-approval when the plan_approval_gate is active', () => {
  const nodes: NodesRecord = {
    ...RICH_NODES,
    plan_approval_gate: { kind: 'gate', status: 'in_progress', gate_active: true },
  };
  const state = { ...makeState('master_plan'), graph: { ...makeState('master_plan').graph, nodes } };
  assert.equal(resolveStateId(state), 'plan-approval');
});

test('a planning leaf stays planning when the plan_approval_gate is inactive', () => {
  // RICH_NODES already carries plan_approval_gate as gate_active: false.
  assert.equal(resolveStateId(makeState('master_plan')), 'planning');
});

test('a planning leaf stays planning when the plan_approval_gate is active but already completed', () => {
  const nodes: NodesRecord = {
    ...RICH_NODES,
    plan_approval_gate: { kind: 'gate', status: 'completed', gate_active: true },
  };
  const state = { ...makeState('master_plan'), graph: { ...makeState('master_plan').graph, nodes } };
  assert.equal(resolveStateId(state), 'planning');
});

test('an active plan_approval_gate does not affect a non-planning (coding) path', () => {
  const nodes: NodesRecord = {
    ...RICH_NODES,
    plan_approval_gate: { kind: 'gate', status: 'in_progress', gate_active: true },
  };
  const state = { ...makeState(`${TASK_PATH}.task_executor`), graph: { ...makeState(`${TASK_PATH}.task_executor`).graph, nodes } };
  assert.equal(resolveStateId(state), 'coding');
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

// ─── plumbing nodes folded into their nearest meaningful state ──────────────

test('explode_master_plan folds into planning, not the fallback', () => {
  assert.equal(resolveStateId(makeState('explode_master_plan')), 'planning');
});

test('final_approval_gate folds into final-review, not the fallback', () => {
  assert.equal(resolveStateId(makeState('final_approval_gate')), 'final-review');
});

test('pr_gate folds into final-review, not the fallback', () => {
  assert.equal(resolveStateId(makeState('pr_gate')), 'final-review');
});

test('final_pr folds into final-review, not the fallback', () => {
  assert.equal(resolveStateId(makeState('final_pr')), 'final-review');
});

test('the real conditional-branch final_pr path folds into final-review, not the gray fallback', () => {
  // The production path the engine writes — pr_gate is a conditional, so
  // final_pr is routed via `.branches.true.`. This is the exact shape that used
  // to abort walkPath and paint the fallback (the live DAG-WIDGET-2 bug).
  assert.equal(resolveStateId(makeState('pr_gate.branches.true.final_pr')), 'final-review');
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

// ─── isPhaseCorrective — phase-level vs. task-level corrective ──────────────

test('a phase_loop.iterN.ctM path resolves isPhaseCorrective: true', () => {
  const { ctx } = resolveStateView(makeState('phase_loop.iter0.ct2.code_review'), undefined, noopDeps);
  assert.equal(ctx.stateId, 'corrective');
  assert.equal(ctx.isCorrective, true);
  assert.equal(ctx.isPhaseCorrective, true);
});

test('a phase_loop.iterN.task_loop.iterK.ctM path resolves isPhaseCorrective: false', () => {
  const { ctx } = resolveStateView(makeState(`${TASK_PATH}.ct1.code_review`), undefined, noopDeps);
  assert.equal(ctx.stateId, 'corrective');
  assert.equal(ctx.isCorrective, true);
  assert.equal(ctx.isPhaseCorrective, false);
});

test('a plain coding path resolves isPhaseCorrective: false', () => {
  const { ctx } = resolveStateView(makeState(`${TASK_PATH}.task_executor`), undefined, noopDeps);
  assert.equal(ctx.isCorrective, false);
  assert.equal(ctx.isPhaseCorrective, false);
});

// ─── skip-set resolves away ──────────────────────────────────────────────────
// explode_master_plan / final_approval_gate / pr_gate / final_pr no longer
// belong here — they fold into planning / final-review above. The remaining
// skip-set (loop containers + auto gates) still resolves to fallback.

for (const skipPath of [
  'phase_loop',
  'gate_mode_selection',
  'phase_loop.iter0.task_loop',
  'phase_loop.iter0.phase_gate',
  `${TASK_PATH}.task_gate`,
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

// ─── view registry: every StateId now has a registered view ─────────────────

test('resolveStateView returns the registered phase-review view for phase_review', () => {
  const { view, ctx } = resolveStateView(makeState('phase_loop.iter0.phase_review'), undefined, noopDeps);
  assert.equal(ctx.stateId, 'phase-review');
  assert.equal(view.id, 'phase-review');
});

test('resolveStateView returns the registered planning view (not fallback) for explode_master_plan', () => {
  const { view, ctx } = resolveStateView(makeState('explode_master_plan'), undefined, noopDeps);
  assert.equal(ctx.stateId, 'planning');
  assert.equal(view.id, 'planning');
});

test('resolveStateView returns the registered final-review view (not fallback) for final_pr', () => {
  const { view, ctx } = resolveStateView(makeState('final_pr'), undefined, noopDeps);
  assert.equal(ctx.stateId, 'final-review');
  assert.equal(view.id, 'final-review');
});

test('resolveStateView returns the final-review view for the real pr_gate.branches.true.final_pr path', () => {
  const { view, ctx } = resolveStateView(
    makeState('pr_gate.branches.true.final_pr'),
    undefined,
    noopDeps,
  );
  assert.equal(ctx.stateId, 'final-review');
  assert.equal(view.id, 'final-review');
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

// ─── ring↔state seam: task-scoped progress, distinct from phase progress ─────

test('resolveStateView exposes task progress scoped to the active phase iteration, distinct from phaseProgress', () => {
  // Three phases (one done), the active phase two of five tasks in — so task
  // progress ({2,5}) and phase progress ({1,3}) are deliberately different.
  const nodes: NodesRecord = {
    phase_loop: {
      kind: 'for_each_phase',
      status: 'in_progress',
      iterations: [
        { index: 0, status: 'completed', doc_path: 'phases/P1.md', corrective_tasks: [], repos: [], nodes: {} },
        {
          index: 1,
          status: 'in_progress',
          doc_path: 'phases/DEMO-PHASE-02-BUILD.md',
          corrective_tasks: [],
          repos: [],
          nodes: {
            task_loop: {
              kind: 'for_each_task',
              status: 'in_progress',
              iterations: [
                { index: 0, status: 'completed', doc_path: 'tasks/t1.md', corrective_tasks: [], repos: [], nodes: {} },
                { index: 1, status: 'completed', doc_path: 'tasks/t2.md', corrective_tasks: [], repos: [], nodes: {} },
                {
                  index: 2,
                  status: 'in_progress',
                  doc_path: 'tasks/t3.md',
                  corrective_tasks: [],
                  repos: [],
                  nodes: { task_executor: { kind: 'step', status: 'in_progress', doc_path: null, retries: 0 } },
                },
                { index: 3, status: 'not_started', doc_path: 'tasks/t4.md', corrective_tasks: [], repos: [], nodes: {} },
                { index: 4, status: 'not_started', doc_path: 'tasks/t5.md', corrective_tasks: [], repos: [], nodes: {} },
              ],
            },
          },
        },
        { index: 2, status: 'not_started', doc_path: 'phases/P3.md', corrective_tasks: [], repos: [], nodes: {} },
      ],
    },
  };
  const state: ProjectStateV5 = {
    $schema: 'orchestration-state-v5',
    project: { name: 'demo', created: '2026-01-01', updated: '2026-01-01' },
    config: {
      gate_mode: 'task',
      limits: { max_phases: 3, max_tasks_per_phase: 5, max_retries_per_task: 2 },
      source_control: { auto_commit: 'never', auto_pr: 'never' },
    },
    pipeline: { gate_mode: 'task', source_control: null, current_tier: 'execution', halt_reason: null },
    graph: {
      template_id: 'std',
      status: 'in_progress',
      current_node_path: 'phase_loop.iter1.task_loop.iter2.task_executor',
      nodes,
    },
  };

  const { ctx } = resolveStateView(state, undefined, noopDeps);
  assert.equal(ctx.stateId, 'coding');
  assert.deepEqual(ctx.phaseProgress, { completed: 1, total: 3 });
  assert.deepEqual(ctx.taskProgress, { completed: 2, total: 5 });
});

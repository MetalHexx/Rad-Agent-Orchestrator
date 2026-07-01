/**
 * Regression tests for DAG timeline rendering against post-Iter-7 state shapes.
 *
 * Two fixture families are covered:
 *   (A) Legacy state.json — iterations carry `phase_planning` + `task_handoff`
 *       body nodes alongside the new post-Iter-7 nodes. The timeline must still
 *       derive iteration names, group sections, and surface statuses without
 *       raising or dropping entries.
 *   (B) Forward-compat state.json — iterations omit the legacy body nodes
 *       entirely (extra-high.yml shape). Fallback labels kick in for iteration
 *       names; section grouping remains unchanged.
 *
 * These tests exercise pure logic — no DOM/JSX rendering, same pattern as
 * sibling `.test.ts` files in this directory.
 *
 * Run with: npx tsx ui/components/dag-timeline/dag-timeline-legacy-render.test.ts
 */
import assert from 'node:assert';
import {
  groupNodesBySection,
  parsePhaseNameFromDocPath,
  parseTaskNameFromDocPath,
  deriveCurrentPhase,
} from './dag-timeline-helpers';
import type {
  NodesRecord,
  ForEachPhaseNodeState,
  IterationEntry,
  StepNodeState,
} from '@/types/state';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  \u2713 ${name}`);
    passed++;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`  \u2717 ${name}\n    ${msg}`);
    failed++;
  }
}

// ─── Shared helpers ──────────────────────────────────────────────────────────

function stepState(status: StepNodeState['status'], doc_path: string | null = null): StepNodeState {
  return { kind: 'step', status, doc_path, retries: 0 };
}

function makeLegacyPhaseIteration(index: number): IterationEntry {
  // Legacy shape: phase_planning + task_handoff body nodes populated alongside
  // execution nodes. Mirrors state.json written by pre-Iter-7 project runs.
  return {
    index,
    status: 'completed',
    corrective_tasks: [],
    repos: [],
    nodes: {
      phase_planning: stepState('completed', 'phases/MYPROJ-PHASE-01-SETUP.md'),
      task_loop: {
        kind: 'for_each_task',
        status: 'completed',
        iterations: [
          {
            index: 0,
            status: 'completed',
            corrective_tasks: [],
            repos: [],
            nodes: {
              task_handoff: stepState('completed', 'tasks/MYPROJ-TASK-P01-T01-AUTH.md'),
              task_executor: stepState('completed'),
              code_review: stepState('completed', 'reports/MYPROJ-CODE-REVIEW-P01-T01-AUTH.md'),
              task_gate: { kind: 'gate', status: 'completed', gate_active: false },
            },
          },
        ],
      },
      phase_report: stepState('completed', 'reports/MYPROJ-PHASE-REPORT-P01-SETUP.md'),
      phase_review: stepState('completed', 'reports/MYPROJ-PHASE-REVIEW-P01-SETUP.md'),
      phase_gate: { kind: 'gate', status: 'completed', gate_active: false },
    },
  };
}

// makeForwardCompatPhaseIteration consolidated into makePostIter8PhaseIteration (Iter-8 corrective
// pass): after dropping the now-retired phase_report node the two fixtures were structurally
// identical, so the forward-compat helper was removed. The name "forward-compat" still
// conceptually applies — it means "no pre-Iter-7 phase_planning / task_handoff nodes" — but the
// canonical fixture for that shape is makePostIter8PhaseIteration.

function makePostIter8PhaseIteration(index: number): IterationEntry {
  // Post-Iter-8 shape: phase_report body node is gone (phase_review absorbs it).
  // New projects write this shape; the UI must render it cleanly with one fewer
  // post-task-loop body node in phase_loop iterations.
  return {
    index,
    status: 'in_progress',
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
            corrective_tasks: [],
            repos: [],
            nodes: {
              task_executor: stepState('in_progress'),
              code_review: stepState('not_started'),
              task_gate: { kind: 'gate', status: 'not_started', gate_active: false },
            },
          },
        ],
      },
      // No phase_report — phase_review covers both the verdict and the structured summary.
      phase_review: stepState('not_started'),
      phase_gate: { kind: 'gate', status: 'not_started', gate_active: false },
    },
  };
}

function makeTopLevelNodes(phaseLoopIterations: IterationEntry[]): NodesRecord {
  const phaseLoop: ForEachPhaseNodeState = {
    kind: 'for_each_phase',
    status: 'in_progress',
    iterations: phaseLoopIterations,
  };
  return {
    requirements: stepState('completed', 'MYPROJ-REQUIREMENTS.md'),
    master_plan: stepState('completed', 'MYPROJ-MASTER-PLAN.md'),
    explode_master_plan: stepState('completed'),
    plan_approval_gate: { kind: 'gate', status: 'completed', gate_active: false },
    gate_mode_selection: { kind: 'gate', status: 'completed', gate_active: false },
    phase_loop: phaseLoop,
    final_review: stepState('not_started'),
    pr_gate: { kind: 'conditional', status: 'not_started', branch_taken: null },
    final_approval_gate: { kind: 'gate', status: 'not_started', gate_active: false },
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

console.log('\nDAG timeline — legacy-state rendering regression\n');

test('(A) legacy iteration with phase_planning + task_handoff: iteration name parsed from phase_planning.doc_path', () => {
  const iteration = makeLegacyPhaseIteration(0);
  const phaseNode = iteration.nodes['phase_planning'] as StepNodeState;
  const name = parsePhaseNameFromDocPath(phaseNode.doc_path, iteration.index);
  // Formatter title-cases all tokens (FR-6).
  assert.strictEqual(name, 'Phase 1 \u2014 Setup');
});

test('(A) legacy task iteration: iteration name parsed from task_handoff.doc_path', () => {
  const iteration = makeLegacyPhaseIteration(0);
  const taskLoop = iteration.nodes['task_loop'];
  assert.ok(taskLoop.kind === 'for_each_task');
  const taskHandoff = taskLoop.iterations[0].nodes['task_handoff'] as StepNodeState;
  const name = parseTaskNameFromDocPath(taskHandoff.doc_path, 0);
  assert.strictEqual(name, 'Task 1 \u2014 Auth');
});

test('(A) legacy top-level nodes: groupNodesBySection emits Planning/Execution/Completion with gate rows in Planning', () => {
  const iterations = [makeLegacyPhaseIteration(0)];
  const nodes = makeTopLevelNodes(iterations);
  const groups = groupNodesBySection(nodes);

  const byLabel = new Map(groups.map((g) => [g.label, g]));
  assert.ok(byLabel.has('Planning'));
  assert.ok(byLabel.has('Execution'));
  assert.ok(byLabel.has('Completion'));

  const planningIds = byLabel.get('Planning')!.entries.map(([id]) => id);
  assert.ok(planningIds.includes('requirements'));
  assert.ok(planningIds.includes('master_plan'));
  assert.ok(planningIds.includes('explode_master_plan'));
  assert.ok(planningIds.includes('plan_approval_gate'));
  assert.ok(planningIds.includes('gate_mode_selection'));

  const executionIds = byLabel.get('Execution')!.entries.map(([id]) => id);
  assert.deepStrictEqual(executionIds, ['phase_loop']);
});

test('(A) legacy deriveCurrentPhase: reads phase_planning.doc_path for the active iteration', () => {
  // deriveCurrentPhase picks the first `in_progress` iteration; flip status.
  const iter = makeLegacyPhaseIteration(0);
  iter.status = 'in_progress';
  const phaseLoop: ForEachPhaseNodeState = {
    kind: 'for_each_phase',
    status: 'in_progress',
    iterations: [iter],
  };
  const label = deriveCurrentPhase(phaseLoop);
  assert.strictEqual(label, 'Phase 1 \u2014 Setup');
});

test('(B) forward-compat iteration without phase_planning: iteration-name fallback returns "Phase N"', () => {
  const iteration = makePostIter8PhaseIteration(0);
  assert.strictEqual(iteration.nodes['phase_planning'], undefined);
  // Code under test reads doc_path via (phaseNode && 'doc_path' in phaseNode)
  // — when the node is absent, fallback label "Phase N" is produced.
  const phaseNode = iteration.nodes['phase_planning'];
  const docPath = phaseNode && 'doc_path' in phaseNode ? (phaseNode as { doc_path: string | null }).doc_path : null;
  const name = parsePhaseNameFromDocPath(docPath, iteration.index);
  assert.strictEqual(name, 'Phase 1');
});

test('(B) forward-compat task iteration without task_handoff: fallback returns "Task N"', () => {
  const iteration = makePostIter8PhaseIteration(0);
  const taskLoop = iteration.nodes['task_loop'];
  assert.ok(taskLoop.kind === 'for_each_task');
  const taskIter = taskLoop.iterations[0];
  assert.strictEqual(taskIter.nodes['task_handoff'], undefined);
  const taskNode = taskIter.nodes['task_handoff'];
  const docPath = taskNode && 'doc_path' in taskNode ? (taskNode as { doc_path: string | null }).doc_path : null;
  const name = parseTaskNameFromDocPath(docPath, taskIter.index);
  assert.strictEqual(name, 'Task 1');
});

test('(B) forward-compat top-level nodes: groupNodesBySection emits the 3-section contract', () => {
  const iterations = [makePostIter8PhaseIteration(0)];
  const nodes = makeTopLevelNodes(iterations);
  const groups = groupNodesBySection(nodes);
  const labels = groups.map((g) => g.label);
  assert.deepStrictEqual(labels, ['Planning', 'Execution', 'Completion']);

  const planningIds = groups.find((g) => g.label === 'Planning')!.entries.map(([id]) => id);
  assert.ok(planningIds.includes('plan_approval_gate'));
  assert.ok(planningIds.includes('gate_mode_selection'));
});

test('(A) legacy state renders with no thrown exceptions even when phase_planning.doc_path is null', () => {
  // Edge case — legacy project with phase_planning seeded but doc_path cleared
  // (e.g., corrective cycle reset). Must not throw.
  const iteration = makeLegacyPhaseIteration(0);
  (iteration.nodes['phase_planning'] as StepNodeState).doc_path = null;
  const phaseNode = iteration.nodes['phase_planning'] as StepNodeState;
  const name = parsePhaseNameFromDocPath(phaseNode.doc_path, iteration.index);
  assert.strictEqual(name, 'Phase 1');
});

// ─── Iter-8 tests — phase_report legacy rendering + new-shape rendering ──────

test('(Iter-8 legacy) iteration fixture preserves completed phase_report body node and top-level grouping uses the 3-section contract', () => {
  // Post-Iter-8 state.json from a pre-Iter-8 project run still carries
  // phase_report as a body node. This is a pure-logic test (no DOM): it
  // verifies the fixture shape the UI renderer will see, and that top-level
  // section grouping (NODE_SECTION_MAP consumers) is unaffected because
  // phase_report sits inside phase_loop.body — not at the top level. The
  // polymorphic body renderer that actually paints the node is exercised by
  // higher-level component tests elsewhere.
  const iteration = makeLegacyPhaseIteration(0);
  const phaseReport = iteration.nodes['phase_report'] as StepNodeState;
  assert.strictEqual(phaseReport.kind, 'step');
  assert.strictEqual(phaseReport.status, 'completed');
  assert.strictEqual(phaseReport.doc_path, 'reports/MYPROJ-PHASE-REPORT-P01-SETUP.md');

  const iterations = [iteration];
  const nodes = makeTopLevelNodes(iterations);
  const groups = groupNodesBySection(nodes);
  const labels = groups.map((g) => g.label);
  assert.deepStrictEqual(labels, ['Planning', 'Execution', 'Completion']);

  const planningIds = groups.find((g) => g.label === 'Planning')!.entries.map(([id]) => id);
  assert.ok(planningIds.includes('plan_approval_gate'));
  assert.ok(planningIds.includes('gate_mode_selection'));
});

test('(Iter-8 new shape) iteration WITHOUT phase_report body node renders cleanly under the 3-section contract', () => {
  // Post-Iter-8 new-shape state.json omits phase_report entirely. Only
  // phase_review + phase_gate remain as post-task-loop body nodes.
  const iteration = makePostIter8PhaseIteration(0);
  assert.strictEqual(iteration.nodes['phase_report'], undefined);
  assert.ok(iteration.nodes['phase_review']);
  assert.ok(iteration.nodes['phase_gate']);

  // Count post-task-loop body nodes (excluding task_loop itself): expect 2
  // (phase_review + phase_gate), vs. 3 in the legacy shape
  // (phase_report + phase_review + phase_gate).
  const bodyNodeIds = Object.keys(iteration.nodes).filter((id) => id !== 'task_loop');
  assert.strictEqual(bodyNodeIds.length, 2);
  assert.ok(bodyNodeIds.includes('phase_review'));
  assert.ok(bodyNodeIds.includes('phase_gate'));

  // Top-level grouping uses the 3-section contract.
  const iterations = [iteration];
  const nodes = makeTopLevelNodes(iterations);
  const groups = groupNodesBySection(nodes);
  const labels = groups.map((g) => g.label);
  assert.deepStrictEqual(labels, ['Planning', 'Execution', 'Completion']);

  const planningIds = groups.find((g) => g.label === 'Planning')!.entries.map(([id]) => id);
  assert.ok(planningIds.includes('plan_approval_gate'));
  assert.ok(planningIds.includes('gate_mode_selection'));
});

// ─── Iter-11 tests — phase-scope corrective rendering ────────────────────────

// Parallel to makeLegacyPhaseIteration: a for_each_phase IterationEntry carrying
// a populated phaseIter.corrective_tasks[0] with synthesized pre-completed
// task_handoff + scaffolded body nodes (code_review). Mirrors the Iter-11
// PHASE_REVIEW_COMPLETED birth-on-handoff-path shape.
function makePhaseCorrectiveIteration(index: number): IterationEntry {
  return {
    index,
    status: 'in_progress',
    corrective_tasks: [
      {
        index: 1,
        reason: 'Phase review requested changes',
        injected_after: 'phase_review',
        status: 'in_progress',
        nodes: {
          // Synthesized pre-completed task_handoff (birth-on-handoff-path semantics)
          task_handoff: stepState('completed', 'tasks/MYPROJ-TASK-P01-PHASE-C1.md'),
          // Scaffolded body node
          code_review: stepState('not_started'),
        },
        repos: [],
      },
    ],
    repos: [],
    nodes: {
      phase_planning: stepState('completed', 'phases/MYPROJ-PHASE-01-SETUP.md'),
      task_loop: {
        kind: 'for_each_task',
        status: 'completed',
        iterations: [
          {
            index: 0,
            status: 'completed',
            corrective_tasks: [],
            repos: [],
            nodes: {
              task_handoff: stepState('completed', 'tasks/MYPROJ-TASK-P01-T01-AUTH.md'),
              task_executor: stepState('completed'),
              code_review: stepState('completed', 'reports/MYPROJ-CODE-REVIEW-P01-T01-AUTH.md'),
              task_gate: { kind: 'gate', status: 'completed', gate_active: false },
            },
          },
        ],
      },
      // Under iter-11, PHASE_REVIEW_COMPLETED sets phase_review.status = 'completed'
      // (and writes verdict = effective_outcome) BEFORE birthing the corrective
      // entry into phaseIter.corrective_tasks[]. The fixture reflects that real
      // post-mutation shape so the render test exercises the actual invariant
      // rather than an impossible "in_progress phase_review + active corrective"
      // combination.
      phase_review: stepState('completed', 'reports/MYPROJ-PHASE-REVIEW-P01-SETUP.md'),
      phase_gate: { kind: 'gate', status: 'not_started', gate_active: false },
    },
  };
}

test('(Iter-11) phase-scope corrective iteration has corrective_tasks.length === 1', () => {
  const iteration = makePhaseCorrectiveIteration(0);
  assert.strictEqual(iteration.corrective_tasks.length, 1);
  const corrective = iteration.corrective_tasks[0];
  assert.strictEqual(corrective.index, 1);
  assert.strictEqual(corrective.injected_after, 'phase_review');
  assert.strictEqual(corrective.reason, 'Phase review requested changes');
});

test('(Iter-11) phase-scope corrective task_handoff is pre-completed with correct doc_path', () => {
  // Validates the synthesized pre-completed task_handoff sub-node shape that
  // PHASE_REVIEW_COMPLETED injects at birth-on-handoff-path.
  const iteration = makePhaseCorrectiveIteration(0);
  const corrective = iteration.corrective_tasks[0];
  assert.ok('task_handoff' in corrective.nodes, 'task_handoff must be present in corrective.nodes');
  const handoff = corrective.nodes['task_handoff'] as StepNodeState;
  assert.strictEqual(handoff.kind, 'step');
  assert.strictEqual(handoff.status, 'completed');
  assert.strictEqual(handoff.doc_path, 'tasks/MYPROJ-TASK-P01-PHASE-C1.md');
});

test('(Iter-11) phase-scope corrective has scaffolded code_review body node', () => {
  // Validates the scaffolded (not_started) code_review body node shape.
  const iteration = makePhaseCorrectiveIteration(0);
  const corrective = iteration.corrective_tasks[0];
  assert.ok('code_review' in corrective.nodes, 'code_review must be present in corrective.nodes');
  const codeReview = corrective.nodes['code_review'] as StepNodeState;
  assert.strictEqual(codeReview.kind, 'step');
  assert.strictEqual(codeReview.status, 'not_started');
});

test('(Iter-11) phase-scope corrective iteration: top-level groupNodesBySection emits Planning/Execution/Completion', () => {
  // Regression guard: adding a phase-scope corrective iteration must not affect
  // the top-level section grouping (phase_loop stays in Execution).
  const iterations = [makePhaseCorrectiveIteration(0)];
  const nodes = makeTopLevelNodes(iterations);
  const groups = groupNodesBySection(nodes);
  const labels = groups.map((g) => g.label);
  assert.deepStrictEqual(labels, ['Planning', 'Execution', 'Completion']);

  const planningIds = groups.find((g) => g.label === 'Planning')!.entries.map(([id]) => id);
  assert.ok(planningIds.includes('plan_approval_gate'));
  assert.ok(planningIds.includes('gate_mode_selection'));

  const executionIds = groups.find((g) => g.label === 'Execution')!.entries.map(([id]) => id);
  assert.deepStrictEqual(executionIds, ['phase_loop']);
});

test('(Iter-11) phase-scope corrective iteration: phase_planning.doc_path parsed correctly', () => {
  const iteration = makePhaseCorrectiveIteration(0);
  const phaseNode = iteration.nodes['phase_planning'] as StepNodeState;
  const name = parsePhaseNameFromDocPath(phaseNode.doc_path, iteration.index);
  // Fallback to "Phase 1" if token not parseable; "SETUP" token produces "Phase 1 — Setup" (FR-6)
  assert.strictEqual(name, 'Phase 1 — Setup');
});

test('(Iter-11) legacy canary still passes: makeLegacyPhaseIteration is unchanged and corrective_tasks is empty', () => {
  // Explicit check that the legacy canary fixture is unmodified.
  const iteration = makeLegacyPhaseIteration(0);
  assert.strictEqual(iteration.corrective_tasks.length, 0);
  assert.strictEqual(iteration.status, 'completed');
  const phaseNode = iteration.nodes['phase_planning'] as StepNodeState;
  assert.strictEqual(phaseNode.doc_path, 'phases/MYPROJ-PHASE-01-SETUP.md');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;

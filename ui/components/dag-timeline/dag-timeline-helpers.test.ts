/**
 * Tests for dag-timeline-helpers utility functions.
 * Run with: npx tsx ui/components/dag-timeline/dag-timeline-helpers.test.ts
 *
 * NOTE: Tests use the established .test.ts pattern (no DOM/JSX rendering).
 */
import assert from "node:assert";
import { getCommitLinkData, deriveRepoBaseUrl, formatNodeId, getDisplayName, parsePhaseNameFromDocPath, parseTaskNameFromDocPath, groupNodesBySection, deriveCurrentPhase, derivePhaseProgress, getRowButtonDescriptor, NODE_SECTION_MAP } from './dag-timeline-helpers';
import type { GateNodeState, NodeStatus } from '@/types/state';
import { compoundNodeIds, stepNode, gateNode, forEachPhaseNode } from './__fixtures__';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`  ✗ ${name}\n    ${msg}`);
    failed++;
  }
}

console.log("\ndag-timeline-helpers tests\n");

test("valid commit hash with valid repoBaseUrl returns real commit URL and 7-char label", () => {
  const result = getCommitLinkData("abc1234def", "https://github.com/user/repo");
  assert.deepStrictEqual(result, { href: "https://github.com/user/repo/commit/abc1234def", label: "abc1234" });
});

test("valid commit hash with null repoBaseUrl returns null href and 7-char label", () => {
  const result = getCommitLinkData("abc1234def", null);
  assert.deepStrictEqual(result, { href: null, label: "abc1234" });
});

test("null commitHash with valid repoBaseUrl returns null", () => {
  const result = getCommitLinkData(null, "https://github.com/user/repo");
  assert.strictEqual(result, null);
});

test("null commitHash with null repoBaseUrl returns null", () => {
  const result = getCommitLinkData(null, null);
  assert.strictEqual(result, null);
});

test("undefined commitHash returns null without throwing", () => {
  const result = getCommitLinkData(undefined, null);
  assert.strictEqual(result, null);
});

test("empty string commitHash returns null", () => {
  const result = getCommitLinkData("", null);
  assert.strictEqual(result, null);
});

test("short hash (fewer than 7 chars) with null repoBaseUrl returns null href and full hash as label", () => {
  const result = getCommitLinkData("abc", null);
  assert.deepStrictEqual(result, { href: null, label: "abc" });
});

console.log("\nderiveRepoBaseUrl tests\n");

test("valid compare URL returns repo base URL", () => {
  const result = deriveRepoBaseUrl("https://github.com/user/repo/compare/main...branch");
  assert.strictEqual(result, "https://github.com/user/repo");
});

test("null input returns null", () => {
  const result = deriveRepoBaseUrl(null);
  assert.strictEqual(result, null);
});

test("URL without /compare/ segment returns null", () => {
  const result = deriveRepoBaseUrl("https://github.com/user/repo");
  assert.strictEqual(result, null);
});

test("URL with /compare/ followed by trailing slash returns repo base URL", () => {
  const result = deriveRepoBaseUrl("https://github.com/user/repo/compare/");
  assert.strictEqual(result, "https://github.com/user/repo");
});

console.log("\nformatNodeId tests\n");

test("phase_planning returns Phase Planning", () => {
  assert.strictEqual(formatNodeId("phase_planning"), "Phase Planning");
});

test("code_review returns Code Review", () => {
  assert.strictEqual(formatNodeId("code_review"), "Code Review");
});

test("requirements (single word) returns Requirements", () => {
  assert.strictEqual(formatNodeId("requirements"), "Requirements");
});

console.log("\ngetDisplayName tests\n");

test("simple ID with no dot passes through to formatNodeId", () => {
  assert.strictEqual(getDisplayName(compoundNodeIds.simple), "Phase Planning");
});

test("two-segment ID extracts leaf after dot", () => {
  assert.strictEqual(getDisplayName(compoundNodeIds.twoSegment), "Phase Planning");
});

test("three-segment ID extracts leaf after last dot", () => {
  assert.strictEqual(getDisplayName(compoundNodeIds.threeSegment), "Phase Planning");
});

test("deeply nested ID extracts leaf", () => {
  assert.strictEqual(getDisplayName(compoundNodeIds.deeplyNested), "Code Review");
});

test("loop node ID extracts leaf", () => {
  assert.strictEqual(getDisplayName(compoundNodeIds.loopNode), "Task Loop");
});

test("single word with no dot and no underscore returns capitalized", () => {
  assert.strictEqual(getDisplayName(compoundNodeIds.singleWord), "Requirements");
});

test("DISPLAY_NAME_OVERRIDES restores acronym capitalization for final_pr", () => {
  assert.strictEqual(getDisplayName("final_pr"), "Final PR");
});

test("DISPLAY_NAME_OVERRIDES restores acronym capitalization for pr_gate", () => {
  assert.strictEqual(getDisplayName("pr_gate"), "PR Gate");
});

test("DISPLAY_NAME_OVERRIDES applies after compound-id leaf extraction", () => {
  assert.strictEqual(getDisplayName("phase_loop.iter0.final_pr"), "Final PR");
});

console.log("\nparsePhaseNameFromDocPath tests\n");

test("multi-word all-caps title is title-cased (FR-6)", () => {
  const result = parsePhaseNameFromDocPath("phases/MY-PROJECT-PHASE-02-CORE-RESEARCH-BRANCH.md", 1);
  assert.strictEqual(result, "Phase 2 \u2014 Core Research Branch");
});

test("null doc path returns fallback Phase N", () => {
  const result = parsePhaseNameFromDocPath(null, 0);
  assert.strictEqual(result, "Phase 1");
});

test("non-matching doc path returns fallback Phase N", () => {
  const result = parsePhaseNameFromDocPath("some/random/file.md", 2);
  assert.strictEqual(result, "Phase 3");
});

test("single-word all-caps title is title-cased (FR-6)", () => {
  const result = parsePhaseNameFromDocPath("phases/FOO-PHASE-01-SETUP.md", 0);
  assert.strictEqual(result, "Phase 1 \u2014 Setup");
});

test("case-insensitive: lowercase -phase- segment parses correctly", () => {
  const result = parsePhaseNameFromDocPath("phases/foo-phase-01-setup.md", 0);
  assert.strictEqual(result, "Phase 1 \u2014 Setup");
});

console.log("\nparseTaskNameFromDocPath tests\n");

test("task single-word all-caps title is title-cased (FR-6)", () => {
  const result = parseTaskNameFromDocPath("tasks/MY-PROJECT-TASK-P01-T03-WORKFLOW.md", 2);
  assert.strictEqual(result, "Task 3 \u2014 Workflow");
});

test("null doc path returns fallback Task N", () => {
  const result = parseTaskNameFromDocPath(null, 0);
  assert.strictEqual(result, "Task 1");
});

test("non-matching doc path returns fallback Task N", () => {
  const result = parseTaskNameFromDocPath("some/random/file.md", 4);
  assert.strictEqual(result, "Task 5");
});

test("task multi-word all-caps title is title-cased (FR-6)", () => {
  const result = parseTaskNameFromDocPath("tasks/X-TASK-P02-T01-UI-COMPONENT-SETUP.md", 0);
  assert.strictEqual(result, "Task 1 \u2014 Ui Component Setup");
});

test("case-insensitive: lowercase -task- segment parses correctly", () => {
  const result = parseTaskNameFromDocPath("tasks/x-task-p02-t01-ui-component-setup.md", 0);
  assert.strictEqual(result, "Task 1 \u2014 Ui Component Setup");
});

test("DD-12: phaseN/taskN prefix preserved exactly", () => {
  const phase = parsePhaseNameFromDocPath("phases/X-PHASE-05-FOO.md", 4);
  assert.ok(phase.startsWith("Phase 5 \u2014 "), `prefix preserved: ${phase}`);
  const task = parseTaskNameFromDocPath("tasks/X-TASK-P02-T03-FOO.md", 2);
  assert.ok(task.startsWith("Task 3 \u2014 "), `prefix preserved: ${task}`);
});

console.log("\ngroupNodesBySection tests\n");

test("NODE_SECTION_MAP no longer contains the retired Planning node ids (timeline Planning section is retired)", () => {
  for (const id of ['prd', 'research', 'design', 'architecture', 'requirements', 'master_plan', 'explode_master_plan', 'plan_approval_gate', 'gate_mode_selection']) {
    assert.ok(!Object.hasOwn(NODE_SECTION_MAP, id), `${id} must no longer be present in NODE_SECTION_MAP`);
  }
});

test("NODE_SECTION_MAP routes final_pr to Completion", () => {
  assert.strictEqual(NODE_SECTION_MAP.final_pr, "Completion");
});

test("groupNodesBySection excludes retired Planning ids entirely — only Execution/Completion groups emit", () => {
  const result = groupNodesBySection({
    prd: stepNode,
    plan_approval_gate: gateNode,
    gate_mode_selection: gateNode,
    phase_loop: forEachPhaseNode,
    final_review: stepNode,
  });
  const labels = result.map(g => g.label);
  assert.deepStrictEqual(labels, ["Execution", "Completion"]);
  for (const group of result) {
    const ids = group.entries.map(([id]) => id);
    assert.ok(!ids.includes("prd"));
    assert.ok(!ids.includes("plan_approval_gate"));
    assert.ok(!ids.includes("gate_mode_selection"));
  }
});

test("section order is Execution → Completion regardless of insertion (AD-3)", () => {
  const result = groupNodesBySection({
    final_approval_gate: gateNode,
    prd: stepNode,
    phase_loop: forEachPhaseNode,
    plan_approval_gate: gateNode,
  });
  assert.deepStrictEqual(result.map(g => g.label), ["Execution", "Completion"]);
});

test("empty NodesRecord returns empty array", () => {
  const result = groupNodesBySection({});
  assert.deepStrictEqual(result, []);
});

test("nodes mapping only to former Planning ids return an empty array (no group emits)", () => {
  const result = groupNodesBySection({ prd: stepNode, design: stepNode });
  assert.deepStrictEqual(result, []);
});

test("unknown node IDs are silently excluded from all groups", () => {
  const result = groupNodesBySection({ unknown_step: stepNode, another_unknown: gateNode });
  assert.deepStrictEqual(result, []);
});

test("legacy full.yml state (all Planning-era steps + gates present) still groups Execution/Completion correctly", () => {
  // A real state.json carries the full set of former-Planning top-level nodes
  // (prd/research/design/architecture/master_plan/plan_approval_gate/gate_mode_selection)
  // alongside phase_loop and the Completion-section nodes for the whole life of a run.
  // None of the former-Planning ids route anywhere any more; Execution/Completion
  // grouping must stay intact regardless.
  const legacyNodes = {
    prd: stepNode,
    research: stepNode,
    design: stepNode,
    architecture: stepNode,
    master_plan: stepNode,
    plan_approval_gate: gateNode,
    gate_mode_selection: gateNode,
    phase_loop: forEachPhaseNode,
    final_review: stepNode,
    pr_gate: gateNode,
    final_approval_gate: gateNode,
  };
  const result = groupNodesBySection(legacyNodes);
  assert.strictEqual(result.length, 2);
  assert.deepStrictEqual(result.map(g => g.label), ["Execution", "Completion"]);

  const executionIds = result.find(g => g.label === "Execution")!.entries.map(([id]) => id);
  assert.deepStrictEqual(executionIds, ["phase_loop"]);

  const completionIds = result.find(g => g.label === "Completion")!.entries.map(([id]) => id);
  assert.deepStrictEqual(completionIds, ["final_review", "pr_gate", "final_approval_gate"]);
});

test("pre-seeded iterations — phase_loop node with explode_master_plan completed + iterations carrying phase_planning child nodes with doc_path populated still groups Execution correctly", () => {
  // After explosion completes, explode_master_plan.status=completed and each phase iteration
  // carries a pre-seeded `phase_planning` child step node with doc_path populated (not on the
  // iteration itself — IterationEntry has no doc_path field). groupNodesBySection must not crash
  // on this shape, and phase_loop must still resolve to Execution even with the (now unmapped)
  // former-Planning top-level ids present alongside it.
  const seededPhaseLoop = {
    ...forEachPhaseNode,
    status: "not_started" as const,
    iterations: [
      { index: 0, status: "not_started" as const, nodes: { phase_planning: { kind: "step" as const, status: "completed" as const, doc_path: "phases/MYAPP-PHASE-01-SETUP.md", retries: 0 } }, corrective_tasks: [], repos: [] },
      { index: 1, status: "not_started" as const, nodes: { phase_planning: { kind: "step" as const, status: "completed" as const, doc_path: "phases/MYAPP-PHASE-02-CORE.md", retries: 0 } }, corrective_tasks: [], repos: [] },
    ],
  };
  const completedExplode = { ...stepNode, status: "completed" as const, doc_path: null };
  const result = groupNodesBySection({
    requirements: stepNode,
    master_plan: stepNode,
    explode_master_plan: completedExplode,
    plan_approval_gate: gateNode,
    phase_loop: seededPhaseLoop,
  });
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].label, "Execution");
  assert.deepStrictEqual(result[0].entries.map(([id]) => id), ["phase_loop"]);
});

test("legacy state.json (no explode_master_plan + no pre-seeded phase_planning child) still groups Execution cleanly", () => {
  // Pre-Iter-5 state.json must keep rendering without the explode node and without the
  // pre-seeded phase_planning child step nodes that Iter 5's explosion script now emits.
  const legacyPhaseLoop = {
    ...forEachPhaseNode,
    iterations: [
      { index: 0, status: "not_started" as const, nodes: {}, corrective_tasks: [], repos: [] },
    ],
  };
  const legacyNodes = {
    requirements: stepNode,
    master_plan: stepNode,
    plan_approval_gate: gateNode,
    phase_loop: legacyPhaseLoop,
  };
  const result = groupNodesBySection(legacyNodes);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].label, "Execution");
  assert.deepStrictEqual(result[0].entries.map(([id]) => id), ["phase_loop"]);
});


console.log("\nderiveCurrentPhase tests\n");

test("undefined phaseLoopNode returns null", () => {
  const result = deriveCurrentPhase(undefined);
  assert.strictEqual(result, null);
});

test("phase loop with no iterations returns null", () => {
  const result = deriveCurrentPhase({ ...forEachPhaseNode, iterations: [] });
  assert.strictEqual(result, null);
});

test("phase loop with all completed iterations returns null", () => {
  const result = deriveCurrentPhase({
    ...forEachPhaseNode,
    status: "completed",
    iterations: [
      { index: 0, status: "completed", nodes: {}, corrective_tasks: [], repos: [] },
      { index: 1, status: "completed", nodes: {}, corrective_tasks: [], repos: [] },
    ],
  });
  assert.strictEqual(result, null);
});

test("phase loop with in_progress iteration and doc_path returns parsed phase name", () => {
  const result = deriveCurrentPhase({
    ...forEachPhaseNode,
    status: "in_progress",
    iterations: [
      {
        index: 0,
        status: "in_progress",
        nodes: {
          phase_planning: { kind: "step", status: "in_progress", doc_path: "phases/MY-PROJECT-PHASE-01-CORE-SETUP.md", retries: 0 },
        },
        corrective_tasks: [],
        repos: [],
      },
    ],
  });
  assert.strictEqual(result, "Phase 1 \u2014 Core Setup");
});

test("phase loop with in_progress iteration using new shape (iteration.doc_path set, empty nodes) returns parsed phase name", () => {
  // Post-explode-scaffold-unify shape: the iteration itself carries doc_path and
  // has no synthetic phase_planning child node. deriveCurrentPhase must read
  // iteration.doc_path first before falling back to the legacy phase_planning node.
  const result = deriveCurrentPhase({
    ...forEachPhaseNode,
    status: "in_progress",
    iterations: [
      {
        index: 0,
        status: "in_progress",
        doc_path: "phases/MY-PROJECT-PHASE-01-CORE-SETUP.md",
        nodes: {},
        corrective_tasks: [],
        repos: [],
      },
    ],
  });
  assert.strictEqual(result, "Phase 1 — Core Setup");
});

test("phase loop with in_progress iteration carrying BOTH iteration.doc_path and legacy phase_planning prefers iteration.doc_path", () => {
  // Mixed-shape edge case (shouldn't happen in practice but precedence must be deterministic).
  const result = deriveCurrentPhase({
    ...forEachPhaseNode,
    status: "in_progress",
    iterations: [
      {
        index: 0,
        status: "in_progress",
        doc_path: "phases/MY-PROJECT-PHASE-01-NEW-SHAPE.md",
        nodes: {
          phase_planning: { kind: "step", status: "completed", doc_path: "phases/MY-PROJECT-PHASE-01-LEGACY-SHAPE.md", retries: 0 },
        },
        corrective_tasks: [],
        repos: [],
      },
    ],
  });
  assert.strictEqual(result, "Phase 1 — New Shape");
});

test("phase loop with in_progress iteration and null doc_path returns fallback Phase N", () => {
  const result = deriveCurrentPhase({
    ...forEachPhaseNode,
    status: "in_progress",
    iterations: [
      {
        index: 1,
        status: "in_progress",
        nodes: {
          phase_planning: { kind: "step", status: "in_progress", doc_path: null, retries: 0 },
        },
        corrective_tasks: [],
        repos: [],
      },
    ],
  });
  assert.strictEqual(result, "Phase 2");
});

console.log("\nderivePhaseProgress tests\n");

test("undefined phaseLoopNode returns null", () => {
  const result = derivePhaseProgress(undefined);
  assert.strictEqual(result, null);
});

test("phase loop with no iterations returns null", () => {
  const result = derivePhaseProgress({ ...forEachPhaseNode, iterations: [] });
  assert.strictEqual(result, null);
});

test("3 iterations (2 completed, 1 in_progress) returns {completed:2, total:3}", () => {
  const result = derivePhaseProgress({
    ...forEachPhaseNode,
    status: "in_progress",
    iterations: [
      { index: 0, status: "completed", nodes: {}, corrective_tasks: [], repos: [] },
      { index: 1, status: "completed", nodes: {}, corrective_tasks: [], repos: [] },
      { index: 2, status: "in_progress", nodes: {}, corrective_tasks: [], repos: [] },
    ],
  });
  assert.deepStrictEqual(result, { completed: 2, total: 3 });
});

test("all iterations completed returns {completed:N, total:N}", () => {
  const result = derivePhaseProgress({
    ...forEachPhaseNode,
    status: "completed",
    iterations: [
      { index: 0, status: "completed", nodes: {}, corrective_tasks: [], repos: [] },
      { index: 1, status: "completed", nodes: {}, corrective_tasks: [], repos: [] },
    ],
  });
  assert.deepStrictEqual(result, { completed: 2, total: 2 });
});

test("no completed iterations returns {completed:0, total:N}", () => {
  const result = derivePhaseProgress({
    ...forEachPhaseNode,
    status: "in_progress",
    iterations: [
      { index: 0, status: "in_progress", nodes: {}, corrective_tasks: [], repos: [] },
      { index: 1, status: "not_started", nodes: {}, corrective_tasks: [], repos: [] },
    ],
  });
  assert.deepStrictEqual(result, { completed: 0, total: 2 });
});

// ─── Tests: getRowButtonDescriptor (FR-1, FR-2, FR-3, AD-1, AD-2) ───────────

const gateNotActive: GateNodeState = { kind: 'gate', status: 'not_started', gate_active: false };
const gateActive: GateNodeState   = { kind: 'gate', status: 'not_started', gate_active: true  };
const gateCompleted: GateNodeState = { kind: 'gate', status: 'completed',  gate_active: true  };

console.log('\ngetRowButtonDescriptor tests\n');

test("plan_approval_gate: gate_active=false → kind='none' (FR-1 regression: no premature Approve Plan)", () => {
  const desc = getRowButtonDescriptor('plan_approval_gate', gateNotActive, 'not_started');
  assert.deepStrictEqual(desc, { kind: 'none' });
});

test("plan_approval_gate: gate_active=true → kind='approve' with plan_approved event (FR-1)", () => {
  const desc = getRowButtonDescriptor('plan_approval_gate', gateActive, 'not_started');
  assert.deepStrictEqual(desc, { kind: 'approve', event: 'plan_approved', label: 'Approve Plan' });
});

test("plan_approval_gate compound id with gate_active=true resolves leaf (FR-1, AD-1)", () => {
  const desc = getRowButtonDescriptor('some.prefix.plan_approval_gate', gateActive, 'not_started');
  assert.strictEqual(desc.kind, 'approve');
});

test("final_approval_gate: gate_active=false → kind='none' (FR-1)", () => {
  const desc = getRowButtonDescriptor('final_approval_gate', gateNotActive, 'not_started');
  assert.deepStrictEqual(desc, { kind: 'none' });
});

test("final_approval_gate: gate_active=true → kind='approve' with final_approved event (FR-1)", () => {
  const desc = getRowButtonDescriptor('final_approval_gate', gateActive, 'not_started');
  assert.deepStrictEqual(desc, { kind: 'approve', event: 'final_approved', label: 'Approve Final Review' });
});

test("plan_approval_gate completed AND phase_loop not_started → kind='execute' (FR-2, AD-2)", () => {
  const desc = getRowButtonDescriptor('plan_approval_gate', gateCompleted, 'not_started');
  assert.deepStrictEqual(desc, { kind: 'execute', label: 'Execute Plan' });
});

test("plan_approval_gate completed AND phase_loop in_progress → kind='none' (FR-2: hides post-launch)", () => {
  const desc = getRowButtonDescriptor('plan_approval_gate', gateCompleted, 'in_progress');
  assert.deepStrictEqual(desc, { kind: 'none' });
});

test("plan_approval_gate completed AND phase_loop completed → kind='none' (FR-2)", () => {
  const desc = getRowButtonDescriptor('plan_approval_gate', gateCompleted, 'completed');
  assert.deepStrictEqual(desc, { kind: 'none' });
});

test("plan_approval_gate completed AND phase_loop undefined → kind='none' (FR-2 defensive)", () => {
  const desc = getRowButtonDescriptor('plan_approval_gate', gateCompleted, undefined);
  assert.deepStrictEqual(desc, { kind: 'none' });
});

test("final_approval_gate completed never yields kind='execute' regardless of phase_loop (FR-2: plan-row only)", () => {
  const desc = getRowButtonDescriptor('final_approval_gate', gateCompleted, 'not_started');
  assert.deepStrictEqual(desc, { kind: 'none' });
});

test("non-gate-config leaf (task_gate) returns kind='none' regardless of input (FR-7)", () => {
  const desc = getRowButtonDescriptor('phase_loop.iter0.task_gate', gateActive, 'not_started');
  assert.deepStrictEqual(desc, { kind: 'none' });
});

test("FR-3 mutex: at no phase_loop status do both buttons render simultaneously", () => {
  const statuses: Array<NodeStatus | undefined> = ['not_started', 'in_progress', 'completed', 'failed', 'halted', 'skipped', undefined];
  for (const s of statuses) {
    const a = getRowButtonDescriptor('plan_approval_gate', gateActive, s);
    const c = getRowButtonDescriptor('plan_approval_gate', gateCompleted, s);
    // Distinct calls model distinct moments in time; mutex is that no
    // single (gate, phase_loop) tuple yields both kinds.
    assert.ok(a.kind !== 'execute', 'gate_active state never produces execute');
    assert.ok(c.kind !== 'approve', 'completed-gate state never produces approve');
  }
});

// ─── Tests: getRowButtonDescriptor — FR-7 non-regression invariants ──────────

test("compound id 'phase_loop.iter0.final_approval_gate' with gate_active=true → approve (FR-7, AD-1)", () => {
  const desc = getRowButtonDescriptor(
    'phase_loop.iter0.final_approval_gate',
    gateActive,
    'in_progress'
  );
  assert.deepStrictEqual(desc, { kind: 'approve', event: 'final_approved', label: 'Approve Final Review' });
});

test("compound id 'phase_loop.iter0.task_gate' returns kind='none' (FR-7: task gates never render row buttons)", () => {
  const desc = getRowButtonDescriptor('phase_loop.iter0.task_gate', gateActive, 'in_progress');
  assert.deepStrictEqual(desc, { kind: 'none' });
});

test("pr_gate leaf returns kind='none' (FR-7)", () => {
  const desc = getRowButtonDescriptor('pr_gate', gateActive, 'in_progress');
  assert.deepStrictEqual(desc, { kind: 'none' });
});

test("gate_mode_selection leaf returns kind='none' (FR-7)", () => {
  const desc = getRowButtonDescriptor('gate_mode_selection', gateActive, 'in_progress');
  assert.deepStrictEqual(desc, { kind: 'none' });
});

// ─── Tests: phase_loop.status pass-through invariant (AD-2) ──────────────────

test("AD-2: descriptor receives phase_loop.status straight from nodes record (no derived fetch)", () => {
  // Build a minimal nodes record matching v5 shape. The descriptor is
  // computed against `nodes.phase_loop.status` directly — proving the
  // page can pass the raw status without a side-channel.
  const nodes = {
    plan_approval_gate: { kind: 'gate', status: 'completed', gate_active: true } as const,
    phase_loop: { kind: 'for_each_phase', status: 'not_started', iterations: [] } as const,
  };
  const phaseLoopStatus = nodes.phase_loop.status;
  const desc = getRowButtonDescriptor('plan_approval_gate', nodes.plan_approval_gate, phaseLoopStatus);
  assert.strictEqual(desc.kind, 'execute');
});

test("AD-2: phase_loop missing → undefined → descriptor 'none' for FR-2 (defensive)", () => {
  const node = { kind: 'gate', status: 'completed', gate_active: true } as const;
  const desc = getRowButtonDescriptor('plan_approval_gate', node, undefined);
  assert.strictEqual(desc.kind, 'none');
});

import {
  buildIterationItemValue,
  buildCorrectiveItemValue,
  isLoopNode,
} from './dag-timeline-helpers';

console.log("\niteration key builders\n");

test('buildIterationItemValue("phase_loop", 0) returns "iter-phase_loop-0"', () => {
  assert.strictEqual(buildIterationItemValue("phase_loop", 0), "iter-phase_loop-0");
});

test('buildIterationItemValue("phase_loop.iter0.task_loop", 2) returns "iter-phase_loop.iter0.task_loop-2"', () => {
  assert.strictEqual(
    buildIterationItemValue("phase_loop.iter0.task_loop", 2),
    "iter-phase_loop.iter0.task_loop-2"
  );
});

test('buildCorrectiveItemValue("iter-phase_loop.iter0.task_loop-1", 1) returns "ct-iter-phase_loop.iter0.task_loop-1-1"', () => {
  assert.strictEqual(
    buildCorrectiveItemValue("iter-phase_loop.iter0.task_loop-1", 1),
    "ct-iter-phase_loop.iter0.task_loop-1-1"
  );
});

test('isLoopNode is re-exported from dag-timeline-helpers', () => {
  assert.strictEqual(typeof isLoopNode, 'function');
});

import { deriveIterationTaskProgress } from './dag-timeline-helpers';
import type { IterationEntry } from '@/types/state';

console.log("\nderiveIterationTaskProgress tests\n");

test('returns null when iteration has no task_loop child', () => {
  const iter: IterationEntry = {
    index: 0, status: 'in_progress', corrective_tasks: [], repos: [],
    nodes: { phase_planning: { kind: 'step', status: 'completed', doc_path: null, retries: 0 } },
  };
  assert.strictEqual(deriveIterationTaskProgress(iter), null);
});

test('returns { completed: 0, total: 0 } when task_loop has no iterations (FR-8)', () => {
  const iter: IterationEntry = {
    index: 0, status: 'not_started', corrective_tasks: [], repos: [],
    nodes: { task_loop: { kind: 'for_each_task', status: 'not_started', iterations: [] } },
  };
  assert.deepStrictEqual(deriveIterationTaskProgress(iter), { completed: 0, total: 0 });
});

test('counts only iterations whose status === "completed" (AD-4, FR-7)', () => {
  const iter: IterationEntry = {
    index: 0, status: 'in_progress', corrective_tasks: [], repos: [],
    nodes: {
      task_loop: {
        kind: 'for_each_task', status: 'in_progress',
        iterations: [
          { index: 0, status: 'completed', nodes: {}, corrective_tasks: [], repos: [] },
          { index: 1, status: 'completed', nodes: {}, corrective_tasks: [], repos: [] },
          { index: 2, status: 'in_progress', nodes: {}, corrective_tasks: [], repos: [] },
          { index: 3, status: 'not_started', nodes: {}, corrective_tasks: [], repos: [] },
        ],
      },
    },
  };
  assert.deepStrictEqual(deriveIterationTaskProgress(iter), { completed: 2, total: 4 });
});

test('keeps reporting full progress after iteration completes (FR-7 — "stays full and visible")', () => {
  const iter: IterationEntry = {
    index: 0, status: 'completed', corrective_tasks: [], repos: [],
    nodes: {
      task_loop: {
        kind: 'for_each_task', status: 'completed',
        iterations: [
          { index: 0, status: 'completed', nodes: {}, corrective_tasks: [], repos: [] },
          { index: 1, status: 'completed', nodes: {}, corrective_tasks: [], repos: [] },
        ],
      },
    },
  };
  assert.deepStrictEqual(deriveIterationTaskProgress(iter), { completed: 2, total: 2 });
});

import { deriveIterationBadgeLabel, deriveGateBadgeStatusAndLabel } from './dag-timeline-helpers';

console.log("\nderiveIterationBadgeLabel tests\n");

test("FR-2/DD-1 task_executor in_progress → Coding (renamed from Executing)", () => {
  const iter: IterationEntry = { index: 0, status: 'in_progress', corrective_tasks: [], repos: [],
    nodes: { task_executor: { kind: 'step', status: 'in_progress', doc_path: null, retries: 0 } } };
  assert.deepStrictEqual(deriveIterationBadgeLabel(iter, 'for_each_task'), { status: 'in_progress', label: 'Coding' });
});

test("FR-3 code_review in_progress → Reviewing", () => {
  const iter: IterationEntry = { index: 0, status: 'in_progress', corrective_tasks: [], repos: [],
    nodes: { code_review: { kind: 'step', status: 'in_progress', doc_path: null, retries: 0 } } };
  assert.deepStrictEqual(deriveIterationBadgeLabel(iter, 'for_each_task'), { status: 'in_progress', label: 'Reviewing' });
});

test("FR-3 phase_review in_progress → Reviewing", () => {
  const iter: IterationEntry = { index: 0, status: 'in_progress', corrective_tasks: [], repos: [],
    nodes: { phase_review: { kind: 'step', status: 'in_progress', doc_path: null, retries: 0 } } };
  assert.deepStrictEqual(deriveIterationBadgeLabel(iter, 'for_each_task'), { status: 'in_progress', label: 'Reviewing' });
});

test("FR-3 task iter inherits its own in-flight substep (Reviewing)", () => {
  const iter: IterationEntry = { index: 0, status: 'in_progress', corrective_tasks: [], repos: [],
    nodes: { code_review: { kind: 'step', status: 'in_progress', doc_path: null, retries: 0 } } };
  assert.deepStrictEqual(
    deriveIterationBadgeLabel(iter, 'for_each_task'),
    { status: 'in_progress', label: 'Reviewing' },
  );
});

test("FR-2 fallback: in_progress with no in-flight substep → Coding (renamed from Executing)", () => {
  const iter: IterationEntry = { index: 0, status: 'in_progress', corrective_tasks: [], repos: [],
    nodes: { task_executor: { kind: 'step', status: 'completed', doc_path: null, retries: 0 } } };
  assert.deepStrictEqual(deriveIterationBadgeLabel(iter, 'for_each_task'), { status: 'in_progress', label: 'Coding' });
});

test("DD-2 completed iteration → Completed (icon-only label)", () => {
  const iter: IterationEntry = { index: 0, status: 'completed', corrective_tasks: [], repos: [], nodes: {} };
  assert.deepStrictEqual(deriveIterationBadgeLabel(iter, 'for_each_task'), { status: 'completed', label: 'Completed' });
});

console.log("\nderiveGateBadgeStatusAndLabel tests\n");

test("FR-4 gate_active=true overrides to Not Started (DD-3)", () => {
  const node: GateNodeState = { kind: 'gate', status: 'in_progress', gate_active: true };
  assert.deepStrictEqual(deriveGateBadgeStatusAndLabel(node), { status: 'not_started', label: 'Not Started' });
});

test("FR-4 gate_active=false uses underlying status default", () => {
  const node: GateNodeState = { kind: 'gate', status: 'completed', gate_active: false };
  assert.deepStrictEqual(deriveGateBadgeStatusAndLabel(node), { status: 'completed', label: 'Completed' });
});

import { getDocLinkLabel } from './dag-timeline-helpers';

console.log("\ngetDocLinkLabel tests\n");

test("planning artifact steps bucket to 'Document'", () => {
  assert.strictEqual(getDocLinkLabel('research'), 'Document');
  assert.strictEqual(getDocLinkLabel('prd'), 'Document');
  assert.strictEqual(getDocLinkLabel('design'), 'Document');
  assert.strictEqual(getDocLinkLabel('architecture'), 'Document');
  assert.strictEqual(getDocLinkLabel('requirements'), 'Document');
  assert.strictEqual(getDocLinkLabel('master_plan'), 'Document');
});

test("review/report steps bucket to 'Report'", () => {
  assert.strictEqual(getDocLinkLabel('code_review'), 'Report');
  assert.strictEqual(getDocLinkLabel('phase_report'), 'Report');
  assert.strictEqual(getDocLinkLabel('phase_review'), 'Report');
  assert.strictEqual(getDocLinkLabel('final_review'), 'Report');
});

test("AD-6 compound id resolves leaf to bucketed label", () => {
  assert.strictEqual(getDocLinkLabel('phase_loop.iter0.task_loop.iter1.code_review'), 'Report');
});

test("unknown leaf falls back to getDisplayName", () => {
  assert.strictEqual(getDocLinkLabel('something_custom'), 'Something Custom');
});

test("getDocLinkLabel returns the correct bucket for every bucketed id", () => {
  const documentIds = ['research','prd','design','architecture','requirements','master_plan'];
  const reportIds = ['code_review','phase_report','phase_review','final_review'];
  for (const id of documentIds) assert.strictEqual(getDocLinkLabel(id), 'Document');
  for (const id of reportIds) assert.strictEqual(getDocLinkLabel(id), 'Report');
});

import { shouldRenderTimelineRow } from './dag-timeline-helpers';

console.log("\nshouldRenderTimelineRow tests\n");

test("pr_gate always hidden", () => {
  const node: import('@/types/state').GateNodeState = { kind: 'gate', status: 'completed', gate_active: false };
  assert.strictEqual(shouldRenderTimelineRow('pr_gate', node), false);
});

test("task_gate with gate_active: false returns false", () => {
  const node: import('@/types/state').GateNodeState = { kind: 'gate', status: 'completed', gate_active: false };
  assert.strictEqual(shouldRenderTimelineRow('task_gate', node), false);
});

test("task_gate with gate_active: true returns true", () => {
  const node: import('@/types/state').GateNodeState = { kind: 'gate', status: 'not_started', gate_active: true };
  assert.strictEqual(shouldRenderTimelineRow('task_gate', node), true);
});

test("phase_gate with gate_active: false returns false", () => {
  const node: import('@/types/state').GateNodeState = { kind: 'gate', status: 'completed', gate_active: false };
  assert.strictEqual(shouldRenderTimelineRow('phase_gate', node), false);
});

test("phase_gate with gate_active: true returns true", () => {
  const node: import('@/types/state').GateNodeState = { kind: 'gate', status: 'not_started', gate_active: true };
  assert.strictEqual(shouldRenderTimelineRow('phase_gate', node), true);
});

test("final_pr is unconditionally hidden (FR-14: PRs surface only in the Source Control panel)", () => {
  const node: import('@/types/state').StepNodeState = { kind: 'step', status: 'completed', doc_path: null, retries: 0 };
  assert.strictEqual(shouldRenderTimelineRow('final_pr', node), false);
});

test("unrelated node 'requirements' (kind: 'step') always returns true", () => {
  const node: import('@/types/state').StepNodeState = { kind: 'step', status: 'completed', doc_path: null, retries: 0 };
  assert.strictEqual(shouldRenderTimelineRow('requirements', node), true);
});

test("unrelated node 'master_plan' always returns true", () => {
  const node: import('@/types/state').StepNodeState = { kind: 'step', status: 'not_started', doc_path: null, retries: 0 };
  assert.strictEqual(shouldRenderTimelineRow('master_plan', node), true);
});

import { resolveStageBadge, ITERATION_SUBSTEP_LABELS } from './dag-timeline-helpers';

console.log("\nresolveStageBadge (FR-1, FR-2, FR-4, FR-6, AD-2, AD-4, DD-1, DD-2) tests\n");

test("FR-1/DD-1 planning step ids in_progress resolve to --tier-planning + 'Planning'", () => {
  for (const id of ['research','prd','design','architecture','requirements','master_plan','explode_master_plan']) {
    assert.deepStrictEqual(
      resolveStageBadge(id, 'in_progress'),
      { cssVar: '--tier-planning', label: 'Planning' },
      `${id} in_progress`,
    );
  }
});

test("FR-2/DD-1 task_executor in_progress resolves to --tier-execution + 'Coding' (renamed from Executing)", () => {
  assert.deepStrictEqual(
    resolveStageBadge('task_executor', 'in_progress'),
    { cssVar: '--tier-execution', label: 'Coding' },
  );
});

test("FR-1/DD-1 code_review in_progress resolves to --tier-review + 'Reviewing'", () => {
  assert.deepStrictEqual(
    resolveStageBadge('code_review', 'in_progress'),
    { cssVar: '--tier-review', label: 'Reviewing' },
  );
});

test("FR-1/DD-1 phase_review in_progress resolves to --tier-review + 'Reviewing'", () => {
  assert.deepStrictEqual(
    resolveStageBadge('phase_review', 'in_progress'),
    { cssVar: '--tier-review', label: 'Reviewing' },
  );
});

test("FR-4/DD-1 final_review in_progress resolves to --tier-review + 'Reviewing'", () => {
  assert.deepStrictEqual(
    resolveStageBadge('final_review', 'in_progress'),
    { cssVar: '--tier-review', label: 'Reviewing' },
  );
});

test("FR-1/AD-2 unknown leaf in_progress falls back to STATUS_MAP defaults", () => {
  assert.deepStrictEqual(
    resolveStageBadge('something_else', 'in_progress'),
    { cssVar: '--status-in-progress', label: 'In Progress' },
  );
});

test("FR-2/DD-2 non-in_progress statuses use STATUS_MAP defaults regardless of nodeId", () => {
  assert.deepStrictEqual(
    resolveStageBadge('task_executor', 'completed'),
    { cssVar: '--status-complete', label: 'Completed' },
  );
  assert.deepStrictEqual(
    resolveStageBadge('phase_review', 'not_started'),
    { cssVar: '--status-not-started', label: 'Not Started' },
  );
  assert.deepStrictEqual(
    resolveStageBadge('research', 'skipped'),
    { cssVar: '--status-skipped', label: 'Skipped' },
  );
  assert.deepStrictEqual(
    resolveStageBadge('final_review', 'failed'),
    { cssVar: '--status-failed', label: 'Failed' },
  );
  assert.deepStrictEqual(
    resolveStageBadge('code_review', 'halted'),
    { cssVar: '--status-halted', label: 'Halted' },
  );
});

test("AD-4 compound nodeIds resolve via leaf segment", () => {
  assert.deepStrictEqual(
    resolveStageBadge('phase_loop.iter0.task_loop.iter1.code_review', 'in_progress'),
    { cssVar: '--tier-review', label: 'Reviewing' },
  );
  assert.deepStrictEqual(
    resolveStageBadge('phase_loop.iter0.phase_review', 'in_progress'),
    { cssVar: '--tier-review', label: 'Reviewing' },
  );
  assert.deepStrictEqual(
    resolveStageBadge('phase_loop.iter0.task_loop.iter0.task_executor', 'in_progress'),
    { cssVar: '--tier-execution', label: 'Coding' },
  );
});

test("FR-6 ITERATION_SUBSTEP_LABELS now covers final_review", () => {
  assert.strictEqual(ITERATION_SUBSTEP_LABELS.final_review, 'Reviewing');
  assert.strictEqual(ITERATION_SUBSTEP_LABELS.task_executor, 'Coding');
  assert.strictEqual(ITERATION_SUBSTEP_LABELS.code_review, 'Reviewing');
  assert.strictEqual(ITERATION_SUBSTEP_LABELS.phase_review, 'Reviewing');
});

console.log("\nderiveIterationBadgeLabel — phase-boundary recursion stop (FR-3, AD-3, DD-7) tests\n");

test("FR-3/AD-3 phase iter with task_loop in_progress reads 'Executing' regardless of task substep", () => {
  const phaseIter: IterationEntry = {
    index: 0, status: 'in_progress', corrective_tasks: [], repos: [],
    nodes: {
      phase_planning: { kind: 'step', status: 'completed', doc_path: null, retries: 0 },
      task_loop: {
        kind: 'for_each_task', status: 'in_progress',
        iterations: [
          { index: 0, status: 'in_progress', corrective_tasks: [], repos: [],
            nodes: { code_review: { kind: 'step', status: 'in_progress', doc_path: null, retries: 0 } } },
        ],
      },
      phase_review: { kind: 'step', status: 'not_started', doc_path: null, retries: 0 },
    },
  };
  // Pre-FR-3 behavior bubbled the active task's "Reviewing" up to the phase row.
  // Under FR-3 the phase row stops at task_loop and reads "Executing".
  assert.deepStrictEqual(
    deriveIterationBadgeLabel(phaseIter, 'for_each_phase'),
    { status: 'in_progress', label: 'Executing' },
  );
});

test("FR-11 phase iter with phase_planning in_progress reads 'Executing' (Planning dropped)", () => {
  const phaseIter: IterationEntry = {
    index: 0, status: 'in_progress', corrective_tasks: [], repos: [],
    nodes: {
      phase_planning: { kind: 'step', status: 'in_progress', doc_path: null, retries: 0 },
    },
  };
  assert.deepStrictEqual(
    deriveIterationBadgeLabel(phaseIter, 'for_each_phase'),
    { status: 'in_progress', label: 'Executing' },
  );
});

test("FR-3 phase iter with phase_review in_progress reads 'Reviewing'", () => {
  const phaseIter: IterationEntry = {
    index: 0, status: 'in_progress', corrective_tasks: [], repos: [],
    nodes: {
      phase_planning: { kind: 'step', status: 'completed', doc_path: null, retries: 0 },
      task_loop: { kind: 'for_each_task', status: 'completed', iterations: [] },
      phase_review: { kind: 'step', status: 'in_progress', doc_path: null, retries: 0 },
    },
  };
  assert.deepStrictEqual(
    deriveIterationBadgeLabel(phaseIter, 'for_each_phase'),
    { status: 'in_progress', label: 'Reviewing' },
  );
});

test("FR-3 task iter still recurses — code_review substep bubbles up", () => {
  const taskIter: IterationEntry = {
    index: 0, status: 'in_progress', corrective_tasks: [], repos: [],
    nodes: { code_review: { kind: 'step', status: 'in_progress', doc_path: null, retries: 0 } },
  };
  assert.deepStrictEqual(
    deriveIterationBadgeLabel(taskIter, 'for_each_task'),
    { status: 'in_progress', label: 'Reviewing' },
  );
});

test("FR-2/DD-1 task iter task_executor in_progress → 'Coding' (renamed from Executing)", () => {
  const taskIter: IterationEntry = {
    index: 0, status: 'in_progress', corrective_tasks: [], repos: [],
    nodes: { task_executor: { kind: 'step', status: 'in_progress', doc_path: null, retries: 0 } },
  };
  assert.deepStrictEqual(
    deriveIterationBadgeLabel(taskIter, 'for_each_task'),
    { status: 'in_progress', label: 'Coding' },
  );
});

test("DD-7 phase iter, no in-flight substep, in_progress → 'Executing' (fallback)", () => {
  const phaseIter: IterationEntry = {
    index: 0, status: 'in_progress', corrective_tasks: [], repos: [],
    nodes: {
      phase_planning: { kind: 'step', status: 'completed', doc_path: null, retries: 0 },
    },
  };
  assert.deepStrictEqual(
    deriveIterationBadgeLabel(phaseIter, 'for_each_phase'),
    { status: 'in_progress', label: 'Executing' },
  );
});

test("DD-2 completed phase iter → 'Completed' regardless of parentKind", () => {
  const phaseIter: IterationEntry = { index: 0, status: 'completed', corrective_tasks: [], repos: [], nodes: {} };
  assert.deepStrictEqual(
    deriveIterationBadgeLabel(phaseIter, 'for_each_phase'),
    { status: 'completed', label: 'Completed' },
  );
  assert.deepStrictEqual(
    deriveIterationBadgeLabel(phaseIter, 'for_each_task'),
    { status: 'completed', label: 'Completed' },
  );
});

console.log("\nderiveIterationBadgeLabel — UI-IMPROVE-3-FIXES extensions (FR-2, FR-3, FR-4, FR-6, FR-11, FR-17, AD-1, AD-2, DD-1, DD-3, DD-4, DD-5)\n");

test("FR-2/DD-1 task iter task_executor in_progress reads 'Coding' (renamed from 'Executing')", () => {
  const taskIter: IterationEntry = {
    index: 0, status: 'in_progress', corrective_tasks: [], repos: [],
    nodes: { task_executor: { kind: 'step', status: 'in_progress', doc_path: null, retries: 0 } },
  };
  assert.deepStrictEqual(
    deriveIterationBadgeLabel(taskIter, 'for_each_task'),
    { status: 'in_progress', label: 'Coding' },
  );
});

test("FR-2 task iter code_review in_progress still reads 'Reviewing'", () => {
  const taskIter: IterationEntry = {
    index: 0, status: 'in_progress', corrective_tasks: [], repos: [],
    nodes: { code_review: { kind: 'step', status: 'in_progress', doc_path: null, retries: 0 } },
  };
  assert.deepStrictEqual(
    deriveIterationBadgeLabel(taskIter, 'for_each_task'),
    { status: 'in_progress', label: 'Reviewing' },
  );
});

test("FR-4/DD-3 task iter with an in_progress corrective entry reads 'Correcting'", () => {
  const taskIter: IterationEntry = {
    index: 0, status: 'in_progress', corrective_tasks: [
      { index: 1, reason: 'r', injected_after: 'code_review', status: 'in_progress', nodes: {}, doc_path: null, repos: [] },
    ], repos: [],
    nodes: { task_executor: { kind: 'step', status: 'completed', doc_path: null, retries: 0 } },
  };
  assert.deepStrictEqual(
    deriveIterationBadgeLabel(taskIter, 'for_each_task'),
    { status: 'in_progress', label: 'Correcting' },
  );
});

test("FR-4 'Correcting' wins over the in-flight substep label when both apply", () => {
  const taskIter: IterationEntry = {
    index: 0, status: 'in_progress', corrective_tasks: [
      { index: 1, reason: 'r', injected_after: 'code_review', status: 'in_progress', nodes: {}, doc_path: null, repos: [] },
    ], repos: [],
    nodes: { code_review: { kind: 'step', status: 'in_progress', doc_path: null, retries: 0 } },
  };
  assert.deepStrictEqual(
    deriveIterationBadgeLabel(taskIter, 'for_each_task'),
    { status: 'in_progress', label: 'Correcting' },
  );
});

test("FR-4 'Correcting' clears once every corrective resolves; iteration on completed reads STATUS_MAP default 'Completed'", () => {
  const taskIter: IterationEntry = {
    index: 0, status: 'completed', corrective_tasks: [
      { index: 1, reason: 'r', injected_after: 'code_review', status: 'completed', nodes: {}, doc_path: null, repos: [] },
    ], repos: [],
    nodes: {},
  };
  assert.deepStrictEqual(
    deriveIterationBadgeLabel(taskIter, 'for_each_task'),
    { status: 'completed', label: 'Completed' },
  );
});

test("FR-6/DD-4 task iter status='failed' reads {status:'failed', label:'Failed'} (terminal)", () => {
  const taskIter: IterationEntry = {
    index: 0, status: 'failed', corrective_tasks: [], repos: [],
    nodes: { task_executor: { kind: 'step', status: 'failed', doc_path: null, retries: 0 } },
  };
  assert.deepStrictEqual(
    deriveIterationBadgeLabel(taskIter, 'for_each_task'),
    { status: 'failed', label: 'Failed' },
  );
});

test("FR-6 task iter status='halted' reads {status:'halted', label:'Halted'}", () => {
  const taskIter: IterationEntry = {
    index: 0, status: 'halted', corrective_tasks: [], repos: [],
    nodes: {},
  };
  assert.deepStrictEqual(
    deriveIterationBadgeLabel(taskIter, 'for_each_task'),
    { status: 'halted', label: 'Halted' },
  );
});

test("FR-11/AD-1 phase iter with phase_planning in_progress now reads 'Executing' (Planning dropped)", () => {
  const phaseIter: IterationEntry = {
    index: 0, status: 'in_progress', corrective_tasks: [], repos: [],
    nodes: {
      phase_planning: { kind: 'step', status: 'in_progress', doc_path: null, retries: 0 },
    },
  };
  assert.deepStrictEqual(
    deriveIterationBadgeLabel(phaseIter, 'for_each_phase'),
    { status: 'in_progress', label: 'Executing' },
  );
});

test("FR-11 phase iter with phase_review in_progress still reads 'Reviewing'", () => {
  const phaseIter: IterationEntry = {
    index: 0, status: 'in_progress', corrective_tasks: [], repos: [],
    nodes: {
      phase_planning: { kind: 'step', status: 'completed', doc_path: null, retries: 0 },
      task_loop: { kind: 'for_each_task', status: 'completed', iterations: [] },
      phase_review: { kind: 'step', status: 'in_progress', doc_path: null, retries: 0 },
    },
  };
  assert.deepStrictEqual(
    deriveIterationBadgeLabel(phaseIter, 'for_each_phase'),
    { status: 'in_progress', label: 'Reviewing' },
  );
});

test("FR-17 phase iter with task_loop in_progress reads 'Executing' even when no phase_planning child exists (defensive guard removed)", () => {
  const phaseIter: IterationEntry = {
    index: 0, status: 'in_progress', corrective_tasks: [], repos: [],
    nodes: {
      task_loop: { kind: 'for_each_task', status: 'in_progress', iterations: [] },
    },
  };
  assert.deepStrictEqual(
    deriveIterationBadgeLabel(phaseIter, 'for_each_phase'),
    { status: 'in_progress', label: 'Executing' },
  );
});

import { readFileSync as readFileSyncCleanup } from 'node:fs';
import { join as joinCleanup, dirname as dirnameCleanup } from 'node:path';
import { fileURLToPath as fileURLToPathCleanup } from 'node:url';
const __dirname_cleanup = dirnameCleanup(fileURLToPathCleanup(import.meta.url));
const HELPERS_SOURCE = readFileSyncCleanup(joinCleanup(__dirname_cleanup, 'dag-timeline-helpers.ts'), 'utf8');

console.log("\nFR-16 / FR-12 carry-forward cleanup\n");

test("FR-16 dag-timeline-helpers.ts no longer exports derivePlanningStepLabel", () => {
  assert.ok(!/export function derivePlanningStepLabel/.test(HELPERS_SOURCE),
    "derivePlanningStepLabel must be removed from dag-timeline-helpers.ts");
  assert.ok(!/derivePlanningStepLabel/.test(HELPERS_SOURCE),
    "no residual references to derivePlanningStepLabel may remain");
});

test("FR-12 PLANNING_STEP_IDS no longer contains 'phase_planning' (top-level planning steps unaffected; phase_planning resolves via resolveStageBadge leaf-segment lookup)", () => {
  // Source-shape proxy — PLANNING_STEP_IDS is a private const; the
  // contract is "the set covers research/prd/design/architecture/
  // requirements/master_plan/explode_master_plan only".
  const setLiteralMatch = HELPERS_SOURCE.match(/const PLANNING_STEP_IDS[\s\S]*?\]\);/);
  assert.ok(setLiteralMatch !== null, "PLANNING_STEP_IDS literal must still exist");
  const literal = setLiteralMatch[0];
  for (const id of ['research','prd','design','architecture','requirements','master_plan','explode_master_plan']) {
    assert.ok(literal.includes(`'${id}'`), `${id} must remain a top-level planning step id`);
  }
  assert.ok(!literal.includes(`'phase_planning'`),
    "phase_planning must be dropped from PLANNING_STEP_IDS — it is a phase iteration substep, not a top-level planning step (FR-12, FR-17)");
});

test("FR-12 top-level planning step ids still resolve to --tier-planning + 'Planning' (resolveStageBadge unaffected)", () => {
  for (const id of ['research','prd','design','architecture','requirements','master_plan','explode_master_plan']) {
    assert.deepStrictEqual(
      resolveStageBadge(id, 'in_progress'),
      { cssVar: '--tier-planning', label: 'Planning' },
      `${id} still reads Planning (FR-12)`,
    );
  }
});

test("FR-12/FR-17 phase_planning leaf no longer resolves to --tier-planning (falls through to STATUS_MAP)", () => {
  // After FR-17, phase_planning is no longer a planning-leaf override.
  // resolveStageBadge falls through to STATUS_MAP['in_progress'] for it.
  assert.deepStrictEqual(
    resolveStageBadge('phase_planning', 'in_progress'),
    { cssVar: '--status-in-progress', label: 'In Progress' },
  );
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);

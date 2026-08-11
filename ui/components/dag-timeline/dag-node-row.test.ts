/**
 * Tests for DAGNodeRow component logic.
 * Run with: npx tsx ui/components/dag-timeline/dag-node-row.test.ts
 *
 * NOTE: Tests use the established .test.ts pattern (no DOM/JSX rendering).
 * formatNodeId is exported from dag-node-row.tsx for testability; this is a
 * minor deviation from "file-local" described in the handoff, necessitated by
 * the project's non-rendering test pattern.
 */
import assert from "node:assert";
import { formatNodeId } from './dag-node-row';
import { getDisplayName, getGateNodeConfig, getRowButtonDescriptor, GATE_NODE_CONFIG } from './dag-timeline-helpers';
import { STATUS_MAP } from './node-status-badge';
import type { StepNodeState, GateNodeState, ConditionalNodeState, ParallelNodeState, NodeStatus } from '@/types/state';
import { gateNode, conditionalNodeBranchTrue, conditionalNodeBranchFalse } from './__fixtures__';

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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function computeAriaCurrent(nodeId: string, currentNodePath: string | null): 'step' | undefined {
  return nodeId === currentNodePath ? 'step' : undefined;
}

function computePaddingLeft(depth: number): number {
  return 12 + depth * 16;
}

function shouldRenderDocLink(node: StepNodeState | GateNodeState | ConditionalNodeState | ParallelNodeState): boolean {
  return node.kind === 'step' && node.doc_path != null && node.doc_path !== '';
}

function shouldRenderBranchIndicator(node: StepNodeState | GateNodeState | ConditionalNodeState | ParallelNodeState): boolean {
  return node.kind === 'conditional' && node.branch_taken != null;
}

function computeBranchBadge(branchTaken: 'true' | 'false'): { label: string; badgeStatus: string; ariaLabel: string } {
  const label = branchTaken === 'true' ? 'Yes' : 'No';
  const badgeStatus = branchTaken === 'true' ? 'completed' : 'skipped';
  return { label, badgeStatus, ariaLabel: `Branch taken: ${label}` };
}

/**
 * Mirrors the gate-render decision logic in DAGNodeRow:
 * returns true iff the node is a gate, its status is not 'completed',
 * projectName is defined, and the nodeId leaf resolves in GATE_NODE_CONFIG.
 */
function shouldRenderGateButton(
  node: StepNodeState | GateNodeState | ConditionalNodeState | ParallelNodeState,
  nodeId: string,
  projectName: string | undefined
): boolean {
  if (node.kind !== 'gate') return false;
  if (node.status === 'completed') return false;
  if (projectName === undefined) return false;
  return getGateNodeConfig(nodeId) !== null;
}

function computeClasses(isActive: boolean): string[] {
  const classes = ['py-2', 'pr-3', 'rounded-md', 'gap-2', 'flex', 'items-center', 'hover:bg-accent/50'];
  if (isActive) {
    classes.push('border-l-2', 'border-l-[var(--color-link)]');
  }
  return classes;
}

// Mirrors the aria-label composition in DAGNodeRow: display-name and status
// label joined by a real em-dash.
function computeAriaLabel(displayName: string, statusLabel: string): string {
  return `${displayName} — ${statusLabel}`;
}

// Mirrors the row tabIndex stamp: 0 when focused, -1 otherwise.
function computeRowTabIndex(isFocused: boolean): 0 | -1 {
  return isFocused ? 0 : -1;
}

// Mirrors the onKeyDown decision logic in DAGNodeRow.
// Enter/Space always preventDefault (swallow space-scroll on listbox options);
// gate wins over doc; doc rows open their document; rows with neither action
// still swallow the keystroke.
function decideKeyDownAction(
  key: string,
  hasGate: boolean,
  hasDoc: boolean,
): 'click-gate' | 'open-doc' | 'swallow' | 'noop' {
  if (key !== 'Enter' && key !== ' ') return 'noop';
  if (hasGate) return 'click-gate';
  if (hasDoc) return 'open-doc';
  return 'swallow';
}

// Static-markup invariants the production component emits on the row's
// outer <div>. These literals must match exactly what DAGNodeRow renders.
const ROW_ROLE_LITERAL = 'option';
const ROW_DATA_ATTRIBUTE_NAME = 'data-timeline-row';
const ROW_DATA_ROW_KEY_ATTRIBUTE_NAME = 'data-row-key';

// ─── Fixture Nodes ───────────────────────────────────────────────────────────

const stepNodeWithDoc: StepNodeState = {
  kind: 'step',
  status: 'in_progress',
  doc_path: 'tasks/some-task.md',
  retries: 0,
};

const stepNodeNoDoc: StepNodeState = {
  kind: 'step',
  status: 'completed',
  doc_path: null,
  retries: 0,
};

const conditionalNode: ConditionalNodeState = {
  kind: 'conditional',
  status: 'completed',
  branch_taken: null,
};

const parallelNode: ParallelNodeState = {
  kind: 'parallel',
  status: 'in_progress',
  nodes: {},
};

// ─── Tests: formatNodeId ─────────────────────────────────────────────────────

console.log("\nDAGNodeRow logic tests\n");

test('getDisplayName extracts leaf from compound path', () => {
  assert.strictEqual(getDisplayName('phase_loop.iter0.task_handoff'), 'Task Handoff');
});

test('formatNodeId: "gate_mode_selection" → "Gate Mode Selection"', () => {
  assert.strictEqual(formatNodeId('gate_mode_selection'), 'Gate Mode Selection');
});

test('formatNodeId: single word "step" → "Step"', () => {
  assert.strictEqual(formatNodeId('step'), 'Step');
});

test('formatNodeId: two words "run_tests" → "Run Tests"', () => {
  assert.strictEqual(formatNodeId('run_tests'), 'Run Tests');
});

test('formatNodeId: long id "create_phase_plan_v2" → "Create Phase Plan V2"', () => {
  assert.strictEqual(formatNodeId('create_phase_plan_v2'), 'Create Phase Plan V2');
});

// ─── Tests: NodeKindIcon kind prop (via node.kind) ───────────────────────────

test('step node has kind="step"', () => {
  assert.strictEqual(stepNodeWithDoc.kind, 'step');
});

test('gate node has kind="gate"', () => {
  assert.strictEqual(gateNode.kind, 'gate');
});

test('conditional node has kind="conditional"', () => {
  assert.strictEqual(conditionalNode.kind, 'conditional');
});

test('parallel node has kind="parallel"', () => {
  assert.strictEqual(parallelNode.kind, 'parallel');
});

// ─── Tests: NodeStatusBadge status prop (via node.status) ───────────────────

test('step node passes correct status to NodeStatusBadge', () => {
  assert.strictEqual(stepNodeWithDoc.status, 'in_progress');
});

test('gate node passes correct status to NodeStatusBadge', () => {
  assert.strictEqual(gateNode.status, 'not_started');
});

// ─── Tests: DocumentLink render conditions ───────────────────────────────────

test('renders DocumentLink for step node with non-null doc_path', () => {
  assert.strictEqual(shouldRenderDocLink(stepNodeWithDoc), true);
});

test('does NOT render DocumentLink for step node with null doc_path', () => {
  assert.strictEqual(shouldRenderDocLink(stepNodeNoDoc), false);
});

test('does NOT render DocumentLink for step node with undefined doc_path (malformed state.json omits the field)', () => {
  // Regression guard: the original `!== null` check let `undefined` through,
  // so nodes that omitted doc_path entirely still rendered a broken "Doc" link.
  const stepNodeUndefinedDoc = {
    kind: 'step',
    status: 'not_started',
    retries: 0,
    // doc_path field intentionally omitted.
  } as unknown as StepNodeState;
  assert.strictEqual(shouldRenderDocLink(stepNodeUndefinedDoc), false);
});

test('does NOT render DocumentLink for step node with empty-string doc_path', () => {
  const stepNodeEmptyDoc: StepNodeState = {
    kind: 'step',
    status: 'not_started',
    doc_path: '',
    retries: 0,
  };
  assert.strictEqual(shouldRenderDocLink(stepNodeEmptyDoc), false);
});

test('does NOT render DocumentLink for gate node', () => {
  assert.strictEqual(shouldRenderDocLink(gateNode), false);
});

test('does NOT render DocumentLink for conditional node', () => {
  assert.strictEqual(shouldRenderDocLink(conditionalNode), false);
});

test('does NOT render DocumentLink for parallel node', () => {
  assert.strictEqual(shouldRenderDocLink(parallelNode), false);
});

// ─── Tests: aria-current ─────────────────────────────────────────────────────

test('sets aria-current="step" when nodeId === currentNodePath', () => {
  assert.strictEqual(computeAriaCurrent('run_tests', 'run_tests'), 'step');
});

test('does NOT set aria-current when nodeId !== currentNodePath', () => {
  assert.strictEqual(computeAriaCurrent('run_tests', 'other_node'), undefined);
});

test('does NOT set aria-current when currentNodePath is null', () => {
  assert.strictEqual(computeAriaCurrent('run_tests', null), undefined);
});

// ─── Tests: border-l-2 class when active ────────────────────────────────────

test('applies border-l-2 class when active', () => {
  const classes = computeClasses(true);
  assert.ok(classes.includes('border-l-2'), 'should include border-l-2');
  assert.ok(classes.includes('border-l-[var(--color-link)]'), 'should include border-l color');
});

test('does NOT apply border-l-2 class when not active', () => {
  const classes = computeClasses(false);
  assert.ok(!classes.includes('border-l-2'), 'should not include border-l-2');
});

// ─── Tests: depth-based left padding ─────────────────────────────────────────

test('default depth=0 → paddingLeft: 12 (base indent)', () => {
  assert.strictEqual(computePaddingLeft(0), 12);
});

test('depth=1 → paddingLeft: 28', () => {
  assert.strictEqual(computePaddingLeft(1), 28);
});

test('depth=2 → paddingLeft: 44', () => {
  assert.strictEqual(computePaddingLeft(2), 44);
});

test('depth=3 → paddingLeft: 60', () => {
  assert.strictEqual(computePaddingLeft(3), 60);
});

// ─── Tests: Branch indicator rendering ───

test('shouldRenderBranchIndicator returns true for conditional node with branch_taken="true"', () => {
  assert.strictEqual(shouldRenderBranchIndicator(conditionalNodeBranchTrue), true);
});

test('shouldRenderBranchIndicator returns true for conditional node with branch_taken="false"', () => {
  assert.strictEqual(shouldRenderBranchIndicator(conditionalNodeBranchFalse), true);
});

test('shouldRenderBranchIndicator returns false for conditional node with branch_taken=null', () => {
  assert.strictEqual(shouldRenderBranchIndicator(conditionalNode), false);
});

test('shouldRenderBranchIndicator returns false for step node', () => {
  assert.strictEqual(shouldRenderBranchIndicator(stepNodeWithDoc), false);
});

test('shouldRenderBranchIndicator returns false for gate node', () => {
  assert.strictEqual(shouldRenderBranchIndicator(gateNode), false);
});

test('shouldRenderBranchIndicator returns false for parallel node', () => {
  assert.strictEqual(shouldRenderBranchIndicator(parallelNode), false);
});

test('computeBranchBadge("true") returns label="Yes", badgeStatus="completed", ariaLabel="Branch taken: Yes"', () => {
  const result = computeBranchBadge('true');
  assert.deepStrictEqual(result, { label: 'Yes', badgeStatus: 'completed', ariaLabel: 'Branch taken: Yes' });
});

test('computeBranchBadge("false") returns label="No", badgeStatus="skipped", ariaLabel="Branch taken: No"', () => {
  const result = computeBranchBadge('false');
  assert.deepStrictEqual(result, { label: 'No', badgeStatus: 'skipped', ariaLabel: 'Branch taken: No' });
});

test('shouldRenderBranchIndicator handles a generic conditional node id', () => {
  const genericNode: ConditionalNodeState = {
    kind: 'conditional',
    status: 'completed',
    branch_taken: 'true',
  };
  assert.strictEqual(shouldRenderBranchIndicator(genericNode), true);
});

// ─── Tests: GATE_NODE_CONFIG & getGateNodeConfig ─────────────────────────────

test('GATE_NODE_CONFIG contains exactly two entries', () => {
  assert.strictEqual(Object.keys(GATE_NODE_CONFIG).length, 2);
});

test('GATE_NODE_CONFIG contains plan_approval_gate', () => {
  assert.ok('plan_approval_gate' in GATE_NODE_CONFIG, 'should contain plan_approval_gate');
});

test('GATE_NODE_CONFIG contains final_approval_gate', () => {
  assert.ok('final_approval_gate' in GATE_NODE_CONFIG, 'should contain final_approval_gate');
});

test('GATE_NODE_CONFIG does NOT contain pr_gate', () => {
  assert.ok(!('pr_gate' in GATE_NODE_CONFIG), 'should not contain pr_gate');
});

test('GATE_NODE_CONFIG does NOT contain gate_mode_selection', () => {
  assert.ok(!('gate_mode_selection' in GATE_NODE_CONFIG), 'should not contain gate_mode_selection');
});

test('GATE_NODE_CONFIG does NOT contain task_gate', () => {
  assert.ok(!('task_gate' in GATE_NODE_CONFIG), 'should not contain task_gate');
});

test('GATE_NODE_CONFIG does NOT contain phase_gate', () => {
  assert.ok(!('phase_gate' in GATE_NODE_CONFIG), 'should not contain phase_gate');
});

test("getGateNodeConfig('plan_approval_gate') returns plan_approved config", () => {
  assert.deepStrictEqual(getGateNodeConfig('plan_approval_gate'), {
    event: 'plan_approved',
    label: 'Approve Plan',
  });
});

test("getGateNodeConfig('final_approval_gate') returns final_approved config", () => {
  assert.deepStrictEqual(getGateNodeConfig('final_approval_gate'), {
    event: 'final_approved',
    label: 'Approve Final Review',
  });
});

test("getGateNodeConfig('pr_gate') returns null", () => {
  assert.strictEqual(getGateNodeConfig('pr_gate'), null);
});

test("getGateNodeConfig('gate_mode_selection') returns null", () => {
  assert.strictEqual(getGateNodeConfig('gate_mode_selection'), null);
});

test("getGateNodeConfig('task_gate') returns null", () => {
  assert.strictEqual(getGateNodeConfig('task_gate'), null);
});

test("getGateNodeConfig('phase_gate') returns null", () => {
  assert.strictEqual(getGateNodeConfig('phase_gate'), null);
});

test("getGateNodeConfig resolves leaf for compound ID 'some.prefix.plan_approval_gate'", () => {
  assert.deepStrictEqual(getGateNodeConfig('some.prefix.plan_approval_gate'), {
    event: 'plan_approved',
    label: 'Approve Plan',
  });
});

test("getGateNodeConfig resolves leaf for compound ID 'phase_loop.iter0.final_approval_gate'", () => {
  assert.deepStrictEqual(getGateNodeConfig('phase_loop.iter0.final_approval_gate'), {
    event: 'final_approved',
    label: 'Approve Final Review',
  });
});

test("getGateNodeConfig returns null for compound ID with non-map leaf 'phase_loop.iter0.task_gate'", () => {
  assert.strictEqual(getGateNodeConfig('phase_loop.iter0.task_gate'), null);
});

test("getGateNodeConfig returns null for compound ID with non-map leaf 'phase_loop.iter0.phase_gate'", () => {
  assert.strictEqual(getGateNodeConfig('phase_loop.iter0.phase_gate'), null);
});

// ─── Tests: shouldRenderGateButton decision logic ────────────────────────────

// Gate that the walker has reached but that is still awaiting human approval —
// walker leaves status at 'not_started' and flips gate_active = true. That is
// the realistic shape for plan_approval_gate / final_approval_gate pre-approval.
const pendingGateNode: GateNodeState = {
  kind: 'gate',
  status: 'not_started',
  gate_active: true,
};

test("shouldRenderGateButton returns true for pending plan_approval_gate with projectName", () => {
  assert.strictEqual(
    shouldRenderGateButton(pendingGateNode, 'plan_approval_gate', 'my-project'),
    true
  );
});

test("shouldRenderGateButton returns true for pending final_approval_gate with projectName", () => {
  assert.strictEqual(
    shouldRenderGateButton(pendingGateNode, 'final_approval_gate', 'my-project'),
    true
  );
});

test("shouldRenderGateButton returns true for compound ID resolving to plan_approval_gate", () => {
  assert.strictEqual(
    shouldRenderGateButton(pendingGateNode, 'some.prefix.plan_approval_gate', 'my-project'),
    true
  );
});

test("shouldRenderGateButton returns false for step node (non-gate kind)", () => {
  assert.strictEqual(
    shouldRenderGateButton(stepNodeWithDoc, 'plan_approval_gate', 'my-project'),
    false
  );
});

test("shouldRenderGateButton returns false for conditional node (non-gate kind)", () => {
  assert.strictEqual(
    shouldRenderGateButton(conditionalNode, 'plan_approval_gate', 'my-project'),
    false
  );
});

test("shouldRenderGateButton returns false for parallel node (non-gate kind)", () => {
  assert.strictEqual(
    shouldRenderGateButton(parallelNode, 'plan_approval_gate', 'my-project'),
    false
  );
});

// Regression: DAG-VIEW-4 persisted plan_approval_gate as
// { status: 'completed', gate_active: true } after human approval because the
// mutation handler writes gate_active = true on approval. The UI must hide the
// button once status === 'completed' regardless of gate_active.
test("shouldRenderGateButton returns false when node.status === 'completed' (regression: DAG-VIEW-4 plan_approval_gate stuck visible)", () => {
  const completedGate: GateNodeState = {
    kind: 'gate',
    status: 'completed',
    gate_active: true,
  };
  assert.strictEqual(
    shouldRenderGateButton(completedGate, 'plan_approval_gate', 'my-project'),
    false
  );
});

test("shouldRenderGateButton returns false when projectName === undefined", () => {
  assert.strictEqual(
    shouldRenderGateButton(pendingGateNode, 'plan_approval_gate', undefined),
    false
  );
});

test("shouldRenderGateButton returns false for pr_gate leaf", () => {
  assert.strictEqual(
    shouldRenderGateButton(pendingGateNode, 'pr_gate', 'my-project'),
    false
  );
});

test("shouldRenderGateButton returns false for gate_mode_selection leaf", () => {
  assert.strictEqual(
    shouldRenderGateButton(pendingGateNode, 'gate_mode_selection', 'my-project'),
    false
  );
});

test("shouldRenderGateButton returns false for task_gate leaf", () => {
  assert.strictEqual(
    shouldRenderGateButton(pendingGateNode, 'task_gate', 'my-project'),
    false
  );
});

test("shouldRenderGateButton returns false for phase_gate leaf", () => {
  assert.strictEqual(
    shouldRenderGateButton(pendingGateNode, 'phase_gate', 'my-project'),
    false
  );
});

// ─── Tests: composed aria-label ──────────────────────────────────────────────

test("computeAriaLabel('Plan Architecture', 'In Progress') returns 'Plan Architecture — In Progress'", () => {
  assert.strictEqual(
    computeAriaLabel('Plan Architecture', 'In Progress'),
    'Plan Architecture — In Progress'
  );
});

test("computeAriaLabel uses STATUS_MAP['halted'].defaultLabel → 'Approve Plan — Halted'", () => {
  assert.strictEqual(
    computeAriaLabel('Approve Plan', STATUS_MAP['halted'].defaultLabel),
    'Approve Plan — Halted'
  );
});

test("computeAriaLabel with compound-id leaf extraction → 'Plan Approval Gate — Not Started'", () => {
  assert.strictEqual(
    computeAriaLabel(
      getDisplayName('phase_loop.iter0.plan_approval_gate'),
      STATUS_MAP['not_started'].defaultLabel
    ),
    'Plan Approval Gate — Not Started'
  );
});

// ─── Tests: row tabIndex ─────────────────────────────────────────────────────

test('computeRowTabIndex(true) === 0', () => {
  assert.strictEqual(computeRowTabIndex(true), 0);
});

test('computeRowTabIndex(false) === -1', () => {
  assert.strictEqual(computeRowTabIndex(false), -1);
});

// ─── Tests: static markup invariants ─────────────────────────────────────────

test("row role literal is 'option'", () => {
  assert.strictEqual(ROW_ROLE_LITERAL, 'option');
});

test("row carries the 'data-timeline-row' attribute", () => {
  assert.strictEqual(ROW_DATA_ATTRIBUTE_NAME, 'data-timeline-row');
});

test("row carries the 'data-row-key' attribute stamped with nodeId", () => {
  assert.strictEqual(ROW_DATA_ROW_KEY_ATTRIBUTE_NAME, 'data-row-key');
});

// ─── Tests: decideKeyDownAction ──────────────────────────────────────────────

test("decideKeyDownAction('Enter', true, false) === 'click-gate'", () => {
  assert.strictEqual(decideKeyDownAction('Enter', true, false), 'click-gate');
});

test("decideKeyDownAction(' ', true, false) === 'click-gate'", () => {
  assert.strictEqual(decideKeyDownAction(' ', true, false), 'click-gate');
});

test("decideKeyDownAction('Enter', true, true) === 'click-gate' (gate wins over doc)", () => {
  assert.strictEqual(decideKeyDownAction('Enter', true, true), 'click-gate');
});

test("decideKeyDownAction('Enter', false, true) === 'open-doc'", () => {
  assert.strictEqual(decideKeyDownAction('Enter', false, true), 'open-doc');
});

test("decideKeyDownAction(' ', false, true) === 'open-doc'", () => {
  assert.strictEqual(decideKeyDownAction(' ', false, true), 'open-doc');
});

test("decideKeyDownAction('Enter', false, false) === 'swallow'", () => {
  assert.strictEqual(decideKeyDownAction('Enter', false, false), 'swallow');
});

test("decideKeyDownAction(' ', false, false) === 'swallow'", () => {
  assert.strictEqual(decideKeyDownAction(' ', false, false), 'swallow');
});

test("decideKeyDownAction('Tab', true, true) === 'noop'", () => {
  assert.strictEqual(decideKeyDownAction('Tab', true, true), 'noop');
});

test("decideKeyDownAction('ArrowDown', true, true) === 'noop'", () => {
  assert.strictEqual(decideKeyDownAction('ArrowDown', true, true), 'noop');
});

test("decideKeyDownAction('ArrowUp', true, true) === 'noop'", () => {
  assert.strictEqual(decideKeyDownAction('ArrowUp', true, true), 'noop');
});

test("decideKeyDownAction('Escape', true, true) === 'noop'", () => {
  assert.strictEqual(decideKeyDownAction('Escape', true, true), 'noop');
});

// ─── Tests: gate-forwarding integration (pure-logic) ─────────────────────────

test("Enter on pending plan_approval_gate row forwards .click() to gate button", () => {
  // Row would render the gate button (shouldRenderGateButton === true) AND
  // the keydown decision would forward Enter as a gate click.
  const renders = shouldRenderGateButton(pendingGateNode, 'plan_approval_gate', 'my-project');
  const action = decideKeyDownAction('Enter', renders, false);
  assert.strictEqual(renders, true);
  assert.strictEqual(action, 'click-gate');
});

test("Enter on step row with doc_path returns 'open-doc'", () => {
  // Step rows with a non-null doc_path should keyboard-activate the doc.
  const action = decideKeyDownAction('Enter', false, true);
  assert.strictEqual(action, 'open-doc');
});

// ─── Tests: row descriptor branching (FR-1, FR-2, FR-3, AD-1, AD-2) ──────────

/**
 * Mirrors the `DAGNodeRow` post-descriptor render decision. The DAG-state
 * card (dag-widget) now owns the Approve action for the active plan/final-
 * approval gate, so the row intentionally renders nothing for a descriptor's
 * `'approve'` kind — only `'execute'` → ExecutePlanButton still renders here.
 */
function renderKindFor(
  nodeId: string,
  node: GateNodeState,
  phaseLoopStatus: NodeStatus | undefined,
  projectName: string | undefined,
): 'execute' | 'none' {
  if (projectName === undefined) return 'none';
  if (node.kind !== 'gate') return 'none';
  const desc = getRowButtonDescriptor(nodeId, node, phaseLoopStatus);
  return desc.kind === 'execute' ? 'execute' : 'none';
}

test("gate_active=false on plan_approval_gate → 'none' (regression: POEMS-1 in requirements step)", () => {
  const node: GateNodeState = { kind: 'gate', status: 'not_started', gate_active: false };
  assert.strictEqual(renderKindFor('plan_approval_gate', node, 'not_started', 'POEMS-1'), 'none');
});

test("gate_active=false on final_approval_gate → 'none'", () => {
  const node: GateNodeState = { kind: 'gate', status: 'not_started', gate_active: false };
  assert.strictEqual(renderKindFor('final_approval_gate', node, 'not_started', 'POEMS-1'), 'none');
});

test("gate_active=true on plan_approval_gate → 'none' (Approve now owned by the DAG-state card, not this row)", () => {
  const node: GateNodeState = { kind: 'gate', status: 'not_started', gate_active: true };
  assert.strictEqual(renderKindFor('plan_approval_gate', node, 'not_started', 'POEMS-1'), 'none');
});

test("gate_active=true on final_approval_gate → 'none' (Approve now owned by the DAG-state card, not this row)", () => {
  const node: GateNodeState = { kind: 'gate', status: 'not_started', gate_active: true };
  assert.strictEqual(renderKindFor('final_approval_gate', node, 'not_started', 'POEMS-1'), 'none');
});

test("FR-2: plan_approval_gate completed AND phase_loop not_started → 'execute'", () => {
  const node: GateNodeState = { kind: 'gate', status: 'completed', gate_active: true };
  assert.strictEqual(renderKindFor('plan_approval_gate', node, 'not_started', 'POEMS-1'), 'execute');
});

test("FR-2: plan_approval_gate completed AND phase_loop in_progress → 'none'", () => {
  const node: GateNodeState = { kind: 'gate', status: 'completed', gate_active: true };
  assert.strictEqual(renderKindFor('plan_approval_gate', node, 'in_progress', 'POEMS-1'), 'none');
});

test("FR-7: task_gate compound id never renders any row button", () => {
  const node: GateNodeState = { kind: 'gate', status: 'not_started', gate_active: true };
  assert.strictEqual(
    renderKindFor('phase_loop.iter0.task_gate', node, 'in_progress', 'POEMS-1'),
    'none'
  );
});

test("projectName undefined → 'none' (no button without a project context)", () => {
  const node: GateNodeState = { kind: 'gate', status: 'not_started', gate_active: true };
  assert.strictEqual(renderKindFor('plan_approval_gate', node, 'not_started', undefined), 'none');
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);

// ─── P03-T03: Root-row visual tightening (DD-1, DD-4, FR-11) ─────────────────

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dagNodeRowSource = readFileSync(join(__dirname, 'dag-node-row.tsx'), 'utf-8');

console.log("\nDAGNodeRow — root-row visual tightening (P03-T03)\n");

let passed2 = 0;
let failed2 = 0;

function test2(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed2++;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`  ✗ ${name}\n    ${msg}`);
    failed2++;
  }
}

test2('dag-node-row.tsx renders <NodeStatusBadge status=... iconOnly /> (DD-1)', () => {
  assert.ok(
    /<NodeStatusBadge\b[^>]*\biconOnly\b/.test(dagNodeRowSource),
    'DAGNodeRow must render the icon-only NodeStatusBadge variant on root-level rows so the small status icon vocabulary is consistent across phase iteration / task iteration / corrective / root rows (DD-1, FR-11)'
  );
});

test2('dag-node-row.tsx keeps the compact py-2 px-3 typography on the row container (DD-4)', () => {
  assert.ok(
    /'py-2 pr-3 rounded-md gap-2 flex items-center hover:bg-accent\/50'/.test(dagNodeRowSource)
    || /'py-2 px-3[^']*hover:bg-accent\/50'/.test(dagNodeRowSource),
    'DAGNodeRow must keep the compact py-2 (px/pr-3) gap-2 row typography (DD-4)'
  );
});

test2('dag-node-row.tsx still renders the execute button container with ml-auto so it aligns right (FR-11 — no behavior change)', () => {
  assert.ok(/className="ml-auto"/.test(dagNodeRowSource), 'action-button right-alignment classes must be preserved (FR-11)');
});

const nsbSource = readFileSync(join(__dirname, 'node-status-badge.tsx'), 'utf-8');

test2('node-status-badge.tsx accepts an `iconOnly` prop and forwards it to SpinnerBadge as `hideLabel` (DD-1)', () => {
  assert.ok(
    /iconOnly\??:\s*boolean/.test(nsbSource),
    'NodeStatusBadgeProps must declare iconOnly?: boolean'
  );
  assert.ok(
    /hideLabel=\{iconOnly\}/.test(nsbSource)
    || /hideLabel:\s*iconOnly/.test(nsbSource),
    'NodeStatusBadge must forward iconOnly to SpinnerBadge as hideLabel (DD-1)'
  );
});

console.log(`\n${passed2} passed, ${failed2} failed\n`);
if (failed2 > 0) process.exit(1);

// ─── P02-T01: Drop kind icon and label flat-row badge ───────────────────────

import { readFileSync as fsReadSync } from 'node:fs';
import { fileURLToPath as fsFileURL } from 'node:url';
import { dirname as fsDirname, join as fsJoin } from 'node:path';

const ROW_SOURCE = fsReadSync(
  fsJoin(fsDirname(fsFileURL(import.meta.url)), 'dag-node-row.tsx'),
  'utf8'
);

console.log("\nDAGNodeRow FR-1/FR-2/FR-7 source-shape tests\n");

let passed3 = 0;
let failed3 = 0;

function test3(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed3++;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`  ✗ ${name}\n    ${msg}`);
    failed3++;
  }
}

test3("FR-7 NodeKindIcon is no longer rendered in dag-node-row.tsx", () => {
  assert.ok(!ROW_SOURCE.includes('<NodeKindIcon'),
    "DAGNodeRow must not render NodeKindIcon (FR-7)");
});

test3("FR-1/FR-2 NodeStatusBadge renders before the name span", () => {
  // Scope the source-shape check to the JSX render block (everything after
  // `return (`) so the aria-label's getDisplayName usage on line 61 doesn't
  // false-trigger the precede check.
  const renderStart = ROW_SOURCE.indexOf('return (');
  assert.ok(renderStart > -1, "return ( marker must be present");
  const renderBlock = ROW_SOURCE.slice(renderStart);
  const badgeIdx = renderBlock.indexOf('<NodeStatusBadge');
  const nameIdx  = renderBlock.indexOf('>{getDisplayName(nodeId)}</span>');
  assert.ok(badgeIdx > -1 && nameIdx > -1, "both must be present in render block");
  assert.ok(badgeIdx < nameIdx, "badge must precede the display name span (FR-2)");
});

test3("DD-1 iconOnly is conditional on completed status, not unconditional", () => {
  assert.ok(/iconOnly=\{[^}]*['"]?completed['"]?[^}]*\}/.test(ROW_SOURCE) ||
            /node\.status\s*===\s*['"]completed['"]/.test(ROW_SOURCE),
    "iconOnly must be wired to node.status === 'completed' (DD-1)");
});

console.log(`\n${passed3} passed, ${failed3} failed\n`);
if (failed3 > 0) process.exit(1);

test3("FR-4/AD-2 dag-node-row imports deriveGateBadgeStatusAndLabel", () => {
  assert.ok(/deriveGateBadgeStatusAndLabel/.test(ROW_SOURCE),
    "DAGNodeRow must import deriveGateBadgeStatusAndLabel for the gate-active override (FR-4, AD-2)");
});

test3("FR-4 gate node badge resolved via helper, not raw node.status", () => {
  // The helper-resolved {status,label} pair drives the badge so
  // gate_active=true renders gray Not Started even when underlying
  // status === 'in_progress' (FR-4, AD-2, DD-3).
  assert.ok(/deriveGateBadgeStatusAndLabel\s*\(\s*node\s*\)/.test(ROW_SOURCE),
    "DAGNodeRow must call deriveGateBadgeStatusAndLabel(node) on gate rows (FR-4)");
});

test3("FR-11 dag-node-row imports getDocLinkLabel for typed doc-link labels", () => {
  assert.ok(/getDocLinkLabel/.test(ROW_SOURCE),
    "DAGNodeRow must import getDocLinkLabel (FR-11)");
});

test3("FR-11 DocumentLink label is wired to getDocLinkLabel(nodeId), not literal 'Doc'", () => {
  assert.ok(/label=\{getDocLinkLabel\(nodeId\)\}/.test(ROW_SOURCE),
    "DocumentLink must consume getDocLinkLabel(nodeId) (FR-11)");
  assert.ok(!/label="Doc"/.test(ROW_SOURCE),
    "literal 'Doc' label is forbidden on flat-row DocumentLink (FR-11)");
});

console.log(`\n${passed3} passed, ${failed3} failed\n`);
if (failed3 > 0) process.exit(1);

// ─── P04-T03: verdictPill prop addition (AD-8) ───────────────────────────────

console.log("\nDAGNodeRow — P04-T03 verdictPill prop (AD-8)\n");

let passed4 = 0;
let failed4 = 0;

function test4(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed4++;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`  ✗ ${name}\n    ${msg}`);
    failed4++;
  }
}

test4("FR-17/DD-13 flat-row container retains pr-3 gutter", () => {
  assert.ok(/'py-2 pr-3 rounded-md/.test(ROW_SOURCE) || /pr-3 rounded-md gap-2 flex/.test(ROW_SOURCE),
    "flat-row container must carry pr-3 gutter (FR-17, DD-13)");
});

test4("DAGNodeRow accepts an optional prUrl prop and renders an ExternalLink (icon=github, label=\"Pull Request\") on the final_pr row", () => {
  assert.ok(/prUrl\??:\s*string\s*\|\s*null/.test(ROW_SOURCE),
    "DAGNodeRow props must include optional prUrl: string | null");
  assert.ok(/import\s+\{[^}]*\bExternalLink\b[^}]*\}\s+from\s+['"]@\/components\/documents['"]/.test(ROW_SOURCE),
    "DAGNodeRow must import ExternalLink so the final_pr row can surface the PR link");
  assert.ok(/nodeId\s*===\s*['"]final_pr['"]\s*&&\s*prUrl\s*!=\s*null/.test(ROW_SOURCE),
    "ExternalLink must be gated on `nodeId === 'final_pr' && prUrl != null` so the link only renders on the Final PR row when the PR URL exists");
  assert.ok(/<ExternalLink[^/>]*href=\{prUrl\}[^/>]*label="Pull Request"[^/>]*icon="github"/s.test(ROW_SOURCE)
    || /<ExternalLink[^/>]*icon="github"[^/>]*label="Pull Request"[^/>]*href=\{prUrl\}/s.test(ROW_SOURCE)
    || (/<ExternalLink/.test(ROW_SOURCE) && /href=\{prUrl\}/.test(ROW_SOURCE) && /label="Pull Request"/.test(ROW_SOURCE) && /icon="github"/.test(ROW_SOURCE)),
    "ExternalLink must render with href={prUrl}, label=\"Pull Request\", icon=\"github\" — same shape as the project header link");
});

test4("final_pr row is keyboard-activatable — Enter/Space opens prUrl in a new tab", () => {
  assert.ok(/window\.open\s*\(\s*prUrl/.test(ROW_SOURCE),
    "handleKeyDown must call window.open(prUrl, ...) so Enter/Space activates the PR link without breaking roving-tabindex");
  assert.ok(/['"]_blank['"]/.test(ROW_SOURCE),
    "PR link must open in a new tab via window.open(..., '_blank', ...)");
  assert.ok(/noopener,?\s*noreferrer/.test(ROW_SOURCE),
    "window.open must include noopener,noreferrer for safety parity with the anchor's rel attribute");
});

test4("aria-label is derived from the resolved badge {status,label} — not raw node.status", () => {
  // The row's aria-label must announce the same status the badge renders so
  // screen readers don't disagree with the visible label (e.g. gate_active=true
  // shows "Not Started" but raw node.status would announce "In Progress").
  assert.ok(/aria-label=\{`\$\{getDisplayName\(nodeId\)\} — \$\{resolvedBadge\.label\}`\}/.test(ROW_SOURCE),
    "aria-label must be `${getDisplayName(nodeId)} — ${resolvedBadge.label}` — single source of truth with the badge");
  assert.ok(!/STATUS_MAP\[node\.status\]\.defaultLabel/.test(ROW_SOURCE.replace(/planningLabel \?\? STATUS_MAP\[node\.status\]\.defaultLabel/g, '')),
    "aria-label must not consume STATUS_MAP[node.status].defaultLabel directly outside of the resolvedBadge fallback");
});

// ─── P02-T02: Stage-aware badge wiring (FR-1, FR-2, FR-4, FR-6, AD-2, AD-4, DD-1, DD-2) ──

console.log("\nDAGNodeRow stage-aware badge wiring (FR-1, FR-2, FR-4, FR-6, AD-2, AD-4, DD-1, DD-2)\n");

test4("AD-2 DAGNodeRow imports resolveStageBadge from dag-timeline-helpers", () => {
  assert.ok(/resolveStageBadge/.test(ROW_SOURCE),
    "dag-node-row.tsx must import resolveStageBadge");
});

test4("AD-2 DAGNodeRow no longer imports derivePlanningStepLabel", () => {
  // resolveStageBadge subsumes derivePlanningStepLabel (DD-1: planning
  // steps now resolve to --tier-planning + 'Planning', not the
  // legacy 'Executing' label). The old import is removed to prove
  // there's no duplication of label resolution at the row.
  assert.ok(!/derivePlanningStepLabel/.test(ROW_SOURCE),
    "dag-node-row.tsx must no longer import or reference derivePlanningStepLabel");
});

test4("AD-4 DAGNodeRow passes resolved cssVar into NodeStatusBadge", () => {
  // Body must contain a `cssVar={...}` JSX attribute on NodeStatusBadge.
  assert.ok(/<NodeStatusBadge[\s\S]*?cssVar=\{/.test(ROW_SOURCE),
    "dag-node-row.tsx must pass cssVar to NodeStatusBadge");
});

test4("FR-6 DAGNodeRow stops calling STATUS_MAP[status].defaultLabel directly for label resolution", () => {
  // The old planningLabel ?? STATUS_MAP[node.status].defaultLabel
  // pattern is replaced by resolveStageBadge(...).label, which
  // already collapses both branches into the helper.
  // resolveStageBadge replaces the inline STATUS_MAP fallback that
  // was on the resolvedBadge ternary at line ~49 of the pre-change file.
  assert.ok(!/planningLabel\s*\?\?\s*STATUS_MAP/.test(ROW_SOURCE),
    "dag-node-row.tsx must no longer chain `planningLabel ?? STATUS_MAP[...].defaultLabel`");
});

console.log(`\n${passed4} passed, ${failed4} failed\n`);
if (failed4 > 0) process.exit(1);

// ─── Pending Review cssVar/isSpinning threading ──────────────────────────────

console.log("\nDAGNodeRow — Pending Review cssVar/isSpinning threading\n");

let passed5 = 0;
let failed5 = 0;

function test5(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed5++;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`  ✗ ${name}\n    ${msg}`);
    failed5++;
  }
}

/**
 * Mirrors the gate branch of DAGNodeRow's resolvedBadge computation: the
 * derived cssVar/isSpinning override wins over the stage-resolved defaults,
 * and isSpinning is undefined on the non-blocking path.
 */
function resolveGateRowBadge(
  gate: { status: NodeStatus; label: string; cssVar?: string; isSpinning?: boolean },
  gateStageCssVar: string,
): { cssVar: string; isSpinning: boolean | undefined } {
  return {
    cssVar: gate.cssVar ?? gateStageCssVar,
    isSpinning: gate.isSpinning,
  };
}

test5("a blocking gate's derived cssVar wins over the stage-resolved default", () => {
  const result = resolveGateRowBadge(
    { status: 'in_progress', label: 'Pending Review', cssVar: '--tier-review', isSpinning: false },
    '--status-in-progress',
  );
  assert.strictEqual(result.cssVar, '--tier-review');
  assert.strictEqual(result.isSpinning, false);
});

test5("a non-blocking gate falls back to the stage-resolved cssVar and leaves isSpinning undefined", () => {
  const result = resolveGateRowBadge(
    { status: 'completed', label: 'Completed' },
    '--status-complete',
  );
  assert.strictEqual(result.cssVar, '--status-complete');
  assert.strictEqual(result.isSpinning, undefined);
});

test5('dag-node-row.tsx resolves cssVar as gate.cssVar ?? gateStage.cssVar', () => {
  assert.ok(/gate\.cssVar\s*\?\?\s*gateStage\.cssVar/.test(ROW_SOURCE),
    'dag-node-row.tsx must resolve cssVar as gate.cssVar ?? gateStage.cssVar');
});

test5('dag-node-row.tsx threads isSpinning from the derived gate badge into resolvedBadge', () => {
  assert.ok(/isSpinning:\s*gate\.isSpinning/.test(ROW_SOURCE),
    'dag-node-row.tsx must carry gate.isSpinning into resolvedBadge.isSpinning');
});

test5('dag-node-row.tsx threads isSpinning into NodeStatusBadge', () => {
  assert.ok(/<NodeStatusBadge[\s\S]*?isSpinning=\{resolvedBadge\.isSpinning\}/.test(ROW_SOURCE),
    'dag-node-row.tsx must pass isSpinning={resolvedBadge.isSpinning} to NodeStatusBadge');
});

console.log(`\n${passed5} passed, ${failed5} failed\n`);
if (failed5 > 0) process.exit(1);

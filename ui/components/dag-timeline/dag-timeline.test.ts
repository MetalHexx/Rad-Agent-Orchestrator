/**
 * Tests for DAGTimeline component logic.
 * Run with: npx tsx ui/components/dag-timeline/dag-timeline.test.ts
 *
 * NOTE: Tests use the established .test.ts pattern (no DOM/JSX rendering).
 * isLoopNode is exported from dag-timeline-helpers.ts for testability.
 */
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { isLoopNode, getGateNodeConfig } from './dag-timeline-helpers';
import { deriveAncestorLoopKeys } from './dag-timeline';
import type { NodeKind, NodeState, NodesRecord, GateNodeState, StepNodeState, ConditionalNodeState, ParallelNodeState } from '@/types/state';
import {
  stepNode,
  gateNode,
  conditionalNode,
  parallelNode,
  forEachPhaseNode,
  forEachTaskNode,
} from './__fixtures__';

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

// ─── Tests: Dispatch Logic (isLoopNode) ───────────────────────────────────────

test('step node is NOT identified as a loop node', () => {
  assert.strictEqual(isLoopNode(stepNode), false);
});

test('gate node is NOT identified as a loop node', () => {
  assert.strictEqual(isLoopNode(gateNode), false);
});

test('conditional node is NOT identified as a loop node', () => {
  assert.strictEqual(isLoopNode(conditionalNode), false);
});

test('parallel node is NOT identified as a loop node', () => {
  assert.strictEqual(isLoopNode(parallelNode), false);
});

test('for_each_phase node IS identified as a loop node', () => {
  assert.strictEqual(isLoopNode(forEachPhaseNode), true);
});

test('for_each_task node IS identified as a loop node', () => {
  assert.strictEqual(isLoopNode(forEachTaskNode), true);
});

// ─── Tests: Insertion Order Preserved ────────────────────────────────────────

test('Object.entries preserves insertion order for a mixed NodesRecord', () => {
  const nodes: NodesRecord = {
    gate_start: gateNode,
    step_one: stepNode,
    loop_phase: forEachPhaseNode,
    step_two: { kind: 'step', status: 'not_started', doc_path: null, retries: 0 },
    loop_task: forEachTaskNode,
  };
  const keys = Object.entries(nodes).map(([k]) => k);
  assert.deepStrictEqual(keys, ['gate_start', 'step_one', 'loop_phase', 'step_two', 'loop_task']);
});

test('Object.entries of single-entry NodesRecord returns that single entry', () => {
  const nodes: NodesRecord = { only_step: stepNode };
  const entries = Object.entries(nodes);
  assert.strictEqual(entries.length, 1);
  assert.strictEqual(entries[0][0], 'only_step');
});

// ─── Tests: Empty NodesRecord ─────────────────────────────────────────────────

test('empty NodesRecord produces zero entries', () => {
  const nodes: NodesRecord = {};
  const entries = Object.entries(nodes);
  assert.strictEqual(entries.length, 0);
});

// ─── Tests: All NodeKind Values Covered ──────────────────────────────────────

test('all NodeKind values are classified without throwing', () => {
  const allKinds: NodeKind[] = ['step', 'gate', 'conditional', 'parallel', 'for_each_phase', 'for_each_task'];
  const loopKinds = ['for_each_phase', 'for_each_task'];
  const nonLoopKinds = ['step', 'gate', 'conditional', 'parallel'];

  // Check every loop kind returns true
  for (const kind of loopKinds) {
    const node = { kind } as NodeState;
    assert.strictEqual(isLoopNode(node), true, `Expected ${kind} to be a loop node`);
  }

  // Check every non-loop kind returns false
  for (const kind of nonLoopKinds) {
    const node = { kind } as NodeState;
    assert.strictEqual(isLoopNode(node), false, `Expected ${kind} to NOT be a loop node`);
  }

  // Verify total coverage
  assert.strictEqual(allKinds.length, loopKinds.length + nonLoopKinds.length);
});

test('loop kinds form exactly the set {for_each_phase, for_each_task}', () => {
  const allKinds: NodeKind[] = ['step', 'gate', 'conditional', 'parallel', 'for_each_phase', 'for_each_task'];
  const identified = allKinds.filter((kind) => isLoopNode({ kind } as NodeState));
  assert.deepStrictEqual(identified.sort(), ['for_each_phase', 'for_each_task'].sort());
});

// ─── Integration: shouldRenderGateButton composition ─────────────────────────

// Gate awaiting human approval — walker leaves status as 'not_started' while
// blocking. This is the realistic pre-approval shape.
const pendingGateNode: GateNodeState = {
  kind: 'gate',
  status: 'not_started',
  gate_active: true,
};

/**
 * Mirrors the gate-render decision logic in DAGNodeRow. Local copy of the
 * helper used in dag-node-row.test.ts — validates that the composition of
 * `node.kind`, `node.status`, `projectName`, and `getGateNodeConfig(nodeId)`
 * produces the correct top-level-only scope for `ApproveGateButton` rendering.
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

test('integration: plan_approval_gate pending (status: not_started) with projectName defined → shouldRenderGateButton true', () => {
  assert.strictEqual(
    shouldRenderGateButton(pendingGateNode, 'plan_approval_gate', 'my-project'),
    true
  );
});

test('integration: final_approval_gate pending (status: not_started) with projectName defined → shouldRenderGateButton true', () => {
  assert.strictEqual(
    shouldRenderGateButton(pendingGateNode, 'final_approval_gate', 'my-project'),
    true
  );
});

test('integration: plan_approval_gate completed → shouldRenderGateButton false (hide-after-approval)', () => {
  const approvedNode: GateNodeState = { kind: 'gate', status: 'completed', gate_active: true };
  assert.strictEqual(
    shouldRenderGateButton(approvedNode, 'plan_approval_gate', 'my-project'),
    false
  );
});

test('integration: gate_mode_selection pending with projectName defined → shouldRenderGateButton false (excluded from GATE_NODE_CONFIG)', () => {
  assert.strictEqual(
    shouldRenderGateButton(pendingGateNode, 'gate_mode_selection', 'my-project'),
    false
  );
});

test('integration: pr_gate as conditional node → shouldRenderGateButton false regardless of other props (not a gate kind)', () => {
  const nodeId = 'pr_gate';
  const prGateConditional: ConditionalNodeState = {
    kind: 'conditional',
    status: 'in_progress',
    branch_taken: null,
  };
  assert.strictEqual(
    shouldRenderGateButton(prGateConditional, nodeId, 'my-project'),
    false
  );
});

// ─── Source-text: dag-timeline.tsx forwards projectName (no gateActive) ──────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const timelineSource = readFileSync(join(__dirname, 'dag-timeline.tsx'), 'utf-8');

test('dag-timeline.tsx forwards `projectName={projectName}` on every <DAGNodeRow> / <DAGLoopNode> call site (>= 2 total occurrences)', () => {
  const matches = timelineSource.match(/projectName=\{projectName\}/g) ?? [];
  // The file forwards projectName to DAGLoopNode (once) and to DAGNodeRow (once)
  // inside the shared renderNodeEntry helper = 2 total.
  assert.ok(
    matches.length >= 2,
    `expected at least 2 projectName={projectName} occurrences, got ${matches.length}`
  );
});

test('dag-timeline.tsx does NOT forward `gateActive` (button visibility is driven by node.status inside DAGNodeRow)', () => {
  // Strip JSDoc / line comments so doc-comment references don't trip the check.
  const codeOnly = timelineSource
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  assert.ok(
    !/gateActive\s*=/.test(codeOnly),
    'dag-timeline.tsx must NOT pass a gateActive prop to DAGNodeRow — render logic must key off node.status'
  );
  assert.ok(
    !/deriveGateActive/.test(codeOnly),
    'dag-timeline.tsx must NOT reference deriveGateActive (helper was removed)'
  );
});

// ─── No-side-effects contract: DAGTimeline delegates gate API to ApproveGateButton ─

test('dag-timeline.tsx does NOT import fetch, api-client, or useApproveGate directly', () => {
  // Confirm no direct network side-effects. All gate API calls are delegated
  // through ApproveGateButton (via useApproveGate), which is owned by the
  // node-row scope — not by DAGTimeline.
  assert.ok(
    !/from\s+['"].*api\/projects\/.*gate['"]/.test(timelineSource),
    'dag-timeline.tsx must NOT import from the gate API route'
  );
  assert.ok(
    !/useApproveGate/.test(timelineSource),
    'dag-timeline.tsx must NOT reference useApproveGate'
  );
  assert.ok(
    !/\bfetch\s*\(/.test(timelineSource),
    'dag-timeline.tsx must NOT call fetch() directly'
  );
  // Strip JSDoc / line comments before checking for ApproveGateButton references
  // — a doc comment that names the component is allowed, but no import/JSX use.
  const codeOnly = timelineSource
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  assert.ok(
    !/ApproveGateButton/.test(codeOnly),
    'dag-timeline.tsx must NOT import or render ApproveGateButton directly (it is wired inside DAGNodeRow)'
  );
});

// ─── Roving-tabindex coordinator: pure-logic helpers ─────────────────────────

/**
 * Mirrors the production `useState<string | null>(() => focusableRowKeys[0] ?? null)`
 * lazy initializer so tests can assert the initial-focus derivation without
 * rendering the component.
 */
function deriveInitialFocusedRowKey(orderedKeys: readonly string[]): string | null {
  return orderedKeys[0] ?? null;
}

/**
 * Mirrors the `handleKeyDown` wrap-around index computation:
 * - ArrowDown: `currentIndex < length - 1 ? currentIndex + 1 : 0`
 * - ArrowUp:   `currentIndex > 0 ? currentIndex - 1 : length - 1`
 * When `currentIndex === -1` (no row has focus), ArrowDown resolves to 0 and
 * ArrowUp resolves to `length - 1` by the same expressions.
 */
function computeNextIndex(
  direction: 'ArrowDown' | 'ArrowUp',
  currentIndex: number,
  length: number,
): number {
  if (direction === 'ArrowDown') {
    return currentIndex < length - 1 ? currentIndex + 1 : 0;
  }
  return currentIndex > 0 ? currentIndex - 1 : length - 1;
}

/**
 * Mirrors the production `tabIndex={isFocused ? 0 : -1}` expression where
 * `isFocused` is `focusedRowKey === rowKey`. Returns `0` when the row is the
 * currently focused row in the coordinator state, `-1` otherwise.
 */
function computeRowTabIndex(rowKey: string, focusedRowKey: string | null): 0 | -1 {
  return rowKey === focusedRowKey ? 0 : -1;
}

// ─── Tests: deriveInitialFocusedRowKey ───────────────────────────────────────

test('deriveInitialFocusedRowKey([]) === null (empty timeline has no initial focus)', () => {
  assert.strictEqual(deriveInitialFocusedRowKey([]), null);
});

test('deriveInitialFocusedRowKey(["a"]) === "a" (single-row timeline)', () => {
  assert.strictEqual(deriveInitialFocusedRowKey(['a']), 'a');
});

test('deriveInitialFocusedRowKey(["a", "b", "c"]) === "a" (first in document order)', () => {
  assert.strictEqual(deriveInitialFocusedRowKey(['a', 'b', 'c']), 'a');
});

// ─── Tests: computeNextIndex ─────────────────────────────────────────────────

test('computeNextIndex("ArrowDown", 0, 3) === 1 (advance forward)', () => {
  assert.strictEqual(computeNextIndex('ArrowDown', 0, 3), 1);
});

test('computeNextIndex("ArrowDown", 1, 3) === 2 (advance forward)', () => {
  assert.strictEqual(computeNextIndex('ArrowDown', 1, 3), 2);
});

test('computeNextIndex("ArrowDown", 2, 3) === 0 (wrap to start from last)', () => {
  assert.strictEqual(computeNextIndex('ArrowDown', 2, 3), 0);
});

test('computeNextIndex("ArrowDown", -1, 3) === 0 (no current focus → first row)', () => {
  assert.strictEqual(computeNextIndex('ArrowDown', -1, 3), 0);
});

test('computeNextIndex("ArrowUp", 2, 3) === 1 (advance backward)', () => {
  assert.strictEqual(computeNextIndex('ArrowUp', 2, 3), 1);
});

test('computeNextIndex("ArrowUp", 1, 3) === 0 (advance backward)', () => {
  assert.strictEqual(computeNextIndex('ArrowUp', 1, 3), 0);
});

test('computeNextIndex("ArrowUp", 0, 3) === 2 (wrap to end from first)', () => {
  assert.strictEqual(computeNextIndex('ArrowUp', 0, 3), 2);
});

test('computeNextIndex("ArrowUp", -1, 3) === 2 (no current focus → last row)', () => {
  assert.strictEqual(computeNextIndex('ArrowUp', -1, 3), 2);
});

test('computeNextIndex("ArrowDown", 0, 1) === 0 (single-row wrap-to-self)', () => {
  assert.strictEqual(computeNextIndex('ArrowDown', 0, 1), 0);
});

test('computeNextIndex("ArrowUp", 0, 1) === 0 (single-row wrap-to-self)', () => {
  assert.strictEqual(computeNextIndex('ArrowUp', 0, 1), 0);
});

// ─── Tests: computeRowTabIndex ───────────────────────────────────────────────

test('computeRowTabIndex("a", "a") === 0 (focused row is tabbable)', () => {
  assert.strictEqual(computeRowTabIndex('a', 'a'), 0);
});

test('computeRowTabIndex("a", "b") === -1 (unfocused row is not tabbable)', () => {
  assert.strictEqual(computeRowTabIndex('a', 'b'), -1);
});

test('computeRowTabIndex("a", null) === -1 (no focused row → row not tabbable)', () => {
  assert.strictEqual(computeRowTabIndex('a', null), -1);
});

test('computeRowTabIndex("b", null) === -1 (no focused row → row not tabbable)', () => {
  assert.strictEqual(computeRowTabIndex('b', null), -1);
});

// ─── Tests: single-tabindex=0 invariant ──────────────────────────────────────

test('single-tabindex=0 invariant: focusedRowKey="b" in ["a","b","c"] → [-1, 0, -1]', () => {
  const orderedKeys = ['a', 'b', 'c'];
  const result = orderedKeys.map((k) => computeRowTabIndex(k, 'b'));
  assert.deepStrictEqual(result, [-1, 0, -1]);
  const zeros = result.filter((v) => v === 0);
  assert.strictEqual(zeros.length, 1, 'exactly one row should carry tabindex=0');
});

test('single-tabindex=0 invariant: focusedRowKey=null in ["a","b","c"] → all -1 (empty coordinator state)', () => {
  const orderedKeys = ['a', 'b', 'c'];
  const result = orderedKeys.map((k) => computeRowTabIndex(k, null));
  assert.deepStrictEqual(result, [-1, -1, -1]);
  const zeros = result.filter((v) => v === 0);
  assert.strictEqual(zeros.length, 0, 'no row should carry tabindex=0 when focusedRowKey is null');
});

// ─── Source-text invariants: dag-timeline.tsx coordinator wiring ─────────────

test('dag-timeline.tsx contains role="listbox" (outer container role swap)', () => {
  assert.ok(
    timelineSource.includes('role="listbox"'),
    'dag-timeline.tsx must declare role="listbox" on the outer container'
  );
});

test('dag-timeline.tsx contains aria-label="Pipeline timeline"', () => {
  assert.ok(
    timelineSource.includes('aria-label="Pipeline timeline"'),
    'dag-timeline.tsx must declare aria-label="Pipeline timeline" on the outer container'
  );
});

test('dag-timeline.tsx contains ref={containerRef} (ref attachment for descendant query)', () => {
  assert.ok(
    timelineSource.includes('ref={containerRef}'),
    'dag-timeline.tsx must attach a containerRef to the outer container for the [data-timeline-row] descendant query'
  );
});

test('dag-timeline.tsx contains onKeyDownCapture={handleKeyDown} (arrow-key handler wired on container in capture phase)', () => {
  assert.ok(
    timelineSource.includes('onKeyDownCapture={handleKeyDown}'),
    'dag-timeline.tsx must attach onKeyDownCapture={handleKeyDown} to the outer container (capture phase is required so base-ui\'s AccordionTrigger onKeyDown does not intercept ArrowDown/ArrowUp and trap focus on loop rows)'
  );
});

test('dag-timeline.tsx handleKeyDown calls event.stopPropagation() for ArrowDown/ArrowUp (prevents base-ui AccordionTrigger from stealing arrow keys)', () => {
  assert.ok(
    timelineSource.includes('event.stopPropagation()'),
    'dag-timeline.tsx handleKeyDown must call event.stopPropagation() so arrow-key events never reach base-ui\'s AccordionTrigger onKeyDown (which would call its own stopEvent + focus-trap the loop row)'
  );
});

test('dag-timeline.tsx contains [data-timeline-row] (descendant query selector for roving coordinator)', () => {
  assert.ok(
    timelineSource.includes('[data-timeline-row]'),
    'dag-timeline.tsx must query [data-timeline-row] descendants (not [role="option"]) so loop triggers are reached on equal footing'
  );
});

test('dag-timeline.tsx contains isFocused={focusedRowKey === nodeId} on both renderNodeEntry branches (>= 2 occurrences)', () => {
  const matches = timelineSource.match(/isFocused=\{focusedRowKey === nodeId\}/g) ?? [];
  assert.ok(
    matches.length >= 2,
    `expected at least 2 isFocused={focusedRowKey === nodeId} occurrences (one per DAGLoopNode / DAGNodeRow branch), got ${matches.length}`
  );
});

test('dag-timeline.tsx contains onFocusChange={handleFocusChange} on both renderNodeEntry branches (>= 2 occurrences)', () => {
  const matches = timelineSource.match(/onFocusChange=\{handleFocusChange\}/g) ?? [];
  assert.ok(
    matches.length >= 2,
    `expected at least 2 onFocusChange={handleFocusChange} occurrences (one per branch), got ${matches.length}`
  );
});

test('dag-timeline.tsx does NOT contain role="list" (regression guard: container role flipped from list to listbox)', () => {
  // Strip JSDoc / line comments so doc-comment references don't trip the check.
  const codeOnly = timelineSource
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  assert.ok(
    !codeOnly.includes('role="list"'),
    'dag-timeline.tsx must NOT contain role="list" — the container role flipped to "listbox" and per-entry wrappers flipped to "presentation"'
  );
});

test('dag-timeline.tsx does NOT contain placeholder isFocused={false} (regression guard: all placeholders replaced)', () => {
  assert.ok(
    !timelineSource.includes('isFocused={false}'),
    'dag-timeline.tsx must NOT contain isFocused={false} — all placeholder literals must be replaced by the coordinator wiring'
  );
});

test('dag-timeline.tsx contains focus-recovery useEffect that reseeds focusedRowKey when null or stale', () => {
  assert.ok(
    timelineSource.includes('!focusableRowKeys.includes(focusedRowKey)'),
    'dag-timeline.tsx must include the staleness guard `!focusableRowKeys.includes(focusedRowKey)` so focus recovers when the focused key disappears'
  );
  assert.ok(
    timelineSource.includes('setFocusedRowKey(focusableRowKeys[0])'),
    'dag-timeline.tsx must reseed focusedRowKey to focusableRowKeys[0] in the recovery effect so the listbox stays Tab-enterable after SSE-late row arrival'
  );
});

test('dag-timeline.tsx does NOT contain placeholder onFocusChange={() => {}} (regression guard: all placeholders replaced)', () => {
  assert.ok(
    !timelineSource.includes('onFocusChange={() => {}}'),
    'dag-timeline.tsx must NOT contain onFocusChange={() => {}} — all placeholder literals must be replaced by handleFocusChange'
  );
});

// ─── Source-text invariants: dag-iteration-panel.tsx coordinator wiring ──────

const iterationPanelSourceForCoordinator = readFileSync(
  join(__dirname, 'dag-iteration-panel.tsx'),
  'utf-8'
);

test('dag-iteration-panel.tsx does NOT contain placeholder isFocused={false} (regression guard)', () => {
  assert.ok(
    !iterationPanelSourceForCoordinator.includes('isFocused={false}'),
    'dag-iteration-panel.tsx must NOT contain isFocused={false} — all placeholder literals must be replaced by focusedRowKey === childKey'
  );
});

test('dag-iteration-panel.tsx does NOT contain placeholder onFocusChange={() => {}} (regression guard)', () => {
  assert.ok(
    !iterationPanelSourceForCoordinator.includes('onFocusChange={() => {}}'),
    'dag-iteration-panel.tsx must NOT contain onFocusChange={() => {}} — all placeholder literals must be replaced by onFocusChange (coordinator-forwarded)'
  );
});

test('dag-iteration-panel.tsx contains isFocused={focusedRowKey === childKey} on both iteration-child branches (>= 2 occurrences)', () => {
  const matches = iterationPanelSourceForCoordinator.match(/isFocused=\{focusedRowKey === childKey\}/g) ?? [];
  assert.ok(
    matches.length >= 2,
    `expected at least 2 isFocused={focusedRowKey === childKey} occurrences (one per DAGLoopNode / DAGNodeRow branch), got ${matches.length}`
  );
});

test('dag-iteration-panel.tsx contains focusedRowKey={focusedRowKey} forwarded to nested DAGLoopNode and DAGCorrectiveTaskGroup (>= 2 occurrences)', () => {
  const matches = iterationPanelSourceForCoordinator.match(/focusedRowKey=\{focusedRowKey\}/g) ?? [];
  assert.ok(
    matches.length >= 2,
    `expected at least 2 focusedRowKey={focusedRowKey} occurrences (forwarded to DAGLoopNode and DAGCorrectiveTaskGroup), got ${matches.length}`
  );
});

test('dag-iteration-panel.tsx contains onFocusChange={onFocusChange} forwarded to DAGLoopNode, DAGNodeRow, and DAGCorrectiveTaskGroup (>= 3 occurrences)', () => {
  const matches = iterationPanelSourceForCoordinator.match(/onFocusChange=\{onFocusChange\}/g) ?? [];
  assert.ok(
    matches.length >= 3,
    `expected at least 3 onFocusChange={onFocusChange} occurrences (forwarded to DAGLoopNode, DAGNodeRow, DAGCorrectiveTaskGroup), got ${matches.length}`
  );
});

// ─── Source-text invariants: dag-corrective-task-group.tsx coordinator wiring ─

const correctiveTaskGroupSourceForCoordinator = readFileSync(
  join(__dirname, 'dag-corrective-task-group.tsx'),
  'utf-8'
);

test('dag-corrective-task-group.tsx does NOT contain placeholder isFocused={false} (regression guard)', () => {
  assert.ok(
    !correctiveTaskGroupSourceForCoordinator.includes('isFocused={false}'),
    'dag-corrective-task-group.tsx must NOT contain isFocused={false} — placeholder replaced by focusedRowKey === childKey'
  );
});

test('dag-corrective-task-group.tsx does NOT contain placeholder onFocusChange={() => {}} (regression guard)', () => {
  assert.ok(
    !correctiveTaskGroupSourceForCoordinator.includes('onFocusChange={() => {}}'),
    'dag-corrective-task-group.tsx must NOT contain onFocusChange={() => {}} — placeholder replaced by onFocusChange (coordinator-forwarded)'
  );
});

// Note: previously this file asserted CorrectiveRow contained
// `isFocused={focusedRowKey === childKey}` on its <DAGNodeRow> branch.
// P02-T02/FR-1 removed the <DAGNodeRow> mapping from CorrectiveRow, so
// the per-child-key forwarding shape no longer applies. The corrective
// row's own focus is governed by `isFocused={focusedRowKey === itemValue}`
// resolved at the parent group call site, not at the row body.

// ─── TypeScript-level fixtures: new required-prop contracts compile ──────────

// These declarations fail TypeScript compilation if the new required fields
// (focusedRowKey, onFocusChange) are missing or mistyped on the component
// prop interfaces — mirroring the test-fixture pattern already used in
// dag-loop-node.test.ts for asserting prop-contract shape.
import type { DAGLoopNodeProps } from './dag-loop-node';

const _loopPropsContractFixture: DAGLoopNodeProps = {
  nodeId: 'phase_loop',
  node: {
    kind: 'for_each_phase',
    status: 'not_started',
    iterations: [],
  },
  currentNodePath: null,
  onDocClick: (path: string) => { void path; },
  expandedLoopIds: [],
  onAccordionChange: (value: string[], eventDetails: { reason: string }) => { void value; void eventDetails; },
  repoBaseUrl: null,
  compareUrlByRepo: {},
  projectName: 'test-project',
  focusedRowKey: null,
  isFocused: false,
  onFocusChange: (nodeId: string) => { void nodeId; },
};

test('DAGLoopNodeProps contract fixture: focusedRowKey is string|null and onFocusChange is (nodeId: string) => void', () => {
  assert.strictEqual(_loopPropsContractFixture.focusedRowKey, null);
  assert.strictEqual(typeof _loopPropsContractFixture.onFocusChange, 'function');
});

// The DAGIterationPanel and DAGCorrectiveTaskGroup prop interfaces are not
// exported (they are internal `interface` declarations). Build an equivalent
// structural type locally and assert that an object with the expected shape
// compiles. This exercises the same contract that the parent components
// satisfy when rendering those elements.

interface _DAGIterationPanelPropsContract {
  iteration: {
    index: number;
    status: string;
    nodes: Record<string, unknown>;
    corrective_tasks: unknown[];
    commit_hash: string | null;
  };
  iterationIndex: number;
  parentNodeId: string;
  parentKind: 'for_each_phase' | 'for_each_task';
  currentNodePath: string | null;
  onDocClick: (path: string) => void;
  repoBaseUrl: string | null;
  projectName: string;
  expandedLoopIds: string[];
  onAccordionChange: (value: string[], eventDetails: { reason: string }) => void;
  focusedRowKey: string | null;
  onFocusChange: (nodeId: string) => void;
}

const _iterationPanelPropsContractFixture: _DAGIterationPanelPropsContract = {
  iteration: {
    index: 0,
    status: 'not_started',
    nodes: {},
    corrective_tasks: [],
    commit_hash: null,
  },
  iterationIndex: 0,
  parentNodeId: 'phase_loop',
  parentKind: 'for_each_phase',
  currentNodePath: null,
  onDocClick: (path: string) => { void path; },
  repoBaseUrl: null,
  projectName: 'test-project',
  expandedLoopIds: [],
  onAccordionChange: (value: string[], eventDetails: { reason: string }) => { void value; void eventDetails; },
  focusedRowKey: null,
  onFocusChange: (nodeId: string) => { void nodeId; },
};

test('DAGIterationPanelProps structural fixture: focusedRowKey and onFocusChange are present and typed correctly', () => {
  assert.strictEqual(_iterationPanelPropsContractFixture.focusedRowKey, null);
  assert.strictEqual(typeof _iterationPanelPropsContractFixture.onFocusChange, 'function');
});

interface _DAGCorrectiveTaskGroupPropsContract {
  correctiveTasks: unknown[];
  parentNodeId: string;
  currentNodePath: string | null;
  onDocClick: (path: string) => void;
  repoBaseUrl: string | null;
  focusedRowKey: string | null;
  onFocusChange: (nodeId: string) => void;
}

const _correctiveTaskGroupPropsContractFixture: _DAGCorrectiveTaskGroupPropsContract = {
  correctiveTasks: [],
  parentNodeId: 'phase_loop.iter0',
  currentNodePath: null,
  onDocClick: (path: string) => { void path; },
  repoBaseUrl: null,
  focusedRowKey: null,
  onFocusChange: (nodeId: string) => { void nodeId; },
};

test('DAGCorrectiveTaskGroupProps structural fixture: focusedRowKey and onFocusChange are present and typed correctly', () => {
  assert.strictEqual(_correctiveTaskGroupPropsContractFixture.focusedRowKey, null);
  assert.strictEqual(typeof _correctiveTaskGroupPropsContractFixture.onFocusChange, 'function');
});

// ─── T05: deriveAncestorLoopKeys helper ──────────────────────────────────────

/**
 * Local mirror of the production helper exported from `dag-timeline.tsx` —
 * matched against the imported production helper to verify both implementations
 * agree on the same return values. Kept as a pure-logic helper so the test
 * suite can assert the ancestor-key derivation without rendering the component.
 */
function deriveAncestorLoopKeysLocal(lostKey: string): string[] {
  const result: string[] = [];
  const regex = /\.iter\d+\./g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(lostKey)) !== null) {
    result.push(lostKey.slice(0, match.index));
  }
  return result.reverse();
}

test('deriveAncestorLoopKeys("top_level_step") === [] (no .iter\\d+. boundary)', () => {
  assert.deepStrictEqual(deriveAncestorLoopKeys('top_level_step'), []);
  assert.deepStrictEqual(deriveAncestorLoopKeysLocal('top_level_step'), []);
});

test('deriveAncestorLoopKeys("phase_loop") === [] (loop trigger key with no ancestor)', () => {
  assert.deepStrictEqual(deriveAncestorLoopKeys('phase_loop'), []);
  assert.deepStrictEqual(deriveAncestorLoopKeysLocal('phase_loop'), []);
});

test('deriveAncestorLoopKeys("phase_loop.iter0.task_handoff") === ["phase_loop"]', () => {
  assert.deepStrictEqual(
    deriveAncestorLoopKeys('phase_loop.iter0.task_handoff'),
    ['phase_loop']
  );
  assert.deepStrictEqual(
    deriveAncestorLoopKeysLocal('phase_loop.iter0.task_handoff'),
    ['phase_loop']
  );
});

test('deriveAncestorLoopKeys("phase_loop.iter0.ct1.task_handoff") === ["phase_loop"] (.ct\\d+. is NOT an ancestor)', () => {
  assert.deepStrictEqual(
    deriveAncestorLoopKeys('phase_loop.iter0.ct1.task_handoff'),
    ['phase_loop']
  );
  assert.deepStrictEqual(
    deriveAncestorLoopKeysLocal('phase_loop.iter0.ct1.task_handoff'),
    ['phase_loop']
  );
});

test('deriveAncestorLoopKeys("phase_loop.iter0.task_loop.iter1.task_handoff") === ["phase_loop.iter0.task_loop", "phase_loop"] (deepest first)', () => {
  assert.deepStrictEqual(
    deriveAncestorLoopKeys('phase_loop.iter0.task_loop.iter1.task_handoff'),
    ['phase_loop.iter0.task_loop', 'phase_loop']
  );
  assert.deepStrictEqual(
    deriveAncestorLoopKeysLocal('phase_loop.iter0.task_loop.iter1.task_handoff'),
    ['phase_loop.iter0.task_loop', 'phase_loop']
  );
});

test('deriveAncestorLoopKeys("phase_loop.iter12.task_loop.iter345.task_handoff") matches multi-digit iteration indices', () => {
  assert.deepStrictEqual(
    deriveAncestorLoopKeys('phase_loop.iter12.task_loop.iter345.task_handoff'),
    ['phase_loop.iter12.task_loop', 'phase_loop']
  );
  assert.deepStrictEqual(
    deriveAncestorLoopKeysLocal('phase_loop.iter12.task_loop.iter345.task_handoff'),
    ['phase_loop.iter12.task_loop', 'phase_loop']
  );
});

// ─── T05: Source-text invariants on dag-timeline.tsx (recovery effect) ───────

test('dag-timeline.tsx imports useEffect from react', () => {
  // Find the react import line and confirm it includes useEffect.
  const reactImportLine = timelineSource
    .split('\n')
    .find((line) => /from\s+['"]react['"]/.test(line));
  assert.ok(
    reactImportLine !== undefined,
    'dag-timeline.tsx must contain an import line from "react"'
  );
  assert.ok(
    /\buseEffect\b/.test(reactImportLine!),
    `expected the react import line to include useEffect, got: ${reactImportLine}`
  );
});

test('dag-timeline.tsx contains the focus-loss guard on `document.activeElement` vs `document.body`', () => {
  // Per Implementation Step 3 / Acceptance Criterion #269, the recovery effect
  // returns early when `document.activeElement !== document.body` — i.e. the
  // body is the focus-loss sentinel. The test asserts the guard wires
  // `document.activeElement` against `document.body` regardless of the exact
  // equality operator used in the source (=== or !==), since the two forms are
  // semantic complements of one another and the implementation step uses !==.
  assert.ok(
    /document\.activeElement\s*(!==|===)\s*document\.body/.test(timelineSource),
    'dag-timeline.tsx must contain a `document.activeElement` vs `document.body` guard in the recovery effect'
  );
});

test('dag-timeline.tsx seeds the recovery walk with `deriveAccordionFallbackKeys(focusedRowKey)`', () => {
  assert.ok(
    timelineSource.includes('deriveAccordionFallbackKeys(focusedRowKey)'),
    'dag-timeline.tsx must seed the recovery walk with deriveAccordionFallbackKeys(focusedRowKey) so iter-/ct- shaped focused row keys are unwrapped before the ancestor walk'
  );
});

test('dag-timeline.tsx contains the recovery selector prefix `[data-row-key="`', () => {
  assert.ok(
    timelineSource.includes('[data-row-key="'),
    'dag-timeline.tsx must contain the [data-row-key=" selector prefix used by the recovery effect'
  );
});

test('dag-timeline.tsx uses CSS.escape to safely escape ancestor keys in the selector', () => {
  assert.ok(
    timelineSource.includes('CSS.escape'),
    'dag-timeline.tsx must use CSS.escape to escape ancestor keys for the [data-row-key="..."] selector'
  );
});

test('dag-timeline.tsx contains the recovery effect dep array `[expandedLoopIds, focusedRowKey]`', () => {
  const matches = timelineSource.match(/\[expandedLoopIds,\s*focusedRowKey\]/g) ?? [];
  assert.ok(
    matches.length >= 1,
    `expected at least 1 [expandedLoopIds, focusedRowKey] dependency array, got ${matches.length}`
  );
});

// ─── T05: Source-text regression guards on dag-timeline.tsx ──────────────────

test('dag-timeline.tsx contains `const handleFocusChange = useCallback(` (prior-task stable-callback wrapping preserved)', () => {
  assert.ok(
    timelineSource.includes('const handleFocusChange = useCallback('),
    'dag-timeline.tsx must keep handleFocusChange as a useCallback-wrapped declaration (prior-task stability prerequisite)'
  );
});

test('dag-timeline.tsx contains `const handleKeyDown = useCallback(` (prior-task stable-callback wrapping preserved)', () => {
  assert.ok(
    timelineSource.includes('const handleKeyDown = useCallback('),
    'dag-timeline.tsx must keep handleKeyDown as a useCallback-wrapped declaration (prior-task stability prerequisite)'
  );
});

test('dag-timeline.tsx does NOT contain `React.memo` (memoization is OUT OF SCOPE for this task)', () => {
  assert.ok(
    !timelineSource.includes('React.memo'),
    'dag-timeline.tsx must NOT wrap any row component in React.memo — profile-driven memoization is out of scope'
  );
});

test('dag-timeline.tsx does NOT call fetch( (no new network wiring is introduced by this task)', () => {
  assert.ok(
    !/\bfetch\s*\(/.test(timelineSource),
    'dag-timeline.tsx must NOT introduce a fetch call — the recovery effect is purely client-side React + DOM'
  );
});

test('dag-timeline.tsx does NOT contain `EventSource(` (no new SSE subscription is introduced by this task)', () => {
  assert.ok(
    !/\bEventSource\s*\(/.test(timelineSource),
    'dag-timeline.tsx must NOT introduce a new EventSource — live state arrives through the existing useProjects SSE pipeline'
  );
});

// ─── T05: Source-text invariant on use-follow-mode.ts (regression guard) ────

test('use-follow-mode.ts still contains `!isProgrammaticRef.current` (unchanged by this task)', () => {
  const followModeSource = readFileSync(
    join(__dirname, '..', '..', 'hooks', 'use-follow-mode.ts'),
    'utf-8'
  );
  assert.ok(
    followModeSource.includes('!isProgrammaticRef.current'),
    'use-follow-mode.ts must still contain the !isProgrammaticRef.current guard at line 173 (byte-identical to today)'
  );
});

// ─── P03-T04: iterationAncestorToAccordionKey helper ─────────────────────────

import { iterationAncestorToAccordionKey } from './dag-timeline';

console.log("\nDAGTimeline — ancestor-key translation for the iter-... accordion (P03-T04)\n");

test('iterationAncestorToAccordionKey("phase_loop", 0) returns "iter-phase_loop-0" (AD-3 + AD-5)', () => {
  assert.strictEqual(iterationAncestorToAccordionKey('phase_loop', 0), 'iter-phase_loop-0');
});

test('iterationAncestorToAccordionKey accepts a compound parent ("phase_loop.iter0.task_loop", 2) → "iter-phase_loop.iter0.task_loop-2"', () => {
  assert.strictEqual(
    iterationAncestorToAccordionKey('phase_loop.iter0.task_loop', 2),
    'iter-phase_loop.iter0.task_loop-2'
  );
});

test('deriveAncestorLoopKeys("phase_loop.iter0.task_loop.iter2.task_handoff") still returns the loop-id chain so the focus-fallback effect can map them via iterationAncestorToAccordionKey (FR-16)', () => {
  const result = deriveAncestorLoopKeys('phase_loop.iter0.task_loop.iter2.task_handoff');
  assert.deepStrictEqual(result, ['phase_loop.iter0.task_loop', 'phase_loop']);
});

// ─── deriveAccordionFallbackKeys: focus-recovery unwrap for iter-/ct- keys ───

import { deriveAccordionFallbackKeys } from './dag-timeline';

console.log("\nDAGTimeline — deriveAccordionFallbackKeys (Copilot review #1: iter-/ct- shaped focusedRowKey)\n");

test('deriveAccordionFallbackKeys(compound nodeId) walks every .iterN. boundary deepest-first', () => {
  assert.deepStrictEqual(
    deriveAccordionFallbackKeys('phase_loop.iter0.task_loop.iter2.task_handoff'),
    ['iter-phase_loop.iter0.task_loop-2', 'iter-phase_loop-0']
  );
});

test('deriveAccordionFallbackKeys("phase_loop") returns [] (top-level row, no accordion ancestor)', () => {
  assert.deepStrictEqual(deriveAccordionFallbackKeys('phase_loop'), []);
});

test('deriveAccordionFallbackKeys(iter- key with compound parent) falls back to the enclosing iteration trigger', () => {
  // Nested task iteration trigger lost focus when the enclosing phase iteration collapsed.
  // The task iteration trigger itself is gone; the next ancestor is the phase iteration trigger.
  assert.deepStrictEqual(
    deriveAccordionFallbackKeys('iter-phase_loop.iter0.task_loop-2'),
    ['iter-phase_loop-0']
  );
});

test('deriveAccordionFallbackKeys(top-level iter- key) returns [] (no ancestor accordion)', () => {
  // Top-level phase iteration: parent is the top-level loop, which has no accordion trigger.
  assert.deepStrictEqual(deriveAccordionFallbackKeys('iter-phase_loop-0'), []);
});

test('deriveAccordionFallbackKeys(ct- key) falls back to its parent iteration trigger first', () => {
  assert.deepStrictEqual(
    deriveAccordionFallbackKeys('ct-iter-phase_loop-0-3'),
    ['iter-phase_loop-0']
  );
});

test('deriveAccordionFallbackKeys(ct- key under a nested iteration) recurses up the iteration chain', () => {
  assert.deepStrictEqual(
    deriveAccordionFallbackKeys('ct-iter-phase_loop.iter0.task_loop-2-1'),
    ['iter-phase_loop.iter0.task_loop-2', 'iter-phase_loop-0']
  );
});

// ─── P05-T01: inter-section <Separator> removal ──────────────────────────────

import { readFileSync as tlRead } from 'node:fs';
import { fileURLToPath as tlFileURL } from 'node:url';
import { dirname as tlDirname, join as tlJoin } from 'node:path';

const TIMELINE_SOURCE = tlRead(
  tlJoin(tlDirname(tlFileURL(import.meta.url)), 'dag-timeline.tsx'),
  'utf8'
);

console.log("\nDAGTimeline FR-13/FR-14 source-shape tests\n");

test("FR-13/FR-14 inter-section <Separator> is no longer rendered between groups", () => {
  // The cards (Planning, Completion) carry their own border; Separator
  // between sibling DAGSectionGroup renders is removed (DD-9, DD-10).
  assert.ok(!/<Separator[\s\S]*?my-3[\s\S]*?\/>/.test(TIMELINE_SOURCE),
    "DAGTimeline must not render a Separator between section groups (FR-13, DD-9)");
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);

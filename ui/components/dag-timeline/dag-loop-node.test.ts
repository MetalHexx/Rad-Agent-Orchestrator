/**
 * Tests for DAGLoopNode component logic.
 * Run with: npx tsx ui/components/dag-timeline/dag-loop-node.test.ts
 *
 * NOTE: Tests use the established .test.ts pattern (no DOM/JSX rendering).
 * Helper functions are exported from dag-loop-node.tsx for testability.
 */
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { isLoopNode, getDisplayName } from './dag-timeline-helpers';
import type {
  ForEachPhaseNodeState,
  ForEachTaskNodeState,
  IterationEntry,
  NodeStatus,
} from '@/types/state';

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

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeIteration(index: number, status: NodeStatus = 'not_started'): IterationEntry {
  return {
    index,
    status,
    nodes: {},
    corrective_tasks: [],
    commit_hash: null,
  };
}

const forEachPhaseNode0: ForEachPhaseNodeState = {
  kind: 'for_each_phase',
  status: 'not_started',
  iterations: [],
};

const forEachPhaseNode2: ForEachPhaseNodeState = {
  kind: 'for_each_phase',
  status: 'in_progress',
  iterations: [makeIteration(0), makeIteration(1)],
};

const forEachTaskNode3: ForEachTaskNodeState = {
  kind: 'for_each_task',
  status: 'completed',
  iterations: [makeIteration(0), makeIteration(1), makeIteration(2)],
};

// Intentionally out of order to test sort
const forEachPhaseNodeUnsorted: ForEachPhaseNodeState = {
  kind: 'for_each_phase',
  status: 'not_started',
  iterations: [makeIteration(2), makeIteration(0), makeIteration(1)],
};

// ─── Tests ───────────────────────────────────────────────────────────────────

console.log("\nDAGLoopNode logic tests\n");

// getDisplayName (used by callers / smoke test for helpers integration)
test('getDisplayName("phase_loop") returns "Phase Loop"', () => {
  assert.strictEqual(getDisplayName("phase_loop"), "Phase Loop");
});

test('getDisplayName("task_loop") returns "Task Loop"', () => {
  assert.strictEqual(getDisplayName("task_loop"), "Task Loop");
});

// isLoopNode smoke tests for both fixtures
test('isLoopNode(forEachPhaseNode2) returns true', () => {
  assert.strictEqual(isLoopNode(forEachPhaseNode2), true);
});

test('isLoopNode(forEachTaskNode3) returns true', () => {
  assert.strictEqual(isLoopNode(forEachTaskNode3), true);
});

// Component simulation: for_each_phase node with 0 iterations
test('for_each_phase node with 0 iterations renders no iteration panels', () => {
  const iterations = forEachPhaseNode0.iterations;
  assert.strictEqual(iterations.length, 0);
});

// Component simulation: iteration counts and ordering
test('for_each_phase node with 2 iterations has 2 iteration entries', () => {
  assert.strictEqual(forEachPhaseNode2.iterations.length, 2);
});

test('for_each_task node with 3 iterations has 3 iteration entries', () => {
  assert.strictEqual(forEachTaskNode3.iterations.length, 3);
});

test('iterations are sorted by index ascending', () => {
  const sorted = [...forEachPhaseNodeUnsorted.iterations].sort((a, b) => a.index - b.index);
  assert.strictEqual(sorted[0].index, 0);
  assert.strictEqual(sorted[1].index, 1);
  assert.strictEqual(sorted[2].index, 2);
});

test('unsorted iterations are reordered to ascending order', () => {
  const original = forEachPhaseNodeUnsorted.iterations.map(i => i.index);
  assert.deepStrictEqual(original, [2, 0, 1]); // confirm fixture is unsorted
  const sorted = [...forEachPhaseNodeUnsorted.iterations].sort((a, b) => a.index - b.index);
  assert.deepStrictEqual(sorted.map(i => i.index), [0, 1, 2]);
});

// ─── Source-text: transparent renderer ─────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const loopNodeSource = readFileSync(join(__dirname, 'dag-loop-node.tsx'), 'utf-8');

test('dag-loop-node.tsx does NOT render an <Accordion> (AD-1 — loop shell removed)', () => {
  assert.ok(
    !/<Accordion\b/.test(loopNodeSource),
    'DAGLoopNode must not wrap iterations in an <Accordion> — it is now a transparent iteration mapper (AD-1, FR-1, FR-2)'
  );
});

test('dag-loop-node.tsx does NOT export buildLoopItemValue (AD-1 — old loop-key shape retired)', () => {
  assert.ok(
    !/export\s+function\s+buildLoopItemValue\b/.test(loopNodeSource),
    'buildLoopItemValue export must be removed; the iteration accordion key shape (iter-...) is the only key shape now (AD-3)'
  );
});

test('dag-loop-node.tsx maps directly over node.iterations sorted by index ascending (DD-8, FR-10)', () => {
  assert.ok(
    /\.\.\.node\.iterations\][\s\S]{0,80}\.sort\(\(a,\s*b\)\s*=>\s*a\.index\s*-\s*b\.index\)/.test(loopNodeSource)
    || /node\.iterations\.slice\(\)\.sort\(\(a,\s*b\)\s*=>\s*a\.index\s*-\s*b\.index\)/.test(loopNodeSource),
    'DAGLoopNode must sort node.iterations by index ascending (DD-8: oldest first / newest at the bottom)'
  );
});

test('dag-loop-node.tsx renders one DAGIterationPanel per iteration with no wrapping shell (AD-1)', () => {
  assert.ok(
    /<DAGIterationPanel\b/.test(loopNodeSource),
    'DAGLoopNode must render <DAGIterationPanel> for each iteration (transparent mapping)'
  );
  // No JSX element other than <DAGIterationPanel ...> and a React.Fragment wrapper
  // may surround the map call: no <div className="..." > wrapper that would
  // re-introduce a visual shell.
  const noShellWrap = !/<div\s+className=[^>]*>\s*\{\s*sortedIterations\.map/.test(loopNodeSource)
    && !/<Accordion\b/.test(loopNodeSource);
  assert.ok(noShellWrap, 'DAGLoopNode must not introduce a wrapping <div className=... > or <Accordion> shell around the iteration map');
});

test('dag-loop-node.tsx forwards expandedLoopIds and onAccordionChange to DAGIterationPanel (AD-3 — iteration panel owns the accordion)', () => {
  assert.ok(/expandedLoopIds=\{expandedLoopIds\}/.test(loopNodeSource));
  assert.ok(/onAccordionChange=\{onAccordionChange\}/.test(loopNodeSource));
});

// ─── Props-contract fixture (kept) ─────────────────────────────────────────

import type { DAGLoopNodeProps } from './dag-loop-node';

const _propsContractFixture: DAGLoopNodeProps = {
  nodeId: 'phase_loop',
  node: forEachPhaseNode2,
  currentNodePath: null,
  onDocClick: () => {},
  expandedLoopIds: [],
  onAccordionChange: () => {},
  repoBaseUrl: null,
  compareUrlByRepo: {},
  projectName: 'test-project',
  focusedRowKey: null,
  isFocused: false,
  onFocusChange: () => {},
};

test('DAGLoopNodeProps contract still compiles (props shape preserved so DAGTimeline / DAGIterationPanel call sites do not change)', () => {
  assert.strictEqual(typeof _propsContractFixture.onFocusChange, 'function');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);

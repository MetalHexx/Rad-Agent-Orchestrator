/**
 * Tests for DAGIterationPanel component logic.
 * Run with: npx tsx ui/components/dag-timeline/dag-iteration-panel.test.ts
 *
 * NOTE: Tests use the established .test.ts pattern (no DOM/JSX rendering).
 * Helper functions are exported from dag-iteration-panel.tsx for testability.
 */
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  buildIterationLabel,
  buildIterationChildNodeId,
  buildCorrectiveGroupParentId,
  ITERATION_CHILD_DEPTH,
} from './dag-iteration-panel';
import { getCommitLinkData, filterCompatibleNodes } from './dag-timeline-helpers';
import { isLoopNode } from './dag-timeline-helpers';
import {
  stepNode,
  gateNode,
  conditionalNode,
  parallelNode,
  forEachPhaseNode,
  forEachTaskNode,
  taskLoopIteration,
  taskLoopIterationWithCorrective,
} from './__fixtures__';
import type {
  NodeState,
  ForEachTaskNodeState,
  IterationEntry,
  CorrectiveTaskEntry,
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

// ─── Tests ───────────────────────────────────────────────────────────────────

console.log("\nDAGIterationPanel logic tests\n");

// buildIterationLabel
test('buildIterationLabel(0) returns "Iteration 1" (0-based index → 1-based display)', () => {
  assert.strictEqual(buildIterationLabel(0), "Iteration 1");
});

test('buildIterationLabel(4) returns "Iteration 5"', () => {
  assert.strictEqual(buildIterationLabel(4), "Iteration 5");
});

// buildChildNodeId
test('buildIterationChildNodeId("phase_loop", 0, "phase_planning") returns "phase_loop.iter0.phase_planning"', () => {
  assert.strictEqual(
    buildIterationChildNodeId("phase_loop", 0, "phase_planning"),
    "phase_loop.iter0.phase_planning"
  );
});

test('buildIterationChildNodeId("task_loop", 2, "task_handoff") returns "task_loop.iter2.task_handoff"', () => {
  assert.strictEqual(
    buildIterationChildNodeId("task_loop", 2, "task_handoff"),
    "task_loop.iter2.task_handoff"
  );
});

// getCommitLinkData — linked state (drives ExternalLink icon="external-link" branch)
test('getCommitLinkData("abc1234def", "https://github.com/user/repo") returns { href: "https://github.com/user/repo/commit/abc1234def", label: "abc1234" } (linked-state branch)', () => {
  const result = getCommitLinkData("abc1234def", "https://github.com/user/repo");
  assert.ok(result !== null);
  assert.strictEqual(result.href, "https://github.com/user/repo/commit/abc1234def");
  assert.strictEqual(result.label, "abc1234");
});

// getCommitLinkData — unlinked state (drives plain-monospace-span branch)
test('getCommitLinkData("abc1234def", null) returns { href: null, label: "abc1234" } (unlinked-state branch receives href === null and 7-char label)', () => {
  const result = getCommitLinkData("abc1234def", null);
  assert.ok(result !== null);
  assert.strictEqual(result.label, "abc1234");
  assert.strictEqual(result.label.length, 7);
  assert.strictEqual(result.href, null);
});

// getCommitLinkData — absent state (outer commitData !== null guard suppresses render)
test('getCommitLinkData(null, null) returns null (absent-state outer guard suppresses render)', () => {
  const result = getCommitLinkData(null, null);
  assert.strictEqual(result, null);
});

// filterCompatibleNodes — inclusions
test('filterCompatibleNodes includes nodes with kind "step"', () => {
  const nodes: Record<string, NodeState> = { task_handoff: stepNode };
  const result = filterCompatibleNodes(nodes);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0][0], 'task_handoff');
});

test('filterCompatibleNodes includes nodes with kind "gate"', () => {
  const nodes: Record<string, NodeState> = { gate_check: gateNode };
  const result = filterCompatibleNodes(nodes);
  assert.strictEqual(result.length, 1);
});

test('filterCompatibleNodes includes nodes with kind "conditional"', () => {
  const nodes: Record<string, NodeState> = { cond: conditionalNode };
  const result = filterCompatibleNodes(nodes);
  assert.strictEqual(result.length, 1);
});

test('filterCompatibleNodes includes nodes with kind "parallel"', () => {
  const nodes: Record<string, NodeState> = { par: parallelNode };
  const result = filterCompatibleNodes(nodes);
  assert.strictEqual(result.length, 1);
});

// filterCompatibleNodes — exclusions
test('filterCompatibleNodes excludes nodes with kind "for_each_phase"', () => {
  const nodes: Record<string, NodeState> = { loop: forEachPhaseNode };
  const result = filterCompatibleNodes(nodes);
  assert.strictEqual(result.length, 0);
});

test('filterCompatibleNodes excludes nodes with kind "for_each_task"', () => {
  const nodes: Record<string, NodeState> = { loop: forEachTaskNode };
  const result = filterCompatibleNodes(nodes);
  assert.strictEqual(result.length, 0);
});

// filterCompatibleNodes — mixed
test('filterCompatibleNodes with mixed kinds returns only compatible entries in original order', () => {
  const nodes: Record<string, NodeState> = {
    task_handoff: stepNode,
    loop: forEachPhaseNode,
    code_review: gateNode,
    task_loop: forEachTaskNode,
  };
  const result = filterCompatibleNodes(nodes);
  assert.strictEqual(result.length, 2);
  const ids = result.map(([id]) => id);
  assert.deepStrictEqual(ids, ['task_handoff', 'code_review']);
});

// CHILD_DEPTH constant
test('ITERATION_CHILD_DEPTH is exported and equals 1', () => {
  assert.strictEqual(ITERATION_CHILD_DEPTH, 1);
});

// buildCorrectiveGroupParentId
test('buildCorrectiveGroupParentId("phase_loop", 0) returns "phase_loop.iter0"', () => {
  assert.strictEqual(buildCorrectiveGroupParentId("phase_loop", 0), "phase_loop.iter0");
});

test('buildCorrectiveGroupParentId("task_loop", 3) returns "task_loop.iter3"', () => {
  assert.strictEqual(buildCorrectiveGroupParentId("task_loop", 3), "task_loop.iter3");
});

// ─── Loop dispatch classification within iteration nodes ─────────────────────

test('isLoopNode() returns true for the for_each_task node inside taskLoopIteration.nodes', () => {
  const forEachTask = taskLoopIteration.nodes['for_each_task'];
  assert.ok(forEachTask !== undefined);
  assert.strictEqual(isLoopNode(forEachTask), true);
});

test('isLoopNode() returns false for all non-loop nodes in taskLoopIteration.nodes', () => {
  const nonLoopKeys = ['phase_report', 'phase_review', 'phase_gate'];
  for (const key of nonLoopKeys) {
    const node = taskLoopIteration.nodes[key];
    assert.ok(node !== undefined, `Expected node "${key}" to exist`);
    assert.strictEqual(isLoopNode(node), false, `Expected isLoopNode(${key}) to be false`);
  }
});

test('partitioning taskLoopIteration.nodes by isLoopNode() yields 1 loop node and 3 non-loop nodes', () => {
  const entries = Object.entries(taskLoopIteration.nodes);
  const loopNodes = entries.filter(([, node]) => isLoopNode(node));
  const nonLoopNodes = entries.filter(([, node]) => !isLoopNode(node));
  assert.strictEqual(loopNodes.length, 1);
  assert.strictEqual(nonLoopNodes.length, 3);
});

// ─── Compound node ID construction through nesting chain ─────────────────────

test('phase-level child ID: buildIterationChildNodeId("phase_loop", 0, "task_loop") -> "phase_loop.iter0.task_loop"', () => {
  assert.strictEqual(
    buildIterationChildNodeId("phase_loop", 0, "task_loop"),
    "phase_loop.iter0.task_loop"
  );
});

test('task-level nested child ID: buildIterationChildNodeId("phase_loop.iter0.task_loop", 0, "code_review") -> "phase_loop.iter0.task_loop.iter0.code_review"', () => {
  assert.strictEqual(
    buildIterationChildNodeId("phase_loop.iter0.task_loop", 0, "code_review"),
    "phase_loop.iter0.task_loop.iter0.code_review"
  );
});

test('task-level child ID at iteration index 2: buildIterationChildNodeId("phase_loop.iter0.task_loop", 2, "task_handoff") -> "phase_loop.iter0.task_loop.iter2.task_handoff"', () => {
  assert.strictEqual(
    buildIterationChildNodeId("phase_loop.iter0.task_loop", 2, "task_handoff"),
    "phase_loop.iter0.task_loop.iter2.task_handoff"
  );
});

test('multi-level chaining: deeply nested corrective task ID construction', () => {
  const level1 = buildIterationChildNodeId("phase_loop", 0, "task_loop");
  const level2 = buildIterationChildNodeId(level1, 0, "ct1");
  assert.strictEqual(level1, "phase_loop.iter0.task_loop");
  assert.strictEqual(level2, "phase_loop.iter0.task_loop.iter0.ct1");
  const level3 = buildIterationChildNodeId(level2, 0, "task_handoff");
  assert.strictEqual(level3, "phase_loop.iter0.task_loop.iter0.ct1.iter0.task_handoff");
});

// ─── Nested state data safety ─────────────────────────────────────────────────

test('traversing taskLoopIteration nested data completes without error and yields 3 child node keys', () => {
  const entries = Object.entries(taskLoopIteration.nodes);
  const found = entries.find(([, n]) => isLoopNode(n));
  assert.ok(found !== undefined);
  const forEachTask = found[1] as ForEachTaskNodeState;
  const innerKeys = Object.keys(forEachTask.iterations[0].nodes);
  assert.deepStrictEqual(
    innerKeys.sort(),
    ['code_review', 'task_executor', 'task_gate'].sort()
  );
});

test('traversing taskLoopIterationWithCorrective nested data completes without error and corrective_tasks has length 1', () => {
  const entries = Object.entries(taskLoopIterationWithCorrective.nodes);
  const found = entries.find(([, n]) => isLoopNode(n));
  assert.ok(found !== undefined);
  const forEachTask = found[1] as ForEachTaskNodeState;
  const innerIteration = forEachTask.iterations[0];
  assert.strictEqual(innerIteration.corrective_tasks.length, 1);
});

test('inner task iteration does NOT contain any further loop nodes (recursion naturally terminates)', () => {
  const entries = Object.entries(taskLoopIteration.nodes);
  const found = entries.find(([, n]) => isLoopNode(n));
  assert.ok(found !== undefined);
  const forEachTask = found[1] as ForEachTaskNodeState;
  const innerEntries = Object.entries(forEachTask.iterations[0].nodes);
  const innerLoopNodes = innerEntries.filter(([, n]) => isLoopNode(n));
  assert.strictEqual(innerLoopNodes.length, 0);
});

// ─── Corrective task fixture structure ───────────────────────────────────────

test('taskLoopIterationWithCorrective corrective task has reason "Code review found issues"', () => {
  const entries = Object.entries(taskLoopIterationWithCorrective.nodes);
  const found = entries.find(([, n]) => isLoopNode(n));
  assert.ok(found !== undefined);
  const forEachTask = found[1] as ForEachTaskNodeState;
  const correctiveTask = forEachTask.iterations[0].corrective_tasks[0];
  assert.strictEqual(correctiveTask.reason, 'Code review found issues');
});

test('taskLoopIterationWithCorrective corrective task carries doc_path directly', () => {
  const entries = Object.entries(taskLoopIterationWithCorrective.nodes);
  const found = entries.find(([, n]) => isLoopNode(n));
  assert.ok(found !== undefined);
  const forEachTask = found[1] as ForEachTaskNodeState;
  const correctiveTask = forEachTask.iterations[0].corrective_tasks[0];
  assert.strictEqual(correctiveTask.doc_path, 'tasks/t1-fix.md');
});

test('taskLoopIterationWithCorrective corrective task repos is empty (no commit)', () => {
  const entries = Object.entries(taskLoopIterationWithCorrective.nodes);
  const found = entries.find(([, n]) => isLoopNode(n));
  assert.ok(found !== undefined);
  const forEachTask = found[1] as ForEachTaskNodeState;
  const correctiveTask = forEachTask.iterations[0].corrective_tasks[0];
  assert.deepStrictEqual(correctiveTask.repos, []);
});

// ─── Phase-scope corrective forwarding ──────────────────────────────────────

// DAGIterationPanel is generic over parentKind ('for_each_phase' | 'for_each_task').
// It always forwards iteration.corrective_tasks to <DAGCorrectiveTaskGroup> regardless
// of parentKind. This block verifies the structural wiring at fixture + source-text level.

test('phase-scope corrective iteration fixture has corrective_tasks.length === 1', () => {
  // A for_each_phase IterationEntry carrying a synthesized phase-scope corrective
  // (task_handoff pre-completed + code_review scaffolded body node).
  const phaseCorrectiveIteration: IterationEntry = {
    index: 0,
    status: 'in_progress',
    corrective_tasks: [
      {
        index: 1,
        reason: 'Phase review requested changes',
        injected_after: 'phase_review',
        status: 'in_progress',
        nodes: {
          task_handoff: {
            kind: 'step',
            status: 'completed',
            doc_path: 'tasks/PROJ-TASK-P01-PHASE-C1.md',
            retries: 0,
          },
          code_review: {
            kind: 'step',
            status: 'not_started',
            doc_path: null,
            retries: 0,
          },
        },
        repos: [],
      },
    ],
    nodes: {
      // Under iter-11, PHASE_REVIEW_COMPLETED sets phase_review.status =
      // 'completed' BEFORE birthing the corrective into
      // phaseIter.corrective_tasks[]. Fixture matches the real post-mutation
      // shape rather than the impossible "in_progress phase_review + active
      // corrective" combination.
      phase_review: { kind: 'step', status: 'completed', doc_path: 'reports/PROJ-PHASE-REVIEW-P01.md', retries: 0 },
    },
    repos: [],
  };

  assert.strictEqual(phaseCorrectiveIteration.corrective_tasks.length, 1);
  const corrective = phaseCorrectiveIteration.corrective_tasks[0];
  assert.strictEqual(corrective.index, 1);
  assert.strictEqual(corrective.injected_after, 'phase_review');
  assert.strictEqual(corrective.reason, 'Phase review requested changes');
  assert.ok('task_handoff' in corrective.nodes);
  assert.ok('code_review' in corrective.nodes);
  assert.strictEqual((corrective.nodes['task_handoff'] as NodeState & { doc_path?: string | null }).doc_path, 'tasks/PROJ-TASK-P01-PHASE-C1.md');
});

test('phase-scope corrective task nodes contain synthesized pre-completed task_handoff step node', () => {
  const corrective: CorrectiveTaskEntry = {
    index: 1,
    reason: 'Phase review requested changes',
    injected_after: 'phase_review',
    status: 'in_progress',
    nodes: {
      task_handoff: { kind: 'step', status: 'completed', doc_path: 'tasks/PROJ-TASK-P01-PHASE-C1.md', retries: 0 },
      code_review: { kind: 'step', status: 'not_started', doc_path: null, retries: 0 },
    },
    repos: [],
  };

  const taskHandoff = corrective.nodes['task_handoff'];
  assert.ok(taskHandoff !== undefined);
  assert.strictEqual(taskHandoff.kind, 'step');
  // Pre-completed synthesized task_handoff has status 'completed' and a non-null doc_path.
  const handoffStep = taskHandoff as { kind: 'step'; status: string; doc_path: string | null; retries: number };
  assert.strictEqual(handoffStep.status, 'completed');
  assert.notStrictEqual(handoffStep.doc_path, null);
});

// ─── Source-text: no projectName / gateActive forwarding into iteration scope ─

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const iterationPanelSource = readFileSync(join(__dirname, 'dag-iteration-panel.tsx'), 'utf-8');
const correctiveTaskGroupSource = readFileSync(join(__dirname, 'dag-corrective-task-group.tsx'), 'utf-8');

/**
 * Returns true if any <DAGNodeRow ...> JSX element in the given source text
 * contains a `projectName=` or `gateActive=` prop. The check is performed
 * line-by-line: when a line references `<DAGNodeRow`, all subsequent lines up
 * to the closing `/>` or `>` (end of the opening tag) are inspected for the
 * forbidden substrings. This guards against accidental future forwarding of
 * gate activation state into iteration-internal (`task_gate`, `phase_gate`)
 * rows, which are intentionally out of scope for approval-button rendering.
 */
function hasGateForwardingOnDAGNodeRow(source: string): boolean {
  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes('<DAGNodeRow')) continue;
    // Scan the opening tag (may span multiple lines)
    let j = i;
    while (j < lines.length) {
      const line = lines[j];
      if (line.includes('projectName=') || line.includes('gateActive=')) {
        return true;
      }
      if (line.includes('/>') || (j > i && line.includes('>'))) break;
      j++;
    }
  }
  return false;
}

test('dag-iteration-panel.tsx <DAGNodeRow> elements do NOT forward projectName or gateActive', () => {
  assert.ok(iterationPanelSource.includes('<DAGNodeRow'), 'sanity: iteration panel should contain a <DAGNodeRow element');
  assert.strictEqual(
    hasGateForwardingOnDAGNodeRow(iterationPanelSource),
    false,
    'dag-iteration-panel.tsx must NOT forward projectName or gateActive on any <DAGNodeRow> — iteration-internal gate nodes (task_gate, phase_gate) are intentionally out of scope'
  );
});

test('dag-iteration-panel.tsx forwards iteration.corrective_tasks to DAGCorrectiveTaskGroup (phase-scope wiring)', () => {
  // Verifies the panel unconditionally forwards corrective_tasks to the group
  // component, meaning phase-scope corrective entries surface identically to
  // task-scope ones — no parentKind guard on the forwarding call.
  assert.ok(
    iterationPanelSource.includes('<DAGCorrectiveTaskGroup'),
    'sanity: iteration panel must render <DAGCorrectiveTaskGroup>'
  );
  assert.ok(
    iterationPanelSource.includes('correctiveTasks={iteration.corrective_tasks}'),
    'iteration panel must forward iteration.corrective_tasks to DAGCorrectiveTaskGroup'
  );
  // The corrective_tasks forwarding must NOT be inside a parentKind conditional block
  // (i.e., it appears once unconditionally for both for_each_phase and for_each_task).
  //
  // Robust check: (1) <DAGCorrectiveTaskGroup occurs at least once in the file. The
  // P02-T01-C1 corrective restored a SECOND call site in the for_each_task fallthrough
  // branch — the new "exactly two" test is the canonical invariant. This pre-existing
  // test now flexes to >= 1 to permit both per-branch invocations.
  // (2) No gating pattern appears anywhere before the forwarding line — regardless
  // of distance — scanning the full file up to the forwarding point rather than a
  // fixed window. This catches gating nested several blocks up (e.g. an IIFE or
  // helper that wraps the JSX later in a refactor).
  const invocationMatches = iterationPanelSource.match(/<DAGCorrectiveTaskGroup\b/g) ?? [];
  assert.ok(
    invocationMatches.length >= 1,
    `<DAGCorrectiveTaskGroup must appear at least once in dag-iteration-panel.tsx; found ${invocationMatches.length}`
  );
  const lines = iterationPanelSource.split(/\r?\n/);
  const forwardingLine = lines.findIndex((l) => l.includes('correctiveTasks={iteration.corrective_tasks}'));
  assert.ok(forwardingLine >= 0, 'correctiveTasks forwarding line must exist');
  const precedingText = lines.slice(0, forwardingLine).join('\n');
  const gatingPatterns = [
    /parentKind\s*===\s*['"]for_each_task['"]\s*&&\s*\(?\s*<DAGCorrectiveTaskGroup/,
    /parentKind\s*!==\s*['"]for_each_phase['"]\s*&&\s*\(?\s*<DAGCorrectiveTaskGroup/,
    /parentKind\s*===\s*['"]for_each_task['"]\s*\?\s*<DAGCorrectiveTaskGroup/,
  ];
  for (const pat of gatingPatterns) {
    assert.ok(
      !pat.test(precedingText + '\n' + lines[forwardingLine]),
      `corrective_tasks forwarding must not be gated on parentKind (matched: ${pat})`
    );
  }
});

// ─── Doc button rendering (post-unify: iteration.doc_path owns the link) ─────

test('dag-iteration-panel.tsx imports DocumentLink from @/components/documents', () => {
  assert.ok(
    /import\s+\{[^}]*DocumentLink[^}]*\}\s+from\s+['"]@\/components\/documents['"]/.test(iterationPanelSource),
    'iteration panel must import DocumentLink so the header row can render a Doc link when iteration.doc_path resolves'
  );
});

test('dag-iteration-panel.tsx renders <DocumentLink path={iteration.doc_path}> with typed labels (Phase Plan / Task Handoff) onDocClick={onDocClick} /> — new-shape only (FR-11)', () => {
  // Iterations lost their synthetic phase_planning / task_handoff child step nodes in the
  // explode-scaffold-unify refactor. Those children used to own the Doc button via DAGNodeRow.
  // Post-unify, the iteration panel itself must render the Doc button off iteration.doc_path.
  //
  // IMPORTANT: the Doc button is gated on iteration.doc_path (new shape) directly, NOT on the
  // combined `docPath` that includes the legacy phase_planning / task_handoff fallback. Legacy
  // projects still render a Doc button on those synthetic child rows via DAGNodeRow; adding a
  // second one from the iteration header would duplicate the link on every pre-unify project.
  assert.ok(
    iterationPanelSource.includes('<DocumentLink'),
    'iteration panel must render <DocumentLink> for the iteration\'s doc link'
  );
  assert.ok(
    /<DocumentLink\s+path=\{iteration\.doc_path!?\}/.test(iterationPanelSource),
    '<DocumentLink> path prop must be iteration.doc_path (new-shape only), NOT the combined docPath — otherwise legacy projects show a duplicate Doc button on top of the one DAGNodeRow already renders for the phase_planning / task_handoff child row. (Trailing `!` non-null assertion accepted when callsite is gated on a hasPhasePlan/hasTaskHandoff boolean derived from iteration.doc_path.)'
  );
  assert.ok(
    /<DocumentLink[^/]*label="Phase Plan|Task Handoff"/.test(iterationPanelSource),
    '<DocumentLink> label prop must be typed by parent kind: "Phase Plan" for phase iterations, "Task Handoff" for task iterations (FR-11)'
  );
  assert.ok(
    /<DocumentLink[^/]*onDocClick=\{onDocClick\}/.test(iterationPanelSource),
    '<DocumentLink> must forward the onDocClick prop plumbed through to the iteration panel'
  );
});

test('dag-iteration-panel.tsx gates <DocumentLink> on iteration.doc_path (new shape only — no render on legacy fallback, no render on null/empty)', () => {
  // The panel must not render the Doc button when iteration.doc_path is absent — the legacy
  // fallback path already has a Doc button on the phase_planning / task_handoff child row.
  // Double-rendering would ship two buttons that open the same document on every legacy project.
  // The gate uses `iteration.doc_path != null && iteration.doc_path !== ''` to mirror the
  // existing DAGNodeRow:80 pattern (`node.doc_path != null && node.doc_path !== ''`). The
  // gate may be hoisted into a boolean (`hasPhasePlan` / `hasTaskHandoff` /
  // `hasAnyTaskTrailing`) and reused at the JSX site — accept either inline or hoisted form.
  assert.ok(
    /(hasPhasePlan|hasTaskHandoff|hasAnyTaskTrailing)\s*=\s*iteration\.doc_path\s*!=\s*null/.test(iterationPanelSource)
      || /iteration\.doc_path\s*!=\s*null\s*&&\s*iteration\.doc_path\s*!==\s*''/.test(iterationPanelSource),
    'DocumentLink must be gated on `iteration.doc_path != null && iteration.doc_path !== \'\'` (new shape only, not the legacy-fallback-inclusive `docPath` variable). Gate may be hoisted into a hasPhasePlan/hasTaskHandoff/hasAnyTaskTrailing boolean.'
  );
});

test('dag-iteration-panel.tsx <DocumentLink> does NOT pass tabIndex (keyboard accessibility — default tabIndex=0 so users can tab to it)', () => {
  // DAGNodeRow passes tabIndex={-1} because the row div itself is focusable and a keydown
  // handler opens the doc on Enter/Space — that closed pattern keeps roving tabindex intact.
  // The iteration panel header has no such row-level focus wiring: the header <div> is not
  // focusable and has no keydown handler. If the DocumentLink here were tabIndex={-1}, a
  // keyboard-only user would have NO path to open the iteration doc (the AccordionTrigger
  // above consumes Enter/Space to expand/collapse the loop, not to open the doc).
  // Therefore this DocumentLink must use the default tab order.
  const docLinkMatch = iterationPanelSource.match(/<DocumentLink\b[^>]*\/>/);
  assert.ok(docLinkMatch, 'iteration panel must contain a self-closing <DocumentLink ... /> element');
  assert.ok(
    !/tabIndex\s*=/.test(docLinkMatch[0]),
    '<DocumentLink> in the iteration header must NOT pass tabIndex — relying on the default lets keyboard users tab to the Doc button (the header has no row-level keydown handler like DAGNodeRow does)'
  );
});

test('dag-iteration-panel.tsx uses CommitChips for per-repo commit rendering, not ExternalLink (FR-15)', () => {
  // FR-15: single-commit ExternalLink has been retired in favour of CommitChips so task
  // iterations get per-repo attribution. ExternalLink must no longer appear in the source;
  // CommitChips must be imported and used.
  assert.ok(
    !/<ExternalLink\b/.test(iterationPanelSource),
    'iteration panel must NOT contain <ExternalLink> — commit rendering is now solely CommitChips (FR-15)'
  );
  assert.ok(
    /CommitChips/.test(iterationPanelSource),
    'iteration panel must import and render CommitChips for per-repo commit attribution (FR-15)'
  );
});

test('dag-corrective-task-group.tsx does NOT contain projectName= or gateActive=', () => {
  // Note: the original sanity assertion checked the file contained <DAGNodeRow>.
  // P02-T02/FR-1 explicitly removed <DAGNodeRow> from CorrectiveRow as part of
  // the row-recursion simplification, so the sanity guard no longer applies.
  // The substantive assertions (no projectName=, no gateActive= nested-scope
  // forwarding) still hold.
  assert.ok(
    !correctiveTaskGroupSource.includes('projectName='),
    'dag-corrective-task-group.tsx must NOT contain projectName= (confirms no nested-scope forwarding)'
  );
  assert.ok(
    !correctiveTaskGroupSource.includes('gateActive='),
    'dag-corrective-task-group.tsx must NOT contain gateActive= (confirms no nested-scope forwarding)'
  );
});

console.log("\nDAGIterationPanel — phase iteration accordion (P02-T01)\n");

test('dag-iteration-panel.tsx imports Accordion/AccordionItem/AccordionTrigger/AccordionContent from @/components/ui/accordion (AD-2)', () => {
  assert.ok(
    /import\s+\{[^}]*Accordion[^}]*AccordionItem[^}]*AccordionTrigger[^}]*AccordionContent[^}]*\}\s+from\s+['"]@\/components\/ui\/accordion['"]/.test(iterationPanelSource)
    || (
      /import\s+\{[^}]*Accordion\b/.test(iterationPanelSource)
      && /AccordionItem/.test(iterationPanelSource)
      && /AccordionTrigger/.test(iterationPanelSource)
      && /AccordionContent/.test(iterationPanelSource)
    ),
    'iteration panel must import the accordion primitives so the panel itself becomes the accordion (AD-2)'
  );
});

test('dag-iteration-panel.tsx wires <Accordion ... value={expandedLoopIds} onValueChange={onAccordionChange} multiple> at the top of the for_each_phase branch (AD-2, AD-3)', () => {
  assert.ok(
    /<Accordion\b[^>]*\bmultiple\b[^>]*value=\{expandedLoopIds\}[^>]*onValueChange=\{onAccordionChange\}/.test(iterationPanelSource)
    || /<Accordion\b[^>]*value=\{expandedLoopIds\}[^>]*onValueChange=\{onAccordionChange\}[^>]*\bmultiple\b/.test(iterationPanelSource),
    '<Accordion> in iteration panel must be controlled (value={expandedLoopIds}, onValueChange={onAccordionChange}) and multi-open (matches the controlled-mode contract documented in AD-3)'
  );
});

test('dag-iteration-panel.tsx <AccordionItem value> uses buildIterationItemValue(parentNodeId, iterationIndex) (AD-3 hook+renderer parity)', () => {
  assert.ok(
    /<AccordionItem\b[^>]*value=\{buildIterationItemValue\(parentNodeId,\s*iterationIndex\)\}/.test(iterationPanelSource),
    '<AccordionItem value> must come from buildIterationItemValue so the same key shape is produced by both the hook and the renderer (AD-3)'
  );
});

test('dag-iteration-panel.tsx renders NodeStatusBadge with iconOnly for the phase-iteration small status icon (DD-1)', () => {
  assert.ok(
    /NodeStatusBadge[\s\S]{0,200}iconOnly/.test(iterationPanelSource),
    'phase iteration header must use NodeStatusBadge with iconOnly wired to iteration.status === "completed" for the small status icon (DD-1)'
  );
});

test('dag-iteration-panel.tsx imports ProgressBar from @/components/execution/progress-bar (NFR-5)', () => {
  assert.ok(
    /import\s+\{\s*ProgressBar\s*\}\s+from\s+['"]@\/components\/execution\/progress-bar['"]/.test(iterationPanelSource),
    'iteration panel must reuse the existing ProgressBar primitive — no new package, no new shared utility (NFR-5)'
  );
});

test('dag-iteration-panel.tsx renders ProgressBar inside the for_each_phase accordion trigger (FR-7, FR-8)', () => {
  assert.ok(
    /<ProgressBar\b/.test(iterationPanelSource),
    'iteration panel must render <ProgressBar> in the phase-iteration header so progress ticks per task (FR-7) and the empty 0% track shows for not_started phases (FR-8)'
  );
});

test('dag-iteration-panel.tsx Phase Plan DocumentLink is a SIBLING of AccordionTrigger (not nested inside it) — DD-6 + nested-interactive-control invariant', () => {
  // The DocumentLink line for Phase Plan must NOT live within the
  // <AccordionTrigger>...</AccordionTrigger> span. Mirrors the
  // dag-corrective-task-group.tsx pattern.
  const triggerOpenIdx = iterationPanelSource.indexOf('<AccordionTrigger');
  const triggerCloseIdx = iterationPanelSource.indexOf('</AccordionTrigger>');
  assert.ok(triggerOpenIdx > -1 && triggerCloseIdx > triggerOpenIdx, 'panel must contain a <AccordionTrigger>...</AccordionTrigger> pair');
  const triggerInner = iterationPanelSource.slice(triggerOpenIdx, triggerCloseIdx);
  assert.ok(
    !/<DocumentLink\b/.test(triggerInner),
    'Phase Plan <DocumentLink> must render as a sibling of <AccordionTrigger>, not inside it (nested interactive control would break click + ARIA — see dag-corrective-task-group.tsx pattern)'
  );
});

test('dag-iteration-panel.tsx renders <DAGCorrectiveTaskGroup> in BOTH the for_each_phase accordion body AND the for_each_task fallthrough (FR-3, FR-4, NFR-1)', () => {
  const src = readFileSync(
    join(__dirname, 'dag-iteration-panel.tsx'),
    'utf-8'
  );
  // exactly two <DAGCorrectiveTaskGroup ...> JSX call sites
  const matches = src.match(/<DAGCorrectiveTaskGroup\b/g) ?? [];
  assert.strictEqual(
    matches.length,
    2,
    'expected exactly two <DAGCorrectiveTaskGroup> JSX usages — one per branch'
  );
});

test('dag-iteration-panel.tsx (P01-T04) threads isPhaseCorrective and phaseReviewDocPath into BOTH <DAGCorrectiveTaskGroup> call sites', () => {
  const src = readFileSync(
    join(__dirname, 'dag-iteration-panel.tsx'),
    'utf-8'
  );
  // The phase-branch call site (parentKind is not yet narrowed there) resolves both
  // props from parentKind/iteration.nodes['phase_review']. The task-branch call site
  // is only reachable once TS has narrowed parentKind to the 'for_each_task' literal
  // (the phase branch returns earlier), so `parentKind === 'for_each_phase'` there would
  // be a TS2367 impossible-comparison error — it instead hardcodes isPhaseCorrective={false}
  // and phaseReviewDocPath={null}, which is semantically identical (a task corrective is
  // never phase-level).
  assert.ok(
    /isPhaseCorrective=\{parentKind === ['"]for_each_phase['"]\}/.test(src),
    "the for_each_phase-branch <DAGCorrectiveTaskGroup> call site must pass isPhaseCorrective={parentKind === 'for_each_phase'}"
  );
  assert.ok(
    /phaseReviewDocPath=\{parentKind === ['"]for_each_phase['"]\s*\?\s*\(\(iteration\.nodes\[['"]phase_review['"]\]\s+as\s+StepNodeState\s*\|\s*undefined\)\?\.\s*doc_path\s*\?\?\s*null\)\s*:\s*null\}/.test(src),
    "the for_each_phase-branch <DAGCorrectiveTaskGroup> call site must resolve phaseReviewDocPath from iteration.nodes['phase_review'] as a StepNodeState, falling back to null"
  );
  const isPhaseCorrectiveFalseMatches = src.match(/isPhaseCorrective=\{false\}/g) ?? [];
  const phaseReviewDocPathNullMatches = src.match(/phaseReviewDocPath=\{null\}/g) ?? [];
  assert.strictEqual(
    isPhaseCorrectiveFalseMatches.length,
    1,
    `the for_each_task-branch <DAGCorrectiveTaskGroup> call site must hardcode isPhaseCorrective={false} — found ${isPhaseCorrectiveFalseMatches.length}`
  );
  assert.strictEqual(
    phaseReviewDocPathNullMatches.length,
    1,
    `the for_each_task-branch <DAGCorrectiveTaskGroup> call site must hardcode phaseReviewDocPath={null} — found ${phaseReviewDocPathNullMatches.length}`
  );
});

test('dag-iteration-panel.tsx passes showCount={...} to <ProgressBar> so 0/0 tasks is suppressed (DD-3, FR-8)', () => {
  const src = readFileSync(
    join(__dirname, 'dag-iteration-panel.tsx'),
    'utf-8'
  );
  assert.match(
    src,
    /<ProgressBar[\s\S]*?showCount=\{[^}]+\}/,
    '<ProgressBar> in dag-iteration-panel.tsx must receive a showCount prop'
  );
});

test('progress-bar.tsx accepts a showCount prop and suppresses the count span when showCount is false (DD-3)', () => {
  const src = readFileSync(
    join(__dirname, '..', '..', 'components', 'execution', 'progress-bar.tsx'),
    'utf-8'
  );
  // showCount is part of the props interface
  assert.match(
    src,
    /showCount\??:\s*boolean/,
    'ProgressBarProps must declare a showCount?: boolean field'
  );
  // showCount guards the rendering of the {completed}/{total} tasks span
  assert.match(
    src,
    /showCount\s*&&[\s\S]*?\{completed\}\/\{total\}\s*tasks/,
    'progress-bar.tsx must gate the {completed}/{total} tasks span on showCount'
  );
});

test('dag-iteration-panel.tsx ariaLabel ternary does NOT carry a "Phase iteration" branch (dead-code prune)', () => {
  const src = readFileSync(
    join(__dirname, 'dag-iteration-panel.tsx'),
    'utf-8'
  );
  // there must be at most one occurrence of "Phase iteration ${"
  // — namely headerAriaLabel — and zero in the ariaLabel ternary
  const phaseIterPattern = /["`'\s]Phase iteration\s+\$\{/g;
  const hits = src.match(phaseIterPattern) ?? [];
  assert.ok(
    hits.length <= 1,
    `expected at most 1 "Phase iteration \${...}" template hit (headerAriaLabel) — found ${hits.length}; the dead ariaLabel branch was not pruned`
  );
});

console.log("\nDAGIterationPanel — task iteration accordion (P02-T02)\n");

test('dag-iteration-panel.tsx for_each_task branch wraps the task iteration in <AccordionItem value={buildIterationItemValue(parentNodeId, iterationIndex)}> (AD-2, AD-3)', () => {
  // The file now contains TWO AccordionItem invocations (one per parentKind branch).
  // Both must use buildIterationItemValue for the value prop so the hook + renderer
  // identity contract holds for tasks too (AD-3).
  //
  // P02-T01 update: the for_each_task branch hoists the call result into a
  // local `itemValue` const (`const itemValue = buildIterationItemValue(...)`)
  // and then references `value={itemValue}` on the AccordionItem. Accept either
  // the inlined call or the hoisted-const form; the AD-3 contract is that the
  // value identity comes from buildIterationItemValue, not the literal call site.
  const inlined = iterationPanelSource.match(/value=\{buildIterationItemValue\(parentNodeId,\s*iterationIndex\)\}/g) ?? [];
  const hoisted = iterationPanelSource.match(/value=\{itemValue\}/g) ?? [];
  // Confirm the hoisted-const form is in fact buildIterationItemValue (no aliasing of
  // a different helper to the same identifier).
  assert.ok(
    /const\s+itemValue\s*=\s*buildIterationItemValue\(parentNodeId,\s*iterationIndex\)/.test(iterationPanelSource),
    'itemValue (used by the for_each_task <AccordionItem value>) must be hoisted from buildIterationItemValue(parentNodeId, iterationIndex)'
  );
  const total = inlined.length + hoisted.length;
  assert.ok(
    total >= 2,
    `for_each_task branch must also use buildIterationItemValue (inlined or via the hoisted itemValue const) for its <AccordionItem value> — found ${inlined.length} inlined + ${hoisted.length} hoisted = ${total} occurrence(s), expected ≥ 2`
  );
});

test('dag-iteration-panel.tsx for_each_task branch does NOT render <ProgressBar> (FR-9 — task iterations have no progress bar)', () => {
  // ProgressBar is imported and used by the for_each_phase branch only. The for_each_task
  // branch must not introduce a second usage.
  const matches = iterationPanelSource.match(/<ProgressBar\b/g) ?? [];
  assert.strictEqual(
    matches.length,
    1,
    `<ProgressBar> must appear exactly once in dag-iteration-panel.tsx (in the for_each_phase branch only); found ${matches.length} occurrence(s) — task iterations have no progress bar (FR-9)`
  );
});

test('dag-iteration-panel.tsx for_each_task branch renders NodeStatusBadge in its header (DD-1)', () => {
  // After P02-T02, NodeStatusBadge replaces renderStatusIcon. There must be ≥ 2
  // call sites (one per parentKind branch).
  const matches = iterationPanelSource.match(/<NodeStatusBadge/g) ?? [];
  assert.ok(
    matches.length >= 2,
    `<NodeStatusBadge> must be rendered in BOTH parentKind branches — found ${matches.length} occurrence(s), expected ≥ 2 (DD-1)`
  );
});

test('dag-iteration-panel.tsx for_each_task branch keeps Doc / commit links as SIBLINGS of AccordionTrigger (DD-1, no nested interactive controls)', () => {
  // After P02-T02, both <AccordionTrigger> blocks in the file must contain NO
  // <DocumentLink or <ExternalLink usage. The links live in sibling rows.
  const triggerBlocks = [...iterationPanelSource.matchAll(/<AccordionTrigger[\s\S]*?<\/AccordionTrigger>/g)];
  assert.ok(triggerBlocks.length >= 2, `expected ≥ 2 <AccordionTrigger>...</AccordionTrigger> blocks (one per parentKind branch); found ${triggerBlocks.length}`);
  for (const m of triggerBlocks) {
    assert.ok(!/<DocumentLink\b/.test(m[0]), 'no <DocumentLink> may live inside an <AccordionTrigger> (nested interactive control)');
    assert.ok(!/<ExternalLink\b/.test(m[0]), 'no <ExternalLink> may live inside an <AccordionTrigger> (nested interactive control)');
  }
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log("\nDAGIterationPanel — roving-tabindex parity (P02-T03)\n");

test('dag-iteration-panel.tsx wires tabIndex={isFocused ? 0 : -1} on EVERY <AccordionTrigger> (FR-16, AD-5)', () => {
  const triggerBlocks = [...iterationPanelSource.matchAll(/<AccordionTrigger[\s\S]*?>/g)];
  assert.ok(triggerBlocks.length >= 2, 'expected ≥ 2 <AccordionTrigger ...> opening tags');
  for (const m of triggerBlocks) {
    assert.ok(
      /tabIndex=\{isFocused \? 0 : -1\}/.test(m[0]),
      `every <AccordionTrigger> must wire tabIndex={isFocused ? 0 : -1}; missing on tag: ${m[0].slice(0, 120)}...`
    );
  }
});

test('dag-iteration-panel.tsx wires onFocus={handleFocus} on EVERY <AccordionTrigger> (FR-16)', () => {
  const triggerBlocks = [...iterationPanelSource.matchAll(/<AccordionTrigger[\s\S]*?>/g)];
  for (const m of triggerBlocks) {
    assert.ok(
      /onFocus=\{handleFocus\}/.test(m[0]),
      `every <AccordionTrigger> must wire onFocus={handleFocus}; missing on tag: ${m[0].slice(0, 120)}...`
    );
  }
});

test('dag-iteration-panel.tsx data-row-key uses itemValue (the iteration accordion key) so deriveAncestorLoopKeys still walks correctly (AD-5)', () => {
  const matches = iterationPanelSource.match(/data-row-key=\{itemValue\}/g) ?? [];
  assert.ok(
    matches.length >= 2,
    `data-row-key={itemValue} must appear in BOTH parentKind branches — found ${matches.length}`
  );
});

test('dag-iteration-panel.tsx renders <DAGNodeRow> in the for_each_phase branch for non-loop iteration.nodes children (e.g. legacy phase_planning step) (FR-17)', () => {
  // Pre-unify projects carry a synthetic `phase_planning` step inside
  // for_each_phase iteration.nodes. The for_each_phase branch must keep its
  // <DAGNodeRow> fallthrough (one per pre-loop / spine / post-loop bucket)
  // so any direct step / gate / conditional node inside iteration.nodes is
  // not silently dropped.
  //
  // P02-T01 update: the for_each_task branch INTENTIONALLY no longer renders
  // <DAGNodeRow> children for substep nodes (FR-1 / DD-9). Code Review surfaces
  // as a header trailing link (FR-7); other substeps are absorbed into the
  // iteration's badge label (FR-2 / FR-4 / FR-6) rather than into child rows.
  // This test now asserts the post-P02-T01 invariant: phase branch keeps
  // <DAGNodeRow> fallthroughs, task branch has zero.
  const TASK_BRANCH_MARKER = '// for_each_task branch';
  const split = iterationPanelSource.split(TASK_BRANCH_MARKER);
  assert.ok(split.length === 2,
    `expected the for_each_task branch marker comment "${TASK_BRANCH_MARKER}" to split the source exactly once; the test cannot reason about branch coverage without it.`);
  const phaseBranchSource = split[0];
  const taskBranchSource = split[1];
  const phaseMatches = phaseBranchSource.match(/<DAGNodeRow\b/g) ?? [];
  const taskMatches  = taskBranchSource.match(/<DAGNodeRow\b/g) ?? [];
  assert.ok(phaseMatches.length >= 1,
    `for_each_phase branch must contain at least one <DAGNodeRow> fallthrough so non-loop iteration.nodes children (e.g. legacy phase_planning step) are not silently dropped — found ${phaseMatches.length}`);
  assert.strictEqual(taskMatches.length, 0,
    `for_each_task branch must contain ZERO <DAGNodeRow> usages — substep mapping was intentionally dropped by P02-T01 (FR-1 / DD-9); found ${taskMatches.length}`);

  // Sanity: also confirm a phase iteration whose nodes contain a non-loop
  // step is structurally the case the renderer must handle. Mirrors the
  // pre-unify shape carried by legacy completed projects.
  const phaseIterationWithLegacyStep: IterationEntry = {
    index: 0,
    status: 'completed',
    corrective_tasks: [],
    nodes: {
      phase_planning: {
        kind: 'step',
        status: 'completed',
        doc_path: 'plans/PROJ-PHASE-P01.md',
        retries: 0,
      },
    },
    repos: [],
  };
  const phasePlanning = phaseIterationWithLegacyStep.nodes['phase_planning'];
  assert.ok(phasePlanning !== undefined);
  assert.strictEqual(isLoopNode(phasePlanning), false, 'phase_planning is a non-loop step node');
});

const PANEL_SOURCE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'dag-iteration-panel.tsx'),
  'utf8'
);

console.log("\nDAGIterationPanel FR-1/FR-3 source-shape tests\n");

test("AD-1 deriveIterationBadgeLabel is imported", () => {
  assert.ok(/deriveIterationBadgeLabel/.test(PANEL_SOURCE),
    "panel must import deriveIterationBadgeLabel (AD-1)");
});

test("FR-1 panel renders <NodeStatusBadge ...> on the trigger (not the bare hideLabel SpinnerBadge)", () => {
  assert.ok(/<NodeStatusBadge/.test(PANEL_SOURCE),
    "trigger must render NodeStatusBadge (FR-1)");
});

test("DD-1 iconOnly is wired to iteration.status === 'completed'", () => {
  assert.ok(/iteration\.status\s*===\s*['"]completed['"]/.test(PANEL_SOURCE),
    "iconOnly must be conditional on iteration.status === 'completed' (DD-1)");
});

test("renderStatusIcon helper retired", () => {
  assert.ok(!/function renderStatusIcon\b/.test(PANEL_SOURCE),
    "renderStatusIcon helper is replaced by NodeStatusBadge call sites (FR-1)");
});

test("FR-11 phase-iteration DocumentLink label is 'Phase Plan'", () => {
  assert.ok(/label="Phase Plan"/.test(PANEL_SOURCE),
    "phase iteration trigger DocumentLink must be 'Phase Plan' (FR-11)");
});

test("FR-11 task-iteration DocumentLink label is 'Task Handoff', not 'Doc'", () => {
  assert.ok(/label="Task Handoff"/.test(PANEL_SOURCE),
    "task iteration trigger DocumentLink must be 'Task Handoff' (FR-11)");
  assert.ok(!/label="Doc"/.test(PANEL_SOURCE),
    "literal 'Doc' label is forbidden in dag-iteration-panel.tsx (FR-11)");
});

test("FR-15 task-iteration uses CommitChips with repos and compareUrlByRepo props for per-repo rendering", () => {
  // FR-15: single-commit ExternalLink retired in favour of CommitChips.
  // CommitChips receives iteration.repos and compareUrlByRepo to render per-repo chips.
  assert.ok(/<CommitChips/.test(PANEL_SOURCE),
    "panel must render <CommitChips> for per-repo commit attribution (FR-15)");
  assert.ok(/compareUrlByRepo=\{compareUrlByRepo\}/.test(PANEL_SOURCE),
    "panel must forward compareUrlByRepo prop to <CommitChips> (FR-15)");
  assert.ok(/repos=\{iteration\.repos\}/.test(PANEL_SOURCE),
    "panel must forward iteration.repos to <CommitChips> (FR-15)");
});

test("FR-15 task-iteration no longer uses ExternalLink for single-commit rendering", () => {
  // FR-15: per-repo CommitChips replaces the single-commit ExternalLink block.
  assert.ok(!/<ExternalLink\b/.test(PANEL_SOURCE),
    "panel must NOT contain <ExternalLink> — single-commit rendering retired (FR-15)");
});

// ─── P04-T04: Phase iteration body indent + chevron column reservation ────────

console.log("\nDAGIterationPanel — P04-T04 indent wrapper + chevron slot (FR-8, FR-9, DD-5, DD-6)\n");

test("FR-8/DD-5 phase iteration body wraps task list with left padding + left rule", () => {
  // The body container must use both left padding and a left border
  // (border-l) on the body wrapper inside AccordionContent.
  assert.ok(/border-l[^"]*pl-/.test(PANEL_SOURCE) || /pl-[^"]*border-l/.test(PANEL_SOURCE),
    "phase iteration body wrapper must include border-l + pl-* classes (FR-8, DD-5)");
});

test("phase-iteration non-loop step nodes render at phase-level depth (depth={0})", () => {
  // Phase-level rows (e.g. phase_review) must render as <DAGNodeRow> at
  // depth=0 so they align horizontally with the Phase header (px-3),
  // not at ITERATION_CHILD_DEPTH=1 like task rows. Source-shape proxy:
  // the panel must contain at least one DAGNodeRow with depth={0}.
  assert.ok(/depth=\{0\}/.test(PANEL_SOURCE),
    "phase iteration must render at least one DAGNodeRow with depth={0} for phase-level (non-loop) step nodes");
});

test("phase-iteration <DAGCorrectiveTaskGroup> renders OUTSIDE the spine wrapper so the grey spine line bounds task content only", () => {
  // The for_each_phase branch's grey border-l spine wraps only the task loop.
  // The corrective task group renders as a sibling of the spine so its own
  // dashed warning border picks up at the same x-column the grey line stops at,
  // signalling that phase-level corrective tasks belong to the phase, not the tasks.
  // Source-shape proxy: in the for_each_phase branch, the spine wrapper class
  // string and <DAGCorrectiveTaskGroup must not appear inside the same JSX
  // container — i.e. between the spine open and the next `</div>` that closes
  // it, there is no <DAGCorrectiveTaskGroup.
  const TASK_BRANCH_MARKER = '// for_each_task branch';
  const phaseBranch = PANEL_SOURCE.split(TASK_BRANCH_MARKER)[0];
  const spineOpen = phaseBranch.indexOf('border-l border-border pl-3 ml-3');
  assert.ok(spineOpen >= 0, "panel must still contain the spine wrapper class string");
  // Walk to the next occurrence of <DAGCorrectiveTaskGroup in the phase branch.
  // Between spineOpen and that index, ensure we crossed at least one </div>
  // (the spine's closing tag) — i.e. the corrective group is OUTSIDE the spine.
  const ctIndex = phaseBranch.indexOf('<DAGCorrectiveTaskGroup', spineOpen);
  assert.ok(ctIndex >= 0, "for_each_phase branch must still render <DAGCorrectiveTaskGroup>");
  const between = phaseBranch.slice(spineOpen, ctIndex);
  assert.ok(/<\/div>/.test(between),
    "<DAGCorrectiveTaskGroup> must render OUTSIDE the spine wrapper in the for_each_phase branch — found no </div> between the spine open and the corrective group, meaning it's still nested inside the spine.");
});

test("FR-9/DD-6 phase trigger lands the auto-rendered chevron at the row's right edge via Header flex-1", () => {
  // Once the inner wrapper gives the AccordionPrimitive.Header (rendered as <h3>)
  // flex-1 + min-w-0, the trigger button fills the row width and shadcn's
  // ChevronDownIcon lands at the right edge via the
  // [&_data-[slot=accordion-trigger-icon]]:ml-auto rule on AccordionTrigger.
  // No phantom chevron-slot is required.
  assert.ok(/\[&>h3\]:flex-1/.test(PANEL_SOURCE),
    "phase trigger inner wrapper must give Header flex-1 so the auto-chevron lands at the row's right edge (FR-9, DD-6)");
});

// Re-uses readFileSync / fileURLToPath / dirname / join already imported
// at the top of dag-iteration-panel.test.ts (lines 9–11).
const PANEL_SOURCE_P02 = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'dag-iteration-panel.tsx'), 'utf8');

console.log("\nFR-1 / FR-7 / FR-8 / FR-9 / FR-5 — task iteration row simplification\n");

test("FR-1 task iteration AccordionContent no longer renders <DAGNodeRow> children for substep nodes", () => {
  // Source-shape proxy — the for_each_task arm's AccordionContent must
  // not contain a <DAGNodeRow> mapping that walks iteration.nodes; the
  // only allowed mapping inside that arm is <DAGCorrectiveTaskGroup>.
  const taskArmMatch = PANEL_SOURCE_P02.match(/\/\/ for_each_task branch[\s\S]*?<\/Accordion>/);
  assert.ok(taskArmMatch !== null, "for_each_task arm must still exist");
  const taskArm = taskArmMatch[0];
  // The AccordionContent block inside the task arm should contain the
  // corrective group but no <DAGNodeRow> mapping over iteration.nodes.
  assert.ok(/<DAGCorrectiveTaskGroup/.test(taskArm), "corrective group still rendered");
  assert.ok(!/Object\.entries\(iteration\.nodes\)\s*\.filter[\s\S]*?<DAGNodeRow/.test(taskArm),
    "task iteration AccordionContent must no longer map iteration.nodes onto <DAGNodeRow> (FR-1)");
});

test("FR-9/DD-8 task iteration row renders flat (no AccordionItem) when corrective_tasks.length === 0", () => {
  // Source-shape proxy — the task arm must branch on
  // iteration.corrective_tasks.length to choose between the
  // AccordionItem shape and a flat <div> row.
  assert.ok(/iteration\.corrective_tasks\.length\s*===\s*0/.test(PANEL_SOURCE_P02) ||
            /iteration\.corrective_tasks\.length\s*>\s*0/.test(PANEL_SOURCE_P02),
    "task arm must branch on iteration.corrective_tasks.length to gate the chevron (FR-9)");
  // The flat-row branch must preserve data-timeline-row + data-row-key
  // so follow mode keeps working.
  assert.ok(/data-timeline-row[\s\S]*?data-row-key/.test(PANEL_SOURCE_P02),
    "flat row must preserve data-timeline-row + data-row-key for follow mode (DD-8)");
});

test("FR-7/AD-5 task iteration header references iteration.nodes['code_review'].doc_path for the Code Review link", () => {
  assert.ok(/iteration\.nodes\[['"]code_review['"]\][\s\S]*?doc_path/.test(PANEL_SOURCE_P02),
    "task iteration header must read iteration.nodes['code_review'].doc_path for the Code Review link (FR-7, AD-5)");
  assert.ok(/['"]Code Review['"]/.test(PANEL_SOURCE_P02),
    "task iteration header must render a 'Code Review' link label beside Task Handoff (FR-7)");
});

test("FR-8/FR-15 trailing-link slot order on the task header: CommitChips, then Task Handoff, then Code Review", () => {
  // FR-15: single-commit ExternalLink (label="Commit") retired in favour of CommitChips.
  // Trailing slot order is now: CommitChips (per-repo chips) → Task Handoff → Code Review.
  // Verify CommitChips appears in source and the two DocumentLink labels appear in order.
  const commitChipsIdx = PANEL_SOURCE_P02.indexOf('<CommitChips');
  const handoffIdx     = PANEL_SOURCE_P02.indexOf('label="Task Handoff"');
  const reviewIdx      = PANEL_SOURCE_P02.indexOf('label="Code Review"');
  assert.ok(commitChipsIdx !== -1 && handoffIdx !== -1 && reviewIdx !== -1,
    "CommitChips and both trailing DocumentLink labels must be present (FR-15, FR-8, DD-7)");
  assert.ok(commitChipsIdx < handoffIdx && handoffIdx < reviewIdx,
    "trailing-link order must be CommitChips → Task Handoff → Code Review (FR-15, FR-8, DD-7)");
});

test("FR-5/DD-6 task iteration renders 'Corrected' trailing pill when iteration completed AND any corrective resolved", () => {
  // Source-shape proxy — the task arm must check
  // iteration.corrective_tasks.some(ct => ct.status === 'completed')
  // (or equivalent) gated on iteration.status === 'completed' to render
  // a `Corrected` pill with --color-warning styling.
  assert.ok(/Corrected/.test(PANEL_SOURCE_P02),
    "task arm must render the 'Corrected' trailing marker label (FR-5)");
  assert.ok(/--color-warning/.test(PANEL_SOURCE_P02),
    "Corrected marker must reference --color-warning (DD-6, NFR-2)");
  assert.ok(/aria-label=['"]Corrected['"]/.test(PANEL_SOURCE_P02),
    "Corrected marker must carry aria-label='Corrected' (NFR-4)");
});

test("FR-4/FR-6 task arm wires Correcting/Failed cssVar at the call site (--status-failed for both)", () => {
  // The taskStageId mapping must extend with 'Correcting' and 'Failed'
  // labels resolving to a cssVar that is --status-failed (DD-3, DD-4).
  assert.ok(/derivedBadge\.label\s*===\s*['"]Correcting['"][\s\S]*?--status-failed/.test(PANEL_SOURCE_P02) ||
            /label === ['"]Correcting['"][\s\S]*?--status-failed/.test(PANEL_SOURCE_P02) ||
            /Correcting[\s\S]*?cssVar:\s*['"]--status-failed['"]/.test(PANEL_SOURCE_P02),
    "Correcting label must resolve to --status-failed at the call site (FR-4, DD-3, NFR-2)");
  assert.ok(/Failed[\s\S]*?--status-failed/.test(PANEL_SOURCE_P02),
    "Failed label must resolve to --status-failed at the call site (FR-6, DD-4, NFR-2)");
});

test("FR-2 task arm passes 'Coding' (renamed from 'Executing') as the active substep label", () => {
  // taskStageId mapping must include a 'Coding' branch resolving to task_executor.
  assert.ok(/derivedBadge\.label\s*===\s*['"]Coding['"][\s\S]*?task_executor/.test(PANEL_SOURCE_P02) ||
            /label === ['"]Coding['"][\s\S]*?task_executor/.test(PANEL_SOURCE_P02) ||
            /['"]Coding['"][\s\S]*?task_executor/.test(PANEL_SOURCE_P02),
    "task arm must map the 'Coding' label to the task_executor substep (FR-2, DD-1)");
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);

// ─── P04-T03: Footer block removal + verdictPill inline wiring ───────────────

console.log("\nDAGIterationPanel — P04-T03 footer removal + verdictPill (FR-16, AD-8, DD-11)\n");

test("FR-16 phase-iteration body has no border-t footer block", () => {
  // The duplicated footer (border-t + Phase Report/Phase Review links)
  // is removed; verdict surfaces on the phase_review row itself.
  assert.ok(!/border-t pl-2/.test(PANEL_SOURCE),
    "phase iteration footer (border-t pl-2) must be removed (FR-16)");
});

console.log("\nDAGIterationPanel FR-18 legacy-fallback regression assertions\n");

test("FR-18 legacy phase iteration with phase_planning child + no doc_path keeps fallback rendering shape", () => {
  // Source-shape proxy: the panel must read iteration.nodes['phase_planning']
  // as a fallback when iteration.doc_path is null/absent.
  assert.ok(/iteration\.nodes\[['"]phase_planning['"]\]/.test(PANEL_SOURCE),
    "panel must reference iteration.nodes['phase_planning'] for legacy fallback (FR-18)");
});

test("FR-18 legacy task iteration with task_handoff child + no doc_path keeps fallback rendering shape", () => {
  assert.ok(/iteration\.nodes\[['"]task_handoff['"]\]/.test(PANEL_SOURCE),
    "panel must reference iteration.nodes['task_handoff'] for legacy fallback (FR-18)");
});

test("DD-4 italic-fallback class chain still present when both doc_path and legacy node yield null", () => {
  assert.ok(/italic text-muted-foreground/.test(PANEL_SOURCE),
    "italic-fallback iteration name treatment retained (DD-4)");
});

test("FR-18 deriveCurrentPhase still walks legacy phase_planning child", () => {
  // dag-timeline-helpers.ts line 288-290: phase_planning legacy branch
  const helpersSource = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'dag-timeline-helpers.ts'),
    'utf8'
  );
  assert.ok(/phase_planning/.test(helpersSource),
    "deriveCurrentPhase must keep its phase_planning legacy fallback (FR-18)");
});

test("FR-17/DD-13 phase iteration trigger wrapper carries pr-3 gutter", () => {
  // Both phase- and task-iteration trigger wrapper divs (the
  // <div className="...flex items-center gap-2 rounded-md hover:bg-accent/50 ...">)
  // must include the pr-3 gutter token. Match the trailing flex-row class chain
  // with optional leading utilities (e.g. `relative`) so future additive
  // refactors don't churn this assertion.
  const matches = PANEL_SOURCE.match(/className="[^"]*flex items-center gap-2 rounded-md hover:bg-accent\/50[^"]*"/g) ?? [];
  assert.ok(matches.length >= 2, `expected at least 2 trigger wrappers, got ${matches.length}`);
  for (const m of matches) {
    assert.ok(m.includes('pr-3'), `trigger wrapper missing pr-3 gutter: ${m} (FR-17, DD-13)`);
  }
});

// ─── P02-T02: Stage-aware badge wiring (FR-1, FR-3, AD-2, AD-3, AD-4, DD-7) ──

console.log("\nDAGIterationPanel stage-aware badge wiring (FR-1, FR-3, AD-2, AD-3, AD-4, DD-7)\n");

test("AD-2 panel imports resolveStageBadge", () => {
  assert.ok(/resolveStageBadge/.test(PANEL_SOURCE),
    "dag-iteration-panel.tsx must import resolveStageBadge");
});

test("AD-3 deriveIterationBadgeLabel called with explicit parentKind ('for_each_phase')", () => {
  assert.ok(/deriveIterationBadgeLabel\(iteration,\s*['"]for_each_phase['"]\)/.test(PANEL_SOURCE),
    "phase-branch call site must pass 'for_each_phase' as parentKind");
});

test("AD-3 deriveIterationBadgeLabel called with explicit parentKind ('for_each_task')", () => {
  assert.ok(/deriveIterationBadgeLabel\(iteration,\s*['"]for_each_task['"]\)/.test(PANEL_SOURCE),
    "task-branch call site must pass 'for_each_task' as parentKind");
});

test("AD-4 panel passes cssVar to NodeStatusBadge on both phase and task iteration headers", () => {
  const matches = PANEL_SOURCE.match(/<NodeStatusBadge[\s\S]*?cssVar=\{/g);
  assert.ok(matches !== null && matches.length >= 2,
    "both iteration-header NodeStatusBadge instances (phase + task) must pass cssVar");
});

test("FR-12/FR-17 phase_planning no longer maps to --tier-planning (PLANNING_STEP_IDS member dropped)", async () => {
  // FR-12 dropped 'phase_planning' from PLANNING_STEP_IDS; FR-17
  // removed the special phase-arm Planning branch in
  // deriveIterationBadgeLabel. resolveStageBadge('phase_planning', ...)
  // now falls through to STATUS_MAP['in_progress'].
  const { resolveStageBadge } = await import('./dag-timeline-helpers');
  const badge = resolveStageBadge('phase_planning', 'in_progress');
  assert.strictEqual(badge.cssVar, '--status-in-progress');
  assert.strictEqual(badge.label, 'In Progress');
});

const PANEL_SOURCE_P03 = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'dag-iteration-panel.tsx'), 'utf8');

console.log("\nFR-11 phase arm: Planning mapping removed from phaseStageId\n");

test("FR-11/AD-1 phase arm no longer maps 'Planning' label to a stage id (dead branch removed)", () => {
  // The for_each_phase arm's label-to-stage-id ternary must no longer
  // contain a 'Planning' → 'phase_planning' branch — the helper no
  // longer returns 'Planning' from for_each_phase, so the branch is
  // unreachable and should be deleted.
  // Keep the test narrow: only the phase arm's mapping table is in
  // scope; the for_each_task arm has no Planning mapping and isn't
  // relevant here.
  const phaseArmMatch = PANEL_SOURCE_P03.match(/parentKind === ['"]for_each_phase['"][\s\S]*?for_each_task branch/);
  assert.ok(phaseArmMatch !== null, "for_each_phase arm must still exist");
  const phaseArm = phaseArmMatch[0];
  assert.ok(!/derivedBadge\.label\s*===\s*['"]Planning['"]/.test(phaseArm),
    "phase arm must no longer map the 'Planning' label to a stage id (FR-11, AD-1)");
  assert.ok(!/['"]phase_planning['"]/.test(phaseArm.split('phaseStageId')[1] ?? ''),
    "phaseStageId mapping must no longer reference 'phase_planning' (FR-11)");
});

test("FR-11 phase arm 'Executing' mapping still resolves via task_executor or task_loop equivalent", () => {
  const phaseArmMatch = PANEL_SOURCE_P03.match(/parentKind === ['"]for_each_phase['"][\s\S]*?for_each_task branch/);
  assert.ok(phaseArmMatch !== null);
  const phaseArm = phaseArmMatch[0];
  assert.ok(/derivedBadge\.label\s*===\s*['"]Executing['"]/.test(phaseArm),
    "phase arm must still map the 'Executing' label to a stage id (FR-11 preserves Executing)");
});

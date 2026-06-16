/**
 * Tests for DAGCorrectiveTaskGroup component logic.
 * Run with: npx tsx ui/components/dag-timeline/dag-corrective-task-group.test.ts
 *
 * NOTE: Tests use the established .test.ts pattern (no DOM/JSX rendering).
 * Helper functions are exported from dag-corrective-task-group.tsx for testability.
 */
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  buildCorrectiveChildNodeId,
  buildTriggerText,
  GROUP_ARIA_LABEL,
  CORRECTIVE_CHILD_DEPTH,
} from './dag-corrective-task-group';
import { getCommitLinkData, filterCompatibleNodes } from './dag-timeline-helpers';
import {
  stepNode,
  gateNode,
  conditionalNode,
  parallelNode,
  forEachPhaseNode,
  forEachTaskNode,
  baseCorrectiveTask,
} from './__fixtures__';
import type {
  NodeState,
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

console.log("\nDAGCorrectiveTaskGroup logic tests\n");

// buildChildNodeId
test('buildCorrectiveChildNodeId returns "{parentNodeId}.ct{ctIndex}.{childNodeId}"', () => {
  assert.strictEqual(
    buildCorrectiveChildNodeId("task_loop", 1, "task_handoff"),
    "task_loop.ct1.task_handoff"
  );
});

test('buildCorrectiveChildNodeId works with different indices', () => {
  assert.strictEqual(
    buildCorrectiveChildNodeId("phase_loop", 3, "code_review"),
    "phase_loop.ct3.code_review"
  );
});

// getCommitLinkData — with hash
test('commit_hash "abc1234def" produces label "abc1234" (first 7 chars)', () => {
  const result = getCommitLinkData("abc1234def", null);
  assert.ok(result !== null);
  assert.strictEqual(result.label, "abc1234");
});

test('commit_hash "abc1234def" with null repoBaseUrl produces href null', () => {
  const result = getCommitLinkData("abc1234def", null);
  assert.ok(result !== null);
  assert.strictEqual(result.href, null);
});

// getCommitLinkData — null
test('commit_hash null produces null (no commit link)', () => {
  const result = getCommitLinkData(null, null);
  assert.strictEqual(result, null);
});

// filterCompatibleNodes — exclusions
test('node with kind "for_each_phase" is excluded', () => {
  const nodes: Record<string, NodeState> = { loop: forEachPhaseNode };
  const result = filterCompatibleNodes(nodes);
  assert.strictEqual(result.length, 0);
});

test('node with kind "for_each_task" is excluded', () => {
  const nodes: Record<string, NodeState> = { loop: forEachTaskNode };
  const result = filterCompatibleNodes(nodes);
  assert.strictEqual(result.length, 0);
});

// filterCompatibleNodes — inclusions
test('node with kind "step" is included', () => {
  const nodes: Record<string, NodeState> = { task_handoff: stepNode };
  const result = filterCompatibleNodes(nodes);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0][0], 'task_handoff');
});

test('node with kind "gate" is included', () => {
  const nodes: Record<string, NodeState> = { gate_check: gateNode };
  const result = filterCompatibleNodes(nodes);
  assert.strictEqual(result.length, 1);
});

test('node with kind "conditional" is included', () => {
  const nodes: Record<string, NodeState> = { cond: conditionalNode };
  const result = filterCompatibleNodes(nodes);
  assert.strictEqual(result.length, 1);
});

test('node with kind "parallel" is included', () => {
  const nodes: Record<string, NodeState> = { par: parallelNode };
  const result = filterCompatibleNodes(nodes);
  assert.strictEqual(result.length, 1);
});

test('filterCompatibleNodes skips for_each nodes while passing compatible ones', () => {
  const nodes: Record<string, NodeState> = {
    task_handoff: stepNode,
    loop: forEachPhaseNode,
    code_review: gateNode,
    task_loop: forEachTaskNode,
  };
  const result = filterCompatibleNodes(nodes);
  assert.strictEqual(result.length, 2);
  const ids = result.map(([id]) => id);
  assert.ok(ids.includes('task_handoff'));
  assert.ok(ids.includes('code_review'));
});

// aria-label constant
test('GROUP_ARIA_LABEL is "Corrective tasks"', () => {
  assert.strictEqual(GROUP_ARIA_LABEL, "Corrective tasks");
});

// filterCompatibleNodes — empty nodes
test('filterCompatibleNodes returns empty array when nodes is {}', () => {
  const taskWithNoNodes: CorrectiveTaskEntry = { ...baseCorrectiveTask, nodes: {} };
  assert.strictEqual(filterCompatibleNodes(taskWithNoNodes.nodes).length, 0);
});

test('non-empty corrective task nodes are filtered compatibly', () => {
  const taskWithNode: CorrectiveTaskEntry = {
    ...baseCorrectiveTask,
    nodes: {
      task_executor: { kind: 'step', status: 'not_started', doc_path: null, retries: 0 },
    },
  };
  const result = filterCompatibleNodes(taskWithNode.nodes);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0][0], 'task_executor');
});

// buildTriggerText
test('trigger text for index 1 is "Corrective Task 1"', () => {
  assert.strictEqual(buildTriggerText(1), "Corrective Task 1");
});

test('trigger text for index 3 is "Corrective Task 3"', () => {
  assert.strictEqual(buildTriggerText(3), "Corrective Task 3");
});

// Multiple corrective tasks trigger text
test('multiple corrective tasks produce correct trigger text for each', () => {
  const tasks: CorrectiveTaskEntry[] = [
    { ...baseCorrectiveTask, index: 1 },
    { ...baseCorrectiveTask, index: 2 },
    { ...baseCorrectiveTask, index: 3 },
  ];
  const texts = tasks.map((t) => buildTriggerText(t.index));
  assert.deepStrictEqual(texts, ["Corrective Task 1", "Corrective Task 2", "Corrective Task 3"]);
});

// CHILD_DEPTH constant
test('CORRECTIVE_CHILD_DEPTH is 2', () => {
  assert.strictEqual(CORRECTIVE_CHILD_DEPTH, 2);
});

// ─── Doc button rendering (post-unify: entry.doc_path owns the link) ─────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const correctiveTaskGroupSource = readFileSync(join(__dirname, 'dag-corrective-task-group.tsx'), 'utf-8');

test('dag-corrective-task-group.tsx imports DocumentLink from @/components/documents', () => {
  // Post-unify, CorrectiveTaskEntry.doc_path replaces the synthesized task_handoff step node
  // that used to own the Doc button via DAGNodeRow. The group component must import DocumentLink
  // so its accordion header row can render a Doc link off entry.doc_path. DocumentLink renders
  // as a SIBLING of AccordionTrigger (not nested inside it) to avoid invalid nested <button>s.
  assert.ok(
    /import\s+\{[^}]*DocumentLink[^}]*\}\s+from\s+['"]@\/components\/documents['"]/.test(correctiveTaskGroupSource),
    'corrective task group must import DocumentLink so the accordion header row can render a Doc link when entry.doc_path resolves'
  );
});

test('dag-corrective-task-group.tsx renders a <DocumentLink path={entry.doc_path} label="Task Handoff" onDocClick={onDocClick} /> in the accordion header row', () => {
  // Mirrors the iteration-panel pattern (dag-iteration-panel.tsx:132-138): post-unify corrective
  // handoff docs are carried on CorrectiveTaskEntry.doc_path and entry.nodes can be empty, so
  // the group component itself must render the Task Handoff button off entry.doc_path to keep
  // corrective handoffs accessible from the timeline now that the synthetic task_handoff step node
  // is gone. Label is "Task Handoff" (matching regular task iterations) so the corrective task
  // handoff doc is presented identically to a normal task handoff (FR-11).
  assert.ok(
    correctiveTaskGroupSource.includes('<DocumentLink'),
    'corrective task group must render <DocumentLink> for the corrective task\'s doc link'
  );
  assert.ok(
    /<DocumentLink\s+path=\{entry\.doc_path!?\}/.test(correctiveTaskGroupSource),
    '<DocumentLink> path prop must be entry.doc_path (the new CorrectiveTaskEntry.doc_path field). Trailing `!` non-null assertion accepted when callsite is gated on a hasHandoff boolean derived from entry.doc_path.'
  );
  assert.ok(
    /<DocumentLink[^/]*label="Task Handoff"/.test(correctiveTaskGroupSource),
    '<DocumentLink> label prop must be "Task Handoff" so corrective task handoff docs share the same label as normal task handoffs (FR-11)'
  );
  assert.ok(
    /<DocumentLink[^/]*onDocClick=\{onDocClick\}/.test(correctiveTaskGroupSource),
    '<DocumentLink> must forward the onDocClick prop plumbed through to the corrective task group'
  );
});

test('dag-corrective-task-group.tsx gates <DocumentLink> on entry.doc_path (no render when null/empty)', () => {
  // Gate expression mirrors dag-iteration-panel.tsx exactly:
  //   entry.doc_path != null && entry.doc_path !== ''
  // No render when doc_path is absent — a completed-without-handoff-doc corrective task would
  // show an empty Doc button otherwise. The gate may be hoisted into a `hasHandoff` boolean
  // and reused at the JSX site — accept either inline or hoisted form.
  assert.ok(
    /hasHandoff\s*=\s*entry\.doc_path\s*!=\s*null/.test(correctiveTaskGroupSource)
      || /entry\.doc_path\s*!=\s*null\s*&&\s*entry\.doc_path\s*!==\s*''/.test(correctiveTaskGroupSource),
    'DocumentLink must be gated on `entry.doc_path != null && entry.doc_path !== \'\'` so corrective tasks without a handoff doc do not render an empty Doc button. Gate may be hoisted into a hasHandoff boolean.'
  );
});

test('dag-corrective-task-group.tsx <DocumentLink> does NOT pass tabIndex (keyboard accessibility — default tab order required)', () => {
  // The AccordionTrigger consumes Enter/Space to expand/collapse the corrective task panel.
  // If DocumentLink were tabIndex={-1} (as DAGNodeRow uses internally to preserve roving
  // tabindex), a keyboard-only user would have NO path to open the corrective handoff doc.
  // Same rationale as dag-iteration-panel.tsx — header-level DocumentLinks must use default
  // tab order.
  const docLinkMatch = correctiveTaskGroupSource.match(/<DocumentLink\b[^>]*\/>/);
  assert.ok(docLinkMatch, 'corrective task group must contain a self-closing <DocumentLink ... /> element');
  assert.ok(
    !/tabIndex\s*=/.test(docLinkMatch[0]),
    '<DocumentLink> in the corrective accordion header row must NOT pass tabIndex — the AccordionTrigger consumes Enter/Space so a keyboard user must reach the Doc link via natural tab order'
  );
});

test('dag-corrective-task-group.tsx uses CommitChips for per-repo commit rendering, not ExternalLink (FR-15)', () => {
  // FR-15: single-commit ExternalLink has been retired in favour of CommitChips so corrective
  // tasks get the same per-repo attribution as regular task iterations. ExternalLink must no
  // longer appear in the source; CommitChips must be imported and used.
  assert.ok(
    !/<ExternalLink\b/.test(correctiveTaskGroupSource),
    'corrective task group must NOT contain <ExternalLink> — commit rendering is now solely CommitChips (FR-15)'
  );
  assert.ok(
    /CommitChips/.test(correctiveTaskGroupSource),
    'corrective task group must import and render CommitChips for per-repo commit attribution (FR-15)'
  );
});

test('dag-corrective-task-group.tsx <AccordionTrigger> className contains w-full (full-band clickable area, regression guard for Copilot R11)', () => {
  // Post-R6 the Doc/commit links moved to sibling positions outside the trigger, which required
  // a flex-1 wrapper <div> around the trigger so the Trigger's inner <button> no longer spans
  // the full row width on its own. Without `w-full`, the <button>'s click target collapses to
  // its content's intrinsic width — clicking the padded whitespace to the right of the status
  // badge (but still inside the flex-1 column) would no longer toggle the accordion. This is
  // the UX/a11y regression Copilot R11 flagged. Guard the className so a future edit doesn't
  // silently re-introduce the narrow-trigger bug.
  const triggerMatch = correctiveTaskGroupSource.match(/<AccordionTrigger\b[^>]*>/);
  assert.ok(triggerMatch, 'corrective task group must contain an <AccordionTrigger> element');
  assert.ok(
    /className="[^"]*\bw-full\b[^"]*"/.test(triggerMatch[0]),
    '<AccordionTrigger> className must contain `w-full` so the trigger <button> fills its flex-1 wrapper (Copilot R11 regression guard)'
  );
  assert.ok(
    /className="[^"]*\bpy-2\b[^"]*"/.test(triggerMatch[0]),
    '<AccordionTrigger> className must carry vertical padding (`py-2`) so the click/focus band matches the pre-R6 full-row size (Copilot R11 regression guard)'
  );
});

test('dag-corrective-task-group.tsx <DocumentLink> renders OUTSIDE <AccordionTrigger> (no nested interactive controls)', () => {
  // AccordionTrigger renders AccordionPrimitive.Trigger, which is a <button>.
  // DocumentLink renders a <button>. Nesting <button> inside <button> is invalid HTML
  // and breaks click/keyboard behavior (the inner click bubbles and toggles the accordion,
  // ARIA/focus is undefined). The Doc link MUST be a sibling of AccordionTrigger, not a
  // child. Enforce the invariant by scanning every AccordionTrigger span in the source
  // and asserting <DocumentLink appears in NONE of them.
  //
  // Approach: split the source on </AccordionTrigger>. Each segment except the last ends
  // with a trigger's body; within each such segment find the nearest preceding
  // <AccordionTrigger and check the body between them for <DocumentLink.
  const segments = correctiveTaskGroupSource.split('</AccordionTrigger>');
  // Skip the final segment — it is the tail after the last closing tag (no matching open).
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    const openIdx = seg.lastIndexOf('<AccordionTrigger');
    assert.ok(openIdx >= 0, `segment ${i} missing matching <AccordionTrigger open tag`);
    const triggerBody = seg.slice(openIdx);
    assert.ok(
      !/<DocumentLink\b/.test(triggerBody),
      `<DocumentLink> must NOT render inside <AccordionTrigger> — invalid nested <button> breaks HTML + click/keyboard (Copilot R6). Found inside AccordionTrigger segment ${i}.`
    );
    assert.ok(
      !/<ExternalLink\b/.test(triggerBody),
      `<ExternalLink> must NOT render inside <AccordionTrigger> — invalid nested <a> inside <button> breaks HTML + click/keyboard (Copilot R6). Found inside AccordionTrigger segment ${i}.`
    );
  }
});

// ─── v4 header parity (P03-T02) ──────────────────────────────────────────────

const ctgSource = readFileSync(join(__dirname, 'dag-corrective-task-group.tsx'), 'utf-8');

console.log("\nDAGCorrectiveTaskGroup — v4 header parity (P03-T02)\n");

test('dag-corrective-task-group.tsx wires <Accordion ... value={expandedCorrectiveIds} onValueChange={onAccordionChange} multiple> (DD-7, AD-3)', () => {
  // The corrective accordion now participates in the same controlled
  // expansion set as the iteration accordions so DD-7 (additive
  // auto-expansion) works.
  assert.ok(
    /<Accordion\b[^>]*\bmultiple\b[^>]*value=\{expandedLoopIds\}[^>]*onValueChange=\{onAccordionChange\}/.test(ctgSource)
    || /<Accordion\b[^>]*value=\{expandedLoopIds\}[^>]*onValueChange=\{onAccordionChange\}[^>]*\bmultiple\b/.test(ctgSource),
    '<Accordion> in dag-corrective-task-group.tsx must be controlled (value, onValueChange) and multi-open so DD-7 additive expansion works'
  );
});

test('dag-corrective-task-group.tsx <AccordionItem value> uses buildCorrectiveItemValue(parentIterationKey, entry.index) (AD-3 hook+renderer parity)', () => {
  assert.ok(
    /<AccordionItem\b[^>]*value=\{buildCorrectiveItemValue\(parentIterationKey,\s*entry\.index\)\}/.test(ctgSource),
    '<AccordionItem value> must come from buildCorrectiveItemValue so the same key produced by useFollowMode also opens the accordion (AD-3)'
  );
});

test('dag-corrective-task-group.tsx renders the icon-only NodeStatusBadge in each header (DD-1)', () => {
  assert.ok(
    /NodeStatusBadge[\s\S]{0,400}iconOnly/.test(ctgSource),
    'corrective task header must render the icon-only NodeStatusBadge for visual parity with iteration headers (DD-1, FR-6)'
  );
});

test('dag-corrective-task-group.tsx <AccordionTrigger> wires role="option", data-timeline-row, data-row-key={itemValue}, tabIndex={isFocused ? 0 : -1}, onFocus={handleFocus} (AD-5, FR-16)', () => {
  assert.ok(/role="option"/.test(ctgSource));
  assert.ok(/data-timeline-row/.test(ctgSource));
  assert.ok(/data-row-key=\{itemValue\}/.test(ctgSource));
  assert.ok(/tabIndex=\{isFocused \? 0 : -1\}/.test(ctgSource));
  assert.ok(/onFocus=\{handleFocus\}/.test(ctgSource));
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);

import { readFileSync as cgReadSync } from 'node:fs';
import { fileURLToPath as cgFileURL } from 'node:url';
import { dirname as cgDirname, join as cgJoin } from 'node:path';

const CG_SOURCE = cgReadSync(
  cgJoin(cgDirname(cgFileURL(import.meta.url)), 'dag-corrective-task-group.tsx'),
  'utf8'
);

console.log("\nDAGCorrectiveTaskGroup FR-1 source-shape tests\n");

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

test4("FR-1 corrective trigger uses NodeStatusBadge (labeled)", () => {
  assert.ok(/<NodeStatusBadge/.test(CG_SOURCE),
    "corrective trigger must render NodeStatusBadge (FR-1)");
});

test4("DD-1 corrective iconOnly wired to entry.status === 'completed'", () => {
  assert.ok(/entry\.status\s*===\s*['"]completed['"]/.test(CG_SOURCE),
    "corrective trigger iconOnly conditional on completed (DD-1)");
});

test4("FR-1 hideLabel SpinnerBadge no longer rendered on corrective trigger", () => {
  // The trigger render (between AccordionTrigger open and close) must not
  // pass a literal hideLabel attribute on a SpinnerBadge.
  assert.ok(!/<SpinnerBadge[\s\S]*?hideLabel[\s\S]*?\/>/.test(CG_SOURCE),
    "no SpinnerBadge … hideLabel on corrective trigger (FR-1)");
});

test4("FR-11 corrective DocumentLink label is 'Task Handoff', not 'Doc'", () => {
  assert.ok(/label="Task Handoff"/.test(CG_SOURCE),
    "corrective DocumentLink label must be 'Task Handoff' to match regular task iterations (FR-11)");
  assert.ok(!/label="Doc"/.test(CG_SOURCE),
    "literal 'Doc' label is forbidden on corrective DocumentLink (FR-11)");
});

test("FR-15 corrective row uses CommitChips with compareUrlByRepo for per-repo commit rendering", () => {
  // FR-15: single-commit ExternalLink retired in favour of CommitChips.
  // CommitChips receives entry.repos and compareUrlByRepo to render per-repo chips.
  assert.ok(/<CommitChips/.test(CG_SOURCE),
    "corrective row must render <CommitChips> for per-repo commit attribution (FR-15)");
  assert.ok(/compareUrlByRepo=\{compareUrlByRepo\}/.test(CG_SOURCE),
    "corrective row must forward compareUrlByRepo prop to <CommitChips> (FR-15)");
  assert.ok(/repos=\{entry\.repos\}/.test(CG_SOURCE),
    "corrective row must forward entry.repos to <CommitChips> (FR-15)");
});

test("FR-15 corrective row no longer uses ExternalLink for single-commit rendering", () => {
  // FR-15: per-repo CommitChips replaces the single-commit ExternalLink block.
  assert.ok(!/<ExternalLink\b/.test(CG_SOURCE),
    "corrective row must NOT contain <ExternalLink> — single-commit rendering retired (FR-15)");
});

test("FR-17/DD-13 corrective trigger wrapper carries pr-3 gutter", () => {
  // Match the trailing flex-row class chain with optional leading utilities
  // (e.g. `relative`) so future additive refactors don't churn this assertion.
  const match = CG_SOURCE.match(/className="[^"]*flex items-center gap-2 rounded-md hover:bg-accent\/50[^"]*"/);
  assert.ok(match !== null, "corrective trigger wrapper missing");
  assert.ok(match[0].includes('pr-3'),
    `corrective trigger wrapper missing pr-3 gutter: ${match[0]} (FR-17, DD-13)`);
});

const __dirname_ct = dirname(fileURLToPath(import.meta.url));
const CT_SOURCE = readFileSync(join(__dirname_ct, 'dag-corrective-task-group.tsx'), 'utf8');

console.log("\nFR-10 / FR-1 / FR-7 / FR-8 / FR-9 / FR-5 — corrective task row recursion\n");

test4("FR-1/FR-10 corrective row AccordionContent no longer maps entry.nodes onto <DAGNodeRow>", () => {
  // Source-shape proxy — CorrectiveRow's AccordionContent must not
  // contain a compatibleNodes.map onto <DAGNodeRow>.
  assert.ok(!/compatibleNodes\.map\([\s\S]*?<DAGNodeRow/.test(CT_SOURCE),
    "CorrectiveRow must no longer render <DAGNodeRow> children for entry.nodes substeps (FR-1, FR-10)");
});

test4("FR-9/FR-10/DD-8 corrective row renders flat (no AccordionItem) when entry.corrective_tasks.length === 0", () => {
  assert.ok(/entry\.corrective_tasks\.length\s*===\s*0/.test(CT_SOURCE) ||
            /entry\.corrective_tasks\.length\s*>\s*0/.test(CT_SOURCE),
    "CorrectiveRow must branch on entry.corrective_tasks.length to gate the chevron (FR-9, FR-10)");
});

test4("FR-7/FR-10/AD-5 corrective row references entry.nodes['code_review'].doc_path for the Code Review link", () => {
  assert.ok(/entry\.nodes\[['"]code_review['"]\][\s\S]*?doc_path/.test(CT_SOURCE),
    "CorrectiveRow must read entry.nodes['code_review'].doc_path for its own Code Review link (FR-7, FR-8, AD-5)");
  assert.ok(/['"]Code Review['"]/.test(CT_SOURCE),
    "CorrectiveRow must render a 'Code Review' link label (FR-7, FR-10)");
});

test4("FR-8/FR-10/DD-7/FR-15 corrective row trailing-link slot order: CommitChips → Task Handoff → Code Review", () => {
  // FR-15: single-commit ExternalLink (label="Commit") retired in favour of CommitChips.
  // Trailing slot order is now: CommitChips (per-repo chips) → Task Handoff → Code Review.
  // Verify CommitChips is present and the two DocumentLink labels appear in order.
  const commitChipsIdx = CT_SOURCE.indexOf('<CommitChips');
  const handoffIdx     = CT_SOURCE.indexOf('label="Task Handoff"');
  const reviewIdx      = CT_SOURCE.indexOf('label="Code Review"');
  assert.ok(commitChipsIdx !== -1 && handoffIdx !== -1 && reviewIdx !== -1,
    "CommitChips and both trailing DocumentLink labels must be present (FR-15, FR-8, DD-7)");
  assert.ok(commitChipsIdx < handoffIdx && handoffIdx < reviewIdx,
    "trailing-link order must be CommitChips → Task Handoff → Code Review (FR-15, FR-8, DD-7)");
});

test4("FR-5/FR-10/DD-6 corrective row renders 'Corrected' trailing pill when entry recovered from nested correctives", () => {
  assert.ok(/Corrected/.test(CT_SOURCE),
    "CorrectiveRow must render the 'Corrected' trailing marker label when nested correctives resolved (FR-5, FR-10)");
  assert.ok(/--color-warning/.test(CT_SOURCE),
    "Corrected marker must reference --color-warning (DD-6, NFR-2)");
  assert.ok(/aria-label=['"]Corrected['"]/.test(CT_SOURCE),
    "Corrected marker must carry aria-label='Corrected' (NFR-4)");
});

test4("FR-2/FR-4/FR-6/FR-10 corrective row badge resolves Coding/Correcting/Failed labels at the same vocabulary as task iterations", () => {
  // CorrectiveRow today builds its badge via NodeStatusBadge with
  // status=entry.status (no label override). Under FR-10, it must use
  // deriveIterationBadgeLabel on a synthetic IterationEntry shape so
  // the label vocabulary matches.
  assert.ok(/deriveIterationBadgeLabel/.test(CT_SOURCE),
    "CorrectiveRow must derive its label via deriveIterationBadgeLabel for FR-10 vocabulary parity");
});

test4("NFR-3 P02-T02 source-shape tests run under the test4 helper so failed4 > 0 fails the suite", () => {
  // Source-shape proxy — the six P02-T02 source-shape assertions
  // (FR-1/FR-10, FR-9/FR-10/DD-8, FR-7/FR-10/AD-5, FR-8/FR-10/DD-7,
  // FR-5/FR-10/DD-6, FR-2/FR-4/FR-6/FR-10) must call test4(...) so
  // they increment failed4 (guarded at line 495) rather than failed
  // (guarded at line 364, before the block runs).
  const SELF_SOURCE = readFileSync(__filename, 'utf8');
  const labels = [
    'FR-1/FR-10 corrective row AccordionContent no longer maps entry.nodes onto <DAGNodeRow>',
    "FR-9/FR-10/DD-8 corrective row renders flat (no AccordionItem) when entry.corrective_tasks.length === 0",
    "FR-7/FR-10/AD-5 corrective row references entry.nodes['code_review'].doc_path for the Code Review link",
    'FR-8/FR-10/DD-7/FR-15 corrective row trailing-link slot order: CommitChips → Task Handoff → Code Review',
    "FR-5/FR-10/DD-6 corrective row renders 'Corrected' trailing pill when entry recovered from nested correctives",
    'FR-2/FR-4/FR-6/FR-10 corrective row badge resolves Coding/Correcting/Failed labels at the same vocabulary as task iterations',
  ];
  for (const label of labels) {
    // Each label must be invoked via test4(...) — the only helper
    // whose counter is guarded by the surviving exit check.
    const escaped = label.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
    const re = new RegExp(`test4\\(\\s*["\`']${escaped}["\`']`);
    assert.ok(re.test(SELF_SOURCE),
      `P02-T02 source-shape test \`${label}\` must call test4(...) (currently calling test(...) — failures would not exit non-zero)`);
  }
});

console.log(`\n${passed4} passed, ${failed4} failed\n`);
if (failed4 > 0) process.exit(1);

/**
 * Tests for DAGFinalReviewPanel component logic.
 * Run with: npx tsx ui/components/dag-timeline/dag-final-review-panel.test.ts
 *
 * NOTE: Tests use the established .test.ts pattern (no DOM/JSX rendering) —
 * mirrors dag-corrective-task-group.test.ts / dag-iteration-panel.test.ts.
 */
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { deriveCorrectiveHostBadge, buildCorrectiveItemValue } from './dag-timeline-helpers';
import { deriveAccordionFallbackKeys } from './dag-timeline';
import { baseCorrectiveTask } from './__fixtures__';
import type { CorrectiveTaskEntry } from '@/types/state';

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

console.log("\nDAGFinalReviewPanel logic tests\n");

// ─── Zero / one / several correctives — badge + group-render gate ───────────

function ct(overrides: Partial<CorrectiveTaskEntry> = {}): CorrectiveTaskEntry {
  return { ...baseCorrectiveTask, ...overrides };
}

test("zero correctives: badge reads the plain stage label ('Reviewing'), same as today's row", () => {
  const badge = deriveCorrectiveHostBadge('final_review', 'in_progress', []);
  assert.deepStrictEqual(badge, { status: 'in_progress', label: 'Reviewing', cssVar: '--tier-review' });
});

test("one in-flight corrective: badge reads 'Correcting' / --status-failed", () => {
  const badge = deriveCorrectiveHostBadge('final_review', 'in_progress', [ct({ index: 1, status: 'in_progress' })]);
  assert.deepStrictEqual(badge, { status: 'in_progress', label: 'Correcting', cssVar: '--status-failed' });
});

test("several correctives with the latest in flight: badge still reads 'Correcting'", () => {
  const badge = deriveCorrectiveHostBadge('final_review', 'in_progress', [
    ct({ index: 1, status: 'completed' }),
    ct({ index: 2, status: 'in_progress' }),
  ]);
  assert.deepStrictEqual(badge, { status: 'in_progress', label: 'Correcting', cssVar: '--status-failed' });
});

// ─── Corrective row key shape at final scope ─────────────────────────────────

test("buildCorrectiveItemValue('final_review', 1) === 'ct-final_review-1' (parentIterationKey is the node id itself)", () => {
  assert.strictEqual(buildCorrectiveItemValue('final_review', 1), 'ct-final_review-1');
});

test("deriveAccordionFallbackKeys('ct-final_review-1') degrades cleanly — falls back to the node id itself, not a phantom iter- key", () => {
  // final_review has no enclosing iteration, so the unwrap must not invent
  // an 'iter-...' ancestor: it should resolve to ['final_review'] (the row's
  // own data-row-key), which the focus-recovery effect can still match.
  const result = deriveAccordionFallbackKeys('ct-final_review-1');
  assert.deepStrictEqual(result, ['final_review']);
});

// ─── Source-shape: row chrome mirrors DAGNodeRow's contract ──────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PANEL_SOURCE = readFileSync(join(__dirname, 'dag-final-review-panel.tsx'), 'utf-8');
const NODE_ROW_SOURCE = readFileSync(join(__dirname, 'dag-node-row.tsx'), 'utf-8');

test("dag-final-review-panel.tsx row wires role=\"option\", aria-selected={isActive}, tabIndex={isFocused ? 0 : -1}, data-timeline-row, data-row-key={nodeId}", () => {
  assert.ok(/role="option"/.test(PANEL_SOURCE));
  assert.ok(/aria-selected=\{isActive\}/.test(PANEL_SOURCE));
  assert.ok(/tabIndex=\{isFocused \? 0 : -1\}/.test(PANEL_SOURCE));
  assert.ok(/data-timeline-row/.test(PANEL_SOURCE));
  assert.ok(/data-row-key=\{nodeId\}/.test(PANEL_SOURCE));
});

test("dag-final-review-panel.tsx row carries aria-label naming the row and its resolved badge label", () => {
  assert.ok(
    /aria-label=\{`\$\{getDisplayName\(nodeId\)\} — \$\{resolvedBadge\.label\}`\}/.test(PANEL_SOURCE),
    'row aria-label must name the row (getDisplayName) and its resolved status (resolvedBadge.label)'
  );
});

test("dag-final-review-panel.tsx row carries aria-current={isActive ? 'step' : undefined}", () => {
  assert.ok(/aria-current=\{isActive \? ['"]step['"] : undefined\}/.test(PANEL_SOURCE));
});

test("dag-final-review-panel.tsx derives its badge via deriveCorrectiveHostBadge, not resolveStageBadge directly or deriveIterationBadgeLabel", () => {
  assert.ok(/deriveCorrectiveHostBadge\(nodeId,\s*node\.status,\s*correctiveTasks\)/.test(PANEL_SOURCE));
  assert.ok(!/deriveIterationBadgeLabel/.test(PANEL_SOURCE),
    'the panel is not an iteration — it must not call deriveIterationBadgeLabel');
});

test("dag-final-review-panel.tsx Enter/Space opens the doc via onDocClick(node.doc_path)", () => {
  const keydownMatch = PANEL_SOURCE.match(/handleKeyDown[\s\S]*?\}, \[[^\]]*\]\);/);
  assert.ok(keydownMatch !== null, 'panel must define a handleKeyDown callback');
  const body = keydownMatch[0];
  assert.ok(/event\.key !== 'Enter' && event\.key !== ' '/.test(body) || /event\.key !== "Enter" && event\.key !== " "/.test(body),
    'handleKeyDown must gate on Enter/Space');
  assert.ok(/onDocClick\(node\.doc_path\)/.test(body), 'handleKeyDown must call onDocClick(node.doc_path)');
});

test("dag-final-review-panel.tsx reuses NodeStatusBadge, DocumentLink, getDisplayName, getDocLinkLabel (no re-implementation)", () => {
  assert.ok(/import\s+\{\s*NodeStatusBadge\s*\}\s+from\s+['"]\.\/node-status-badge['"]/.test(PANEL_SOURCE));
  assert.ok(/import\s+\{\s*DocumentLink\s*\}\s+from\s+['"]@\/components\/documents['"]/.test(PANEL_SOURCE));
  assert.ok(/getDisplayName/.test(PANEL_SOURCE));
  assert.ok(/getDocLinkLabel/.test(PANEL_SOURCE));
});

test("dag-final-review-panel.tsx renders at most one <DocumentLink> in the row (the report link) — no handoff link at final scope", () => {
  const matches = PANEL_SOURCE.match(/<DocumentLink\b/g) ?? [];
  assert.strictEqual(matches.length, 1, `expected exactly one <DocumentLink> on the row itself, got ${matches.length}`);
});

test("dag-final-review-panel.tsx does NOT render an ExecutePlanButton or ExternalLink (final_review is a step, not a gate)", () => {
  assert.ok(!/ExecutePlanButton/.test(PANEL_SOURCE));
  assert.ok(!/ExternalLink/.test(PANEL_SOURCE));
});

test("dag-final-review-panel.tsx does NOT wrap the row in its own Accordion — correctives are always visible, no collapse at this scope", () => {
  assert.ok(!/<Accordion\b/.test(PANEL_SOURCE), 'the panel itself must not introduce a collapsible wrapper around the row + corrective group');
});

test("dag-final-review-panel.tsx row className matches DAGNodeRow's row chrome (zero-corrective parity)", () => {
  const rowClassMatch = PANEL_SOURCE.match(/className=\{cn\(\s*'py-2 pr-3 rounded-md gap-2 flex items-center hover:bg-accent\/50',/);
  assert.ok(rowClassMatch !== null, 'row must reuse the same base row classes DAGNodeRow uses');
  assert.ok(
    NODE_ROW_SOURCE.includes("'py-2 pr-3 rounded-md gap-2 flex items-center hover:bg-accent/50',"),
    'sanity: DAGNodeRow must still carry the class string being mirrored'
  );
});

// ─── Source-shape: corrective group wiring (zero / non-zero correctives) ────

test("dag-final-review-panel.tsx renders <DAGCorrectiveTaskGroup> only when correctiveTasks.length > 0 (zero-corrective parity — no empty dashed group)", () => {
  assert.ok(
    /correctiveTasks\.length > 0[\s\S]{0,40}<DAGCorrectiveTaskGroup/.test(PANEL_SOURCE),
    'the corrective group must be gated on correctiveTasks.length > 0'
  );
});

test("dag-final-review-panel.tsx wires parentIterationKey={nodeId} and parentNodeId={nodeId} (no enclosing iteration at final scope)", () => {
  assert.ok(/parentIterationKey=\{nodeId\}/.test(PANEL_SOURCE));
  assert.ok(/parentNodeId=\{nodeId\}/.test(PANEL_SOURCE));
});

test("dag-final-review-panel.tsx wires correctiveScope=\"final\" and phaseReviewDocPath={node.doc_path}", () => {
  assert.ok(/correctiveScope="final"/.test(PANEL_SOURCE));
  assert.ok(/phaseReviewDocPath=\{node\.doc_path\}/.test(PANEL_SOURCE));
});

test("dag-final-review-panel.tsx forwards state={state} to <DAGCorrectiveTaskGroup>", () => {
  assert.ok(/state=\{state\}/.test(PANEL_SOURCE));
});

test("dag-final-review-panel.tsx resolves budgetOrigin from the step's own corrective_budget_origin, not a hardcoded 0", () => {
  // Unlike an iteration host (always budgetOrigin=0), a step host like
  // final_review can accumulate a non-zero corrective_budget_origin as
  // review windows close — the panel must read it off the node, not
  // hardcode 0 (that hardcoding is only correct for iteration hosts,
  // wired explicitly in dag-iteration-panel.tsx).
  assert.ok(
    /budgetOrigin=\{node\.corrective_budget_origin\s*\?\?\s*0\}/.test(PANEL_SOURCE),
    'budgetOrigin must resolve from node.corrective_budget_origin, falling back to 0 only when absent'
  );
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);

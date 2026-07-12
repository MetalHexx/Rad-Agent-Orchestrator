import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { deriveVerdictTone, finalReviewView } from './final-review-view';
import { resolveStateView } from '../resolver';
import type { StateViewContext } from '../types';
import type { AnyProjectState, NodesRecord } from '@/types/state';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).React = React;

const dir = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(dir, 'final-review-view.tsx'), 'utf-8');

function makeState(verdict: string | null, docPath: string | null, prUrl: string | null): AnyProjectState {
  const nodes: NodesRecord = {
    final_review: { kind: 'step', status: 'in_progress', doc_path: docPath, retries: 0, verdict },
  };
  return {
    $schema: 'orchestration-state-v5',
    project: { name: 'demo', created: '2026-01-01', updated: '2026-01-01' },
    config: {
      gate_mode: 'task',
      limits: { max_phases: 3, max_tasks_per_phase: 3, max_retries_per_task: 2 },
      source_control: { auto_commit: 'never', auto_pr: 'never' },
    },
    pipeline: {
      gate_mode: 'task',
      source_control: prUrl === null
        ? null
        : { worktree_path: '/tmp/demo', auto_commit: 'never', auto_pr: 'never', repos: [{ name: 'api', branch: 'b', base_branch: 'main', remote_url: null, compare_url: null, pr_url: prUrl }] },
      current_tier: 'review',
      halt_reason: null,
    },
    graph: { template_id: 'std', status: 'in_progress', current_node_path: 'final_review', nodes },
  };
}

// ─── deriveVerdictTone ────────────────────────────────────────────────────────

test('deriveVerdictTone maps "approved" to a green "Review Passed" ring label + detail sentence', () => {
  const tone = deriveVerdictTone('approved');
  assert.equal(tone.label, 'Review Passed');
  assert.equal(tone.detail, 'The reviewer approved the work.');
  assert.equal(tone.cssVar, '--verdict-approved');
});

test('deriveVerdictTone maps "changes_requested" to a short "Needs Work" ring label + an issues detail sentence', () => {
  const tone = deriveVerdictTone('changes_requested');
  assert.equal(tone.label, 'Needs Work');
  assert.equal(tone.detail, 'The reviewer found issues.');
  assert.equal(tone.cssVar, '--verdict-changes-requested');
});

test('deriveVerdictTone maps "rejected" to the rejected tone', () => {
  const tone = deriveVerdictTone('rejected');
  assert.equal(tone.label, 'Rejected');
  assert.equal(tone.detail, 'The reviewer rejected the work.');
  assert.equal(tone.cssVar, '--verdict-rejected');
});

test('deriveVerdictTone falls back safely on an unrecognized verdict string', () => {
  const tone = deriveVerdictTone('some-future-verdict');
  assert.equal(tone.label, 'some-future-verdict');
  assert.equal(tone.detail, 'Review complete.');
  assert.equal(tone.cssVar, '--status-not-started');
});

test('deriveVerdictTone maps a null verdict (not yet reviewed) to the in-progress "Final Review" tone', () => {
  const tone = deriveVerdictTone(null);
  assert.equal(tone.label, 'Final Review');
  assert.equal(tone.detail, 'Review in progress.');
  assert.equal(tone.cssVar, '--tier-review');
});

// ─── source shape ─────────────────────────────────────────────────────────────

test('final review view id is "final-review"', () => {
  assert.equal(finalReviewView.id, 'final-review');
});

test('final review view plots whole-graph progress (the run-wide milestone position)', () => {
  assert.match(source, /deriveRingArc\(ctx\.wholeGraphProgress\)/);
});

test('final review view renders a determinate ring tinted to the verdict color with the short verdict label as its sublabel', () => {
  assert.match(source, /mode="determinate"/);
  // The ring (and the control icons) are tinted to the verdict tone, not a fixed
  // tier — green when passed, amber when it needs work, red when rejected.
  assert.match(source, /color=\{`var\(\$\{tone\.cssVar\}\)`\}/);
  assert.ok(!source.includes('--tier-complete'), 'the fixed green tier tint is retired in favor of the verdict color');
  assert.match(source, /sublabel=\{tone\.label\}/);
});

test('final review view reads the report + verdict from the top-level final_review node via deriveFinalReviewInfo, not ctx.node', () => {
  const codeWithoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(codeWithoutComments, /deriveFinalReviewInfo\(ctx\.state\)/);
  assert.ok(!codeWithoutComments.includes('ctx.node'), 'must not read the resolved leaf node — it may be final_pr, not final_review');
});

test('final review view heading is the fixed "Final Review" phrase; meta is the verdict detail sentence', () => {
  assert.match(source, /heading = 'Final Review'/);
  assert.match(source, /const meta = tone\.detail/);
  assert.match(source, /<HeadingSlot\s+heading=\{heading\}\s+hasMeta=\{meta !== null\}\s*\/>/);
  assert.match(source, /<MetaSlot\s+meta=\{meta\}\s*\/>/);
});

test('final review view wraps its controls in CardControlsRow and uses DocButton, not DocumentLink', () => {
  assert.match(source, /CardControlsRow/);
  assert.match(source, /DocButton/);
  assert.ok(!source.includes('DocumentLink'), 'the text doc link is retired in favor of the real button');
});

test('final review view renders the Report DocButton only when a report document exists', () => {
  assert.match(source, /docPath !== null &&/);
});

test('final review view renders no commit chip', () => {
  assert.ok(!source.includes('CommitChips'));
});

test('final review view sets no slot geometry — the shared slot wrappers own layout', () => {
  assert.ok(!/gridArea|gridTemplate|grid-template/.test(source));
  assert.ok(!source.includes('RING_DIAMETER'));
});

// ─── jsdom render check — Done-when: PR link present only when pr_url is set ──

test('Final Review renders the PR link when pr_url is present', () => {
  const { view, ctx } = resolveStateView(makeState('approved', 'reviews/FINAL.md', 'https://github.com/o/r/pull/7'), undefined, {
    onDocClick: () => {},
    compareUrlByRepo: {},
    projectName: 'demo',
  });
  assert.equal(ctx.stateId, 'final-review');
  const html = renderToStaticMarkup(createElement('div', null, view.render(ctx)));
  assert.match(html, /href="https:\/\/github\.com\/o\/r\/pull\/7"/);
});

test('Final Review renders no PR link when pr_url is null', () => {
  const { view, ctx } = resolveStateView(makeState(null, 'reviews/FINAL.md', null), undefined, {
    onDocClick: () => {},
    compareUrlByRepo: {},
    projectName: 'demo',
  });
  const html = renderToStaticMarkup(createElement('div', null, view.render(ctx)));
  assert.ok(!html.includes('<a '), 'no PR anchor rendered');
});

// ─── in-progress vs completed presentation — Done-when: the in-progress card is honest ──

test('Final Review with no verdict and no report yet renders the "Final Review" sublabel and no Report button', () => {
  const { view, ctx } = resolveStateView(makeState(null, null, null), undefined, {
    onDocClick: () => {},
    compareUrlByRepo: {},
    projectName: 'demo',
  });
  const html = renderToStaticMarkup(createElement('div', null, view.render(ctx)));
  assert.match(html, />Final Review</, 'the ring sublabel reads "Final Review", not "Pending"');
  assert.ok(!html.includes('>Report<'), 'no Report button while no report document exists');
});

test('Final Review renders the Report button once a report document exists, even before a verdict lands', () => {
  const { view, ctx } = resolveStateView(makeState(null, 'reviews/FINAL.md', null), undefined, {
    onDocClick: () => {},
    compareUrlByRepo: {},
    projectName: 'demo',
  });
  const html = renderToStaticMarkup(createElement('div', null, view.render(ctx)));
  assert.match(html, />Report</, 'the Report button appears once the document exists');
});

// ─── independence from ctx.node — the resolved leaf may be final_pr, not final_review ──

test('Final Review reads the report + verdict from the top-level final_review node even when ctx.node resolves elsewhere', () => {
  const state = makeState('approved', 'reviews/FINAL.md', null);
  // Simulates the shape once the resolver folds final_pr into this view:
  // the resolved leaf (ctx.node) is the PR node — doc_path/verdict null — while
  // the top-level final_review node still carries the real report + verdict.
  state.graph.nodes['final_pr'] = { kind: 'step', status: 'in_progress', doc_path: null, retries: 0 };
  const ctx: StateViewContext = {
    state,
    stateId: 'final-review',
    nodeId: 'final_pr',
    node: state.graph.nodes['final_pr'],
    isCorrective: false,
    isPhaseCorrective: false,
    iteration: undefined,
    correctiveEntry: undefined,
    phaseName: null,
    phaseProgress: null,
    taskProgress: null,
    wholeGraphProgress: null,
    repos: [],
    prUrl: null,
    onDocClick: () => {},
    compareUrlByRepo: {},
    projectName: 'demo',
  };

  const html = renderToStaticMarkup(createElement('div', null, finalReviewView.render(ctx)));
  assert.match(html, />Review Passed</, 'verdict comes from the top-level final_review node, not the final_pr leaf');
  const buttonCount = (html.match(/<button/g) ?? []).length;
  assert.equal(buttonCount, 1, 'the Report button is active — its doc_path came from final_review, not the null final_pr leaf');
});

// ─── end-to-end via the resolver — the plumbing-node fold ───────────────────

function makeStateWithLeaf(currentNodePath: string, verdict: string | null, docPath: string | null): AnyProjectState {
  const nodes: NodesRecord = {
    final_review: { kind: 'step', status: 'completed', doc_path: docPath, retries: 0, verdict },
    final_approval_gate: { kind: 'gate', status: 'in_progress', gate_active: true },
    pr_gate: { kind: 'conditional', status: 'in_progress', branch_taken: null },
    final_pr: { kind: 'step', status: 'not_started', doc_path: null, retries: 0 },
  };
  return {
    $schema: 'orchestration-state-v5',
    project: { name: 'demo', created: '2026-01-01', updated: '2026-01-01' },
    config: {
      gate_mode: 'task',
      limits: { max_phases: 3, max_tasks_per_phase: 3, max_retries_per_task: 2 },
      source_control: { auto_commit: 'never', auto_pr: 'never' },
    },
    pipeline: { gate_mode: 'task', source_control: null, current_tier: 'review', halt_reason: null },
    graph: { template_id: 'std', status: 'in_progress', current_node_path: currentNodePath, nodes },
  };
}

for (const leafPath of ['final_pr', 'final_approval_gate', 'pr_gate']) {
  test(`resolveStateView renders the Final Review card, not the fallback, when the live leaf is "${leafPath}"`, () => {
    const { view, ctx } = resolveStateView(
      makeStateWithLeaf(leafPath, 'approved', 'reviews/FINAL.md'),
      undefined,
      { onDocClick: () => {}, compareUrlByRepo: {}, projectName: 'demo' },
    );
    assert.equal(ctx.stateId, 'final-review');
    assert.equal(view.id, 'final-review');

    const html = renderToStaticMarkup(createElement('div', null, view.render(ctx)));
    assert.match(html, />Review Passed</, 'verdict is read through to the real final_review node regardless of which leaf is live');
    // The gate is active in this fixture, so both the Approve action and the
    // Report doc button render as active buttons.
    assert.match(html, />Approve</, 'the Approve action renders while the final gate is pending');
    const buttonCount = (html.match(/<button/g) ?? []).length;
    assert.equal(buttonCount, 2, 'Approve + Report render while the final-approval gate is pending');
  });
}

// ─── the real production path — the gray-fallback bug this work fixes ────────
// The engine writes final_pr as a conditional branch child of pr_gate, so the
// live current_node_path is `pr_gate.branches.true.final_pr`. This is the exact
// path that used to fall to the gray fallback card.

test('the real pr_gate.branches.true.final_pr path renders the Final Review card with Approve + Report', () => {
  const { view, ctx } = resolveStateView(
    makeStateWithLeaf('pr_gate.branches.true.final_pr', 'changes_requested', 'reviews/FINAL.md'),
    undefined,
    { onDocClick: () => {}, compareUrlByRepo: {}, projectName: 'demo' },
  );
  assert.equal(ctx.stateId, 'final-review');
  assert.equal(view.id, 'final-review');
  const html = renderToStaticMarkup(createElement('div', null, view.render(ctx)));
  assert.match(html, />Needs Work</, 'the ring shows the short "Needs Work" verdict label');
  assert.match(html, />The reviewer found issues\.</, 'the meta line shows the descriptive verdict sentence');
  assert.match(html, />Approve</);
});

// ─── Approve gating — the button follows the final-approval gate, not the view ──

test('Final Review shows Approve only while the final-approval gate is active', () => {
  const state = makeStateWithLeaf('pr_gate.branches.true.final_pr', 'changes_requested', 'reviews/FINAL.md');
  const { view, ctx } = resolveStateView(state, undefined, {
    onDocClick: () => {},
    compareUrlByRepo: {},
    projectName: 'demo',
  });
  const html = renderToStaticMarkup(createElement('div', null, view.render(ctx)));
  assert.match(html, />Approve</, 'the Approve action renders when gate_active is true and status is not completed');
});

test('Final Review hides Approve once the final-approval gate is completed (approved)', () => {
  const state = makeStateWithLeaf('pr_gate.branches.true.final_pr', 'approved', 'reviews/FINAL.md');
  // The human has approved: the gate is completed and no longer active.
  state.graph.nodes['final_approval_gate'] = { kind: 'gate', status: 'completed', gate_active: false };
  const { view, ctx } = resolveStateView(state, undefined, {
    onDocClick: () => {},
    compareUrlByRepo: {},
    projectName: 'demo',
  });
  const html = renderToStaticMarkup(createElement('div', null, view.render(ctx)));
  assert.ok(!html.includes('>Approve<'), 'no Approve action once the gate has been approved');
  // The Report doc button is still active — the card degrades to report-only.
  const buttonCount = (html.match(/<button/g) ?? []).length;
  assert.equal(buttonCount, 1, 'only the Report doc button remains');
});

test('Final Review shows no Approve during the final_review step, before the gate becomes active', () => {
  // At the final_review step the gate node exists but is not yet active.
  const state = makeState('changes_requested', 'reviews/FINAL.md', null);
  state.graph.nodes['final_approval_gate'] = { kind: 'gate', status: 'not_started', gate_active: false };
  const { view, ctx } = resolveStateView(state, undefined, {
    onDocClick: () => {},
    compareUrlByRepo: {},
    projectName: 'demo',
  });
  const html = renderToStaticMarkup(createElement('div', null, view.render(ctx)));
  assert.ok(!html.includes('>Approve<'), 'no Approve action until the final-approval gate is active');
});

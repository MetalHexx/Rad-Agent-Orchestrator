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

test('deriveVerdictTone maps "approved" to the approved tone', () => {
  const tone = deriveVerdictTone('approved');
  assert.equal(tone.label, 'Approved');
  assert.equal(tone.cssVar, '--verdict-approved');
});

test('deriveVerdictTone maps "changes_requested" to the changes-requested tone', () => {
  const tone = deriveVerdictTone('changes_requested');
  assert.equal(tone.label, 'Changes Requested');
  assert.equal(tone.cssVar, '--verdict-changes-requested');
});

test('deriveVerdictTone maps "rejected" to the rejected tone', () => {
  const tone = deriveVerdictTone('rejected');
  assert.equal(tone.label, 'Rejected');
  assert.equal(tone.cssVar, '--verdict-rejected');
});

test('deriveVerdictTone falls back safely on an unrecognized verdict string', () => {
  const tone = deriveVerdictTone('some-future-verdict');
  assert.equal(tone.label, 'some-future-verdict');
  assert.equal(tone.cssVar, '--status-not-started');
});

test('deriveVerdictTone falls back to Pending on a null verdict (not yet reviewed)', () => {
  const tone = deriveVerdictTone(null);
  assert.equal(tone.label, 'Pending');
});

// ─── source shape ─────────────────────────────────────────────────────────────

test('final review view id is "final-review"', () => {
  assert.equal(finalReviewView.id, 'final-review');
});

test('final review view plots phase progress (the run-wide milestone position)', () => {
  assert.match(source, /deriveRingArc\(ctx\.phaseProgress\)/);
});

test('final review view renders a determinate ring tinted to the green complete tier with the verdict label as its sublabel', () => {
  assert.match(source, /mode="determinate"/);
  assert.match(source, /--tier-complete/);
  assert.match(source, /sublabel=\{tone\.label\}/);
});

test('final review view reads the report + verdict from the top-level final_review node via deriveFinalReviewInfo, not ctx.node', () => {
  const codeWithoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(codeWithoutComments, /deriveFinalReviewInfo\(ctx\.state\)/);
  assert.ok(!codeWithoutComments.includes('ctx.node'), 'must not read the resolved leaf node — it may be final_pr, not final_review');
});

test('final review view heading is the fixed "Final Review" phrase; meta is the verdict label', () => {
  assert.match(source, /heading = 'Final Review'/);
  assert.match(source, /const meta = tone\.label/);
  assert.match(source, /<HeadingSlot\s+heading=\{heading\}\s+hasMeta=\{meta !== null\}\s*\/>/);
  assert.match(source, /<MetaSlot\s+meta=\{meta\}\s*\/>/);
});

test('final review view wraps its controls in CardControlsRow and uses DocButton, not DocumentLink', () => {
  assert.match(source, /CardControlsRow/);
  assert.match(source, /DocButton/);
  assert.ok(!source.includes('DocumentLink'), 'the text doc link is retired in favor of the real button');
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
    iteration: undefined,
    correctiveEntry: undefined,
    phaseName: null,
    phaseProgress: null,
    taskProgress: null,
    repos: [],
    prUrl: null,
    onDocClick: () => {},
    compareUrlByRepo: {},
    projectName: 'demo',
  };

  const html = renderToStaticMarkup(createElement('div', null, finalReviewView.render(ctx)));
  assert.match(html, />Approved</, 'verdict comes from the top-level final_review node, not the final_pr leaf');
  const buttonCount = (html.match(/<button/g) ?? []).length;
  assert.equal(buttonCount, 1, 'the Report button is active — its doc_path came from final_review, not the null final_pr leaf');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { deriveVerdictTone, deriveFinalReviewInfo, completeView } from './complete-view';
import { resolveStateView } from '../resolver';
import type { AnyProjectState, NodesRecord } from '@/types/state';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).React = React;

const dir = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(dir, 'complete-view.tsx'), 'utf-8');

function makeState(verdict: string | null, docPath: string | null, prUrl: string | null): AnyProjectState {
  const nodes: NodesRecord = {
    final_review: { kind: 'step', status: 'completed', doc_path: docPath, retries: 0, verdict },
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
    graph: { template_id: 'std', status: 'completed', current_node_path: null, nodes },
  };
}

// ─── deriveFinalReviewInfo ────────────────────────────────────────────────────

test('deriveFinalReviewInfo reads doc_path and verdict from the top-level final_review node', () => {
  const info = deriveFinalReviewInfo(makeState('approved', 'reviews/FINAL.md', null));
  assert.deepEqual(info, { docPath: 'reviews/FINAL.md', verdict: 'approved' });
});

test('deriveFinalReviewInfo is null-safe when final_review is missing from the node tree', () => {
  const state = makeState(null, null, null);
  state.graph.nodes = {};
  assert.deepEqual(deriveFinalReviewInfo(state), { docPath: null, verdict: null });
});

// ─── deriveVerdictTone ────────────────────────────────────────────────────────

test('deriveVerdictTone maps known verdicts to their tone', () => {
  assert.equal(deriveVerdictTone('approved').cssVar, '--verdict-approved');
  assert.equal(deriveVerdictTone('changes_requested').cssVar, '--verdict-changes-requested');
  assert.equal(deriveVerdictTone('rejected').cssVar, '--verdict-rejected');
});

test('deriveVerdictTone falls back safely on an unrecognized verdict string', () => {
  const tone = deriveVerdictTone('mystery');
  assert.equal(tone.label, 'mystery');
  assert.equal(tone.cssVar, '--status-not-started');
});

// ─── source shape ─────────────────────────────────────────────────────────────

test('complete view id is "complete"', () => {
  assert.equal(completeView.id, 'complete');
});

test('complete view renders a full determinate ring, not a partial arc', () => {
  assert.match(source, /mode="determinate"/);
  assert.match(source, /value=\{1\}/);
  assert.match(source, /max=\{1\}/);
  assert.match(source, /--tier-complete/);
});

test('complete view renders an unconditional Check glyph, not tied to the verdict', () => {
  const ringSection = source.slice(source.indexOf('<RingSlot>'), source.indexOf('</RingSlot>'));
  assert.match(ringSection, /<Check\b/);
});

test('complete view renders no commit chip', () => {
  assert.ok(!source.includes('CommitChips'));
});

test('complete view sets no slot geometry — the shared slot wrappers own layout', () => {
  assert.ok(!/gridArea|gridTemplate|grid-template/.test(source));
  assert.ok(!source.includes('RING_DIAMETER'));
});

// ─── jsdom render check — Done-when: PR link present only when pr_url is set ──

test('Complete renders the PR link when pr_url is present', () => {
  const { view, ctx } = resolveStateView(makeState('approved', 'reviews/FINAL.md', 'https://github.com/o/r/pull/9'), undefined, {
    onDocClick: () => {},
    compareUrlByRepo: {},
    projectName: 'demo',
  });
  assert.equal(ctx.stateId, 'complete');
  const html = renderToStaticMarkup(createElement('div', null, view.render(ctx)));
  assert.match(html, /href="https:\/\/github\.com\/o\/r\/pull\/9"/);
});

test('Complete renders no PR link when pr_url is null', () => {
  const { view, ctx } = resolveStateView(makeState('approved', 'reviews/FINAL.md', null), undefined, {
    onDocClick: () => {},
    compareUrlByRepo: {},
    projectName: 'demo',
  });
  const html = renderToStaticMarkup(createElement('div', null, view.render(ctx)));
  assert.ok(!html.includes('<a '), 'no PR anchor rendered');
});

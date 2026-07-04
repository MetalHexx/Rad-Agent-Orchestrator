import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { deriveMasterPlanDocPath, planApprovalView } from './plan-approval-view';
import { resolveStateView } from '../resolver';
import type { AnyProjectState, NodesRecord } from '@/types/state';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).React = React;

const dir = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(dir, 'plan-approval-view.tsx'), 'utf-8');

function makeState(masterPlanDocPath: string | null): AnyProjectState {
  const nodes: NodesRecord = {
    master_plan: { kind: 'step', status: 'completed', doc_path: masterPlanDocPath, retries: 0 },
    plan_approval_gate: { kind: 'gate', status: 'in_progress', gate_active: true },
  };
  return {
    $schema: 'orchestration-state-v5',
    project: { name: 'demo', created: '2026-01-01', updated: '2026-01-01' },
    config: {
      gate_mode: 'task',
      limits: { max_phases: 3, max_tasks_per_phase: 3, max_retries_per_task: 2 },
      source_control: { auto_commit: 'never', auto_pr: 'never' },
    },
    pipeline: { gate_mode: 'task', source_control: null, current_tier: 'planning', halt_reason: null },
    graph: { template_id: 'std', status: 'in_progress', current_node_path: 'plan_approval_gate', nodes },
  };
}

// ─── deriveMasterPlanDocPath ──────────────────────────────────────────────────

test('deriveMasterPlanDocPath reads the top-level master_plan step doc_path', () => {
  assert.equal(deriveMasterPlanDocPath(makeState('DEMO-MASTER-PLAN.md')), 'DEMO-MASTER-PLAN.md');
});

test('deriveMasterPlanDocPath is null when master_plan has no doc yet', () => {
  assert.equal(deriveMasterPlanDocPath(makeState(null)), null);
});

// ─── source shape ─────────────────────────────────────────────────────────────

test('plan approval view id is "plan-approval"', () => {
  assert.equal(planApprovalView.id, 'plan-approval');
});

test('plan approval view uses ApproveGateButton with the plan_approved gate event', () => {
  assert.match(source, /ApproveGateButton/);
  assert.match(source, /gateEvent="plan_approved"/);
});

test('plan approval view renders a full determinate ring, not a partial arc, with a "READY" sublabel', () => {
  assert.match(source, /mode="determinate"/);
  assert.match(source, /value=\{1\}/);
  assert.match(source, /max=\{1\}/);
  assert.match(source, /sublabel="READY"/);
});

test('plan approval view wraps its controls in CardControlsRow and uses DocButton, not DocumentLink', () => {
  assert.match(source, /CardControlsRow/);
  assert.match(source, /DocButton/);
  assert.ok(!source.includes('DocumentLink'), 'the text doc link is retired in favor of the real button');
});

test('plan approval view renders no commit chip', () => {
  assert.ok(!source.includes('CommitChips'));
});

test('plan approval view sets no slot geometry — the shared slot wrappers own layout', () => {
  assert.ok(!/gridArea|gridTemplate|grid-template/.test(source));
  assert.ok(!source.includes('RING_DIAMETER'));
});

// ─── jsdom render check — Done-when: Approve renders with the plan_approved event ──

test('Plan Approval renders the ApproveGateButton and the Master Plan doc link from a realistic fixture', () => {
  const { view, ctx } = resolveStateView(makeState('DEMO-MASTER-PLAN.md'), undefined, {
    onDocClick: () => {},
    compareUrlByRepo: {},
    projectName: 'demo',
  });
  assert.equal(ctx.stateId, 'plan-approval');
  assert.equal(view.id, 'plan-approval');

  const html = renderToStaticMarkup(createElement('div', null, view.render(ctx)));

  // The primary Approve action renders as a real button.
  assert.match(html, />Approve</);
  // The secondary Master Plan doc button renders alongside it.
  assert.match(html, />Master Plan</);
  // Two active controls: Approve + Master Plan doc link.
  const buttonCount = (html.match(/<button/g) ?? []).length;
  assert.equal(buttonCount, 2, 'both the Approve action and the Master Plan doc link render as active buttons');

  // Heading text, asserted against rendered output rather than source. No meta
  // line — the heading already says what a subtitle would just repeat.
  assert.match(html, />Execution Plan Ready</);

  // Ring center icon is the same checkmark Final Review uses for its approved
  // verdict (lucide's generated class name), not the retired document-check glyph.
  assert.ok(html.includes('lucide-check'), 'ring centers on the checkmark glyph');
  assert.ok(!html.includes('lucide-file-check'), 'the document-checkmark icon is retired');

  // The heading anchors in its own row (paired layout) rather than centering
  // across the whole heading/meta/controls block — with real controls below
  // it, the centered layout would push the heading text down into the button
  // row. Asserted on the rendered style, not the source's hasMeta expression.
  assert.match(html, /grid-area:heading;align-self:end/, 'heading anchors in its own row, leaving the controls row clear');
  assert.ok(!html.includes('controls-end'), 'heading does not span into the controls row');
});

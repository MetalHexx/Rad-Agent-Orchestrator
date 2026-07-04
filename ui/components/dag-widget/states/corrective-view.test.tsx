import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  resolveMaxRetriesPerTask,
  deriveRetryBudgetLabel,
  deriveRetryArc,
  correctiveView,
  DEFAULT_MAX_RETRIES_PER_TASK,
} from './corrective-view';
import { resolveStateView } from '../resolver';
import type { AnyProjectState, CorrectiveTaskEntry, NodesRecord } from '@/types/state';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).React = React;

const dir = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(dir, 'corrective-view.tsx'), 'utf-8');

function makeState(maxRetriesPerTask: number | undefined): AnyProjectState {
  return {
    $schema: 'orchestration-state-v5',
    project: { name: 'demo', created: '2026-01-01', updated: '2026-01-01' },
    config: {
      gate_mode: 'task',
      limits: {
        max_phases: 3,
        max_tasks_per_phase: 3,
        // A stale/hand-edited snapshot can omit this despite the required type —
        // simulate that here to exercise the documented fallback.
        max_retries_per_task: maxRetriesPerTask as unknown as number,
      },
      source_control: { auto_commit: 'never', auto_pr: 'never' },
    },
    pipeline: { gate_mode: 'task', source_control: null, current_tier: 'execution', halt_reason: null },
    graph: { template_id: 'std', status: 'in_progress', current_node_path: null, nodes: {} },
  };
}

function makeCorrectiveEntry(overrides: Partial<CorrectiveTaskEntry> = {}): CorrectiveTaskEntry {
  return {
    index: 1,
    reason: 'code review found issues',
    injected_after: 'code_review',
    status: 'in_progress',
    doc_path: 'tasks/CORRECTIVE-1.md',
    repos: [{ name: 'api', commit_hash: 'cthash' }],
    nodes: {},
    ...overrides,
  };
}

// ─── resolveMaxRetriesPerTask ─────────────────────────────────────────────────

test('resolveMaxRetriesPerTask reads config.limits.max_retries_per_task when present', () => {
  assert.equal(resolveMaxRetriesPerTask(makeState(5)), 5);
});

test('resolveMaxRetriesPerTask falls back to the documented default when the snapshot omits it', () => {
  assert.equal(resolveMaxRetriesPerTask(makeState(undefined)), DEFAULT_MAX_RETRIES_PER_TASK);
});

test('resolveMaxRetriesPerTask treats zero as a valid value, not a missing one', () => {
  assert.equal(resolveMaxRetriesPerTask(makeState(0)), 0);
});

// ─── deriveRetryBudgetLabel ───────────────────────────────────────────────────

test('deriveRetryBudgetLabel is "{correctiveIndex}/{max}"', () => {
  const label = deriveRetryBudgetLabel(makeCorrectiveEntry({ index: 1 }), makeState(2));
  assert.equal(label, '1/2');
});

test('deriveRetryBudgetLabel uses the fallback max when the snapshot omits it', () => {
  const label = deriveRetryBudgetLabel(makeCorrectiveEntry({ index: 2 }), makeState(undefined));
  assert.equal(label, `2/${DEFAULT_MAX_RETRIES_PER_TASK}`);
});

test('deriveRetryBudgetLabel is null when no corrective entry resolved', () => {
  assert.equal(deriveRetryBudgetLabel(undefined, makeState(2)), null);
});

// ─── deriveRetryArc ───────────────────────────────────────────────────────────

test('deriveRetryArc plots the retry budget as { value, max }, not a completion ratio', () => {
  const arc = deriveRetryArc(makeCorrectiveEntry({ index: 1 }), makeState(5));
  assert.deepEqual(arc, { value: 1, max: 5 });
});

test('deriveRetryArc uses the fallback max when the snapshot omits it', () => {
  const arc = deriveRetryArc(makeCorrectiveEntry({ index: 1 }), makeState(undefined));
  assert.deepEqual(arc, { value: 1, max: DEFAULT_MAX_RETRIES_PER_TASK });
});

test('deriveRetryArc falls back to the degenerate-safe { 0, 1 } domain when no corrective entry resolved', () => {
  assert.deepEqual(deriveRetryArc(undefined, makeState(5)), { value: 0, max: 1 });
});

// ─── source shape ─────────────────────────────────────────────────────────────

test('corrective view id is "corrective"', () => {
  assert.equal(correctiveView.id, 'corrective');
});

test('corrective view renders no badge', () => {
  assert.ok(!source.includes('SpinnerBadge'), 'the badge is retired in favor of the heading/meta anatomy');
});

test('corrective view heading is sourced from deriveCardHeading and meta folds in the corrective reason', () => {
  assert.match(source, /deriveCardHeading\(ctx\)/);
  assert.match(source, /<HeadingSlot\s+heading=\{heading\}/);
  assert.match(source, /correctiveEntry\?\.reason/);
});

test('corrective view wraps its controls in CardControlsRow and uses DocButton, not DocumentLink', () => {
  assert.match(source, /CardControlsRow/);
  assert.match(source, /DocButton/);
  assert.ok(!source.includes('DocumentLink'), 'the text doc link is retired in favor of the real button');
});

test('corrective view ring center carries a "RETRY" sublabel', () => {
  assert.match(source, /sublabel="RETRY"/);
});

test('corrective view plots the retry budget, not task or phase completion', () => {
  assert.match(source, /deriveRetryArc\(ctx\.correctiveEntry, ctx\.state\)/);
  assert.ok(!source.includes('ctx.taskProgress'), 'the retry ring must not read task progress');
  assert.ok(!source.includes('ctx.phaseProgress'), 'the retry ring must not read phase progress');
});

test('corrective view renders a commit chip', () => {
  assert.match(source, /CommitChips/);
});

test('corrective view tints its doc controls to the red failed tier', () => {
  assert.match(source, /--status-failed/);
});

test('corrective view references both the handoff and the triggering review-report doc paths', () => {
  assert.match(source, /correctiveEntry\?\.doc_path/);
  assert.match(source, /label="Task Handoff"/);
  assert.match(source, /label="Review Report"/);
});

test('corrective view never renders the retry budget as a button', () => {
  const ringSection = source.slice(source.indexOf('<RingSlot>'), source.indexOf('</RingSlot>'));
  assert.ok(!/<button|onClick/.test(ringSection), 'ring center must be display-only');
});

test('corrective view sets no slot geometry — the shared slot wrappers own layout', () => {
  assert.ok(!/gridArea|gridTemplate|grid-template/.test(source));
  assert.ok(!source.includes('RING_DIAMETER'));
});

// ─── jsdom render check — Done-when: Corrective renders both doc links + commit chip ──

const RICH_NODES: NodesRecord = {
  phase_loop: {
    kind: 'for_each_phase',
    status: 'in_progress',
    iterations: [
      {
        index: 0,
        status: 'in_progress',
        doc_path: 'phases/PHASE-01-SETUP.md',
        corrective_tasks: [],
        repos: [],
        nodes: {
          task_loop: {
            kind: 'for_each_task',
            status: 'in_progress',
            iterations: [
              {
                index: 0,
                status: 'in_progress',
                doc_path: 'tasks/TASK-P01-T01-AUTH.md',
                repos: [{ name: 'api', commit_hash: 'taskhash' }],
                corrective_tasks: [
                  {
                    index: 1,
                    reason: 'code review found issues',
                    injected_after: 'code_review',
                    status: 'in_progress',
                    doc_path: 'tasks/CORRECTIVE-1-AUTH.md',
                    repos: [{ name: 'api', commit_hash: 'cthash' }],
                    nodes: {
                      task_executor: { kind: 'step', status: 'in_progress', doc_path: null, retries: 0 },
                      code_review: { kind: 'step', status: 'not_started', doc_path: null, retries: 0 },
                    },
                  },
                ],
                nodes: {
                  task_executor: { kind: 'step', status: 'completed', doc_path: null, retries: 0 },
                  code_review: { kind: 'step', status: 'completed', doc_path: 'reviews/REVIEW-1.md', retries: 0 },
                  task_gate: { kind: 'gate', status: 'not_started', gate_active: false },
                },
              },
            ],
          },
          phase_review: { kind: 'step', status: 'not_started', doc_path: null, retries: 0 },
          phase_gate: { kind: 'gate', status: 'not_started', gate_active: false },
        },
      },
    ],
  },
};

function makeRichState(): AnyProjectState {
  return {
    $schema: 'orchestration-state-v5',
    project: { name: 'demo', created: '2026-01-01', updated: '2026-01-01' },
    config: {
      gate_mode: 'task',
      limits: { max_phases: 3, max_tasks_per_phase: 3, max_retries_per_task: 2 },
      source_control: { auto_commit: 'never', auto_pr: 'never' },
    },
    pipeline: { gate_mode: 'task', source_control: null, current_tier: 'execution', halt_reason: null },
    graph: {
      template_id: 'std',
      status: 'in_progress',
      current_node_path: 'phase_loop.iter0.task_loop.iter0.ct1.task_executor',
      nodes: RICH_NODES,
    },
  };
}

test('Corrective renders both doc links and a commit chip from a realistic iteration fixture', () => {
  const { view, ctx } = resolveStateView(makeRichState(), undefined, {
    onDocClick: () => {},
    compareUrlByRepo: { api: 'https://github.com/example/api/compare/main...branch' },
    projectName: 'demo',
  });
  assert.equal(ctx.stateId, 'corrective');
  assert.equal(view.id, 'corrective');

  const html = renderToStaticMarkup(createElement('div', null, view.render(ctx)));

  // Two doc-link buttons: Task Handoff (correctiveEntry.doc_path) + Review Report
  // (the enclosing task iteration's code_review.doc_path).
  const buttonCount = (html.match(/<button/g) ?? []).length;
  assert.equal(buttonCount, 2, 'both the Task Handoff and Review Report doc links render as active buttons');

  // Commit chip renders a linkable GitHub commit anchor for the corrective's own repo.
  assert.match(html, /cthash/);
  assert.match(html, /<a\s+href="https:\/\/github\.com\/example\/api\/commit\/cthash"/);

  // Retry budget (1/2) is display-only text in the ring center, never interactive.
  assert.match(html, />1\/2</);

  // The "RETRY" sublabel and the corrective's own reason both surface.
  assert.match(html, />RETRY</);
  assert.match(html, /code review found issues/);
});

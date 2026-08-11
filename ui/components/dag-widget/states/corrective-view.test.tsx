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

test('deriveRetryArc plots the window-relative attempt, not the raw entry index, once a non-zero budgetOrigin applies', () => {
  const arc = deriveRetryArc(makeCorrectiveEntry({ index: 3 }), makeState(5), 2);
  assert.deepEqual(arc, { value: 1, max: 5 });
});

test('deriveRetryArc falls back to the degenerate-safe { 0, 1 } domain for a spent-window entry', () => {
  const arc = deriveRetryArc(makeCorrectiveEntry({ index: 1 }), makeState(5), 2);
  assert.deepEqual(arc, { value: 0, max: 1 });
});

// ─── source shape ─────────────────────────────────────────────────────────────

test('corrective view id is "corrective"', () => {
  assert.equal(correctiveView.id, 'corrective');
});

test('corrective view renders no badge', () => {
  assert.ok(!source.includes('SpinnerBadge'), 'the badge is retired in favor of the heading/meta anatomy');
});

test('corrective view heading is sourced from deriveCardHeading; the reason surfaces as the meta hover title, not the visible line', () => {
  assert.match(source, /deriveCardHeading\(ctx\)/);
  assert.match(source, /<HeadingSlot\s+heading=\{heading\}/);
  assert.match(source, /correctiveEntry\?\.reason/);
  assert.match(source, /<MetaSlot\s+meta=\{meta\}\s+title=\{metaWithReason/);
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
  assert.match(source, /deriveRetryArc\(ctx\.correctiveEntry, ctx\.state, budgetOrigin\)/);
  assert.ok(!source.includes('ctx.taskProgress'), 'the retry ring must not read task progress');
  assert.ok(!source.includes('ctx.phaseProgress'), 'the retry ring must not read phase progress');
});

test('corrective view resolves budgetOrigin from the final_review node for final scope, not a hardcoded 0', () => {
  assert.match(source, /budgetOrigin = finalReviewNode\?\.corrective_budget_origin \?\? 0/);
  assert.match(source, /deriveRetryBudgetLabel\(ctx\.correctiveEntry, ctx\.state, budgetOrigin\)/);
});

test('corrective view renders a commit chip', () => {
  assert.match(source, /CommitChips/);
});

test('corrective view tints its doc controls to the red failed tier', () => {
  assert.match(source, /--status-failed/);
});

test('corrective view references both the handoff and the triggering review-report doc paths', () => {
  assert.match(source, /correctiveEntry\?\.doc_path/);
});

test('corrective view branches its control labels on a CORRECTIVE_LABELS table keyed by ctx.correctiveScope', () => {
  assert.match(source, /task:\s*\{\s*handoff:\s*'Task Handoff',\s*report:\s*'Review Report'\s*\}/);
  assert.match(source, /phase:\s*\{\s*handoff:\s*'Phase Plan',\s*report:\s*'Phase Report'\s*\}/);
  assert.match(source, /final:\s*\{\s*handoff:\s*null,\s*report:\s*'Final Review'\s*\}/);
  assert.match(source, /const labels = CORRECTIVE_LABELS\[ctx\.correctiveScope \?\? 'task'\];/);
});

test('corrective view derives the report doc from phase_review for a phase corrective and code_review otherwise', () => {
  assert.match(source, /ctx\.iteration\?\.nodes\['phase_review'\]/);
  assert.match(source, /ctx\.iteration\?\.nodes\['code_review'\]/);
  assert.match(source, /switch \(ctx\.correctiveScope\)/);
});

test('corrective view derives the final-scope report doc from the top-level final_review node, not ctx.iteration', () => {
  assert.match(source, /case 'final':/);
  assert.match(source, /ctx\.state\.graph\.nodes\['final_review'\]/);
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

  // The "RETRY" sublabel surfaces, and the visible meta line stays the short
  // "Phase N · Task M" — the corrective's own reason does not overrun it.
  assert.match(html, />RETRY</);
  assert.match(html, />Phase 1 · Task 1</);
  assert.ok(!html.includes('>Phase 1 · Task 1 — code review found issues<'), 'the reason is not folded into the visible text');

  // The full "meta — reason" string still surfaces as the meta's hover title.
  assert.match(html, /title="Phase 1 · Task 1 — code review found issues"/);
});

// ─── phase-corrective vs task-corrective control shape ────────────────────────

const PHASE_CORRECTIVE_NODES: NodesRecord = {
  phase_loop: {
    kind: 'for_each_phase',
    status: 'in_progress',
    iterations: [
      {
        index: 0,
        status: 'in_progress',
        doc_path: 'phases/PHASE-01-SETUP.md',
        repos: [{ name: 'api', commit_hash: 'phasecthash' }],
        corrective_tasks: [
          {
            index: 1,
            reason: 'phase review found issues',
            injected_after: 'phase_review',
            status: 'in_progress',
            doc_path: 'phases/PHASE-CORRECTIVE-1.md',
            repos: [{ name: 'api', commit_hash: 'phasecthash' }],
            nodes: {
              task_executor: { kind: 'step', status: 'in_progress', doc_path: null, retries: 0 },
            },
          },
        ],
        nodes: {
          phase_review: { kind: 'step', status: 'completed', doc_path: 'reviews/PHASE-REVIEW-1.md', retries: 0 },
          phase_gate: { kind: 'gate', status: 'not_started', gate_active: false },
        },
      },
    ],
  },
};

function makePhaseCorrectiveState(): AnyProjectState {
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
      current_node_path: 'phase_loop.iter0.ct1.task_executor',
      nodes: PHASE_CORRECTIVE_NODES,
    },
  };
}

test('a phase corrective shows enabled "Phase Plan" and "Phase Report" controls resolving to the phase handoff and phase_review doc', () => {
  const { view, ctx } = resolveStateView(makePhaseCorrectiveState(), undefined, {
    onDocClick: () => {},
    compareUrlByRepo: { api: 'https://github.com/example/api/compare/main...branch' },
    projectName: 'demo',
  });
  assert.equal(ctx.stateId, 'corrective');
  assert.equal(ctx.correctiveScope, 'phase');

  const html = renderToStaticMarkup(createElement('div', null, view.render(ctx)));

  assert.match(html, />Phase Plan</);
  assert.match(html, />Phase Report</);
  assert.ok(!html.includes('>Task Handoff<'));
  assert.ok(!html.includes('>Review Report<'));

  // Both doc buttons render as active (non-disabled) buttons: the phase
  // handoff (correctiveEntry.doc_path) and the phase_review doc that
  // triggered the corrective.
  const buttonCount = (html.match(/<button/g) ?? []).length;
  assert.equal(buttonCount, 2, 'both the Phase Plan and Phase Report doc links render as active buttons');
});

test('a task corrective keeps unchanged "Task Handoff" / "Review Report" labels', () => {
  const { view, ctx } = resolveStateView(makeRichState(), undefined, {
    onDocClick: () => {},
    compareUrlByRepo: { api: 'https://github.com/example/api/compare/main...branch' },
    projectName: 'demo',
  });
  assert.equal(ctx.correctiveScope, 'task');

  const html = renderToStaticMarkup(createElement('div', null, view.render(ctx)));

  assert.match(html, />Task Handoff</);
  assert.match(html, />Review Report</);
  assert.ok(!html.includes('>Phase Plan<'));
  assert.ok(!html.includes('>Phase Report<'));
});

// ─── final-scope corrective — no handoff at this scope ─────────────────────

const FINAL_CORRECTIVE_NODES: NodesRecord = {
  final_review: {
    kind: 'step',
    status: 'not_started',
    doc_path: 'reviews/FINAL-REVIEW-1.md',
    retries: 0,
    corrective_tasks: [
      {
        index: 1,
        reason: 'final review found issues',
        injected_after: 'final_review',
        status: 'in_progress',
        doc_path: 'tasks/FINAL-CORRECTIVE-1.md',
        repos: [{ name: 'api', commit_hash: 'finalcthash' }],
        nodes: {
          task_executor: { kind: 'step', status: 'in_progress', doc_path: null, retries: 0 },
        },
      },
    ],
  },
};

function makeFinalCorrectiveState(): AnyProjectState {
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
      current_node_path: 'final_review.ct1.task_executor',
      nodes: FINAL_CORRECTIVE_NODES,
    },
  };
}

test('a final corrective omits the handoff control entirely and shows the "Final Review" report label', () => {
  const { view, ctx } = resolveStateView(makeFinalCorrectiveState(), undefined, {
    onDocClick: () => {},
    compareUrlByRepo: { api: 'https://github.com/example/api/compare/main...branch' },
    projectName: 'demo',
  });
  assert.equal(ctx.stateId, 'corrective');
  assert.equal(ctx.correctiveScope, 'final');

  const html = renderToStaticMarkup(createElement('div', null, view.render(ctx)));

  assert.ok(!html.includes('>Task Handoff<'));
  assert.ok(!html.includes('>Phase Plan<'));
  assert.match(html, />Final Review</);

  // Only the report control renders — the handoff control is omitted
  // entirely (not rendered disabled) since a final corrective has no handoff doc.
  const buttonCount = (html.match(/<button/g) ?? []).length;
  assert.equal(buttonCount, 1, 'only the Final Review report control renders');

  // The report control is active (not disabled), reading its doc path from the
  // top-level final_review step rather than an (absent) enclosing iteration.
  // Matches the real `disabled=""` DOM attribute, not Tailwind's `disabled:*` variants.
  assert.ok(!/\bdisabled=""/.test(html), 'the Final Review report resolved a real doc path');
});

// ─── final corrective from the raw engine bracket-form path (Done-when) ────

function makeFinalCorrectiveBracketState(): AnyProjectState {
  const state = makeFinalCorrectiveState();
  return {
    ...state,
    graph: { ...state.graph, current_node_path: 'final_review.corrective_tasks[1].task_executor' },
  };
}

test('a bracket-form final_review.corrective_tasks[1] path resolves to the corrective view with a populated ring and no empty state', () => {
  const { view, ctx } = resolveStateView(makeFinalCorrectiveBracketState(), undefined, {
    onDocClick: () => {},
    compareUrlByRepo: { api: 'https://github.com/example/api/compare/main...branch' },
    projectName: 'demo',
  });
  assert.equal(ctx.stateId, 'corrective');
  assert.equal(ctx.correctiveScope, 'final');
  assert.equal(ctx.correctiveEntry?.index, 1);

  const html = renderToStaticMarkup(createElement('div', null, view.render(ctx)));

  // The ring center carries the resolved retry budget, not an empty placeholder.
  assert.match(html, />1\/2</);
  assert.match(html, />Correcting: Final Review</);
  assert.match(html, />Final Review</);
});

// ─── final-scope budgetOrigin threading after a final_rejected reopen ──────

const WINDOWED_FINAL_CORRECTIVE_NODES: NodesRecord = {
  final_review: {
    kind: 'step',
    status: 'in_progress',
    doc_path: 'reviews/FINAL-REVIEW-1.md',
    retries: 0,
    corrective_budget_origin: 2,
    corrective_tasks: [
      { index: 1, reason: 'spent history', injected_after: 'final_review', status: 'completed', doc_path: null, repos: [], nodes: {} },
      { index: 2, reason: 'spent history', injected_after: 'final_review', status: 'completed', doc_path: null, repos: [], nodes: {} },
      {
        index: 3,
        reason: 'final review found issues (new window)',
        injected_after: 'final_review',
        status: 'in_progress',
        doc_path: 'tasks/FINAL-CORRECTIVE-3.md',
        repos: [{ name: 'api', commit_hash: 'windowedhash' }],
        nodes: {
          task_executor: { kind: 'step', status: 'in_progress', doc_path: null, retries: 0 },
        },
      },
    ],
  },
};

function makeWindowedFinalCorrectiveState(): AnyProjectState {
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
      current_node_path: 'final_review.corrective_tasks[3].task_executor',
      nodes: WINDOWED_FINAL_CORRECTIVE_NODES,
    },
  };
}

test('a final corrective past a final_rejected budget-origin advance shows the window-relative retry budget, not the raw entry index', () => {
  const { view, ctx } = resolveStateView(makeWindowedFinalCorrectiveState(), undefined, {
    onDocClick: () => {},
    compareUrlByRepo: { api: 'https://github.com/example/api/compare/main...branch' },
    projectName: 'demo',
  });
  assert.equal(ctx.correctiveScope, 'final');
  assert.equal(ctx.correctiveEntry?.index, 3);

  const html = renderToStaticMarkup(createElement('div', null, view.render(ctx)));

  // entry.index (3) - budgetOrigin (2) = window-relative attempt 1, over the
  // configured ceiling of 2 — not "3/2" (which the ring would show if the
  // origin were silently ignored, and which would also read as saturated).
  assert.match(html, />1\/2</);
  assert.ok(!html.includes('>3/2<'), 'must not render the raw ever-growing index as the attempt number');
});

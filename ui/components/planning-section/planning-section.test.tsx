import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PlanningSection, shouldShowStateCard } from './planning-section';
import type { Artifact } from '@/lib/artifact-model';
import type { ProjectStateV5, GraphStatus, NodesRecord } from '@/types/state';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).React = React;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function makeState(currentNodePath: string | null, status: GraphStatus = 'in_progress'): ProjectStateV5 {
  return {
    $schema: 'orchestration-state-v5',
    project: { name: 'demo', created: '2026-01-01', updated: '2026-01-01' },
    config: {
      gate_mode: 'task',
      limits: { max_phases: 3, max_tasks_per_phase: 3, max_retries_per_task: 2 },
      source_control: { auto_commit: 'never', auto_pr: 'never' },
    },
    pipeline: { gate_mode: 'task', source_control: null, current_tier: 'execution', halt_reason: null },
    graph: { template_id: 'std', status, current_node_path: currentNodePath, nodes: {} },
  };
}

const requirements: Artifact = {
  fileName: 'DEMO-REQUIREMENTS.md', kind: 'markdown', label: 'Requirements', title: null,
  isMarkdown: true, pinned: true, category: 'requirements',
};
const masterPlan: Artifact = {
  fileName: 'DEMO-MASTER-PLAN.md', kind: 'markdown', label: 'Master Plan', title: null,
  isMarkdown: true, pinned: true, category: 'master-plan',
};
const artifacts: Artifact[] = [requirements, masterPlan];
const noop = () => {};

const baseProps = {
  requirementsStatus: null,
  onOpen: noop,
  onDelete: noop,
  onDocClick: noop,
  compareUrlByRepo: {},
  projectName: 'demo',
};

function render(props: Parameters<typeof PlanningSection>[0]): string {
  return renderToStaticMarkup(createElement(PlanningSection, props));
}

// ─── Pure decision helper — shouldShowStateCard ────────────────────────────

test('shouldShowStateCard: true for a completed run even with a null current node', () => {
  assert.equal(shouldShowStateCard(makeState(null, 'completed')), true);
});

test('shouldShowStateCard: true when a current node path is present', () => {
  assert.equal(shouldShowStateCard(makeState('phase_loop.iter0.task_executor')), true);
});

test('shouldShowStateCard: false for a not_started parse with a null current node', () => {
  assert.equal(shouldShowStateCard(makeState(null, 'not_started')), false);
});

test('shouldShowStateCard: false when the current node path is an empty string', () => {
  assert.equal(shouldShowStateCard(makeState('')), false);
});

// ─── Two-up composition ─────────────────────────────────────────────────────

test('mounts docs and the DAG-state card together in the responsive two-up grid', () => {
  const html = render({ ...baseProps, artifacts, state: makeState('some_unmapped_node') });
  assert.ok(html.includes('grid-cols-1 lg:grid-cols-2'), 'renders the responsive two-up grid');
  assert.ok(html.includes('DEMO-REQUIREMENTS.md'), 'the docs list is present (left track)');
  assert.match(html, /<svg/, 'the DAG-state card is present (right track renders a node icon)');
  assert.ok(html.includes('Planning'), 'the section carries its Planning label');
});

test('degrades to a docs-only column (no two-up grid) when the card has no node to show', () => {
  const html = render({ ...baseProps, artifacts, state: makeState(null, 'not_started') });
  assert.ok(html.includes('DEMO-REQUIREMENTS.md'), 'the docs list still renders');
  assert.ok(!html.includes('grid-cols-1 lg:grid-cols-2'), 'no two-up grid when the card is absent');
});

test('renders the card alone when there are no docs but a node resolves', () => {
  const html = render({ ...baseProps, artifacts: [], state: makeState('some_unmapped_node') });
  assert.ok(!html.includes('DEMO-REQUIREMENTS.md'), 'no docs rows');
  assert.ok(!html.includes('grid-cols-1 lg:grid-cols-2'), 'no two-up grid with a single column');
  assert.match(html, /<svg/, 'the card renders on its own');
});

test('renders nothing when there are neither docs nor a resolvable node', () => {
  const html = render({ ...baseProps, artifacts: [], state: makeState(null, 'not_started') });
  assert.equal(html, '');
});

// ─── Source shape — equal tracks, single gap token ─────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const source = readFileSync(join(__dirname, 'planning-section.tsx'), 'utf-8');

test('the two-up row uses equal 1fr tracks via grid-cols-1 lg:grid-cols-2', () => {
  assert.ok(/grid-cols-1 lg:grid-cols-2/.test(source), 'stacks to one column, splits to two equal tracks on lg');
});

test('the two-up row carries exactly one gap token from the spacing scale', () => {
  const gridClass = /className="(grid grid-cols-1 lg:grid-cols-2[^"]*)"/.exec(source);
  assert.ok(gridClass, 'the two-up grid className is present');
  const gaps = gridClass![1].match(/\bgap-\S+/g) ?? [];
  assert.equal(gaps.length, 1, `exactly one gap utility on the grid, found: ${gaps.join(', ')}`);
});

test('reuses the DagStateCard and PlanningDocsList rather than reimplementing them', () => {
  assert.ok(source.includes('DagStateCard'), 'composes the shared DAG-state card');
  assert.ok(source.includes('PlanningDocsList'), 'composes the shared planning docs list');
});

// ─── Spacing regression fix ─────────────────────────────────────────────────

test('wraps the docs-list rows in an inner div so they are not direct gap-4 flex children', () => {
  // The structure should be: <Card ...><div className="...py-2..."><PlanningDocsList /></div></Card>
  // This prevents the rows from being direct children of the Card's gap-4 flex container.
  const innerDivPattern = /<div className=\{cn\("py-2"/;
  assert.ok(
    innerDivPattern.test(source),
    'PlanningDocsList is wrapped in an inner div carrying py-2',
  );
});

test('the inner wrapper div carries py-2 padding, not relying on the Card gap-4 for row spacing', () => {
  // Verify the docs Card wraps a py-2 inner div (rather than spacing rows via the Card's own gap-4).
  const cardWithInnerDiv = /<Card className=\{cn\("py-2"[^}]*\}>\s*<div className=\{cn\("py-2"/;
  assert.ok(
    cardWithInnerDiv.test(source),
    'py-2 inner div wraps PlanningDocsList inside the docs Card',
  );
});

// ─── Card-governed row height via grid stretch (no fixed height) ──────────

test('the two-up grid relies on default stretch alignment — no items-start override, no fixed height utility anywhere in source', () => {
  assert.ok(
    !source.includes('items-start'),
    'the grid keeps the default align-items: stretch instead of overriding to start',
  );
  assert.ok(
    !/h-\[\d+px\]/.test(source),
    'no hand-picked pixel height utility governs the row — the card governs it via natural content height',
  );
  assert.ok(
    !source.includes('PLANNING_ROW_HEIGHT_CLASS'),
    'the fixed-height constant has been removed entirely, not just unused',
  );
});

test('the grid className carries exactly grid-cols-1 lg:grid-cols-2 gap-4 — no alignment override', () => {
  const html = render({ ...baseProps, artifacts, state: makeState('some_unmapped_node') });
  assert.match(html, /class="grid grid-cols-1 lg:grid-cols-2 gap-4"/, 'the two-up grid carries no extra alignment classes');
});

test('the docs list container scrolls internally rather than growing the shared row height', () => {
  const html = render({ ...baseProps, artifacts, state: makeState('some_unmapped_node') });
  assert.match(html, /overflow-y-auto/, 'the docs list wrapper carries overflow-y-auto for internal scroll');
});

test('the card renders directly in the grid row with no scroll-fallback wrapper around it', () => {
  const html = render({ ...baseProps, artifacts, state: makeState('some_unmapped_node') });
  assert.ok(!html.includes('*:shrink-0'), 'no shrink-0 scroll-fallback wrapper around the card');
  assert.ok(!html.includes('safe_center'), 'no centering scroll-fallback wrapper around the card');
});

test('the docs scroll container carries tabIndex so it is keyboard-focusable independent of its descendants', () => {
  const html = render({ ...baseProps, artifacts, state: makeState('some_unmapped_node') });
  assert.match(html, /tabindex="0"/, 'the scrollable docs container is directly reachable via Tab');
});

test('a solo docs column (no card) keeps its natural height — no forced internal scroll', () => {
  const html = render({ ...baseProps, artifacts, state: makeState(null, 'not_started') });
  assert.ok(!html.includes('overflow-y-auto'), 'no forced internal scroll outside the two-up row');
  assert.ok(!html.includes('tabindex="0"'), 'no forced tabindex outside the two-up row\'s scrollable case');
});

test('a solo card (no docs) keeps its natural height — no scroll-fallback wrapper', () => {
  const html = render({ ...baseProps, artifacts: [], state: makeState('some_unmapped_node') });
  assert.ok(!html.includes('*:shrink-0'), 'no scroll-fallback wrapper outside the two-up row');
});

// ─── Realistic content-bearing card in the card-governed row ──────────────
//
// The empty-controls fallback view (`makeState('some_unmapped_node')` above)
// never exercises the composition against a state view that actually renders
// controls. A `corrective` state — the state with the most controls (two doc
// buttons plus a multi-repo commit-chip group) — carries real, non-trivial
// content through the full `PlanningSection` / `DagStateCard` composition
// instead.

const CORRECTIVE_NODES: NodesRecord = {
  phase_loop: {
    kind: 'for_each_phase',
    status: 'in_progress',
    iterations: [
      {
        index: 0,
        status: 'in_progress',
        doc_path: 'phases/DAG-WIDGET-2-PHASE-03-PLANNING-SECTION-LAYOUT.md',
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
                doc_path: 'tasks/DAG-WIDGET-2-TASK-P03-T02-EQUAL-HEIGHT.md',
                repos: [{ name: 'rad-orc-source', commit_hash: 'ae581ca1abcdef1234567890' }],
                corrective_tasks: [
                  {
                    index: 1,
                    reason: 'phase_review changes_requested (orchestrator-mediated, F-6 drift in AGENTS.md)',
                    injected_after: 'code_review',
                    status: 'in_progress',
                    doc_path: 'tasks/DAG-WIDGET-2-TASK-P03-T02-CORRECTIVE-1.md',
                    repos: [
                      { name: 'rad-orc-source', commit_hash: 'd5967f84fedcba0987654321' },
                      { name: 'rad-orc-marketplace', commit_hash: 'a1b2c3d4e5f60718293a4b5c' },
                    ],
                    nodes: {
                      task_executor: { kind: 'step', status: 'in_progress', doc_path: null, retries: 0 },
                      code_review: { kind: 'step', status: 'not_started', doc_path: null, retries: 0 },
                    },
                  },
                ],
                nodes: {
                  task_executor: { kind: 'step', status: 'completed', doc_path: null, retries: 0 },
                  code_review: {
                    kind: 'step',
                    status: 'completed',
                    doc_path: 'reviews/DAG-WIDGET-2-REVIEW-P03-T02.md',
                    retries: 0,
                  },
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

function makeCorrectiveState(): ProjectStateV5 {
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
      nodes: CORRECTIVE_NODES,
    },
  };
}

test('a realistic corrective card (real repos, real reason string, real doc paths) renders fully inside the shared-height row without dropping content', () => {
  const html = render({
    ...baseProps,
    artifacts,
    state: makeCorrectiveState(),
    compareUrlByRepo: {
      'rad-orc-source': 'https://github.com/example/rad-orc-source/compare/main...branch',
      'rad-orc-marketplace': 'https://github.com/example/rad-orc-marketplace/compare/main...branch',
    },
  });

  // The corrective view's own real content is present in full — the two doc
  // buttons, both repos' commit chips, and the real reason string — none of
  // it stripped by the composition itself.
  assert.match(html, /Task Handoff/, 'the corrective task handoff doc button renders');
  assert.match(html, /Review Report/, 'the triggering review-report doc button renders');
  assert.match(html, /d5967f84/, "the corrective's own repo commit chip renders");
  assert.match(html, /a1b2c3d4/, "the corrective's second repo commit chip renders");
  assert.match(html, /F-6 drift in AGENTS\.md/, "the real corrective reason string renders in the card's meta line");

  // The card is never wrapped in scroll-fallback machinery — the row's
  // height comes from the card's own natural size, so there is nothing for
  // it to overflow in the first place.
  assert.ok(!html.includes('*:shrink-0'), 'a realistic corrective card carries no scroll-fallback wrapper');
});

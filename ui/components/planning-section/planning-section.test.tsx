import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PlanningSection, shouldShowStateCard } from './planning-section';
import type { Artifact } from '@/lib/artifact-model';
import type { ProjectStateV5, GraphStatus } from '@/types/state';
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
  // The structure should be: <Card><div className="py-2"><PlanningDocsList /></div></Card>
  // This prevents the rows from being direct children of the Card's gap-4 flex container.
  const innerDivPattern = /<div className="py-2">\s*<PlanningDocsList/;
  assert.ok(
    innerDivPattern.test(source),
    'PlanningDocsList is wrapped in an inner div with py-2 class',
  );
});

test('the inner wrapper div has py-2 padding, not relying on the Card gap-4 for row spacing', () => {
  // Verify the inner div exists and uses py-2 to control padding
  const cardWithInnerDiv = /<Card[^>]*>\s*<div className="py-2">/;
  assert.ok(
    cardWithInnerDiv.test(source),
    'inner py-2 div wraps PlanningDocsList inside Card',
  );
});

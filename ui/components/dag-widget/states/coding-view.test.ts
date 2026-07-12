import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { codingView } from './coding-view';
import { resolveStateView } from '../resolver';
import type { ProjectStateV5, NodesRecord } from '@/types/state';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).React = React;

const dir = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(dir, 'coding-view.tsx'), 'utf-8');

const noopDeps = { onDocClick: () => {}, compareUrlByRepo: {}, projectName: 'demo' };

function makeCodingState(complexity: string | undefined): ProjectStateV5 {
  const nodes: NodesRecord = {
    phase_loop: {
      kind: 'for_each_phase',
      status: 'in_progress',
      iterations: [
        {
          index: 0,
          status: 'in_progress',
          doc_path: null,
          repos: [],
          corrective_tasks: [],
          nodes: {
            task_loop: {
              kind: 'for_each_task',
              status: 'in_progress',
              iterations: [
                {
                  index: 0,
                  status: 'in_progress',
                  doc_path: 'tasks/T01.md',
                  repos: [],
                  corrective_tasks: [],
                  complexity,
                  nodes: {
                    task_executor: { kind: 'step', status: 'in_progress', doc_path: null, retries: 0 },
                    code_review: { kind: 'step', status: 'not_started', doc_path: null, retries: 0 },
                  },
                },
              ],
            },
          },
        },
      ],
    },
  };
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
      current_node_path: 'phase_loop.iter0.task_loop.iter0.task_executor',
      nodes,
    },
  };
}

// ─── source shape ─────────────────────────────────────────────────────────────

test('coding view id is "coding"', () => {
  assert.equal(codingView.id, 'coding');
});

test('coding view renders no badge', () => {
  assert.ok(!source.includes('SpinnerBadge'), 'the badge is retired in favor of the heading/meta anatomy');
});

test('coding view heading/meta are sourced from deriveCardHeading, not composed inline', () => {
  assert.match(source, /deriveCardHeading\(ctx\)/);
  assert.match(source, /<HeadingSlot\s+heading=\{heading\}\s+hasMeta=\{meta !== null\}\s*\/>/);
  assert.match(source, /<MetaSlot\s+meta=\{meta\}\s*\/>/);
});

test('coding view wraps its controls in CardControlsRow and uses DocButton, not DocumentLink', () => {
  assert.match(source, /CardControlsRow/);
  assert.match(source, /DocButton/);
  assert.ok(!source.includes('DocumentLink'), 'the text doc link is retired in favor of the real button');
});

test('coding view surfaces only the Task Handoff doc control alongside the commit chip', () => {
  assert.ok(!source.includes('Code Review'));
  assert.ok(!source.includes('Review Report'));
});

test('coding view ring center carries a "TASK" sublabel', () => {
  assert.match(source, /sublabel="TASK"/);
});

test('coding view plots whole-graph progress', () => {
  assert.match(source, /deriveRingArc\(ctx\.wholeGraphProgress\)/);
});

test('coding view renders a commit chip', () => {
  assert.match(source, /CommitChips/);
});

test('coding view tints its doc controls to the amber execution tier', () => {
  assert.match(source, /--tier-execution/);
});

test('coding view renders the Task Handoff doc link', () => {
  assert.match(source, /label="Task Handoff"/);
});

test('coding view sets no slot geometry — the shared slot wrappers own layout', () => {
  assert.ok(!/gridArea|gridTemplate|grid-template/.test(source));
  assert.ok(!source.includes('RING_DIAMETER'));
});

// ─── jsdom render check — Difficulty meta segment ─────────────────────────

test('Coding renders a "Difficulty: <Complexity>" meta segment when the task iteration carries a complexity', () => {
  const { view, ctx } = resolveStateView(makeCodingState('standard'), undefined, noopDeps);
  assert.equal(ctx.stateId, 'coding');
  const html = renderToStaticMarkup(createElement('div', null, view.render(ctx)));
  assert.match(html, /Difficulty: Standard/);
});

test('Coding renders no Difficulty segment when the task iteration carries no complexity', () => {
  const { view, ctx } = resolveStateView(makeCodingState(undefined), undefined, noopDeps);
  assert.equal(ctx.stateId, 'coding');
  const html = renderToStaticMarkup(createElement('div', null, view.render(ctx)));
  assert.ok(!html.includes('Difficulty'));
});

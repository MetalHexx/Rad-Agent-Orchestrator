import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ArtifactTile } from './artifact-tile';
import { PlanningDocsList } from '@/components/planning-section/planning-docs-list';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).React = React;

const ART = { fileName: 'A.html', kind: 'html' as const, label: 'Visual', title: null, isMarkdown: false };

test('a tile with an unseen file shows the change badge and pulses when active (FR-7, FR-6)', () => {
  const html = renderToStaticMarkup(createElement(ArtifactTile, {
    projectName: 'DEMO', artifact: ART, onOpen: () => {}, onDelete: () => {},
    unseen: true, activePulse: true,
  } as never));
  assert.ok(html.includes('var(--live)'), 'lavender change badge present');
  assert.ok(html.includes('live-pulse-frame'), 'frame pulse applied when active');
});

test('a DAG row uses the row-background pulse variant (DD-2)', () => {
  const html = renderToStaticMarkup(createElement(PlanningDocsList, {
    artifacts: [ART], requirementsStatus: null, onOpen: () => {}, onDelete: () => {},
    unseen: new Set(['A.html']), activePulse: new Set(['A.html']),
  } as never));
  assert.ok(html.includes('live-pulse-row'), 'row pulse variant on DAG rows');
  assert.ok(html.includes('var(--live)'), 'change badge present on the row');
});

test('a seen file shows no change badge — synced clear (DD-4, FR-8)', () => {
  const html = renderToStaticMarkup(createElement(ArtifactTile, {
    projectName: 'DEMO', artifact: ART, onOpen: () => {}, onDelete: () => {},
    unseen: false, activePulse: false,
  } as never));
  assert.ok(!html.includes('Unseen change'), 'no badge once seen');
});

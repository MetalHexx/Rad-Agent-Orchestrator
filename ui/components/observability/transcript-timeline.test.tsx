import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TranscriptTimeline } from './transcript-timeline';
Object.assign(globalThis, { React });

const events = [
  { seq: 1, timestamp: '2026-06-24T09:00:00.000Z', kind: 'message', role: 'user', text: 'build it' },
  { seq: 2, timestamp: '2026-06-24T09:00:01.000Z', kind: 'thinking', text: 'planning' },
  { seq: 3, timestamp: '2026-06-24T09:00:02.000Z', kind: 'tool_call', tool: { name: 'Bash', input: { text: 'npm run build' }, toolUseId: 'a' } },
  { seq: 4, timestamp: '2026-06-24T09:00:03.000Z', kind: 'tool_result', result: { toolUseId: 'a', output: { text: 'done' }, isError: false } },
];
const render = (over: Record<string, unknown> = {}) =>
  renderToStaticMarkup(createElement(TranscriptTimeline, { events, errorCursor: -1, ...over } as never));

test('renders already-filtered events in order as cards (FR-2, FR-11)', () => {
  const html = render();
  assert.ok(html.indexOf('build it') < html.indexOf('planning'), 'chronological order preserved');
  assert.ok(html.includes('Bash') && html.includes('done'), 'tool pair rendered');
});

test('tool-result bodies render by default — filtering is upstream via applyFacets, not a showToolIO prop', () => {
  const html = render();
  assert.ok(html.includes('done'), 'result body visible without any showToolIO wiring');
});

test('an empty (already-filtered) event list shows the empty state, never a blank panel (FR-2)', () => {
  assert.ok(/no events match/i.test(render({ events: [] })), 'empty-state shown when a facet-off empties the list');
});

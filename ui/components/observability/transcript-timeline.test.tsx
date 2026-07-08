import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TranscriptTimeline } from './transcript-timeline';
import { originatingToolByResult } from '@/lib/observability/tool-calls';
import { applyFacets, type TranscriptFacetState } from '@/lib/observability/transcript-view';
Object.assign(globalThis, { React });

const events = [
  { seq: 1, timestamp: '2026-06-24T09:00:00.000Z', kind: 'message', role: 'user', text: 'build it' },
  { seq: 2, timestamp: '2026-06-24T09:00:01.000Z', kind: 'thinking', text: 'planning' },
  { seq: 3, timestamp: '2026-06-24T09:00:02.000Z', kind: 'tool_call', tool: { name: 'Bash', input: { text: 'npm run build' }, toolUseId: 'a' } },
  { seq: 4, timestamp: '2026-06-24T09:00:03.000Z', kind: 'tool_result', result: { toolUseId: 'a', output: { text: 'done' }, isError: false } },
];
const render = (over: Record<string, unknown> = {}) =>
  renderToStaticMarkup(createElement(TranscriptTimeline, {
    events,
    originatingToolByResultSeq: originatingToolByResult(events as never),
    errorCursor: -1,
    ...over,
  } as never));

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

// Regression (phase review Finding 1): a Read tool_call hidden by the Tools facet
// while its tool_result stays visible must not reintroduce the doubled line-number
// gutter. originatingToolByResultSeq is threaded in from the caller (built from the
// FULL, unfiltered transcript — see transcript-facet.tsx), so it must still resolve
// even though `events` here (what the facet-filtered list looks like) no longer
// contains the Read tool_call.
test('a Read tool_result still suppresses the line-number gutter when its tool_call is hidden by the Tools facet', () => {
  const fullEvents = [
    { seq: 1, timestamp: '2026-07-08T09:00:00.000Z', kind: 'tool_call', tool: { name: 'Read', input: { text: JSON.stringify({ file_path: 'ui/lib/foo.ts' }) }, toolUseId: 'r1' } },
    { seq: 2, timestamp: '2026-07-08T09:00:01.000Z', kind: 'tool_result', result: { toolUseId: 'r1', output: { text: '     1\tfoo\n     2\tbar' }, isError: false } },
    { seq: 3, timestamp: '2026-07-08T09:00:02.000Z', kind: 'tool_call', tool: { name: 'Bash', input: { text: 'npm test' }, toolUseId: 'b1' } },
    { seq: 4, timestamp: '2026-07-08T09:00:03.000Z', kind: 'tool_result', result: { toolUseId: 'b1', output: { text: 'ok' }, isError: false } },
  ];
  const facets: TranscriptFacetState = {
    types: { user: true, assistant: true, thinking: true, toolResults: true, errors: true },
    tools: new Set(['Bash']), // Read deselected — its tool_call is filtered out
    files: 'all',
    query: '',
  };
  const filtered = applyFacets(fullEvents as never, facets);
  assert.ok(
    !filtered.some((e) => e.kind === 'tool_call' && e.tool?.name === 'Read'),
    'sanity: the Read tool_call is actually filtered out of the events the timeline renders',
  );
  assert.ok(
    filtered.some((e) => e.kind === 'tool_result' && e.result?.toolUseId === 'r1'),
    'sanity: the Read tool_result is still visible (governed by the separate toolResults facet)',
  );

  const html = render({
    events: filtered,
    originatingToolByResultSeq: originatingToolByResult(fullEvents as never), // built from the UNFILTERED list
  });
  // Scope the assertion to the Read result's own card (data-seq="2") — the
  // sibling Bash result legitimately keeps its added gutter, so a whole-document
  // check would false-positive on that unrelated card's numbering.
  const cardMatch = /<div data-seq="2">([\s\S]*?)<\/div><div data-seq="3">/.exec(html);
  assert.ok(cardMatch, 'the Read result card is present in the rendered output');
  const card = cardMatch![1];
  assert.ok(card.includes('foo') && card.includes('bar'), 'Read result body still renders');
  assert.ok(!/>1</.test(card) && !/>2</.test(card), 'no added line-number gutter doubling the baked-in cat -n numbers');
});

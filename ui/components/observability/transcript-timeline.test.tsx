import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TranscriptTimeline } from './transcript-timeline';
Object.assign(globalThis, { React });

const base = { showThinking: true, showToolIO: true, query: '', errorCursor: -1 };
const events = [
  { seq: 1, timestamp: '2026-06-24T09:00:00.000Z', kind: 'message', role: 'user', text: 'build it' },
  { seq: 2, timestamp: '2026-06-24T09:00:01.000Z', kind: 'thinking', text: 'planning' },
  { seq: 3, timestamp: '2026-06-24T09:00:02.000Z', kind: 'tool_call', tool: { name: 'Bash', input: { text: 'npm run build' }, toolUseId: 'a' } },
  { seq: 4, timestamp: '2026-06-24T09:00:03.000Z', kind: 'tool_result', result: { toolUseId: 'a', output: { text: 'done' }, isError: false } },
];
const render = (over: Record<string, unknown> = {}) =>
  renderToStaticMarkup(createElement(TranscriptTimeline, { ...base, events, ...over } as never));

test('renders events in order as cards (FR-2, FR-11)', () => {
  const html = render();
  assert.ok(html.indexOf('build it') < html.indexOf('planning'), 'chronological order preserved');
  assert.ok(html.includes('Bash') && html.includes('done'), 'tool pair rendered');
});

test('Thinking-off hides thinking cards (FR-7)', () => {
  assert.ok(!render({ showThinking: false }).includes('planning'), 'thinking hidden');
});

test('query filters the stream (FR-9, DD-8)', () => {
  const html = render({ query: 'build it' });
  assert.ok(html.includes('build it') && !html.includes('planning'), 'only matching card shown');
});

test('a no-match filter shows an empty-state, never a blank panel (FR-2)', () => {
  assert.ok(/no events match/i.test(render({ query: 'zzz-no-match' })), 'empty-state shown');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ToolCallsTable } from './tool-calls-table';
Object.assign(globalThis, { React });

const mkCall = (seq: number, name: string, text: string, isError: boolean) => ({
  seq, name, input: { text }, isError,
  callEvent: { seq, timestamp: '2026-06-24T09:00:00.000Z', kind: 'tool_call', tool: { name, input: { text }, toolUseId: `u${seq}` } },
  resultEvent: { seq: seq + 1, timestamp: '2026-06-24T09:00:01.000Z', kind: 'tool_result', result: { toolUseId: `u${seq}`, output: { text: isError ? 'boom' : 'ok-output' }, isError } },
});
const calls = [mkCall(1, 'Read', 'alpha.ts', false), mkCall(3, 'Bash', 'npm test', true)];
const render = (over: Record<string, unknown> = {}) =>
  renderToStaticMarkup(createElement(ToolCallsTable, { calls, expanded: new Set(), onToggle: () => {}, ...over } as never));

test('renders a header and one row per call with ordinal, tool, and snippet (FR-4, DD-7, DD-9)', () => {
  const html = render();
  assert.ok(html.includes('Tool') && html.includes('Input') && html.includes('Status'), 'column headers');
  assert.ok(html.includes('Read') && html.includes('alpha.ts'), 'row 1 tool + input snippet');
  assert.ok(html.includes('>1<') && html.includes('>2<'), 'ordinals are 1..N, not the event seq');
});

test('status is a labelled badge — ok green, error red, no dots (FR-8, DD-3)', () => {
  const html = render();
  assert.ok(html.includes('ok') && html.includes('var(--model-green)'), 'ok → green success badge');
  assert.ok(html.includes('error') && html.includes('text-destructive'), 'error → red destructive badge');
});

test('collapsed rows expose aria-expanded and hide the detail (FR-5, NFR-4)', () => {
  const html = render();
  assert.ok(/aria-expanded="false"/.test(html), 'collapsed rows expose state to AT');
  assert.ok(!html.includes('ok-output'), 'result body hidden while collapsed');
});

test('an expanded row renders the paired call + result via TranscriptEventCard (FR-5, DD-8)', () => {
  const html = render({ expanded: new Set([1]) });
  assert.ok(/aria-expanded="true"/.test(html), 'open row marked expanded');
  assert.ok(html.includes('Tool call') && html.includes('Result'), 'call + result cards present');
  assert.ok(html.includes('ok-output'), 'result body visible in the expansion (showToolIO)');
});

test('empty calls render a no-match message, never a blank table (FR-7)', () => {
  assert.ok(/no matching tool calls/i.test(render({ calls: [] })));
});

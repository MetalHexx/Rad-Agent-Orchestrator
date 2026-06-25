import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FilesTouchedList } from './files-touched-list';
Object.assign(globalThis, { React });

const change = (seq: number, op: 'edit' | 'write', fp: string, out: string) => ({
  seq, op,
  callEvent: { seq, timestamp: '2026-06-24T09:00:00.000Z', kind: 'tool_call', tool: { name: op === 'write' ? 'Write' : 'Edit', input: { text: `${op} ${fp}` }, toolUseId: `u${seq}` } },
  resultEvent: { seq: seq + 1, timestamp: '2026-06-24T09:00:01.000Z', kind: 'tool_result', result: { toolUseId: `u${seq}`, output: { text: out }, isError: false } },
});
const files = [
  { path: 'src/app/page.tsx', ops: ['write'], changes: [change(1, 'write', 'src/app/page.tsx', 'wrote-page')] },
  { path: 'src/lib/util.ts', ops: ['edit'], changes: [change(3, 'edit', 'src/lib/util.ts', 'patched-a'), change(5, 'edit', 'src/lib/util.ts', 'patched-b')] },
];
const render = (over: Record<string, unknown> = {}) =>
  renderToStaticMarkup(createElement(FilesTouchedList, { files, expanded: new Set(), onToggle: () => {}, ...over } as never));

test('renders one row per path with op badge, basename, and ×N (FR-1, FR-2, DD-4)', () => {
  const html = render();
  assert.ok(html.includes('page.tsx') && html.includes('util.ts'), 'a row per path');
  assert.ok(html.includes('write') && html.includes('edit'), 'op badge per op');
  assert.ok(html.includes('×2'), 'multi-change path shows the ×N count');
});

test('collapsed rows expose aria-expanded and hide the detail (FR-3, NFR-4)', () => {
  const html = render();
  assert.ok(/aria-expanded="false"/.test(html), 'collapsed rows expose state to AT');
  assert.ok(!html.includes('wrote-page'), 'call/result detail hidden while collapsed');
});

test('an expanded row renders each change as a paired call + result card (FR-3, DD-5)', () => {
  const html = render({ expanded: new Set([3]) }); // util.ts row key = its first change seq
  assert.ok(/aria-expanded="true"/.test(html), 'open row marked expanded');
  assert.ok(html.includes('change 1') && html.includes('change 2'), 'a step label per change, in order');
  assert.ok(html.includes('patched-a') && html.includes('patched-b'), 'both change results visible (showToolIO)');
});

test('no literal hex — house tokens only (DD-1)', () => {
  assert.ok(!/#[0-9a-fA-F]{6}/.test(render()), 'no raw hex in markup');
});

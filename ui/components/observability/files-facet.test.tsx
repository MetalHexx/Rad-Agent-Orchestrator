import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FilesFacet } from './files-facet';
Object.assign(globalThis, { React });

const ev = (seq: number, kind: string, over: Record<string, unknown>) =>
  ({ seq, timestamp: '2026-06-24T09:00:00.000Z', kind, ...over });

// Build a transcript whose events carry Write/Edit calls + adjacent file_change, as the reader ships it.
const mkTranscript = (touches: Array<[string, 'edit' | 'write']>) => {
  const events: unknown[] = [];
  touches.forEach(([path, op], i) => {
    const useId = `u${i}`;
    const name = op === 'write' ? 'Write' : 'Edit';
    events.push(ev(i * 3 + 1, 'tool_call', { tool: { name, input: { text: `${name} ${path}` }, toolUseId: useId } }));
    events.push(ev(i * 3 + 2, 'tool_result', { result: { toolUseId: useId, output: { text: 'ok' }, isError: false } }));
    events.push(ev(i * 3 + 3, 'file_change', { file: { path, op } }));
  });
  return {
    transcriptId: 't1', sessionId: 's1', harness: 'claude-code', role: 'subagent', model: ['claude-opus-4-8'],
    tokens: { in: 0, out: 0, cacheRead: 0, cacheCreate: 0 },
    toolSummary: { total: touches.length, byName: {}, errors: 0 },
    filesTouched: [...new Set(touches.map(([p]) => p))], events,
  };
};
const render = (t: unknown) => renderToStaticMarkup(createElement(FilesFacet, { transcript: t } as never));

test('populated: header summary counts created vs edited and mounts the list (FR-4, DD-6)', () => {
  const html = render(mkTranscript([['a.ts', 'write'], ['b.ts', 'edit'], ['c.ts', 'write']]));
  assert.ok(html.includes('Files changed'), 'card header present');
  assert.ok(html.includes('>3<') && html.includes('files'), 'N files total');
  assert.ok(html.includes('>2<') && html.includes('created'), 'created = paths with a write op');
  assert.ok(html.includes('>1<') && html.includes('edited'), 'edited = the rest');
  assert.ok(html.includes('a.ts') && html.includes('b.ts'), 'a row per path');
});

test('empty: read-only empty state with the empty-vs-absent note, no list (FR-5, DD-7)', () => {
  const html = render(mkTranscript([]));
  assert.ok(html.includes('No files changed'), 'empty headline');
  assert.ok(/read-only agent/i.test(html), 'read-only reason');
  assert.ok(/no transcript captured/i.test(html), 'empty-vs-absent foot-note');
  assert.ok(!html.includes('Files changed'), 'no populated header in the empty state');
});

test('realtime-by-props: a fresh transcript reflects new files (FR-7, NFR-2)', () => {
  const before = render(mkTranscript([['a.ts', 'write']]));
  assert.ok(before.includes('>1<') && before.includes('files'), 'one file before the tick');
  const after = render(mkTranscript([['a.ts', 'write'], ['b.ts', 'edit']]));
  assert.ok(after.includes('>2<') && after.includes('files'), 'two files after the tick');
});

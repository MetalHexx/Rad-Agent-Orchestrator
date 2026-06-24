import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ToolsFacet } from './tools-facet';
Object.assign(globalThis, { React });

const ev = (seq: number, kind: string, over: Record<string, unknown>) =>
  ({ seq, timestamp: '2026-06-24T09:00:00.000Z', kind, ...over });

// Build a transcript whose toolSummary and events agree, the way the reader API ships it.
const mkTranscript = (calls: Array<[string, boolean]>) => {
  const events: unknown[] = [];
  const byName: Record<string, number> = {};
  let total = 0, errors = 0;
  calls.forEach(([name, isError], i) => {
    const useId = `u${i}`;
    events.push(ev(i * 2 + 1, 'tool_call', { tool: { name, input: { text: `${name}-input-${i}` }, toolUseId: useId } }));
    events.push(ev(i * 2 + 2, 'tool_result', { result: { toolUseId: useId, output: { text: isError ? 'boom' : 'ok' }, isError } }));
    byName[name] = (byName[name] ?? 0) + 1; total += 1; if (isError) errors += 1;
  });
  return {
    transcriptId: 't1', sessionId: 's1', harness: 'claude-code', role: 'subagent', model: ['claude-opus-4-8'],
    tokens: { in: 0, out: 0, cacheRead: 0, cacheCreate: 0 },
    toolSummary: { total, byName, errors }, filesTouched: [], events,
  };
};
const render = (t: unknown) => renderToStaticMarkup(createElement(ToolsFacet, { transcript: t } as never));

test('composes the breakdown and the calls table from the transcript (FR-1, DD-1)', () => {
  const html = render(mkTranscript([['Read', false], ['Bash', true]]));
  assert.ok(html.includes('Calls by tool'), 'breakdown card mounted');
  assert.ok(html.includes('Search inputs'), 'calls card controls mounted');
  assert.ok(html.includes('Read') && html.includes('Bash'), 'a row per call');
  assert.ok(html.includes('showing 2 of 2'), 'showing count reflects all calls');
});

test('is realtime-by-props: a fresh transcript object reflects new calls (FR-9, NFR-2, AD-5)', () => {
  const before = render(mkTranscript([['Read', false]]));
  assert.ok(before.includes('total 1 calls · 1 tool'), 'breakdown shows one call before the tick');
  assert.ok(before.includes('showing 1 of 1'), 'table shows one row before');
  const after = render(mkTranscript([['Read', false], ['Read', false], ['Glob', true]]));
  assert.ok(after.includes('total 3 calls · 2 tools'), 'breakdown reflects the updated transcript');
  assert.ok(after.includes('showing 3 of 3'), 'table reflects the updated transcript');
});

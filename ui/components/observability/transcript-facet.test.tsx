import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TranscriptFacet } from './transcript-facet';
Object.assign(globalThis, { React });

const transcript = {
  transcriptId: 't1', sessionId: 's1', harness: 'claude-code', role: 'subagent', model: ['claude-opus-4-8'],
  tokens: { in: 0, out: 0, cacheRead: 0, cacheCreate: 0 },
  toolSummary: { total: 1, byName: { Bash: 1 }, errors: 1 }, filesTouched: [],
  events: [
    { seq: 1, timestamp: '2026-06-24T09:00:00.000Z', kind: 'message', role: 'assistant', text: 'starting' },
    { seq: 2, timestamp: '2026-06-24T09:00:01.000Z', kind: 'tool_result', result: { toolUseId: 'a', output: { text: 'boom' }, isError: true } },
  ],
};

test('composes controls + timeline and surfaces the live error count (FR-1, FR-6, FR-10, AD-5)', () => {
  const html = renderToStaticMarkup(createElement(TranscriptFacet, { transcript } as never));
  assert.ok(html.includes('Search transcript'), 'controls bar mounted');
  assert.ok(html.includes('Errors (1)'), 'error count derived from events');
  assert.ok(html.includes('starting'), 'timeline mounted with events');
});

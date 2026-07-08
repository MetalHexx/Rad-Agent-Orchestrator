import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TranscriptFacet } from './transcript-facet';
Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

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

// Regression: the `Errors (N)` badge/button must track the *filtered* event list,
// not the transcript's raw list — otherwise toggling the Errors type off leaves a
// stale, enabled button whose click silently no-ops (the jump effect operates on
// the filtered list too, so it never finds the stale target).
test('turning the Errors type switch off drops the Errors(N) button to 0 and disables it', async () => {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<!doctype html><div id="root"></div>');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).window = dom.window;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).document = dom.window.document;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).HTMLElement = dom.window.HTMLElement;

  const { createRoot } = await import('react-dom/client');
  const { act } = await import('react');

  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(TranscriptFacet, { transcript } as never));
  });

  const errorsButton = () =>
    [...container.querySelectorAll('button')].find((b) => /Errors \(/.test(b.textContent ?? ''))!;

  assert.ok(errorsButton().textContent?.includes('Errors (1)'), 'initial unfiltered error count shown');
  assert.ok(!errorsButton().hasAttribute('disabled'), 'button starts enabled — there is a reachable error');

  const errorsSwitchInput = container.querySelector('#t-type-errors') as HTMLInputElement;
  assert.ok(errorsSwitchInput, 'the Errors type switch input is present');
  await act(async () => {
    errorsSwitchInput.click();
  });

  assert.ok(errorsButton().textContent?.includes('Errors (0)'), 'count drops to 0 once the only error is filtered out of view');
  assert.ok(errorsButton().hasAttribute('disabled'), 'button disables rather than staying a silent no-op');

  await act(async () => { root.unmount(); });
});

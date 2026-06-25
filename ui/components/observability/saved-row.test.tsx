import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SavedRow } from './saved-row';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).React = React;

const session = { sessionId: 's1', title: 's1', savedAt: '2026-06-25T00:00:00.000Z',
  snapshot: { worktree: null, model: null, startedAt: '', durationMs: 0, totalSpend: 0,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }, toolCalls: 0, toolErrors: 0, subagents: 0, filesTouched: 0 } };

test('renders the rename (pencil) control on the row (FR-5, DD-4)', () => {
  const html = renderToStaticMarkup(createElement(SavedRow, { session }));
  assert.ok(html.includes('aria-label="Rename benchmark"'), 'pencil rename control present in display mode');
});

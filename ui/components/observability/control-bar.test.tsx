import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ControlBar } from './control-bar';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).React = React;

const props = {
  worktrees: ['C:\\dev\\orchestration\\v3'], worktree: 'All', onWorktree: () => {},
  sessions: ['abc'], session: 'All', onSession: () => {},
  onEarlier: () => {}, canEarlier: true, onHelp: () => {},
};

test('shows Today and Earlier labels but not the word "Window" (DD-4)', () => {
  const html = renderToStaticMarkup(createElement(ControlBar, props));
  assert.ok(html.includes('Today') && html.includes('Earlier'), 'day labels present');
  assert.ok(!html.includes('Window'), 'the word "Window" is not shown');
});

test('worktree and session filters default to "All" and a Help button exists (FR-6, DD-4)', () => {
  const html = renderToStaticMarkup(createElement(ControlBar, props));
  assert.ok(html.includes('All'), 'filters offer an All default');
  assert.ok(html.toLowerCase().includes('help') || html.includes('?'), 'a Help (?) button is present');
});

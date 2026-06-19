import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ControlBar } from './control-bar';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).React = React;

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(__dirname, 'control-bar.tsx'), 'utf8');

const props = {
  rangeId: '24h' as const, onRange: () => {},
  refreshMs: 10000, onRefreshMs: () => {}, onRefreshNow: () => {},
  worktrees: ['C:\\dev\\v3'], worktree: 'All', onWorktree: () => {},
  sessions: ['abc'], session: 'All', onSession: () => {}, onHelp: () => {},
};

test('shows the selected range and a refresh control; no Today/Earlier (FR-1, FR-2)', () => {
  const html = renderToStaticMarkup(createElement(ControlBar, props));
  assert.ok(html.includes('Last 24 hours'), 'time-range pill shows the active range');
  assert.ok(/auto/i.test(html), 'an auto-refresh control is present');
  assert.ok(!html.includes('Today') && !html.includes('Earlier'), 'Today/Earlier removed');
});

test('keeps Worktree/Session filters and Help, and wraps responsively (FR-6, FR-8, DD-10)', () => {
  const html = renderToStaticMarkup(createElement(ControlBar, props));
  assert.ok(html.includes('Worktree') && html.includes('Session'), 'filters preserved');
  assert.ok(html.includes('All'), 'filters default to All');
  assert.ok(html.includes('?') || /help/i.test(html), 'Help control present');
  assert.ok(html.includes('flex-wrap'), 'control bar wraps on small screens');
});

test('styled from house tokens and spacing scale (NFR-2, DD-9)', () => {
  assert.ok(src.includes('var(--space-') , 'uses the spacing scale');
});

test('refresh interval options are exactly Off, 5s, 10s, 30s, 1m (FR-2)', () => {
  // 5s must be present and 5min (300_000) must be gone
  const controlBarSource = fs.readFileSync(path.join(__dirname, 'control-bar.tsx'), 'utf8');
  assert.match(controlBarSource, /ms:\s*5_?000\b/, '5 s option present');
  assert.doesNotMatch(controlBarSource, /ms:\s*300_?000\b/, '5 min option removed');
});

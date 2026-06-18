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
const controlBarSource = fs.readFileSync(path.join(__dirname, 'control-bar.tsx'), 'utf8');

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

test('Today/Earlier day controls carry an explanatory tooltip (FR-14, DD-10)', () => {
  assert.match(
    controlBarSource,
    /from\s*["']@\/components\/ui\/tooltip["']/,
    "control-bar imports from the house tooltip module"
  );
  assert.ok(
    controlBarSource.includes('TooltipTrigger') && controlBarSource.includes('TooltipContent'),
    "control-bar uses TooltipTrigger and TooltipContent"
  );
  // Today must be wrapped in a tooltip
  assert.match(
    controlBarSource,
    /TooltipTrigger[\s\S]{0,300}Today[\s\S]{0,300}TooltipContent/,
    "Today label is enclosed by TooltipTrigger/TooltipContent"
  );
  // Earlier must be wrapped in a tooltip
  assert.match(
    controlBarSource,
    /TooltipTrigger[\s\S]{0,300}Earlier[\s\S]{0,300}TooltipContent/,
    "Earlier button is enclosed by TooltipTrigger/TooltipContent"
  );
});

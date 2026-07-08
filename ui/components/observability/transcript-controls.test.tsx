import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TranscriptControls } from './transcript-controls';
Object.assign(globalThis, { React });

const noop = () => {};
const allTypes = { user: true, assistant: true, thinking: true, errors: true };
const base = {
  types: allTypes, onTypeChange: noop,
  tools: 'all' as const, onToolsChange: noop, toolOptions: [{ value: 'Bash', count: 3 }],
  files: 'all' as const, onFilesChange: noop, fileOptions: [{ value: 'edit', count: 2 }],
  query: '', onQuery: noop,
};

const controlsSource = fs.readFileSync(
  path.join(path.dirname(url.fileURLToPath(import.meta.url)), 'transcript-controls.tsx'), 'utf8');

test('renders the four Show toggles, the Tools/Files dropdown triggers, search, and the error count', () => {
  const html = renderToStaticMarkup(createElement(TranscriptControls, { ...base, errorCount: 2, onJumpError: noop } as never));
  for (const label of ['User', 'Assistant', 'Thinking', 'Errors']) {
    assert.ok(html.includes(label), `${label} toggle label present`);
  }
  assert.ok(html.includes('Tools') && html.includes('Files'), 'Tools/Files dropdown triggers present');
  assert.ok(html.includes('Search transcript'), 'search placeholder present');
  assert.ok(html.includes('Errors (2)'), 'error count shown');
  assert.ok(!/#[0-9a-fA-F]{6}/.test(html), 'no literal hex (NFR-3)');
});

test('errors button is disabled when there are no errors', () => {
  const html = renderToStaticMarkup(createElement(TranscriptControls, { ...base, errorCount: 0, onJumpError: noop } as never));
  assert.ok(html.includes('Errors (0)') && /disabled/.test(html), 'zero count + disabled');
});

test('Row 1 wires the four Switches then the two FacetMultiselects; the search sits on its own row (wireframe layout)', () => {
  const order = ['"user"', '"assistant"', '"thinking"', '"errors"', 'label="Tools"', 'label="Files"'];
  let last = -1;
  for (const token of order) {
    const idx = controlsSource.indexOf(token);
    assert.ok(idx !== -1 && idx > last, `${token} appears in order after the previous control`);
    last = idx;
  }
  const row1End = controlsSource.indexOf('Row 2:');
  const searchIdx = controlsSource.indexOf('Search transcript');
  const errorsIdx = controlsSource.indexOf('Errors (');
  assert.ok(last < row1End, 'the toggles/dropdowns are wired before the Row 2 marker');
  assert.ok(row1End < searchIdx, 'the search input belongs to row 2, not row 1');
  assert.ok(searchIdx < errorsIdx, 'the errors jump button sits after the search on row 2');
});

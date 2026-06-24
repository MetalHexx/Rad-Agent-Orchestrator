import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TranscriptControls } from './transcript-controls';
Object.assign(globalThis, { React });

const noop = () => {};
const base = { showThinking: true, onShowThinking: noop, showToolIO: true, onShowToolIO: noop, query: '', onQuery: noop };

test('renders the four read controls with labels and placeholder (FR-6, DD-5)', () => {
  const html = renderToStaticMarkup(createElement(TranscriptControls, { ...base, errorCount: 2, onJumpError: noop } as never));
  assert.ok(html.includes('Thinking') && html.includes('Tool I/O'), 'toggle labels present');
  assert.ok(html.includes('Search transcript'), 'search placeholder present');
  assert.ok(html.includes('Errors (2)'), 'error count shown');
  assert.ok(!/#[0-9a-fA-F]{6}/.test(html), 'no literal hex (NFR-3)');
});

test('errors button is disabled when there are no errors (FR-10, NFR-4)', () => {
  const html = renderToStaticMarkup(createElement(TranscriptControls, { ...base, errorCount: 0, onJumpError: noop } as never));
  assert.ok(html.includes('Errors (0)') && /disabled/.test(html), 'zero count + disabled');
});

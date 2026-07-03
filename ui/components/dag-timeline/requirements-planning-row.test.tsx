import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { RequirementsPlanningRow } from './requirements-planning-row';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).React = React;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const FILE_NAME = 'DEMO-REQUIREMENTS.md';
const noop = () => {};

function render(): string {
  return renderToStaticMarkup(createElement(RequirementsPlanningRow, { fileName: FILE_NAME, onDocClick: noop }));
}

test('exposes an accessible "Requirements" open control', () => {
  const html = render();
  assert.ok(html.includes('aria-label="Requirements — authored"'), 'button carries the authored accessible label');
  assert.ok(html.includes('>Requirements<'), 'visible "Requirements" label rendered');
});

test('the open control is a real <button>, not a nested role="button" span', () => {
  const html = render();
  assert.ok(/<button[^>]*aria-label="Requirements — authored"/.test(html), 'open control is a real <button>');
  assert.ok(!html.includes('role="button"'), 'no synthetic role="button" control');
});

test('carries no spinner / pipeline-status affordance', () => {
  const html = render();
  assert.ok(!html.includes('animate-spin'), 'no spinner icon (row is a static authored badge, not a pipeline row)');
  assert.ok(!/Not Started|In Progress|Failed|Halted/.test(html), 'no pipeline status label');
});

test('is not stamped into the timeline roving-focus set', () => {
  const html = render();
  assert.ok(!html.includes('data-timeline-row'), 'row must not carry data-timeline-row (static artifact, not roving-focus)');
  assert.ok(!html.includes('data-row-key'), 'row must not carry data-row-key');
});

test('clicking the open control invokes onDocClick with the filename', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).window = dom.window;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).document = dom.window.document;

  const { createRoot } = await import('react-dom/client');
  const { act } = await import('react');

  const clicks: string[] = [];
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(RequirementsPlanningRow, { fileName: FILE_NAME, onDocClick: (p) => clicks.push(p) }));
  });

  const button = container.querySelector('button[aria-label="Requirements — authored"]') as HTMLButtonElement;
  assert.ok(button, 'button must be present in the rendered DOM');
  await act(async () => {
    button.click();
  });

  assert.deepStrictEqual(clicks, [FILE_NAME], 'onDocClick fired once with the doc filename');

  await act(async () => { root.unmount(); });
});

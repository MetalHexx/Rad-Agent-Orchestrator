import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CardControlsRow, DocButton } from './card-controls';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).React = React;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// ─── CardControlsRow ────────────────────────────────────────────────────────

test('CardControlsRow renders its children', () => {
  const html = renderToStaticMarkup(
    createElement(CardControlsRow, null, createElement('span', null, 'child-a'), createElement('span', null, 'child-b')),
  );
  assert.ok(html.includes('child-a') && html.includes('child-b'), 'both children render');
});

test('CardControlsRow applies the load-bearing wrap/gap classes (responsive requirement)', () => {
  const html = renderToStaticMarkup(createElement(CardControlsRow, null, 'x'));
  assert.match(html, /class="[^"]*\bflex-wrap\b[^"]*"/, 'wraps children on narrow widths');
  assert.match(html, /class="[^"]*\bgap-2\b[^"]*"/, 'gap between controls');
});

test('CardControlsRow merges a caller-supplied className without dropping the wrap/gap classes', () => {
  const html = renderToStaticMarkup(createElement(CardControlsRow, { className: 'justify-end' }, 'x'));
  assert.match(html, /class="[^"]*flex-wrap[^"]*"/);
  assert.match(html, /class="[^"]*justify-end[^"]*"/);
});

// ─── DocButton — structure ──────────────────────────────────────────────────

test('DocButton renders a real button with icon and visible label', () => {
  const html = renderToStaticMarkup(
    createElement(DocButton, { path: 'tasks/T01.md', label: 'Task Handoff', onDocClick: () => {} }),
  );
  assert.match(html, /<button/, 'renders a real <button>, not a text link');
  assert.ok(html.includes('Task Handoff'), 'visible label present');
  assert.match(html, /<svg/, 'leading icon present');
});

test('DocButton tints its icon to the supplied tier CSS var', () => {
  const html = renderToStaticMarkup(
    createElement(DocButton, {
      path: 'tasks/T01.md',
      label: 'Task Handoff',
      onDocClick: () => {},
      iconCssVar: '--tier-execution',
    }),
  );
  assert.match(html, /<svg[^>]*style="[^"]*color:var\(--tier-execution\)/, 'icon carries the tier color directly');
});

test('DocButton omits the icon tint style when no iconCssVar is supplied', () => {
  const html = renderToStaticMarkup(
    createElement(DocButton, { path: 'tasks/T01.md', label: 'Task Handoff', onDocClick: () => {} }),
  );
  const svgMatch = html.match(/<svg[^>]*>/);
  assert.ok(svgMatch, 'icon renders');
  assert.ok(!svgMatch![0].includes('style='), 'no inline color override — inherits the button foreground');
});

test('DocButton renders disabled (not omitted) when path is null, same as DocumentLink', () => {
  const html = renderToStaticMarkup(
    createElement(DocButton, { path: null, label: 'Task Handoff', onDocClick: () => {} }),
  );
  assert.match(html, /<button[^>]*disabled/, 'renders a disabled button rather than nothing');
  assert.ok(html.includes('Task Handoff'), 'label still visible so the row keeps its shape');
});

// ─── DocButton — behavior ───────────────────────────────────────────────────

test('clicking DocButton fires onDocClick with the button\'s own path', async () => {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<!doctype html><div id="root"></div>');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).window = dom.window;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).document = dom.window.document;

  const { createRoot } = await import('react-dom/client');
  const { act } = await import('react');

  // base-ui's useButton hook checks `instanceof HTMLElement` against the
  // global, not `window.HTMLElement` — without this, mounting a base-ui
  // Button under jsdom throws "HTMLElement is not defined".
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).HTMLElement = dom.window.HTMLElement;

  const clicked: string[] = [];
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(DocButton, { path: 'tasks/T01.md', label: 'Task Handoff', onDocClick: (p) => clicked.push(p) }));
  });

  const button = container.querySelector('button')!;
  await act(async () => {
    button.click();
  });

  assert.deepStrictEqual(clicked, ['tasks/T01.md'], 'onDocClick fired once with the resolved path');

  await act(async () => { root.unmount(); });
});

test('clicking a null-path DocButton never calls onDocClick', async () => {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<!doctype html><div id="root"></div>');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).window = dom.window;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).document = dom.window.document;

  const { createRoot } = await import('react-dom/client');
  const { act } = await import('react');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).HTMLElement = dom.window.HTMLElement;

  const clicked: string[] = [];
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(DocButton, { path: null, label: 'Task Handoff', onDocClick: (p) => clicked.push(p) }));
  });

  const button = container.querySelector('button')!;
  await act(async () => {
    button.click();
  });

  assert.deepStrictEqual(clicked, [], 'onDocClick never fires for a null path');

  await act(async () => { root.unmount(); });
});

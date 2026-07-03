import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RingSlot, HeadingSlot, MetaSlot, ControlsSlot } from './card-slots';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).React = React;

/**
 * These assert against actual rendered markup (not source text) — the
 * `architecture.test.ts` regex checks confirm the intended `alignSelf`
 * values are written in `card-slots.tsx`; these confirm the real render
 * pipeline (className merge, JSX composition) actually emits them onto the
 * DOM unchanged. Neither this file nor `architecture.test.ts` can verify the
 * resulting *visual* centering: jsdom/`react-dom/server` implement no CSS
 * box layout, so no in-repo test can compute real geometry without a
 * browser-based test runner (Playwright et al.), which is a new test
 * dependency out of scope here. The centering claim instead rests on a CSS
 * Grid Level 1 guarantee: two rows sized `minmax(0, 1fr)` with equal flex
 * factors split the shell's remaining row space evenly whenever their
 * content fits its half (true for the single/double text lines every view
 * renders), so a bottom-anchored top-row element and a top-anchored
 * bottom-row element always meet exactly at the shared boundary — the
 * vertical midpoint of the two rows combined.
 */

function renderHeadingMetaBlock(meta: string | null): string {
  return renderToStaticMarkup(
    createElement(
      React.Fragment,
      null,
      createElement(RingSlot, null, 'ring-content'),
      createElement(HeadingSlot, { heading: 'Coding Task 3' }),
      createElement(MetaSlot, { meta }),
      createElement(ControlsSlot, null, 'controls-content'),
    ),
  );
}

test('RingSlot renders pinned to the start of its spanning row at the shared fixed diameter', () => {
  const html = renderHeadingMetaBlock('Phase 2 · Task 3');
  assert.match(html, /style="[^"]*grid-area:ring[^"]*align-self:start[^"]*"/, 'ring area, start-anchored');
  assert.match(html, /style="[^"]*width:72px;height:72px[^"]*"/, 'ring renders at the fixed diameter');
});

test('a rendered heading+meta pair keeps the end/start anchors that let them float centered between ring and controls', () => {
  const html = renderHeadingMetaBlock('Phase 2 · Task 3');
  assert.match(html, /style="grid-area:heading;align-self:end"/, 'heading is end-anchored in its own rendered style attribute');
  assert.match(html, /style="grid-area:meta;align-self:start"/, 'meta is start-anchored in its own rendered style attribute');
  const headingIndex = html.indexOf('Coding Task 3');
  const metaIndex = html.indexOf('Phase 2 · Task 3');
  assert.ok(headingIndex > -1 && metaIndex > -1 && headingIndex < metaIndex, 'heading precedes meta in document order, flush against each other across the row boundary');
});

test('a heading-only pair (meta: null) renders no meta node at all — nothing competes with the heading for the second row', () => {
  const html = renderHeadingMetaBlock(null);
  assert.match(html, /style="grid-area:heading;align-self:end"/, 'heading still renders, end-anchored');
  assert.ok(!html.includes('grid-area:meta'), 'no meta-area element is mounted, leaving the row genuinely empty rather than reserving a gap');
});

test('ControlsSlot renders into its own pinned area, distinct from the heading/meta pair', () => {
  const html = renderHeadingMetaBlock('Phase 2 · Task 3');
  assert.match(html, /style="grid-area:controls"/, 'controls occupies its own named area');
  assert.ok(html.includes('controls-content'), 'controls children render');
});

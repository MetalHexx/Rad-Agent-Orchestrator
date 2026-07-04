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
 * DOM unchanged.
 *
 * Neither this file nor `architecture.test.ts` can compute real pixel
 * geometry — jsdom/`react-dom/server` implement no CSS box layout — so the
 * actual visual centering claim was verified separately with a real
 * browser (headless Chrome) rendering this exact grid template against the
 * compiled app CSS. That check confirmed: `RingSlot` spans only the heading
 * and meta rows (never `controls`), and its fixed 72px height forces those
 * two `minmax(0, 1fr)` rows to sum to exactly 72px regardless of the
 * `controls` row's own height. A heading+meta pair (`HeadingSlot` end-
 * anchored, `MetaSlot` start-anchored in the row beneath) meets flush at
 * that ring-center boundary; a heading alone (`hasMeta: false`) spans both
 * rows and centers within their combined height, landing on the same
 * boundary. What's asserted below is the structural half that check
 * depended on: the grid-area/align-self values and DOM shape, not the
 * resulting pixel geometry itself.
 */

function renderHeadingMetaBlock(meta: string | null): string {
  return renderToStaticMarkup(
    createElement(
      React.Fragment,
      null,
      createElement(RingSlot, null, 'ring-content'),
      createElement(HeadingSlot, { heading: 'Coding Task 3', hasMeta: meta !== null }),
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

test('a rendered heading+meta pair keeps the end/start anchors that let them meet flush at the ring-center row boundary', () => {
  const html = renderHeadingMetaBlock('Phase 2 · Task 3');
  assert.match(html, /style="grid-area:heading;align-self:end"/, 'heading is end-anchored in its own row, not spanning into meta\'s');
  assert.match(html, /style="grid-area:meta;align-self:start"/, 'meta is start-anchored in its own rendered style attribute');
  const headingIndex = html.indexOf('Coding Task 3');
  const metaIndex = html.indexOf('Phase 2 · Task 3');
  assert.ok(headingIndex > -1 && metaIndex > -1 && headingIndex < metaIndex, 'heading precedes meta in document order, flush against each other across the row boundary');
});

test('a heading-only pair (meta: null, hasMeta: false) spans both rows and centers, rather than anchoring alone in the heading row', () => {
  const html = renderHeadingMetaBlock(null);
  assert.match(
    html,
    /style="grid-area:heading-start \/ heading-start \/ meta-end \/ heading-end;align-self:center"/,
    'heading spans the full heading+meta block and centers within it when alone',
  );
  assert.ok(!html.includes('grid-area:meta'), 'no meta-area element is mounted, leaving the row genuinely empty rather than reserving a gap');
});

test('HeadingSlot defaults hasMeta to false, matching a caller that omits it entirely', () => {
  const html = renderToStaticMarkup(createElement(HeadingSlot, { heading: 'Coding Task 3' }));
  assert.match(html, /align-self:center/, 'omitting hasMeta falls back to the solo, centered layout');
});

test('ControlsSlot renders into its own pinned area, distinct from the heading/meta pair', () => {
  const html = renderHeadingMetaBlock('Phase 2 · Task 3');
  assert.match(html, /style="grid-area:controls"/, 'controls occupies its own named area');
  assert.ok(html.includes('controls-content'), 'controls children render');
});

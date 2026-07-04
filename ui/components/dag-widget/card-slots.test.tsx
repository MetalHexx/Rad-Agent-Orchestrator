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
 * actual visual centering claim was verified separately with a real browser
 * (headless Chrome) measuring this exact grid template against the compiled
 * app CSS. That check confirmed: `RingSlot` spans the card's full height and
 * `align-self: center`s, so the ring sits vertically centered on the left at
 * its fixed 96px diameter; the heading/meta/controls trio is centered as a
 * block by the shell's equal spacer rows, so the ring's center and the
 * content block's center coincide. A heading+meta pair (`HeadingSlot` end-
 * anchored, `MetaSlot` start-anchored in the row beneath) meets flush as a
 * tight title/subtitle; a heading alone (`hasMeta: false`) spans all three
 * content rows and centers, landing on the ring's own center. What's asserted
 * below is the structural half that check depended on: the grid-area/
 * align-self values and DOM shape, not the resulting pixel geometry itself.
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

test('RingSlot renders vertically centered in its full-height spanning column at the shared fixed diameter', () => {
  const html = renderHeadingMetaBlock('Phase 2 · Task 3');
  assert.match(html, /style="[^"]*grid-area:ring[^"]*align-self:center[^"]*"/, 'ring area, center-anchored');
  assert.match(html, /style="[^"]*width:96px;height:96px[^"]*"/, 'ring renders at the fixed diameter');
});

test('a rendered heading+meta pair keeps the end/start anchors that let them meet flush at their shared row boundary', () => {
  const html = renderHeadingMetaBlock('Phase 2 · Task 3');
  assert.match(html, /style="grid-area:heading;align-self:end"/, 'heading is end-anchored in its own row, not spanning into meta\'s');
  assert.match(html, /style="grid-area:meta;align-self:start"/, 'meta is start-anchored in its own rendered style attribute');
  const headingIndex = html.indexOf('Coding Task 3');
  const metaIndex = html.indexOf('Phase 2 · Task 3');
  assert.ok(headingIndex > -1 && metaIndex > -1 && headingIndex < metaIndex, 'heading precedes meta in document order, flush against each other across the row boundary');
});

test('a heading-only pair (meta: null, hasMeta: false) spans all three content rows and centers, rather than anchoring alone in the heading row', () => {
  const html = renderHeadingMetaBlock(null);
  assert.match(
    html,
    /style="grid-area:heading-start \/ heading-start \/ controls-end \/ heading-end;align-self:center"/,
    'heading spans the full heading→controls block and centers on the ring when alone',
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

test('ControlsSlot carries min-w-0 so a wide controls row shrinks inside its minmax(0,1fr) track instead of overrunning', () => {
  const html = renderToStaticMarkup(createElement(ControlsSlot, null, 'controls-content'));
  // Mirror the sibling content slots (HeadingSlot/MetaSlot) — without min-w-0 a
  // multi-repo commit-chip cluster refuses to shrink and clips at the card edge.
  assert.match(html, /class="[^"]*\bmin-w-0\b[^"]*"/, 'controls slot allows its flex content to shrink');
});

test('ControlsSlot carries mt-2 so the action row breaks away from the heading/meta pair above it', () => {
  const html = renderToStaticMarkup(createElement(ControlsSlot, null, 'controls-content'));
  // The title/subtitle sit flush as one unit; a uniform 8px gap sets the
  // buttons apart so they never crowd the meta line (verified in-browser).
  assert.match(html, /class="[^"]*\bmt-2\b[^"]*"/, 'controls slot separates itself from the meta line above');
});

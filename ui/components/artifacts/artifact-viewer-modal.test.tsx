import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ArtifactViewerModal } from './artifact-viewer-modal';
import type { ModalDoc } from '@/lib/modal-doc-model';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).React = React;

const arts: ModalDoc[] = [
  { path: 'DEMO-BRAINSTORMING.md', kind: 'markdown', title: 'Brainstorm', isMarkdown: true },
  { path: 'DEMO-BRAINSTORM.html', kind: 'visual', title: 'Brainstorm Visual', isMarkdown: false },
  { path: 'DEMO-WIREFRAME-X.html', kind: 'wireframe', title: 'X', isMarkdown: false },
];
const noop = () => {};
function render(props: Parameters<typeof ArtifactViewerModal>[0]): string {
  return renderToStaticMarkup(createElement(ArtifactViewerModal, props));
}
const base = {
  projectName: 'DEMO', artifacts: arts, markdownContent: '# Hello',
  onClose: noop, onPrev: noop, onNext: noop, onSelect: noop, onRequestDelete: noop,
  isFullScreen: false, onToggleFullScreen: noop,
} as const;

test('renders the active html artifact in a sandboxed iframe on the stage (FR-13, NFR-1)', () => {
  const html = render({ ...base, activePath: 'DEMO-BRAINSTORM.html' });
  assert.ok(html.includes('/api/projects/DEMO/raw?path=DEMO-BRAINSTORM.html'), 'stage iframe targets raw route');
  assert.ok(!html.includes('allow-scripts'), 'stage iframe has no allow-scripts');
});

test('renders BRAINSTORMING.md via the markdown renderer, not an iframe (FR-13, AD-8)', () => {
  const html = render({ ...base, activePath: 'DEMO-BRAINSTORMING.md' });
  assert.ok(html.includes('Hello'), 'markdown content rendered on the stage');
  assert.ok(!html.includes('/raw?path=DEMO-BRAINSTORMING.md'), 'md is not iframed');
});

test('renders a filmstrip cell per artifact, all mounted (FR-18, NFR-4)', () => {
  const html = render({ ...base, activePath: 'DEMO-BRAINSTORMING.md' });
  const cells = (html.match(/data-filmstrip-cell/g) ?? []).length;
  assert.equal(cells, 3, 'one filmstrip cell per artifact');
});

test('renders nothing when the active filename is absent from the list (FR-19)', () => {
  assert.equal(render({ ...base, activePath: 'GONE.html' }), '');
  assert.equal(render({ ...base, activePath: null }), '');
});

test('exposes full-screen, delete, and close controls; omits new-tab/counter/legend (FR-15, FR-17, DD-7)', () => {
  const html = render({ ...base, activePath: 'DEMO-WIREFRAME-X.html' });
  assert.ok(html.includes('aria-label="Full screen"'), 'full-screen control present');
  assert.ok(html.includes('aria-label="Delete artifact"'), 'delete control present');
  assert.ok(html.includes('aria-label="Close"'), 'close control present');
  assert.ok(!html.toLowerCase().includes('open in new tab'), 'no open-in-new-tab control');
  assert.ok(!/\b1\s*\/\s*3\b/.test(html), 'no position counter');
});

test('applies the full-screen layout class when isFullScreen is true (FR-17)', () => {
  const html = render({ ...base, activePath: 'DEMO-WIREFRAME-X.html', isFullScreen: true });
  assert.ok(html.includes('w-screen'), 'full-screen panel spans the viewport width');
  assert.ok(html.includes('h-screen'), 'full-screen panel spans the viewport height');
});

test('uses the windowed layout (max-w-5xl, rounded-xl) when not full-screen (FR-17 morph target)', () => {
  const html = render({ ...base, activePath: 'DEMO-WIREFRAME-X.html', isFullScreen: false });
  assert.ok(html.includes('max-w-5xl'), 'windowed panel is capped at max-w-5xl');
  assert.ok(html.includes('rounded-xl'), 'windowed panel has rounded corners');
});

test('idle (no activePulse): active cell carries grey ring, no lavender glow classes anywhere (Fix 5)', () => {
  const html = render({ ...base, activePath: 'DEMO-WIREFRAME-X.html' });
  // Legacy classes must be gone
  assert.ok(!html.includes('active-doc-glow-stage'), 'active-doc-glow-stage must not appear');
  assert.ok(!html.includes('active-doc-glow-cell'), 'active-doc-glow-cell must not appear');
  // Stage overlay must NOT carry the pulse class when the doc is not being written
  assert.ok(!html.includes('live-pulse-stage'), 'stage overlay has no live-pulse-stage when idle');
  // Active cell carries the grey ring
  assert.ok(html.includes('ring-ring'), 'active cell carries ring-ring grey ring');
  assert.ok(html.includes('border-ring'), 'active cell carries border-ring grey ring');
  // Active cell has aria-current
  assert.ok(html.includes('aria-current="true"'), 'active cell has aria-current="true"');
});

test('writing (activePulse contains active file): stage pulses lavender, lavender frame on cell, grey ring absent (Fix 5)', () => {
  const html = render({
    ...base,
    activePath: 'DEMO-WIREFRAME-X.html',
    activePulse: new Set(['DEMO-WIREFRAME-X.html']),
  });
  // Stage overlay must carry the pulse class
  assert.ok(html.includes('live-pulse-stage'), 'stage overlay carries live-pulse-stage while writing');
  // The active cell's ActivePulse wrapper is active — renders live-pulse-frame (lavender)
  assert.ok(html.includes('live-pulse-frame'), 'active cell ActivePulse wrapper carries live-pulse-frame');
  // The grey selection ring (ring-2 ring-ring) must NOT appear on the aria-current cell.
  // We locate the aria-current cell's opening tag and confirm it lacks ring-2.
  // (focus-visible:ring-ring appears on every cell as a focus style — we only care about
  // the persistent selection ring-2 which is not added when pulsing.)
  const currentCellMatch = html.match(/data-filmstrip-cell[^>]*aria-current="true"[^>]*class="([^"]+)"/);
  assert.ok(currentCellMatch, 'aria-current cell found in markup');
  const cellClasses = currentCellMatch![1];
  // The grey selection ring adds "ring-2 ring-ring border-ring" as a group.
  // focus-visible:ring-2 and focus-visible:ring-ring are focus styles present on every cell
  // and are not the selection ring — check specifically for the standalone selection pattern.
  assert.ok(!cellClasses.includes('ring-2 ring-ring'), 'grey selection ring-2 ring-ring is absent on active-pulsing cell (lavender supersedes)');
});

test('renders a label caption for every filmstrip cell (DD-8)', () => {
  const html = render({ ...base, activePath: 'DEMO-BRAINSTORMING.md' });
  assert.ok(html.includes('Brainstorm Visual'), 'filmstrip shows friendly name for second artifact');
  // The third artifact has title 'X', so the caption renders the friendly name 'X', not 'Wireframe'
  assert.ok(html.includes('X'), 'filmstrip shows friendly name for third artifact');
  // All three captions must appear; with the md active, 'Brainstorm' is in the header friendly span
  // AND must appear as a filmstrip caption too
  const brainstormCount = (html.match(/Brainstorm/g) ?? []).length;
  assert.ok(brainstormCount >= 2, 'Brainstorm label appears in both header and filmstrip');
});

test('makes every filmstrip cell a keyboard-accessible button (Issue A)', () => {
  const html = render({ ...base, activePath: 'DEMO-BRAINSTORMING.md' });
  const roleButtons = (html.match(/role="button"/g) ?? []).length;
  assert.ok(roleButtons >= 3, 'at least one role="button" per filmstrip cell');
  const tabbables = (html.match(/tabindex="0"/g) ?? []).length;
  assert.ok(tabbables >= 3, 'at least one tabindex="0" per filmstrip cell');
});

test('marks exactly one filmstrip cell as the current artifact (Issue A)', () => {
  const html = render({ ...base, activePath: 'DEMO-BRAINSTORMING.md' });
  const current = (html.match(/aria-current="true"/g) ?? []).length;
  assert.equal(current, 1, 'exactly one cell carries aria-current="true"');
});

test('aria-current tracks the active filename, not a fixed array slot, after a reorder (regression)', () => {
  // The user is focused on the html visual. Render once in the original order…
  const before = render({ ...base, activePath: 'DEMO-BRAINSTORM.html' });
  // …then with the array reordered underneath the modal. The aria-current cell
  // must still be the SAME document (the one whose label is its own), never the
  // file that happens to sit at the old index.
  const reordered: ModalDoc[] = [arts[2], arts[1], arts[0]];
  const after = render({ ...base, artifacts: reordered, activePath: 'DEMO-BRAINSTORM.html' });
  // Exactly one current cell in each render.
  assert.equal((before.match(/aria-current="true"/g) ?? []).length, 1);
  assert.equal((after.match(/aria-current="true"/g) ?? []).length, 1);
  // The dialog still identifies the active doc by its own filename in both.
  assert.ok(before.includes('DEMO-BRAINSTORM.html'));
  assert.ok(after.includes('DEMO-BRAINSTORM.html'));
  // The aria-current cell carries the active file's own label ("Brainstorm Visual"),
  // proving the highlight follows the filename through the reorder.
  for (const html of [before, after]) {
    const m = html.match(/aria-current="true"[^>]*aria-label="View ([^"]+)"|aria-label="View ([^"]+)"[^>]*aria-current="true"/);
    assert.ok(m, 'current cell exposes its view label');
    assert.equal(m![1] ?? m![2], 'Brainstorm Visual', 'highlight stays on the active document');
  }
});

test('resolves the active document by filename, not by array slot (regression)', () => {
  // Same artifacts, two different orderings. The active filename points at the
  // wireframe, which sits at a DIFFERENT index in each list. The stage must show
  // it regardless of where it landed — proving identity is the filename.
  const orderA: ModalDoc[] = [arts[0], arts[1], arts[2]]; // wireframe at index 2
  const orderB: ModalDoc[] = [arts[2], arts[0], arts[1]]; // wireframe at index 0
  const a = render({ ...base, artifacts: orderA, activePath: 'DEMO-WIREFRAME-X.html' });
  const b = render({ ...base, artifacts: orderB, activePath: 'DEMO-WIREFRAME-X.html' });
  for (const html of [a, b]) {
    assert.ok(html.includes('/api/projects/DEMO/raw?path=DEMO-WIREFRAME-X.html'), 'stage shows the doc named by activePath');
  }
});

test('applies cursor-pointer to clickable controls (Issue A/C)', () => {
  const html = render({ ...base, activePath: 'DEMO-BRAINSTORM.html' });
  assert.ok(html.includes('cursor-pointer'), 'cursor-pointer present in modal markup');
});

test('shows a loading spinner while markdown content is unresolved (Extras)', () => {
  const html = render({ ...base, activePath: 'DEMO-BRAINSTORMING.md', markdownContent: null });
  assert.ok(html.includes('role="status"'), 'markdown loading spinner present');
  assert.ok(html.includes('aria-label="Loading document"'), 'spinner is labelled');
});

test('renders a Share control on the shared ghost button in the header', () => {
  const html = render({ ...base, activePath: 'DEMO-BRAINSTORMING.md' });
  assert.ok(html.includes('aria-label="Share / copy link"'), 'share control present and labelled');
});

test('header controls use the shared button slot while preserving their labels', () => {
  const html = render({ ...base, activePath: 'DEMO-BRAINSTORMING.md' });
  const slots = (html.match(/data-slot="button"/g) ?? []).length;
  assert.ok(slots >= 3, 'Share, Full screen, and Close all render on the shared Button');
  assert.ok(html.includes('aria-label="Full screen"'), 'Full screen label preserved');
  assert.ok(html.includes('aria-label="Close"'), 'Close label preserved');
});
test('delete stays a corner overlay and the footer holds only the filmstrip', () => {
  const html = render({ ...base, activePath: 'DEMO-BRAINSTORMING.md' });
  assert.ok(html.includes('aria-label="Delete artifact"'), 'delete control still present');
  const footerStart = html.indexOf('<footer');
  assert.ok(footerStart >= 0 && html.indexOf('aria-label="Delete artifact"') < footerStart,
    'delete is outside the footer (corner overlay), not crammed into the filmstrip row');
});

test('overflow edge fades are non-interactive and end chevrons are labelled', () => {
  const html = render({ ...base, activePath: 'DEMO-BRAINSTORMING.md' });
  assert.ok(html.includes('aria-label="Scroll filmstrip left"'), 'left paging chevron present');
  assert.ok(html.includes('aria-label="Scroll filmstrip right"'), 'right paging chevron present');
  assert.ok(html.includes('pointer-events-none'), 'edge fades do not block cell interaction');
});

test('share feedback timer is captured in a ref and cleared on unmount (FR-6, NFR-1)', () => {
  const src = readFileSync(
    path.join(process.cwd(), 'components', 'artifacts', 'artifact-viewer-modal.tsx'),
    'utf-8',
  );
  assert.match(src, /\b(\w+Ref)\s*=\s*(?:React\.)?useRef\b/,
    'a ref is declared to hold the share-feedback timer handle');
  assert.match(src, /(\w+Ref)\.current\s*=\s*setTimeout\(/,
    'the setTimeout handle is stored in the ref instead of being fire-and-forget');
  assert.match(src, /clearTimeout\(\s*\w+Ref\.current\s*\)/,
    'an unmount cleanup clears the captured timer');
});

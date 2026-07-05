import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ArtifactViewerModal } from './artifact-viewer-modal';
import type { ModalDoc } from '@/lib/modal-doc-model';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).React = React;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

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

test('hides the delete control for a nested (subfolder) doc — the delete API only allows root artifacts (regression)', () => {
  const nested: ModalDoc[] = [
    ...arts,
    { path: 'phases/PHASE-1-PLAN.md', kind: 'markdown', title: 'Phase 1 Plan', isMarkdown: true },
  ];
  const html = render({ ...base, artifacts: nested, activePath: 'phases/PHASE-1-PLAN.md' });
  assert.ok(!html.includes('aria-label="Delete artifact"'), 'delete control absent for a nested doc');
});

test('still shows the delete control for a root-level doc alongside nested docs (regression)', () => {
  const nested: ModalDoc[] = [
    ...arts,
    { path: 'phases/PHASE-1-PLAN.md', kind: 'markdown', title: 'Phase 1 Plan', isMarkdown: true },
  ];
  const html = render({ ...base, artifacts: nested, activePath: 'DEMO-BRAINSTORMING.md' });
  assert.ok(html.includes('aria-label="Delete artifact"'), 'delete control present for a root doc');
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
  // Active cell is the selected tab
  assert.ok(html.includes('aria-selected="true"'), 'active cell has aria-selected="true"');
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
  // The grey selection ring (ring-2 ring-ring) must NOT appear on the selected tab cell.
  // We locate the aria-selected cell's opening tag and confirm it lacks ring-2.
  // (focus-visible:ring-ring appears on every cell as a focus style — we only care about
  // the persistent selection ring-2 which is not added when pulsing.)
  const currentCellMatch = html.match(/data-filmstrip-cell[^>]*aria-selected="true"[^>]*class="([^"]+)"/);
  assert.ok(currentCellMatch, 'aria-selected cell found in markup');
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

test('marks the filmstrip as a tablist of keyboard-accessible tabs with roving tabindex (Issue A, P02-T02)', () => {
  const html = render({ ...base, activePath: 'DEMO-BRAINSTORMING.md' });
  assert.ok(html.includes('role="tablist"'), 'strip container carries role="tablist"');
  // Scope to the filmstrip cells themselves — the shell's own header buttons
  // (Share, Full screen, Close, paging chevrons) also carry tabindex="0".
  const cells = html.match(/<div data-filmstrip-cell="true"[^>]*>/g) ?? [];
  assert.equal(cells.length, 3, 'three filmstrip cells rendered');
  assert.ok(cells.every((c) => c.includes('role="tab"')), 'every filmstrip cell carries role="tab"');
  const tabbables = cells.filter((c) => c.includes('tabindex="0"'));
  assert.equal(tabbables.length, 1, 'exactly one filmstrip cell carries tabindex="0"');
  const inert = cells.filter((c) => c.includes('tabindex="-1"'));
  assert.equal(inert.length, 2, 'the remaining filmstrip cells carry tabindex="-1"');
});

test('wires every tab to the stage panel via aria-controls, and the panel back to the active tab (PR #168 review)', () => {
  const html = render({ ...base, activePath: 'DEMO-BRAINSTORMING.md' });
  assert.ok(html.includes('role="tabpanel"'), 'stage container carries role="tabpanel"');
  const controls = (html.match(/aria-controls="artifact-viewer-modal-stage"/g) ?? []).length;
  assert.equal(controls, 3, 'every tab points aria-controls at the stage panel');
  assert.ok(html.includes('id="artifact-viewer-modal-stage"'), 'stage panel carries the id its tabs reference');
  assert.ok(html.includes('aria-labelledby="filmstrip-tab-0"'), 'stage panel is labelled by the active (first) tab');
});

test('marks exactly one filmstrip cell as selected (Issue A)', () => {
  const html = render({ ...base, activePath: 'DEMO-BRAINSTORMING.md' });
  const current = (html.match(/aria-selected="true"/g) ?? []).length;
  assert.equal(current, 1, 'exactly one cell carries aria-selected="true"');
});

test('aria-selected tracks the active filename, not a fixed array slot, after a reorder (regression)', () => {
  // The user is focused on the html visual. Render once in the original order…
  const before = render({ ...base, activePath: 'DEMO-BRAINSTORM.html' });
  // …then with the array reordered underneath the modal. The selected cell
  // must still be the SAME document (the one whose label is its own), never the
  // file that happens to sit at the old index.
  const reordered: ModalDoc[] = [arts[2], arts[1], arts[0]];
  const after = render({ ...base, artifacts: reordered, activePath: 'DEMO-BRAINSTORM.html' });
  // Exactly one selected cell in each render.
  assert.equal((before.match(/aria-selected="true"/g) ?? []).length, 1);
  assert.equal((after.match(/aria-selected="true"/g) ?? []).length, 1);
  // The dialog still identifies the active doc by its own filename in both.
  assert.ok(before.includes('DEMO-BRAINSTORM.html'));
  assert.ok(after.includes('DEMO-BRAINSTORM.html'));
  // The selected cell carries the active file's own label ("Brainstorm Visual"),
  // proving the highlight follows the filename through the reorder.
  for (const html of [before, after]) {
    const m = html.match(/aria-selected="true"[^>]*aria-label="View ([^"]+)"|aria-label="View ([^"]+)"[^>]*aria-selected="true"/);
    assert.ok(m, 'selected cell exposes its view label');
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
  // The tooltip wrapper's own merged `data-slot="tooltip-trigger"` overwrites the
  // Button's own `data-slot="button"` marker, so `group/button` (a static class
  // literal baked into buttonVariants) is the survives-the-wrap fingerprint instead.
  const slots = (html.match(/group\/button/g) ?? []).length;
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

test('shows a frontmatter toggle for a markdown doc with frontmatter, labelled by the hidden state (P02-T01)', () => {
  const html = render({
    ...base, activePath: 'DEMO-BRAINSTORMING.md',
    showFrontmatter: false, onToggleFrontmatter: noop, frontmatter: { status: 'active' },
  });
  assert.ok(html.includes('aria-label="Show frontmatter"'), 'toggle carries the hidden-state label');
  assert.ok(!html.includes('aria-label="Hide frontmatter"'), 'the shown-state label is absent while hidden');
});

test('the frontmatter toggle aria-label flips to the shown state (P02-T01)', () => {
  const html = render({
    ...base, activePath: 'DEMO-BRAINSTORMING.md',
    showFrontmatter: true, onToggleFrontmatter: noop, frontmatter: { status: 'active' },
  });
  assert.ok(html.includes('aria-label="Hide frontmatter"'), 'toggle carries the shown-state label');
  assert.ok(!html.includes('aria-label="Show frontmatter"'), 'the hidden-state label is absent while shown');
});

test('omits the frontmatter toggle for a non-markdown artifact (P02-T01)', () => {
  const html = render({ ...base, activePath: 'DEMO-BRAINSTORM.html', onToggleFrontmatter: noop, frontmatter: { status: 'active' } });
  assert.ok(!html.includes('Show frontmatter') && !html.includes('Hide frontmatter'), 'no frontmatter toggle for an HTML artifact');
});

test('omits the frontmatter toggle when no onToggleFrontmatter handler is supplied (P02-T01)', () => {
  const html = render({ ...base, activePath: 'DEMO-BRAINSTORMING.md', frontmatter: { status: 'active' } });
  assert.ok(!html.includes('Show frontmatter') && !html.includes('Hide frontmatter'), 'no toggle button without a handler wired');
});

test('omits the frontmatter toggle when the markdown doc has no frontmatter entries', () => {
  const html = render({ ...base, activePath: 'DEMO-BRAINSTORMING.md', onToggleFrontmatter: noop, frontmatter: {} });
  assert.ok(!html.includes('Show frontmatter') && !html.includes('Hide frontmatter'), 'no toggle when frontmatter is an empty object');
});

test('omits the frontmatter toggle when frontmatter is absent, even for a markdown doc with a handler wired', () => {
  const html = render({ ...base, activePath: 'DEMO-BRAINSTORMING.md', onToggleFrontmatter: noop });
  assert.ok(!html.includes('Show frontmatter') && !html.includes('Hide frontmatter'), 'no toggle when frontmatter was never supplied');
});

test('the frontmatter toggle floats over the top-right of the content stage, not in the header', () => {
  const html = render({
    ...base, activePath: 'DEMO-BRAINSTORMING.md', onToggleFrontmatter: noop, frontmatter: { status: 'active' },
  });
  const headerEnd = html.indexOf('</header>');
  const toggleIdx = html.indexOf('aria-label="Show frontmatter"');
  assert.ok(headerEnd >= 0 && toggleIdx > headerEnd, 'frontmatter toggle renders after the header closes, not inside it');
  assert.ok(html.includes('top-3') && html.includes('right-3'), 'toggle uses the floating top-right corner position');
});

test('previous, next, delete, and frontmatter toggle share one cohesive, accessible button treatment', () => {
  const html = render({
    ...base, activePath: 'DEMO-BRAINSTORMING.md', onToggleFrontmatter: noop, frontmatter: { status: 'active' },
  });
  // group/button is a static class literal baked into buttonVariants (see the header-controls
  // test above) — its presence proves a button was built on buttonVariants, not a raw
  // hand-styled <button>. All four floating stage buttons should now render on it.
  const slots = (html.match(/group\/button/g) ?? []).length;
  assert.ok(slots >= 4, 'previous, next, delete, and the frontmatter toggle all render on the shared buttonVariants styling');
  // The old ad hoc p-2/size-5 treatment is gone entirely from the stage overlay — every
  // floating icon there now uses the same size-4 sizing as the frontmatter toggle. Scoped
  // to just the stage (between the header and the footer) since the filmstrip's own
  // FileText cell icon legitimately still uses size-5.
  const stageOnly = html.slice(html.indexOf('</header>'), html.indexOf('<footer'));
  assert.ok(!stageOnly.includes('size-5'), 'no floating stage button falls back to the old oversized icon');
  assert.ok(html.includes('aria-label="Previous artifact"'), 'previous control still present and labelled');
  assert.ok(html.includes('aria-label="Next artifact"'), 'next control still present and labelled');
});

test('renders the frontmatter card above the body only when toggled on (P02-T01)', () => {
  const shown = render({
    ...base, activePath: 'DEMO-BRAINSTORMING.md',
    showFrontmatter: true, frontmatter: { status: 'active' }, onToggleFrontmatter: noop,
  });
  assert.ok(shown.includes('data-slot="card"'), 'frontmatter card renders when shown and present');

  const hidden = render({
    ...base, activePath: 'DEMO-BRAINSTORMING.md',
    showFrontmatter: false, frontmatter: { status: 'active' }, onToggleFrontmatter: noop,
  });
  assert.ok(!hidden.includes('data-slot="card"'), 'frontmatter card is absent while the toggle is off');
});

test('renders no frontmatter card for an HTML artifact even if frontmatter/showFrontmatter are set (P02-T01)', () => {
  const html = render({
    ...base, activePath: 'DEMO-BRAINSTORM.html',
    showFrontmatter: true, frontmatter: { status: 'active' },
  });
  assert.ok(!html.includes('data-slot="card"'), 'no frontmatter card renders on a non-markdown stage');
});

// Focus-follows-active (P02-T02) — jsdom + createRoot harness, since focus
// location can't be observed from renderToStaticMarkup. All-markdown docs
// keep the fixture free of IframePreview/ResizeObserver concerns.
const mdOnly: ModalDoc[] = [
  { path: 'A.md', kind: 'markdown', title: 'Alpha', isMarkdown: true },
  { path: 'B.md', kind: 'markdown', title: 'Beta', isMarkdown: true },
  { path: 'C.md', kind: 'markdown', title: 'Gamma', isMarkdown: true },
];

function setupFocusFollowDom() {
  const dom = new JSDOM('<!doctype html><div id="root"></div>');
  const { window } = dom;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).window = window;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).document = window.document;
  // base-ui's useButton checks the global HTMLElement when the header/footer buttons mount.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).HTMLElement = window.HTMLElement;
  // base-ui's tooltip hover-interaction hook (via @floating-ui/utils's isElement)
  // checks the global Element when a TooltipTrigger mounts.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).Element = window.Element;
  return { container: window.document.getElementById('root')! };
}

test('focus follows the newly-active filmstrip cell when focus is already in the strip (P02-T02)', async () => {
  const { container } = setupFocusFollowDom();
  const { createRoot } = await import('react-dom/client');
  const { act } = await import('react');
  const root = createRoot(container);
  const props = { ...base, artifacts: mdOnly, activePath: 'A.md' };
  await act(async () => {
    root.render(createElement(ArtifactViewerModal, props));
  });
  const activeCell = () => container.querySelector('[data-filmstrip-cell][aria-selected="true"]') as HTMLElement | null;
  const firstCell = activeCell();
  assert.ok(firstCell, 'the active cell for A.md is rendered');
  firstCell!.focus();
  assert.equal(document.activeElement, firstCell, 'focus is on the A.md cell');

  await act(async () => {
    root.render(createElement(ArtifactViewerModal, { ...props, activePath: 'B.md' }));
  });
  const secondCell = activeCell();
  assert.ok(secondCell && secondCell !== firstCell, 'the B.md cell is now the selected one');
  assert.equal(document.activeElement, secondCell, 'focus followed onto the newly-active cell — not stranded on the now tabindex=-1 A.md cell');

  await act(async () => { root.unmount(); });
});

test('focus-follow does not steal focus from outside the filmstrip (P02-T02 guard)', async () => {
  const { container } = setupFocusFollowDom();
  const { createRoot } = await import('react-dom/client');
  const { act } = await import('react');
  const root = createRoot(container);
  const props = { ...base, artifacts: mdOnly, activePath: 'A.md' };
  await act(async () => {
    root.render(createElement(ArtifactViewerModal, props));
  });
  // Simulate a reader whose focus is elsewhere (e.g. the markdown body), not in the filmstrip.
  const outside = document.createElement('button');
  document.body.appendChild(outside);
  outside.focus();
  assert.equal(document.activeElement, outside);

  await act(async () => {
    root.render(createElement(ArtifactViewerModal, { ...props, activePath: 'B.md' }));
  });
  assert.equal(document.activeElement, outside, 'navigating the active doc does not yank focus away from outside the filmstrip');

  await act(async () => { root.unmount(); });
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

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BufferedStage, MarkdownLayer } from './buffered-stage';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).React = React;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const MD = { path: 'A.md', kind: 'markdown' as const, title: 'Doc', isMarkdown: true };

test('stage uses a dark backstop, not a white background (DD-8)', () => {
  const html = renderToStaticMarkup(createElement(BufferedStage, {
    projectName: 'DEMO', artifact: MD, markdownContent: '# Hi', activePulse: false,
  } as never));
  assert.ok(!/bg-white/.test(html), 'white iframe background dropped');
  assert.ok(/bg-background|bg-card|bg-muted/.test(html), 'dark app surface used as backstop');
});

test('two stacked layers exist for double-buffering (DD-7, FR-16)', () => {
  const html = renderToStaticMarkup(createElement(BufferedStage, {
    projectName: 'DEMO', artifact: MD, markdownContent: '# Hi', activePulse: false,
  } as never));
  const layers = html.match(/data-stage-layer/g) ?? [];
  assert.ok(layers.length >= 2, 'two stage layers for buffered cross-fade');
});

test('the dark backstop carries no onLoad — readiness is per layer (DD-7)', () => {
  const html = renderToStaticMarkup(createElement(BufferedStage, {
    projectName: 'DEMO', artifact: MD, markdownContent: '# Hi', activePulse: false,
  } as never));
  // A wrapper <div onLoad> would never fire for the markdown layer, so the
  // ready trigger must not live on the backstop wrapper.
  assert.ok(!/onload/i.test(html), 'no wrapper onLoad drives readiness');
});

test('the markdown layer reports ready via a committed-body layout effect, not <div onLoad> (DD-7, FR-16)', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>');
  const { window } = dom;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).window = window;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).document = window.document;
  const { createRoot } = await import('react-dom/client');
  const { act } = await import('react');
  const scrollRef = React.createRef<HTMLDivElement>();
  let readyCount = 0;
  const root = createRoot(window.document.getElementById('root')!);
  await act(async () => {
    root.render(createElement(MarkdownLayer, {
      content: '# Hi', scrollRef, onReady: () => { readyCount += 1; },
    } as never));
  });
  assert.equal(readyCount, 1, 'markdown layer fired its own ready signal once the body committed');
  const container = window.document.getElementById('root')!;
  assert.ok(!/onload/i.test(container.innerHTML), 'markdown layer attaches no onLoad handler in its DOM');
  await act(async () => { root.unmount(); });
});

test('html iframes stay sandboxed without allow-scripts (NFR-8)', () => {
  const htmlArt = { path: 'V.html', kind: 'html' as const, title: 'Visual', isMarkdown: false };
  const html = renderToStaticMarkup(createElement(BufferedStage, {
    projectName: 'DEMO', artifact: htmlArt, markdownContent: null, activePulse: false,
  } as never));
  assert.ok(/sandbox="allow-same-origin"/.test(html), 'iframe sandboxed, same-origin only');
  assert.ok(!/allow-scripts/.test(html), 'no script execution in the artifact iframe');
});

test('an open HTML document reloads its iframe in place when a live change lands (FR-1)', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>');
  const { window } = dom;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).window = window;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).document = window.document;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  const { createRoot } = await import('react-dom/client');
  const { act } = await import('react');
  const htmlArt = { path: 'V.html', kind: 'html' as const, title: 'Visual', isMarkdown: false };
  const root = createRoot(window.document.getElementById('root')!);
  await act(async () => {
    root.render(createElement(BufferedStage, {
      projectName: 'DEMO', artifact: htmlArt, markdownContent: null, activePulse: false, liveMtime: 0,
    } as never));
  });
  // innerHTML HTML-encodes & as &amp; — decode to plain text for URL pattern matching.
  const decode = (html: string) => html.replace(/&amp;/g, '&');
  const before = decode(window.document.getElementById('root')!.innerHTML);
  assert.ok(!/[?&]v=\d/.test(before), 'no live-reload cache-bust before any change lands');
  await act(async () => {
    root.render(createElement(BufferedStage, {
      projectName: 'DEMO', artifact: htmlArt, markdownContent: null, activePulse: true, liveMtime: 1,
    } as never));
  });
  // Flush any pending state updates triggered by effects (e.g. setLiveRefreshKey from the change effect).
  await act(async () => {});
  const after = decode(window.document.getElementById('root')!.innerHTML);
  assert.ok(/[?&]v=1/.test(after), 'front iframe reloads (cache-bust) when the open HTML doc changes in place');
  await act(async () => { root.unmount(); });
});

test('a repeated change to the open HTML doc within the pulse window still advances the cache-bust (BUG 2)', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>');
  const { window } = dom;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).window = window;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).document = window.document;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  const { createRoot } = await import('react-dom/client');
  const { act } = await import('react');
  const htmlArt = { path: 'V.html', kind: 'html' as const, title: 'Visual', isMarkdown: false };
  const decode = (html: string) => html.replace(/&amp;/g, '&');
  const root = createRoot(window.document.getElementById('root')!);
  await act(async () => {
    root.render(createElement(BufferedStage, {
      projectName: 'DEMO', artifact: htmlArt, markdownContent: null, activePulse: false, liveMtime: 0,
    } as never));
  });
  // First on-disk change lands: pulse rises and mtime advances to 1.
  await act(async () => {
    root.render(createElement(BufferedStage, {
      projectName: 'DEMO', artifact: htmlArt, markdownContent: null, activePulse: true, liveMtime: 1,
    } as never));
  });
  await act(async () => {});
  const afterFirst = decode(window.document.getElementById('root')!.innerHTML);
  assert.ok(/[?&]v=1/.test(afterFirst), 'first change cache-busts to v=1');
  // Second on-disk change lands BEFORE the pulse settles — pulse stays true (no new
  // rising edge), only the mtime advances to 2. The iframe must still reload.
  await act(async () => {
    root.render(createElement(BufferedStage, {
      projectName: 'DEMO', artifact: htmlArt, markdownContent: null, activePulse: true, liveMtime: 2,
    } as never));
  });
  await act(async () => {});
  const afterSecond = decode(window.document.getElementById('root')!.innerHTML);
  assert.ok(/[?&]v=2/.test(afterSecond), 'repeated same-window change advances the cache-bust to v=2');
  assert.ok(!/[?&]v=1\b/.test(afterSecond), 'stale v=1 cache-bust is replaced');
  await act(async () => { root.unmount(); });
});

test('navigating md→md does not flash the previous doc as the incoming layer (BUG 1)', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>');
  const { window } = dom;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).window = window;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).document = window.document;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  const { createRoot } = await import('react-dom/client');
  const { act } = await import('react');
  const A = { path: 'A.md', kind: 'markdown' as const, title: 'Doc', isMarkdown: true };
  const B = { path: 'B.md', kind: 'markdown' as const, title: 'Doc', isMarkdown: true };
  const root = createRoot(window.document.getElementById('root')!);
  // A is open with its matching content.
  await act(async () => {
    root.render(createElement(BufferedStage, {
      projectName: 'DEMO', artifact: A, markdownContent: '# Alpha', markdownContentFileName: 'A.md', activePulse: false, liveMtime: 0,
    } as never));
  });
  await act(async () => {});
  const showingA = window.document.getElementById('root')!;
  assert.ok(/Alpha/.test(showingA.textContent ?? ''), 'A renders with its own content');
  // Navigate to B, but B's fetch has NOT resolved: markdownContent still holds A's
  // body and markdownContentFileName still points at A. The incoming B layer must
  // NOT promote A's stale content as B — it should show its loading spinner.
  await act(async () => {
    root.render(createElement(BufferedStage, {
      projectName: 'DEMO', artifact: B, markdownContent: '# Alpha', markdownContentFileName: 'A.md', activePulse: false, liveMtime: 0,
    } as never));
  });
  await act(async () => {});
  const midNav = window.document.getElementById('root')!;
  assert.ok(/role="status"/i.test(midNav.innerHTML), 'incoming B layer shows a loading spinner, not stale content');
  assert.ok(!/Beta/.test(midNav.textContent ?? ''), 'B body has not arrived yet');
  // B's fetch resolves: content and fileName now match B.
  await act(async () => {
    root.render(createElement(BufferedStage, {
      projectName: 'DEMO', artifact: B, markdownContent: '# Beta', markdownContentFileName: 'B.md', activePulse: false, liveMtime: 0,
    } as never));
  });
  await act(async () => {});
  const showingB = window.document.getElementById('root')!;
  assert.ok(/Beta/.test(showingB.textContent ?? ''), 'B renders once its own content arrives');
  await act(async () => { root.unmount(); });
});

test('the stage isolates its z-index so it never paints over the modal nav buttons (regression)', () => {
  // The slot layers carry z-index (front/incoming) for the cross-fade. Without an
  // isolated stacking context that z-index escapes and covers the modal's
  // prev/next/delete buttons (which are DOM siblings of the stage).
  const html = renderToStaticMarkup(createElement(BufferedStage, {
    projectName: 'DEMO', artifact: MD, markdownContent: '# Hi', activePulse: false,
  } as never));
  assert.ok(/\bisolate\b/.test(html), 'stage root establishes an isolated stacking context so the slot z-index stays local');
});

test('the stage iframe uses the dark backstop color, not white — no first-open white flash (DD-8)', () => {
  const htmlArt = { path: 'V.html', kind: 'html' as const, title: 'Visual', isMarkdown: false };
  const html = renderToStaticMarkup(createElement(BufferedStage, {
    projectName: 'DEMO', artifact: htmlArt, markdownContent: null, activePulse: false,
  } as never));
  assert.ok(!/bg-white/.test(html), 'stage iframe does not use a white background');
  assert.ok(/bg-background/.test(html), 'stage iframe uses the dark app backstop color');
});

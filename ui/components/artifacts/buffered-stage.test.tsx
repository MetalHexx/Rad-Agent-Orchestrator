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

// Slots are stacked in DOM order (0 then 1) regardless of which is front or
// incoming, so `z-index` — 10 for the front slot, 20 for the incoming slot —
// is the only reliable way to scope an assertion to a specific slot instead
// of the whole two-slot markup (see the retargeted live-reload tests below).
function layerAtZIndex(container: HTMLElement, zIndex: number): HTMLElement | undefined {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-stage-layer]'))
    .find((el) => el.style.zIndex === String(zIndex));
}

function iframeSrcAtZIndex(container: HTMLElement, zIndex: number): string | null {
  return layerAtZIndex(container, zIndex)?.querySelector('iframe')?.getAttribute('src') ?? null;
}

function iframeElAtZIndex(container: HTMLElement, zIndex: number): HTMLIFrameElement | null {
  return layerAtZIndex(container, zIndex)?.querySelector('iframe') ?? null;
}

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

test('an open HTML document live-reloads the BACKGROUND slot, leaving the front slot\'s src unchanged (FR-1)', async () => {
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
  const container = window.document.getElementById('root')!;
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(BufferedStage, {
      projectName: 'DEMO', artifact: htmlArt, markdownContent: null, activePulse: false, liveMtime: 0,
    } as never));
  });
  assert.ok(!/[?&]v=\d/.test(iframeSrcAtZIndex(container, 10) ?? ''), 'no live-reload cache-bust before any change lands');
  await act(async () => {
    root.render(createElement(BufferedStage, {
      projectName: 'DEMO', artifact: htmlArt, markdownContent: null, activePulse: true, liveMtime: 1,
    } as never));
  });
  // Flush any pending state updates triggered by effects (e.g. beginLiveReload from the change effect).
  await act(async () => {});
  assert.ok(!/[?&]v=\d/.test(iframeSrcAtZIndex(container, 10) ?? ''), 'the front slot\'s src is unchanged by a live edit — no navigation-style reset');
  assert.ok(/[?&]v=1/.test(iframeSrcAtZIndex(container, 20) ?? ''), 'the incoming (background) slot reloads at the next generation');
  await act(async () => { root.unmount(); });
});

test('a repeated change to the open HTML doc within the pulse window still advances the cache-bust on the background slot, front unchanged (BUG 2)', async () => {
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
  const container = window.document.getElementById('root')!;
  const root = createRoot(container);
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
  assert.ok(/[?&]v=1/.test(iframeSrcAtZIndex(container, 20) ?? ''), 'first change cache-busts the background slot to v=1');
  assert.ok(!/[?&]v=\d/.test(iframeSrcAtZIndex(container, 10) ?? ''), 'the front slot\'s src stays unbusted through the first change');
  // Second on-disk change lands BEFORE the pulse settles — pulse stays true (no new
  // rising edge), only the mtime advances to 2. The background slot must still reload.
  await act(async () => {
    root.render(createElement(BufferedStage, {
      projectName: 'DEMO', artifact: htmlArt, markdownContent: null, activePulse: true, liveMtime: 2,
    } as never));
  });
  await act(async () => {});
  const secondBackgroundSrc = iframeSrcAtZIndex(container, 20) ?? '';
  assert.ok(/[?&]v=2/.test(secondBackgroundSrc), 'repeated same-window change advances the background slot\'s cache-bust to v=2');
  assert.ok(!/[?&]v=1\b/.test(secondBackgroundSrc), 'stale v=1 cache-bust is replaced');
  assert.ok(!/[?&]v=\d/.test(iframeSrcAtZIndex(container, 10) ?? ''), 'the front slot\'s src stays unbusted through the repeated change');
  await act(async () => { root.unmount(); });
});

test('a live edit landing mid-navigation is retried once the navigation settles, not consumed', async () => {
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
  const A = { path: 'A.html', kind: 'html' as const, title: 'Alpha', isMarkdown: false };
  const B = { path: 'B.html', kind: 'html' as const, title: 'Beta', isMarkdown: false };
  const container = window.document.getElementById('root')!;
  const root = createRoot(container);
  const srcs = () => Array.from(container.querySelectorAll('iframe')).map((el) => el.getAttribute('src') ?? '');
  await act(async () => {
    root.render(createElement(BufferedStage, {
      projectName: 'DEMO', artifact: A, markdownContent: null, activePulse: false, liveMtime: 0,
    } as never));
  });
  await act(async () => {});

  // Navigate to B: it loads into the incoming slot; A is still the front.
  await act(async () => {
    root.render(createElement(BufferedStage, {
      projectName: 'DEMO', artifact: B, markdownContent: null, activePulse: false, liveMtime: 0,
    } as never));
  });
  await act(async () => {});
  const incoming = iframeElAtZIndex(container, 20);
  assert.ok(incoming, 'B loaded into the incoming (background) slot');

  // An edit to B lands while B is STILL the incoming slot — the reload is rejected
  // because the front is not B yet.
  await act(async () => {
    root.render(createElement(BufferedStage, {
      projectName: 'DEMO', artifact: B, markdownContent: null, activePulse: true, liveMtime: 1,
    } as never));
  });
  await act(async () => {});
  assert.ok(srcs().every((s) => !/[?&]v=\d/.test(s)), 'nothing reloads while B has not settled to the front');

  // The navigation settles and B becomes the front. The rejected edit must still
  // read as new, or B sits on pre-edit content until some later edit happens to land.
  await act(async () => { incoming!.dispatchEvent(new window.Event('load')); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 400)); });

  assert.ok(srcs().some((s) => /path=B\.html/.test(s) && /[?&]v=1/.test(s)),
    'the same mtime drives a reload of B once the front settles — the mid-navigation edit was not swallowed');
  await act(async () => { root.unmount(); });
});

test('a live reload captures the front iframe\'s scroll offset and replays it on the incoming iframe before it swaps in (P02-T01 seam)', async () => {
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
  const container = window.document.getElementById('root')!;
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(BufferedStage, {
      projectName: 'DEMO', artifact: htmlArt, markdownContent: null, activePulse: false, liveMtime: 0,
    } as never));
  });
  // Flush the front slot's own natural jsdom load event before stubbing it.
  await act(async () => {});

  const frontIframe = iframeElAtZIndex(container, 10);
  assert.ok(frontIframe, 'the front slot has a mounted iframe');
  Object.defineProperty(frontIframe, 'contentWindow', {
    configurable: true,
    get() { return { scrollY: 250 }; },
  });

  // A live edit lands: the effect must read the front iframe's CURRENT scroll
  // offset (via the stub above) before stashing it for the incoming slot.
  await act(async () => {
    root.render(createElement(BufferedStage, {
      projectName: 'DEMO', artifact: htmlArt, markdownContent: null, activePulse: true, liveMtime: 1,
    } as never));
  });
  // Flush the incoming slot's own natural jsdom load event before stubbing it.
  await act(async () => {});

  const incomingIframe = iframeElAtZIndex(container, 20);
  assert.ok(incomingIframe, 'the live reload loaded the incoming (background) slot');
  assert.notEqual(incomingIframe, frontIframe, 'the incoming iframe is a distinct physical slot from the front');

  const scrollToCalls: Array<[number, number]> = [];
  Object.defineProperty(incomingIframe, 'contentWindow', {
    configurable: true,
    get() {
      return { scrollTo: (x: number, y: number) => scrollToCalls.push([x, y]) };
    },
  });

  await act(async () => {
    incomingIframe!.dispatchEvent(new window.Event('load'));
  });

  assert.deepEqual(scrollToCalls, [[0, 250]],
    'the incoming slot replays the exact offset captured off the front iframe before the reload — the stage state → renderer scroll-threading seam, end to end');

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

test('renders the frontmatter card above the markdown body when showFrontmatter is on (P02-T01)', () => {
  const html = renderToStaticMarkup(createElement(BufferedStage, {
    projectName: 'DEMO', artifact: MD, markdownContent: '# Hi',
    frontmatter: { status: 'active' }, showFrontmatter: true, activePulse: false,
  } as never));
  const cardIdx = html.indexOf('data-slot="card"');
  const bodyIdx = html.search(/>Hi</);
  assert.ok(cardIdx >= 0 && bodyIdx >= 0 && cardIdx < bodyIdx, 'frontmatter card precedes the markdown body in DOM order');
});

test('omits the frontmatter card when showFrontmatter is off, even with frontmatter present (P02-T01)', () => {
  const html = renderToStaticMarkup(createElement(BufferedStage, {
    projectName: 'DEMO', artifact: MD, markdownContent: '# Hi',
    frontmatter: { status: 'active' }, showFrontmatter: false, activePulse: false,
  } as never));
  assert.ok(!html.includes('data-slot="card"'), 'no frontmatter card while the toggle is off');
});

test('omits the frontmatter card while the body is still loading, even with showFrontmatter on (P02-T01)', () => {
  const html = renderToStaticMarkup(createElement(BufferedStage, {
    projectName: 'DEMO', artifact: MD, markdownContent: null,
    frontmatter: { status: 'active' }, showFrontmatter: true, activePulse: false,
  } as never));
  assert.ok(!html.includes('data-slot="card"'), 'no frontmatter card renders ahead of its own body');
  assert.ok(/role="status"/.test(html), 'the loading spinner still renders in its place');
});

test('frontmatter is gated by the same active-file identity as the body — no stale card on md→md navigation (P02-T01)', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>');
  const { window } = dom;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).window = window;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).document = window.document;
  const { createRoot } = await import('react-dom/client');
  const { act } = await import('react');
  const A = { path: 'A.md', kind: 'markdown' as const, title: 'Doc', isMarkdown: true };
  const B = { path: 'B.md', kind: 'markdown' as const, title: 'Doc', isMarkdown: true };
  const root = createRoot(window.document.getElementById('root')!);
  // A is open, its own frontmatter shown.
  await act(async () => {
    root.render(createElement(BufferedStage, {
      projectName: 'DEMO', artifact: A, markdownContent: '# Alpha', markdownContentFileName: 'A.md',
      frontmatter: { status: 'alpha' }, showFrontmatter: true, activePulse: false, liveMtime: 0,
    } as never));
  });
  await act(async () => {});
  const showingA = window.document.getElementById('root')!;
  assert.equal((showingA.innerHTML.match(/data-slot="card"/g) ?? []).length, 1, 'A shows exactly its own frontmatter card');
  // Navigate to B, but B's fetch has NOT resolved: markdownContent/frontmatter/fileName
  // still hold A's values. The incoming B layer must not inherit A's frontmatter card —
  // it should stay in its loading state, same as the body (BUG 1's guard, extended).
  await act(async () => {
    root.render(createElement(BufferedStage, {
      projectName: 'DEMO', artifact: B, markdownContent: '# Alpha', markdownContentFileName: 'A.md',
      frontmatter: { status: 'alpha' }, showFrontmatter: true, activePulse: false, liveMtime: 0,
    } as never));
  });
  await act(async () => {});
  const midNav = window.document.getElementById('root')!;
  assert.equal((midNav.innerHTML.match(/data-slot="card"/g) ?? []).length, 1,
    'still exactly one frontmatter card (A\'s front slot) — no second card leaked onto the not-yet-loaded B slot');
  await act(async () => { root.unmount(); });
});

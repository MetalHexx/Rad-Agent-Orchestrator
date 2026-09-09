import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { IframePreview, computeFitScale, StageIframe, readIframeScrollTop, applyIframeScrollTop } from './iframe-preview';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).React = React;

function render(props: Parameters<typeof IframePreview>[0]): string {
  return renderToStaticMarkup(createElement(IframePreview, props));
}

test('points the iframe src at the raw route with encoded project + path (AD-5, FR-13)', () => {
  const html = render({ projectName: 'DEMO', fileName: 'DEMO-BRAINSTORM.html' });
  assert.ok(html.includes('/api/projects/DEMO/raw?path=DEMO-BRAINSTORM.html'), 'src targets raw route');
});

test('renders a sandboxed iframe without allow-scripts (NFR-1)', () => {
  const html = render({ projectName: 'DEMO', fileName: 'DEMO-BRAINSTORM.html' });
  assert.ok(html.includes('sandbox='), 'iframe carries a sandbox attribute');
  assert.ok(!html.includes('allow-scripts'), 'sandbox must not allow scripts');
});

test('applies a CSS scale transform when scale prop is given (FR-16)', () => {
  const html = render({ projectName: 'DEMO', fileName: 'DEMO-BRAINSTORM.html', scale: 0.25 });
  assert.ok(html.includes('scale(0.25)'), 'scale transform applied');
});

test('disables pointer events on the iframe when interactive is false (FR-18)', () => {
  const html = render({ projectName: 'DEMO', fileName: 'DEMO-BRAINSTORM.html', scale: 0.1, interactive: false });
  assert.ok(html.includes('pointer-events:none') || html.includes('pointer-events: none'), 'pointer events disabled');
});

test('computeFitScale scales down to fit a narrower container (FR-16)', () => {
  const scale = computeFitScale(900, 1280);
  assert.ok(Math.abs(scale - 900 / 1280) < 1e-9, 'scale equals containerWidth/designWidth');
  assert.ok(Math.abs(scale - 0.703125) < 1e-6, 'scale ≈ 0.703125');
});

test('computeFitScale never upscales when container is wider than design (FR-16)', () => {
  assert.equal(computeFitScale(1600, 1280), 1, 'wider container clamps to 1');
});

test('computeFitScale returns 1 when container equals design width (FR-16)', () => {
  assert.equal(computeFitScale(1280, 1280), 1, 'equal widths produce scale 1');
});

test('computeFitScale guards against a zero container width (FR-16)', () => {
  assert.equal(computeFitScale(0, 1280), 1, 'zero container width returns 1');
});

test('computeFitScale guards against a zero design width (FR-16)', () => {
  assert.equal(computeFitScale(900, 0), 1, 'zero design width returns 1');
});

test('renders loading="lazy" by default (Issue B)', () => {
  const html = render({ projectName: 'DEMO', fileName: 'DEMO-BRAINSTORM.html' });
  assert.ok(html.includes('loading="lazy"'), 'iframe lazy-loads by default');
});

test('renders loading="eager" when eager is passed (Issue B)', () => {
  const html = render({ projectName: 'DEMO', fileName: 'DEMO-BRAINSTORM.html', eager: true });
  assert.ok(html.includes('loading="eager"'), 'iframe eagerly loads when eager');
});

test('readIframeScrollTop reads contentWindow.scrollY', () => {
  const el = { contentWindow: { scrollY: 150 } } as unknown as HTMLIFrameElement;
  assert.equal(readIframeScrollTop(el), 150, 'reports the window-level scroll offset');
});

test('readIframeScrollTop degrades to 0 on a null element or missing contentWindow', () => {
  assert.equal(readIframeScrollTop(null), 0, 'null element yields 0');
  const el = { contentWindow: null } as unknown as HTMLIFrameElement;
  assert.equal(readIframeScrollTop(el), 0, 'a not-yet-loaded iframe yields 0');
});

test('readIframeScrollTop degrades to 0 when contentWindow access throws (opaque origin)', () => {
  const el = {} as HTMLIFrameElement;
  Object.defineProperty(el, 'contentWindow', {
    get() { throw new Error('cross-origin access denied'); },
  });
  assert.equal(readIframeScrollTop(el), 0, 'a throwing getter degrades to 0 rather than throwing');
});

test('applyIframeScrollTop calls contentWindow.scrollTo(0, top)', () => {
  const calls: Array<[number, number]> = [];
  const el = { contentWindow: { scrollTo: (x: number, y: number) => calls.push([x, y]) } } as unknown as HTMLIFrameElement;
  applyIframeScrollTop(el, 321);
  assert.deepEqual(calls, [[0, 321]], 'scrolls the iframe window to the given offset');
});

test('applyIframeScrollTop is a silent no-op on a null element or a throwing contentWindow getter', () => {
  assert.doesNotThrow(() => applyIframeScrollTop(null, 200), 'null element is a silent no-op');
  const el = {} as HTMLIFrameElement;
  Object.defineProperty(el, 'contentWindow', {
    get() { throw new Error('cross-origin access denied'); },
  });
  assert.doesNotThrow(() => applyIframeScrollTop(el, 200), 'a throwing getter degrades quietly, not a throw');
});

test('StageIframe applies initialScrollTop inside its own load handler before the caller onLoad fires', async () => {
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

  const order: string[] = [];
  const iframeRef = React.createRef<HTMLIFrameElement>();
  const root = createRoot(window.document.getElementById('root')!);
  await act(async () => {
    root.render(createElement(StageIframe, {
      projectName: 'DEMO',
      fileName: 'V.html',
      initialScrollTop: 240,
      iframeRef,
      onLoad: () => { order.push('onLoad'); },
    } as never));
  });

  const iframeEl = iframeRef.current!;
  assert.ok(iframeEl, 'iframeRef is populated once the slot mounts');
  // jsdom fires its own real (unrelated) load event once the mounted iframe's
  // src "navigates" — flush it and discard it before wiring the controlled
  // contentWindow stub this assertion actually cares about.
  await act(async () => {});
  order.length = 0;
  const scrollToCalls: Array<[number, number]> = [];
  Object.defineProperty(iframeEl, 'contentWindow', {
    configurable: true,
    get() {
      return { scrollTo: (x: number, y: number) => { order.push('scroll'); scrollToCalls.push([x, y]); } };
    },
  });

  await act(async () => {
    iframeEl.dispatchEvent(new window.Event('load'));
  });

  assert.deepEqual(scrollToCalls, [[0, 240]], 'the initialScrollTop offset reaches contentWindow.scrollTo');
  assert.deepEqual(order, ['scroll', 'onLoad'], 'the scroll offset is applied before the caller onLoad runs');
  await act(async () => { root.unmount(); });
});

test('StageIframe skips applying a scroll offset when initialScrollTop is omitted, but still fires onLoad', async () => {
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

  let onLoadCount = 0;
  const iframeRef = React.createRef<HTMLIFrameElement>();
  const root = createRoot(window.document.getElementById('root')!);
  await act(async () => {
    root.render(createElement(StageIframe, {
      projectName: 'DEMO',
      fileName: 'V.html',
      iframeRef,
      onLoad: () => { onLoadCount += 1; },
    } as never));
  });

  const iframeEl = iframeRef.current!;
  // jsdom fires its own real (unrelated) load event once the mounted iframe's
  // src "navigates" — flush and discard it so only the controlled dispatch
  // below is measured.
  await act(async () => {});
  onLoadCount = 0;
  let scrollToCalled = false;
  Object.defineProperty(iframeEl, 'contentWindow', {
    configurable: true,
    get() {
      return { scrollTo: () => { scrollToCalled = true; } };
    },
  });

  await act(async () => {
    iframeEl.dispatchEvent(new window.Event('load'));
  });

  assert.equal(scrollToCalled, false, 'no initialScrollTop means no scrollTo call');
  assert.equal(onLoadCount, 1, 'the caller onLoad still fires once');
  await act(async () => { root.unmount(); });
});

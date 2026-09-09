/**
 * Rendering tests for the docs route — route derivation (proving the raw,
 * undecoded pathname reaches routeToCorpusPath), the shell's main-content
 * region and the absence of any breadcrumb link back to /docs, and the two
 * resilience cases: a corpus-absent page reaching the standard not-found
 * page via a render-phase throw, and a hash naming no heading leaving the
 * page fully rendered.
 *
 * Run with: npx tsx --tsconfig ui/tsconfig.test.json "ui/app/docs/[[...slug]]/page.test.tsx"
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import DocsPage from './page';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).React = React;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// A real value reference so esbuild's unused-import elision can't drop this
// import — its side effect of populating require.cache (page.tsx, and
// transitively next/navigation) is what loadMockedDocsPage depends on below.
assert.strictEqual(DocsPage.name, 'DocsPage', 'default export should be named DocsPage');

// ─── next/navigation mock ──────────────────────────────────────────────────

/**
 * tsx compiles imports to CJS require(), so require.cache is accessible — the
 * same technique app-header.test.tsx and page.project-switch.test.tsx use.
 * usePathname is overridden to a fixed test value; notFound is left bound to
 * the REAL next/navigation implementation (reached via the prototype chain),
 * so a render-phase call still throws the genuine NEXT_NOT_FOUND error.
 */
function loadMockedDocsPage(pathname: string): typeof DocsPage {
  const req = require as NodeRequire & { cache: Record<string, { exports: unknown } | undefined> };
  const navPath = req.resolve('next/navigation');
  const pagePath = req.resolve('./page');
  const origNavExports = req.cache[navPath]?.exports;
  assert.ok(origNavExports, 'next/navigation must be in require cache before mock');

  const mock = Object.create(origNavExports as object) as Record<string, unknown>;
  Object.defineProperty(mock, 'usePathname', {
    value: () => pathname,
    writable: true,
    enumerable: true,
    configurable: true,
  });

  req.cache[navPath]!.exports = mock;
  delete req.cache[pagePath];
  try {
    const fresh = req('./page') as { default: typeof DocsPage };
    return fresh.default;
  } finally {
    req.cache[navPath]!.exports = origNavExports;
  }
}

// ─── DOM harness ────────────────────────────────────────────────────────────

function setupDom(url: string): { container: HTMLDivElement; root: Root } {
  const dom = new JSDOM(`<!doctype html><html><body><div id="root"></div></body></html>`, { url });
  Object.defineProperty(globalThis, 'window', { value: dom.window, writable: true, configurable: true });
  Object.defineProperty(globalThis, 'document', { value: dom.window.document, writable: true, configurable: true });
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, writable: true, configurable: true });
  // next/link's useIntersection hook falls back to a requestIdleCallback
  // polyfill (no IntersectionObserver in jsdom) whose body references the
  // bare global `self` — undeclared under Node unless bridged here.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).self = dom.window;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).HTMLElement = dom.window.HTMLElement;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).Node = dom.window.Node;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).Element = dom.window.Element;
  dom.window.matchMedia = (() => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
  const container = dom.window.document.getElementById('root') as HTMLDivElement;
  const root = createRoot(container);
  return { container, root };
}

async function flush(times = 6): Promise<void> {
  for (let i = 0; i < times; i++) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

// ─── Fetch stub ─────────────────────────────────────────────────────────────

interface ContentSpec {
  status: number;
  body: unknown;
}

function installFetchStub(fixtures: Record<string, ContentSpec>, onRequest?: (url: string) => void) {
  const original = global.fetch;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global as any).fetch = async (input: string) => {
    const url = String(input);
    onRequest?.(url);
    const match = url.match(/\/api\/docs\/content\?path=([^&]+)/);
    if (!match) return new Response('{}', { status: 404 });
    const path = decodeURIComponent(match[1]);
    const spec = fixtures[path];
    if (!spec) {
      return new Response(JSON.stringify({ error: 'Document not found' }), { status: 404 });
    }
    return new Response(JSON.stringify(spec.body), { status: spec.status });
  };
  return { restore: () => { global.fetch = original; } };
}

function contentFixture(content: string): ContentSpec {
  return { status: 200, body: { frontmatter: {}, content, filePath: 'x' } };
}

// ─── ErrorBoundary — proves a render-phase throw versus a swallowed one ────

interface BoundaryState {
  caught: boolean;
}

class CatchingBoundary extends React.Component<{ children: React.ReactNode; onError: (e: unknown) => void }, BoundaryState> {
  state: BoundaryState = { caught: false };
  static getDerivedStateFromError(): BoundaryState {
    return { caught: true };
  }
  componentDidCatch(error: unknown) {
    this.props.onError(error);
  }
  render() {
    return this.state.caught ? null : this.props.children;
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test('derives the corpus path from the raw pathname and requests it undecoded', async () => {
  const cases: Array<[string, string]> = [
    ['/docs', 'README.md'],
    ['/docs/pipeline', 'docs/pipeline.md'],
    ['/docs/phases/one', 'docs/phases/one.md'],
  ];

  for (const [pathname, expectedCorpusPath] of cases) {
    let requestedPath: string | null = null;
    const stub = installFetchStub(
      { [expectedCorpusPath]: contentFixture('# Title') },
      (url) => {
        const parsed = new URL(url, 'http://localhost');
        requestedPath = parsed.searchParams.get('path');
      },
    );
    try {
      const MockedDocsPage = loadMockedDocsPage(pathname);
      const { root } = setupDom(`http://localhost:3000${pathname}`);
      await act(async () => { root.render(<MockedDocsPage />); });
      await act(async () => { await flush(); });
      assert.strictEqual(requestedPath, expectedCorpusPath, `pathname ${pathname} must request corpus path ${expectedCorpusPath}`);
      act(() => { root.unmount(); });
    } finally {
      stub.restore();
    }
  }
});

test('renders <main id="main-content"> and no breadcrumb link back to /docs, on either a non-root or the root page', async () => {
  const stub = installFetchStub({
    'docs/pipeline.md': contentFixture('# Pipeline\n\nBody text.'),
    'README.md': contentFixture('# Docs Home'),
  });
  try {
    for (const pathname of ['/docs/pipeline', '/docs']) {
      const MockedDocsPage = loadMockedDocsPage(pathname);
      const { container, root } = setupDom(`http://localhost:3000${pathname}`);
      await act(async () => { root.render(<MockedDocsPage />); });
      await act(async () => { await flush(); });

      const main = container.querySelector('#main-content');
      assert.ok(main, 'the shell must render <main id="main-content">');

      const breadcrumb = Array.from(main!.querySelectorAll('a')).find((a) => a.getAttribute('href') === '/docs');
      assert.strictEqual(breadcrumb, undefined, `${pathname} must not render a breadcrumb link back to /docs`);

      act(() => { root.unmount(); });
    }
  } finally {
    stub.restore();
  }
});

test('a page absent from the corpus throws notFound() during render, not inside the fetch callback', async () => {
  const stub = installFetchStub({});
  const unhandled: unknown[] = [];
  const onUnhandledRejection = (reason: unknown) => { unhandled.push(reason); };
  process.on('unhandledRejection', onUnhandledRejection);
  try {
    const MockedDocsPage = loadMockedDocsPage('/docs/no-such-page');
    const { root } = setupDom('http://localhost:3000/docs/no-such-page');
    let caught: unknown = null;

    await act(async () => {
      root.render(
        <CatchingBoundary onError={(e) => { caught = e; }}>
          <MockedDocsPage />
        </CatchingBoundary>,
      );
    });
    await act(async () => { await flush(); });

    assert.ok(caught, 'the ErrorBoundary must catch a render-phase throw for a corpus-absent page');
    assert.strictEqual((caught as { digest?: string }).digest, 'NEXT_NOT_FOUND', 'the caught error must be next/navigation\'s notFound()');
    assert.strictEqual(unhandled.length, 0, 'notFound() must not surface as an unhandled promise rejection (that would mean it was thrown inside the fetch .then())');

    act(() => { root.unmount(); });
  } finally {
    process.off('unhandledRejection', onUnhandledRejection);
    stub.restore();
  }
});

test('a malformed corpus path (400 from the content route) throws notFound() during render, not inside the fetch callback', async () => {
  const original = global.fetch;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global as any).fetch = async () => new Response(JSON.stringify({ error: 'Invalid path' }), { status: 400 });
  const unhandled: unknown[] = [];
  const onUnhandledRejection = (reason: unknown) => { unhandled.push(reason); };
  process.on('unhandledRejection', onUnhandledRejection);
  try {
    const MockedDocsPage = loadMockedDocsPage('/docs/no-such-page');
    const { root } = setupDom('http://localhost:3000/docs/no-such-page');
    let caught: unknown = null;

    await act(async () => {
      root.render(
        <CatchingBoundary onError={(e) => { caught = e; }}>
          <MockedDocsPage />
        </CatchingBoundary>,
      );
    });
    await act(async () => { await flush(); });

    assert.ok(caught, 'the ErrorBoundary must catch a render-phase throw for a 400 (malformed corpus path)');
    assert.strictEqual((caught as { digest?: string }).digest, 'NEXT_NOT_FOUND', 'the caught error must be next/navigation\'s notFound()');
    assert.strictEqual(unhandled.length, 0, 'notFound() must not surface as an unhandled promise rejection (that would mean it was thrown inside the fetch .then())');

    act(() => { root.unmount(); });
  } finally {
    process.off('unhandledRejection', onUnhandledRejection);
    global.fetch = original;
  }
});

test('a fragment history navigation re-scrolls to the newly addressed heading', async () => {
  const stub = installFetchStub({
    'docs/pipeline.md': contentFixture('# Pipeline\n\n## Alpha\n\nalpha body\n\n## Beta\n\nbeta body'),
  });
  try {
    const MockedDocsPage = loadMockedDocsPage('/docs/pipeline');
    const { root } = setupDom('http://localhost:3000/docs/pipeline#alpha');
    const scrolled: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window.HTMLElement.prototype as any).scrollIntoView = function scrollIntoView(this: HTMLElement) {
      scrolled.push(this.id);
    };

    await act(async () => { root.render(<MockedDocsPage />); });
    await act(async () => { await flush(); });
    assert.deepStrictEqual(scrolled, ['alpha'], 'the initial deep link must scroll to the heading it addresses');

    // Back/forward between two anchors on the same page: the route never
    // changes, so nothing but the fragment moves.
    scrolled.length = 0;
    await act(async () => {
      window.location.hash = '#beta';
      await flush();
    });

    assert.ok(scrolled.length > 0, 'a fragment history navigation must re-scroll — the deep-link effect cannot, its content never changed');
    assert.deepStrictEqual([...new Set(scrolled)], ['beta'], 'the only heading scrolled to must be the newly addressed one');

    act(() => { root.unmount(); });
  } finally {
    stub.restore();
  }
});

test('a hash naming no heading on a valid page renders fully, with no scroll and no thrown error', async () => {
  const stub = installFetchStub({ 'docs/pipeline.md': contentFixture('# Pipeline\n\nBody text.') });
  try {
    const MockedDocsPage = loadMockedDocsPage('/docs/pipeline');
    const { container, root } = setupDom('http://localhost:3000/docs/pipeline#not-a-real-heading');
    let scrollCalls = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window.HTMLElement.prototype as any).scrollIntoView = () => { scrollCalls++; };
    let caught: unknown = null;

    await act(async () => {
      root.render(
        <CatchingBoundary onError={(e) => { caught = e; }}>
          <MockedDocsPage />
        </CatchingBoundary>,
      );
    });
    await act(async () => { await flush(); });

    assert.strictEqual(caught, null, 'no error should be thrown when the hash names no existing heading');
    assert.strictEqual(scrollCalls, 0, 'no scroll should occur when the hash names no existing heading');
    const main = container.querySelector('#main-content');
    assert.ok(main?.textContent?.includes('Pipeline'), 'the page must still render its content in full');

    act(() => { root.unmount(); });
  } finally {
    stub.restore();
  }
});

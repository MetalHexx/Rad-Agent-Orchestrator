import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  corpusPathToRoute,
  routeToCorpusPath,
  resolveDocHref,
  resolveDocImageSrc,
} from './docs-links';

test('corpusPathToRoute maps the corpus root README to the docs viewer root', () => {
  assert.equal(corpusPathToRoute('README.md'), '/docs');
});

test('corpusPathToRoute maps a docs/ page to its slug under /docs', () => {
  assert.equal(corpusPathToRoute('docs/pipeline.md'), '/docs/pipeline');
});

test('routeToCorpusPath inverts the docs viewer root back to the corpus README', () => {
  assert.equal(routeToCorpusPath('/docs'), 'README.md');
});

test('routeToCorpusPath inverts a docs viewer slug back to its corpus page', () => {
  assert.equal(routeToCorpusPath('/docs/pipeline'), 'docs/pipeline.md');
});

test('routeToCorpusPath decodes an encoded segment exactly once', () => {
  // encodeURIComponent('a%2Fb') === 'a%252Fb' — a double decode would turn
  // this back into a literal '/', smuggling a path separator into a value
  // that feeds the content route.
  assert.equal(routeToCorpusPath('/docs/a%252Fb'), 'docs/a%2Fb.md');
});

test('routeToCorpusPath passes a malformed % through instead of throwing', () => {
  assert.doesNotThrow(() => routeToCorpusPath('/docs/100%'));
  assert.equal(routeToCorpusPath('/docs/100%'), 'docs/100%.md');
});

test('resolveDocHref classifies a bare anchor', () => {
  assert.deepEqual(resolveDocHref('#section', 'docs/pipeline.md'), {
    kind: 'anchor',
    hash: '#section',
  });
});

test('resolveDocHref resolves a sibling doc link to the in-app route', () => {
  assert.deepEqual(resolveDocHref('pipeline.md', 'docs/dashboard.md'), {
    kind: 'internal',
    href: '/docs/pipeline',
  });
});

test('resolveDocHref carries a heading anchor through to the resolved route', () => {
  assert.deepEqual(resolveDocHref('pipeline.md#review-intensity', 'docs/dashboard.md'), {
    kind: 'internal',
    href: '/docs/pipeline#review-intensity',
  });
});

test('resolveDocHref climbs up from a nested docs page back to the corpus README', () => {
  assert.deepEqual(resolveDocHref('../README.md', 'docs/pipeline.md'), {
    kind: 'internal',
    href: '/docs',
  });
});

test('resolveDocHref resolves an image-wrapping anchor to the asset route', () => {
  assert.deepEqual(resolveDocHref('../assets/observability-ui-1.png', 'docs/observability.md'), {
    kind: 'asset',
    href: `/api/docs/asset?path=${encodeURIComponent('assets/observability-ui-1.png')}`,
  });
});

test('resolveDocHref leaves an external URL alone', () => {
  const href = 'https://jira.radancy.com/browse/HELP-1';
  assert.deepEqual(resolveDocHref(href, 'docs/pipeline.md'), { kind: 'external', href });
});

test('resolveDocHref treats a protocol-relative host as external', () => {
  const href = '//cdn.example.com/x.png';
  assert.deepEqual(resolveDocHref(href, 'docs/pipeline.md'), { kind: 'external', href });
});

test('resolveDocHref treats a climb above the corpus root as external and leaves it untouched', () => {
  const href = '../../secrets.md';
  assert.deepEqual(resolveDocHref(href, 'docs/pipeline.md'), { kind: 'external', href });
});

test('resolveDocHref passes an already-absolute in-app route straight through as internal', () => {
  assert.deepEqual(resolveDocHref('/docs/pipeline', 'docs/dashboard.md'), {
    kind: 'internal',
    href: '/docs/pipeline',
  });
});

test('resolveDocHref falls to the asset bucket for an href carrying a query string (documented edge behavior — no per-link special casing)', () => {
  const expected = `/api/docs/asset?path=${encodeURIComponent('docs/pipeline.md?ref=1')}`;
  assert.deepEqual(resolveDocHref('pipeline.md?ref=1', 'docs/dashboard.md'), {
    kind: 'asset',
    href: expected,
  });
});

test('resolveDocImageSrc resolves a relative image path to the asset route', () => {
  assert.equal(
    resolveDocImageSrc('../assets/dashboard-screenshot.png', 'docs/dashboard.md'),
    `/api/docs/asset?path=${encodeURIComponent('assets/dashboard-screenshot.png')}`,
  );
});

test('resolveDocImageSrc leaves an external image URL alone', () => {
  const src = 'https://example.com/screenshot.png';
  assert.equal(resolveDocImageSrc(src, 'docs/dashboard.md'), src);
});

test('resolveDocImageSrc leaves an already-absolute in-app path alone', () => {
  const src = '/api/docs/asset?path=assets%2Fdashboard-screenshot.png';
  assert.equal(resolveDocImageSrc(src, 'docs/dashboard.md'), src);
});

test('resolveDocImageSrc leaves a climb above the corpus root untouched', () => {
  const src = '../../outside.png';
  assert.equal(resolveDocImageSrc(src, 'docs/dashboard.md'), src);
});

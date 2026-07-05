import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDocDeepLink } from './deep-link';

test('builds an origin-based document deep link, encoding the project and filename', () => {
  assert.equal(
    buildDocDeepLink('http://192.168.1.5:3000', 'MY PROJ', 'A B-WIREFRAME.html'),
    'http://192.168.1.5:3000/projects/MY%20PROJ/docs/A%20B-WIREFRAME.html',
  );
});

test('encodes a nested path as real path segments, not a single %2F-encoded segment', () => {
  const url = buildDocDeepLink('http://localhost:3000', 'DEMO', 'phases/PHASE-2-PLAN.md');
  assert.equal(url, 'http://localhost:3000/projects/DEMO/docs/phases/PHASE-2-PLAN.md');
  assert.ok(!url.includes('%2F'), 'the path separator is a real URL segment boundary, not an encoded slash');
});

// ─── round-trip: build → the page's segs.slice(3)-style parser ───────────────

/** Mirrors page.tsx's parser: everything after `/docs/` is split into path
 *  segments, each individually decoded, then rejoined with `/`. */
function parseDocPathFromUrl(url: string): string | null {
  const marker = '/docs/';
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  const afterDocs = url.slice(idx + marker.length);
  if (afterDocs === '') return null;
  return afterDocs.split('/').map(decodeURIComponent).join('/');
}

test('a flat filename round-trips unchanged through build -> parse (backward compat)', () => {
  const url = buildDocDeepLink('http://localhost:3000', 'DEMO', 'A B-WIREFRAME.html');
  assert.equal(parseDocPathFromUrl(url), 'A B-WIREFRAME.html');
});

test('a nested phases/ path round-trips through build -> parse (this is the one place a nested path can silently resolve to the wrong document)', () => {
  const docPath = 'phases/PHASE-2-PLAN.md';
  const url = buildDocDeepLink('http://localhost:3000', 'DEMO', docPath);
  assert.equal(parseDocPathFromUrl(url), docPath);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { useUrlViewState } from './use-url-view-state';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(here, 'use-url-view-state.ts'), 'utf8');

test('useUrlViewState is exported and takes a codec (AD-6, FR-8)', () => {
  assert.equal(typeof useUrlViewState, 'function');
  assert.match(src, /codec\.read\(/, 'hydrate uses codec.read');
  assert.match(src, /codec\.write\(/, 'persist uses codec.write');
});

test('a hydrated ref gates the persist effect first run (FR-11, NFR-5)', () => {
  assert.match(src, /const hydrated = React\.useRef\(false\)/, 'a hydrated ref must exist');
  assert.match(src, /if \(!hydrated\.current\) \{ hydrated\.current = true; return; \}/,
    'persist effect must skip its first (mount) invocation before replaceState');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(here, 'observability-view.tsx'), 'utf8');

test('the URL-persist effect skips its first (mount) run so a deep link is not overwritten with defaults (FR-12, AD-8)', () => {
  // The hydrate effect and the persist effect both run in the mount commit; the hydrate
  // effect's setState is still pending when the persist effect fires, so an unguarded
  // mount-time replaceState would clobber the incoming query string with default state.
  // A urlHydrated ref must gate the persist effect's first invocation. This is a
  // source-invariant test because renderToStaticMarkup never runs effects.
  assert.match(
    src,
    /const urlHydrated = React\.useRef\(false\)/,
    'a urlHydrated ref must exist to gate the persist effect'
  );
  assert.match(
    src,
    /if \(!urlHydrated\.current\) \{ urlHydrated\.current = true; return; \}/,
    'the persist effect must skip its first (mount) invocation before replaceState'
  );
});

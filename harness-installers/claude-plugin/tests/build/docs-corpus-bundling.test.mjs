// harness-installers/claude-plugin/tests/build/docs-corpus-bundling.test.mjs —
// Asserts the claude-plugin build stages the documentation corpus (README.md,
// docs/, assets/) under output/_install-source/docs/, that nothing under an
// excluded doc prefix survives into the payload, and that the docs half of the
// catalog is generated into output/manifests/ only — never back into the
// committed source manifest.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runBuild } from '../helpers/run-build.js';

const INSTALLER_REL = 'harness-installers/claude-plugin';
const DOCS_SOURCE_PREFIX = '_install-source/docs/';

function readCatalog(manifestsDir) {
  const file = fs.readdirSync(manifestsDir).find((f) => /^v.+\.json$/.test(f));
  return JSON.parse(fs.readFileSync(path.join(manifestsDir, file), 'utf8'));
}

test('build stages the docs corpus under _install-source/docs/', async () => {
  const { outRoot, cleanup } = await runBuild();
  try {
    const docsRoot = path.join(outRoot, '_install-source/docs');
    assert.ok(fs.existsSync(path.join(docsRoot, 'README.md')), 'README.md staged');
    assert.ok(fs.existsSync(path.join(docsRoot, 'docs/getting-started.md')), 'doc page staged');
    assert.ok(fs.existsSync(path.join(docsRoot, 'assets/diagram.png')), 'image asset staged');
  } finally {
    cleanup();
  }
});

test('nothing from the excluded doc prefixes reaches the payload', async () => {
  const { outRoot, cleanup } = await runBuild();
  try {
    const docsRoot = path.join(outRoot, '_install-source/docs');
    assert.ok(!fs.existsSync(path.join(docsRoot, 'docs/internals')), 'internals/ excluded');
    assert.ok(!fs.existsSync(path.join(docsRoot, 'docs/research')), 'research/ excluded');
  } finally {
    cleanup();
  }
});

test('docs entries are generated into the built catalog only, never the source tree', async () => {
  const { outRoot, fixtureRoot, cleanup } = await runBuild();
  try {
    const built = readCatalog(path.join(outRoot, 'manifests'));
    const docsEntries = built.files.filter((f) => f.sourcePath.startsWith(DOCS_SOURCE_PREFIX));
    assert.ok(docsEntries.length > 0, 'built catalog claims the staged docs corpus');
    for (const entry of docsEntries) {
      assert.match(entry.destinationPath, /^\$\{RAD_HOME\}\/docs\//,
        `${entry.sourcePath} must destinate under \${RAD_HOME}/docs/`);
      assert.equal(entry.ownership, 'installer-owned', `${entry.sourcePath} is installer-owned`);
      assert.ok(fs.existsSync(path.join(outRoot, entry.sourcePath)),
        `${entry.sourcePath} exists in the built payload`);
    }

    const committed = readCatalog(path.join(fixtureRoot, INSTALLER_REL, 'manifests'));
    assert.deepEqual(
      committed.files.filter((f) => f.sourcePath.startsWith(DOCS_SOURCE_PREFIX)), [],
      'the committed catalog stays free of generated docs entries',
    );
  } finally {
    cleanup();
  }
});

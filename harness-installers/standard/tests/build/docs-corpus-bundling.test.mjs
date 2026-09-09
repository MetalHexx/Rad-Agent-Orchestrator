// harness-installers/standard/tests/build/docs-corpus-bundling.test.mjs —
// Asserts the standard installer build stages the documentation corpus
// (README.md, docs/, assets/) into every per-harness `output/<h>/docs/`
// payload, that nothing under an excluded doc prefix survives into `output/`,
// and that every `docs/`-prefixed manifest entry destinates under
// `${RAD_HOME}/docs/`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runBuild } from '../helpers/run-build.js';

const HARNESSES = ['claude', 'copilot-vscode', 'copilot-cli'];

test('standard build stages the docs corpus for every harness', async () => {
  const { outRoot, cleanup } = await runBuild();
  try {
    for (const h of HARNESSES) {
      const docsRoot = path.join(outRoot, h, 'docs');
      assert.ok(fs.existsSync(path.join(docsRoot, 'README.md')), `${h}: docs/README.md present`);
      assert.ok(fs.existsSync(path.join(docsRoot, 'docs/getting-started.md')),
        `${h}: docs/docs/getting-started.md present`);
      assert.ok(fs.existsSync(path.join(docsRoot, 'assets/diagram.png')),
        `${h}: docs/assets/diagram.png present`);
    }
  } finally {
    cleanup();
  }
});

test('nothing from the excluded doc prefixes survives into output/ (exclusion property)', async () => {
  const { outRoot, cleanup } = await runBuild();
  try {
    for (const h of HARNESSES) {
      const docsRoot = path.join(outRoot, h, 'docs');
      assert.ok(!fs.existsSync(path.join(docsRoot, 'docs/internals')),
        `${h}: docs/docs/internals/ must not exist`);
      assert.ok(!fs.existsSync(path.join(docsRoot, 'docs/research')),
        `${h}: docs/docs/research/ must not exist`);
    }
  } finally {
    cleanup();
  }
});

test('manifest entries for docs all destinate under ${RAD_HOME}/docs/', async () => {
  const { outRoot, cleanup } = await runBuild();
  try {
    for (const h of HARNESSES) {
      const manifestPath = path.join(outRoot, h, 'manifests', 'v1.0.0-alpha.14.json');
      assert.ok(fs.existsSync(manifestPath), `${h}: manifest written`);
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      const docFiles = manifest.files.filter((f) => f.bundlePath.startsWith('docs/'));
      assert.ok(docFiles.length > 0, `${h}: manifest lists at least one docs/ entry`);
      for (const f of docFiles) {
        assert.match(f.destinationPath, /^\$\{RAD_HOME\}\/docs\//,
          `${h}: ${f.bundlePath} destinationPath uses \${RAD_HOME}/docs/...`);
      }
      // Defensive: manifest must NOT list any path under an excluded doc prefix.
      for (const f of docFiles) {
        assert.ok(!f.bundlePath.startsWith('docs/docs/internals/'),
          `${h}: manifest must not list any docs/docs/internals/ payload (got ${f.bundlePath})`);
        assert.ok(!f.bundlePath.startsWith('docs/docs/research/'),
          `${h}: manifest must not list any docs/docs/research/ payload (got ${f.bundlePath})`);
      }
    }
  } finally {
    cleanup();
  }
});

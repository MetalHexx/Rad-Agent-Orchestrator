// harness-installers/claude-plugin/tests/install/docs-corpus-replacement.test.mjs —
// The documentation corpus is installer-owned in full and is replaced wholesale
// on install. This channel keeps only one manifest, so the prior-version removal
// pass cannot reach a page dropped between two releases — the removal below is
// the only thing that clears it. The two fast paths must not run it: a careless
// placement would wipe the corpus on every re-run of an unchanged version.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import { dirname, join } from 'node:path';
import { runInstall } from '../../lib/install/run-install.js';

// Mirrors what the build's merge-docs-manifest step emits: one user-config
// runtime-config entry plus the generated, installer-owned docs corpus.
const MANIFEST_FILES = [
  {
    destinationPath: '${RAD_HOME}/orchestration.yml',
    sourcePath: '_install-source/orchestration.yml',
    ownership: 'user-config',
  },
  {
    destinationPath: '${RAD_HOME}/docs/README.md',
    sourcePath: '_install-source/docs/README.md',
    ownership: 'installer-owned',
  },
  {
    destinationPath: '${RAD_HOME}/docs/docs/getting-started.md',
    sourcePath: '_install-source/docs/docs/getting-started.md',
    ownership: 'installer-owned',
  },
];

/** (Re-)stages every manifest sourcePath under the plugin root. A real re-run
 *  re-extracts the payload, which runInstall sweeps on success. */
function stageInstallSource(pluginRoot) {
  for (const entry of MANIFEST_FILES) {
    const src = join(pluginRoot, entry.sourcePath);
    fs.mkdirSync(dirname(src), { recursive: true });
    fs.writeFileSync(src, `# synthetic: ${entry.sourcePath}\n`);
  }
}

function makePluginRoot(version) {
  const dir = fs.mkdtempSync(join(os.tmpdir(), 'docs-plugin-'));
  fs.mkdirSync(join(dir, 'skills/rad-orchestration/scripts'), { recursive: true });
  fs.writeFileSync(join(dir, 'skills/rad-orchestration/scripts/radorch.mjs'), '#!/usr/bin/env node\n');
  fs.writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'p', version }));
  fs.mkdirSync(join(dir, 'manifests'), { recursive: true });
  fs.writeFileSync(join(dir, `manifests/v${version}.json`), JSON.stringify({ version, files: MANIFEST_FILES }));
  stageInstallSource(dir);
  return dir;
}

test('install replaces the corpus wholesale — a page the new payload does not carry is gone', async () => {
  const radHome = fs.mkdtempSync(join(os.tmpdir(), 'rad-home-docs-'));
  const pluginRoot = makePluginRoot('1.0.0');
  try {
    fs.mkdirSync(join(radHome, 'docs/guides'), { recursive: true });
    fs.writeFileSync(join(radHome, 'docs/stale.md'), '# dropped in this release\n');
    fs.writeFileSync(join(radHome, 'docs/guides/gone.md'), '# dropped in this release\n');

    await runInstall({ pluginRoot, radHome });

    assert.ok(!fs.existsSync(join(radHome, 'docs/stale.md')), 'stale page removed');
    assert.ok(!fs.existsSync(join(radHome, 'docs/guides')), 'stale subtree removed');
    assert.ok(fs.existsSync(join(radHome, 'docs/README.md')), 'current corpus installed');
    assert.ok(fs.existsSync(join(radHome, 'docs/docs/getting-started.md')), 'current page installed');
  } finally {
    fs.rmSync(radHome, { recursive: true, force: true });
    fs.rmSync(pluginRoot, { recursive: true, force: true });
  }
});

test('the noop fast path returns without touching the corpus', async () => {
  const radHome = fs.mkdtempSync(join(os.tmpdir(), 'rad-home-docs-noop-'));
  const pluginRoot = makePluginRoot('1.0.0');
  try {
    await runInstall({ pluginRoot, radHome });
    stageInstallSource(pluginRoot);
    fs.writeFileSync(join(radHome, 'docs/README.md'), 'SENTINEL');

    const result = await runInstall({ pluginRoot, radHome });

    assert.strictEqual(result.action, 'noop');
    assert.strictEqual(fs.readFileSync(join(radHome, 'docs/README.md'), 'utf8'), 'SENTINEL',
      'corpus neither removed nor re-installed on the noop path');
  } finally {
    fs.rmSync(radHome, { recursive: true, force: true });
    fs.rmSync(pluginRoot, { recursive: true, force: true });
  }
});

test('the downgrade-noop fast path returns without touching the corpus', async () => {
  const radHome = fs.mkdtempSync(join(os.tmpdir(), 'rad-home-docs-down-'));
  const pluginNew = makePluginRoot('1.1.0');
  const pluginOld = makePluginRoot('1.0.0');
  try {
    await runInstall({ pluginRoot: pluginNew, radHome });
    fs.writeFileSync(join(radHome, 'docs/README.md'), 'SENTINEL');

    const result = await runInstall({ pluginRoot: pluginOld, radHome, stderr: () => {} });

    assert.strictEqual(result.action, 'downgrade-noop');
    assert.strictEqual(fs.readFileSync(join(radHome, 'docs/README.md'), 'utf8'), 'SENTINEL',
      'corpus neither removed nor re-installed on the downgrade-noop path');
  } finally {
    fs.rmSync(radHome, { recursive: true, force: true });
    fs.rmSync(pluginNew, { recursive: true, force: true });
    fs.rmSync(pluginOld, { recursive: true, force: true });
  }
});

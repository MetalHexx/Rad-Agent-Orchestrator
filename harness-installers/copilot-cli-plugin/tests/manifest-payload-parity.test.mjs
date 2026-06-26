import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBuild } from './helpers/run-build.js';
import { checkInstallSourceParity } from '../../shared/build-helpers/manifest-parity.js';

// Drift gate for the hand-authored manifest catalog.
//
// This plugin's manifest is a path catalog (no sha256) that the build copies
// verbatim into output/manifests/, so a rebuild + `git diff` gate (as used for
// the standard installer) can never detect when the installable payload and the
// catalog diverge. Instead we build the REAL runtime-config into an isolated tmp
// output/ (adapter engine / lib build / UI all skipped — fast and race-free) and
// assert the staged _install-source/ tree matches the committed manifest's
// sourcePath set in both directions. Add/rename/remove a template or
// action-event and forget the catalog → this fails.
const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'package.json'), 'utf8'));
const MANIFEST_PATH = path.join(PLUGIN_ROOT, 'manifests', `v${pkg.version}.json`);

test('built _install-source/ matches the committed manifest catalog (FR-1, FR-19)', async () => {
  const { outRoot, cleanup } = await runBuild({ realRuntimeConfig: true });
  try {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    const { missing, orphans } = checkInstallSourceParity({ outputDir: outRoot, manifest });
    assert.deepEqual(missing, [],
      `manifest lists sourcePath(s) with no built file (install would ENOENT): ${missing.join(', ')}`);
    assert.deepEqual(orphans, [],
      `built _install-source file(s) not listed in the manifest (would never install): ${orphans.join(', ')}`);
  } finally {
    cleanup();
  }
});

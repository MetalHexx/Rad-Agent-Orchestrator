// harness-installers/claude-plugin/tests/helpers/install-bench.js —
// Per-installer test helper for exercising runInstall + removeManifestFiles
// under a tmp ${RAD_HOME} with a synthetic plugin root that stages the
// action-events catalog the same way the real build emits it.
//
// Per the harness-installer encapsulation rule, this helper lives inside the
// claude-plugin tree only — never `require` a sibling.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runInstall } from '../../lib/install/run-install.js';
import { removeManifestFiles } from '../../lib/install/remove-files.js';
import { loadManifest } from '../../lib/install/catalog.js';

const VERSION = '1.0.0-alpha.12';

/** Runs the test body under a temp ${RAD_HOME} and a temp plugin root, then
 *  cleans up. The plugin root is pre-staged with the manifest catalog +
 *  _install-source/ payload containing the action-events tree (FR-20). */
export async function withTempHome(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'install-bench-'));
  const pluginRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-root-'));
  try {
    stagePluginRoot(pluginRoot);
    await fn(home, { pluginRoot });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(pluginRoot, { recursive: true, force: true });
  }
}

/** Synthetic plugin payload: package.json + sentinel + manifest catalog +
 *  _install-source tree (templates + action-events with no custom/ entries) +
 *  a synthetic ui.tgz that runInstall expects. */
export function stagePluginRoot(pluginRoot) {
  // package.json + sentinel — required by runInstall.
  fs.mkdirSync(path.join(pluginRoot, 'skills/rad-orchestration/scripts'), { recursive: true });
  fs.writeFileSync(
    path.join(pluginRoot, 'skills/rad-orchestration/scripts/radorch.mjs'),
    '#!/usr/bin/env node\n',
  );
  fs.writeFileSync(
    path.join(pluginRoot, 'package.json'),
    JSON.stringify({ name: 'rad-orc', version: VERSION }, null, 2),
  );

  // Manifest catalog — copy real manifest verbatim.
  fs.mkdirSync(path.join(pluginRoot, 'manifests'), { recursive: true });
  const realManifestPath = path.resolve(
    new URL('../../manifests/' + 'v' + VERSION + '.json', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'),
  );
  fs.copyFileSync(realManifestPath, path.join(pluginRoot, 'manifests', `v${VERSION}.json`));
  const manifest = JSON.parse(fs.readFileSync(realManifestPath, 'utf8'));

  // _install-source/ — stage every manifest entry's sourcePath.
  for (const entry of manifest.files) {
    const src = path.join(pluginRoot, entry.sourcePath);
    fs.mkdirSync(path.dirname(src), { recursive: true });
    fs.writeFileSync(src, `# synthetic: ${entry.sourcePath}\n`);
  }

  // Synthetic ui.tgz — runInstall extracts it only if present. Skip; runInstall
  // tolerates absence via fs.existsSync guard.
}

/** Runs the install for the staged plugin root against the given temp home. */
export async function installFull(home, { pluginRoot } = {}) {
  if (!pluginRoot) throw new Error('installFull: pluginRoot required');
  // Re-stage the plugin root since runInstall destroys _install-source/ on success.
  stagePluginRoot(pluginRoot);
  return await runInstall({ pluginRoot, radHome: path.join(home, '.radorc') });
}

/** Runs the manifest-driven removal under the given temp home — mirrors the
 *  remove half of the upgrade path (no public uninstall entry exists for
 *  plugins; harnesses remove the plugin folder themselves via /plugin uninstall). */
export function uninstallHarness(home, { pluginRoot } = {}) {
  if (!pluginRoot) throw new Error('uninstallHarness: pluginRoot required');
  const manifest = loadManifest(pluginRoot, VERSION);
  removeManifestFiles(manifest, { radHome: path.join(home, '.radorc') });
}

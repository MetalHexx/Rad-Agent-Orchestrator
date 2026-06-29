// harness-installers/standard/lib/install/catalog.js —
// Per-harness manifest catalog reader. Each per-harness payload at
// `output/<harness>/` carries a flat `manifests/` folder containing
// `v<version>.json` for every shipped version (AD-4). Upgrade flows resolve
// the prior-version manifest by reading from this folder, never from a
// repo-root catalog.

import fs from 'node:fs';
import path from 'node:path';

/**
 * Build the absolute path to a versioned manifest within a per-harness bundle.
 *
 * @param {string} bundleRoot — the per-harness payload root (e.g. output/claude/)
 * @param {string} harness    — install-key (informational; not used in path today)
 * @param {string} version    — semver string (without the leading 'v')
 * @returns {string}
 */
export function manifestPathForVersion(bundleRoot, harness, version) {
  void harness;
  return path.join(bundleRoot, 'manifests', `v${version}.json`);
}

/**
 * Read and parse a versioned manifest from the per-harness bundle's
 * `manifests/` folder. Throws a structured error if the file is missing
 * (AD-4: every prior version's manifest must be bundled).
 *
 * @param {string} bundleRoot
 * @param {string} harness
 * @param {string} version
 * @returns {{ files: Array<{ bundlePath: string, destinationPath: string }> }}
 */
export function loadBundledManifest(bundleRoot, harness, version) {
  const file = manifestPathForVersion(bundleRoot, harness, version);
  if (!fs.existsSync(file)) {
    const err = new Error(
      `[catalog] bundled manifest not found for harness '${harness}' version '${version}' at ${file}`,
    );
    err.code = 'BUNDLED_MANIFEST_MISSING';
    err.harness = harness;
    err.version = version;
    err.path = file;
    throw err;
  }
  const text = fs.readFileSync(file, 'utf8');
  return JSON.parse(text);
}

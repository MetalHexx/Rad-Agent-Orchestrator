// harness-installers/standard/build-scripts/emit-manifest.js —
// Walks a output/<harness>/ build tree and writes
// manifests/<harness>/v<version>.json with the per-harness installable tree
// only (no user-data assets per AD-3). The manifest is a sha-free path catalog
// ({ bundlePath, destinationPath }); install copies by path and never hashes.
// Atomic write per NFR-3.

import fs from 'node:fs';
import path from 'node:path';

// Assets that belong to post-install state-machine steps (hydrated by
// hydrate-user-data, not by installManifestFiles). bundlePaths matching any
// of these prefixes are excluded from the manifest entirely (AD-3).
const HYDRATION_EXCLUDED_PREFIXES = ['orchestration.yml', 'templates/', 'ui/'];

// Assets that DO appear in the manifest but install into the shared user-data
// root (~/.radorc/) rather than the per-harness root. Their manifest entries
// use ${RAD_HOME} destinations so installManifestFiles routes them correctly
// (FR-1, FR-19, AD-3). The action-events catalog is the first such asset.
const USER_DATA_PREFIXES = ['action-events/'];

/**
 * Recursively collects all file paths under `dir`, returning absolute paths.
 *
 * @param {string} dir
 * @param {string[]} [acc]
 * @returns {string[]}
 */
function walkDir(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(full, acc);
    } else {
      acc.push(full);
    }
  }
  return acc;
}

/**
 * Emits a per-harness manifest JSON file.
 *
 * Walks `harnessOutputDir`, filters out user-data assets, and writes:
 *   `{manifestDir}/v{version}.json`
 *
 * Shape: { version, channel, files: [{ bundlePath, destinationPath }] }
 * Files are sorted by bundlePath for stable diffs. No `ownership` field (AD-3).
 * No per-file hash — the manifest is a path catalog; every field is
 * platform-stable so the manifest regenerates byte-identically on any OS.
 * Write is atomic via tmp+rename (NFR-3).
 *
 * @param {{ harnessOutputDir: string, harness: string, version: string, manifestDir: string }} opts
 */
export async function emitManifest({ harnessOutputDir, harness, version, manifestDir }) {
  const allFiles = walkDir(harnessOutputDir);

  const files = [];
  for (const absPath of allFiles) {
    // POSIX-normalise the relative path regardless of platform (Windows uses \).
    const rel = path.relative(harnessOutputDir, absPath);
    const bundlePath = rel.split(path.sep).join('/');

    // AD-3: skip hydration-owned user-data assets entirely.
    if (HYDRATION_EXCLUDED_PREFIXES.some((prefix) => bundlePath === prefix || bundlePath.startsWith(prefix))) {
      continue;
    }

    // User-data assets (e.g. action-events/) install into ${RAD_HOME}/...; all
    // other manifest entries install into the per-harness ${HARNESS_ROOT}/...
    const isUserData = USER_DATA_PREFIXES.some(
      (prefix) => bundlePath === prefix || bundlePath.startsWith(prefix),
    );
    const destinationPath = isUserData
      ? '${RAD_HOME}/' + bundlePath
      : '${HARNESS_ROOT}/' + bundlePath;

    files.push({ bundlePath, destinationPath });
  }

  // Stable diffs — sort by bundlePath.
  files.sort((a, b) => a.bundlePath < b.bundlePath ? -1 : a.bundlePath > b.bundlePath ? 1 : 0);

  const manifest = { version, channel: 'standard', files };
  const outPath = path.join(manifestDir, `v${version}.json`);
  const tmpPath = outPath + '.tmp';

  // Atomic write: write to tmp then rename (NFR-3).
  fs.writeFileSync(tmpPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  fs.renameSync(tmpPath, outPath);
}

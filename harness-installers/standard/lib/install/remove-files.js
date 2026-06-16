// harness-installers/standard/lib/install/remove-files.js —
// Removes manifest entries from their resolved destinations and prunes any
// ancestor directories that end up empty (contents-aware): an ancestor that
// still contains a user-authored file — anything not in the manifest — is
// preserved. The harness root itself is never pruned. projects/ entries are
// skipped unconditionally (idempotent symmetry with install-files.js).
//
// FR-20 defensive guard: refuses any manifest entry that targets a path under
// ${RAD_HOME}/action-events/custom/. The shipped manifest must never list a
// user-authored custom payload; if one ever appears, abort the uninstall.
//
// AD-11: refuses any manifest entry whose resolved basename matches
// repo-registry.yml or repo-registry.local.yml — registry files survive
// uninstall unconditionally.

import fs from 'node:fs';
import path from 'node:path';
import { expandDestinationTokens } from './expand-tokens.js';
import { harnessRoot } from './harness-paths.js';
import { userDataPaths } from './user-data-paths.js';

/**
 * @param {{ files: Array<{ bundlePath: string, destinationPath: string, sha256?: string }> }} manifest
 * @param {string} harness
 * @returns {{ removedCount: number, prunedDirs: string[] }}
 */
export function removeManifestFiles(manifest, harness) {
  const projectsRoot = path.resolve(userDataPaths().projects);
  const telemetryRoot = path.resolve(userDataPaths().telemetry);
  const root = harnessRoot(harness);
  const rootResolved = path.resolve(root);
  let removedCount = 0;
  const dirsTouched = new Set();

  // Proper containment check — avoids the sibling-prefix bypass that a plain
  // `startsWith` allows (e.g. a sibling `telemetry-archive/` matching the
  // `telemetry` prefix, or `<root>-backup/` matching `<root>`). Mirrors the
  // claude-plugin remove-files.js guard.
  const isUnder = (parent, child) => {
    const rel = path.relative(parent, child);
    return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
  };

  // FR-20 / AD-11 defensive guard: refuse any manifest entry that targets a
  // payload under action-events/custom/ or a repo-registry*.yml file. The
  // shipped manifest must list neither; if one ever appears, abort before
  // touching disk.
  const customSegment = `${path.sep}action-events${path.sep}custom${path.sep}`;
  for (const entry of manifest.files ?? []) {
    const resolved = expandDestinationTokens(entry.destinationPath, harness);
    if (resolved.includes(customSegment)) {
      throw new Error(
        `uninstall safety: manifest entry '${entry.bundlePath}' targets an action-events/custom/ ` +
        `payload. Refusing to proceed.`,
      );
    }
    // AD-11: registry files are sacred — refuse removal just as install refuses writes.
    if (/repo-registry(\.local)?\.yml$/.test(path.basename(resolved))) {
      throw new Error(
        `uninstall safety: manifest entry '${entry.bundlePath}' targets a ` +
        `registry file. Refusing to proceed.`,
      );
    }
  }

  for (const entry of manifest.files) {
    const abs = expandDestinationTokens(entry.destinationPath, harness);
    const absResolved = path.resolve(abs);

    if (absResolved === projectsRoot || isUnder(projectsRoot, absResolved)) {
      console.warn(`[remove] skipping projects/ entry '${entry.bundlePath}'`);
      continue;
    }

    if (absResolved === telemetryRoot || isUnder(telemetryRoot, absResolved)) {
      console.warn(`[remove] skipping telemetry/ entry '${entry.bundlePath}'`);
      continue;
    }

    if (fs.existsSync(abs)) {
      fs.rmSync(abs, { force: true });
      removedCount++;
    }

    // Walk every ancestor up to (but not including) the harness root.
    let parent = path.dirname(abs);
    while (isUnder(rootResolved, path.resolve(parent))) {
      dirsTouched.add(parent);
      const next = path.dirname(parent);
      if (next === parent) break;
      parent = next;
    }
  }

  // Innermost dirs first. Each is removed only when its readdir returns
  // empty — any user-authored file inside (or any unrelated content) keeps
  // the ancestor (and everything above it) alive.
  const pruned = [];
  const sorted = [...dirsTouched].sort((a, b) => b.length - a.length);
  for (const dir of sorted) {
    if (!fs.existsSync(dir)) continue;
    try {
      const children = fs.readdirSync(dir);
      if (children.length === 0) {
        fs.rmdirSync(dir);
        pruned.push(dir);
      }
    } catch {
      /* race or permission — leave it */
    }
  }

  return { removedCount, prunedDirs: pruned };
}

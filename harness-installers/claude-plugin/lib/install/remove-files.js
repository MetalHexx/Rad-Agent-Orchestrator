import fs from 'node:fs';
import path from 'node:path';
import { userDataPaths } from './user-data-paths.js';

/** Removes every non-user-config entry then prunes empty parent dirs upward,
 *  with ~/.radorc/projects/ always skipped.
 *
 *  FR-20 defensive guard: refuses any manifest entry that targets a path under
 *  a protected catalog's ${RAD_HOME}/<catalog>/custom/ slot (action-events,
 *  communication-styles). The shipped manifest must never list one; if one
 *  ever appears, abort before touching disk. */
export function removeManifestFiles(manifest, opts = {}) {
  const paths = userDataPaths(opts);
  // Resolve both anchors once so containment checks survive mixed separators
  // (manifest paths use POSIX `/`, paths.* use the platform separator) and the
  // sibling-prefix bypass that plain startsWith allows.
  const rootResolved = path.resolve(paths.root);
  const projectsResolved = path.resolve(paths.projects);
  const telemetryResolved = path.resolve(paths.telemetry);
  const isUnder = (parent, child) => {
    const rel = path.relative(parent, child);
    return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
  };

  // FR-20 defensive guard.
  const PROTECTED_CUSTOM_SEGMENTS = ['action-events', 'communication-styles']
    .map((cat) => `${path.sep}${cat}${path.sep}custom${path.sep}`);
  for (const entry of manifest.files ?? []) {
    const dest = path.resolve(entry.destinationPath.replaceAll('${RAD_HOME}', paths.root));
    const guardedSegment = PROTECTED_CUSTOM_SEGMENTS.find((segment) => dest.includes(segment));
    if (guardedSegment) {
      const catalog = guardedSegment.split(path.sep).filter(Boolean)[0];
      throw new Error(
        `uninstall safety: manifest entry '${entry.sourcePath ?? entry.destinationPath}' targets a ` +
        `${catalog}/custom/ payload. Refusing to proceed.`,
      );
    }
  }

  const touched = new Set();
  for (const entry of manifest.files) {
    if (entry.ownership === 'user-config') continue;
    const dest = path.resolve(entry.destinationPath.replaceAll('${RAD_HOME}', paths.root));
    // Hard guards: never delete outside paths.root; never touch the projects tree.
    if (!isUnder(rootResolved, dest)) continue;
    if (dest === projectsResolved || isUnder(projectsResolved, dest)) continue;
    if (dest === telemetryResolved || isUnder(telemetryResolved, dest)) continue;
    if (fs.existsSync(dest)) fs.rmSync(dest, { force: true });
    let parent = path.dirname(dest);
    while (isUnder(rootResolved, parent) && parent !== projectsResolved && parent !== telemetryResolved) {
      touched.add(parent);
      parent = path.dirname(parent);
    }
  }
  const sorted = [...touched].sort((a, b) => b.length - a.length);
  for (const dir of sorted) {
    if (!fs.existsSync(dir)) continue;
    try {
      if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
    } catch { /* race / permission */ }
  }
}

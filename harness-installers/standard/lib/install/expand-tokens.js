// harness-installers/standard/lib/install/expand-tokens.js —
// Consumer-side helpers for resolving manifest tokens at install time.
//
//  * expandDestinationTokens — resolves ${HARNESS_ROOT}/${RAD_HOME} in a
//    manifest entry's destination PATH (where the file lands on disk).
//  * expandContentTokens — resolves the ${PLUGIN_ROOT}/${SKILLS_ROOT} CONTENT
//    tokens that skill/agent payload files reference, against the installing
//    user's home. These are deferred from build time on purpose: output/ ships
//    prebuilt, so baking them at build would embed the build machine's home dir
//    into every user's install (see build-scripts/build.js → tokenMapFor).
// Path helper lifted from installer/lib/install/expand-tokens.js (lines 19–24).

import path from 'node:path';
import { harnessRoot } from './harness-paths.js';
import { userDataPaths } from './user-data-paths.js';

/**
 * Replaces ${HARNESS_ROOT} and ${RAD_HOME} tokens with concrete paths, then
 * normalises separators so Windows mixed-separator strings collapse to OS-native.
 *
 * @param {string} templatedPath
 * @param {string} harness
 */
export function expandDestinationTokens(templatedPath, harness) {
  const expanded = templatedPath
    .replaceAll('${HARNESS_ROOT}', harnessRoot(harness))
    .replaceAll('${RAD_HOME}', userDataPaths().root);
  return path.normalize(expanded);
}

// Text extensions whose CONTENT may carry ${PLUGIN_ROOT}/${SKILLS_ROOT} tokens.
// Mirrors the build's expand-tokens TEXT_EXTS so the install-time expansion
// covers exactly what the build-time pass used to. Binary payload (e.g. ui.tgz)
// is copied verbatim.
const CONTENT_TEXT_EXTS = new Set([
  '.md', '.txt', '.js', '.mjs', '.cjs', '.ts', '.tsx',
  '.json', '.yml', '.yaml', '.sh', '.css', '.html',
]);

// The build only ever expanded the agents/ and skills/ trees; scope the
// install-time expansion identically so hooks/templates/etc. stay byte-verbatim.
const CONTENT_SCOPED_PREFIXES = ['agents/', 'skills/'];

/**
 * True when a manifest entry's payload should be read, content-token-expanded,
 * and rewritten (vs. copied verbatim). Scoped to the agents/ and skills/ trees
 * and to text extensions, faithfully reproducing the build's old expand-tokens
 * scope now that expansion happens at install time.
 *
 * @param {string} bundlePath
 */
export function isContentExpandable(bundlePath) {
  const norm = bundlePath.split(/[\\/]/).join('/');
  if (!CONTENT_SCOPED_PREFIXES.some((p) => norm.startsWith(p))) return false;
  return CONTENT_TEXT_EXTS.has(path.extname(norm).toLowerCase());
}

/**
 * Resolves the ${PLUGIN_ROOT} and ${SKILLS_ROOT} content tokens against the
 * installing user's harness root. Plain string substitution (no path.normalize):
 * the tokens are embedded in arbitrary payload text, not standalone paths — this
 * mirrors the build's former substituteTokens exactly, swapping the build
 * machine's home for the installing user's.
 *
 * @param {string} text
 * @param {string} harness
 */
export function expandContentTokens(text, harness) {
  const root = harnessRoot(harness);
  return text
    .replaceAll('${SKILLS_ROOT}', path.join(root, 'skills'))
    .replaceAll('${PLUGIN_ROOT}', root);
}

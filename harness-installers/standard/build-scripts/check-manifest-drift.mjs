#!/usr/bin/env node
// check-manifest-drift.mjs — CI gate for the standard installer's manifests.
//
// The standard installer's manifests are GENERATED path catalogs:
// emit-manifest.js walks each output/<harness>/ tree and writes a
// { bundlePath, destinationPath } entry per file (no hashes) into the tracked
// manifests/<harness>/v<version>.json. So adding, removing, renaming, or
// re-homing an installable payload file (skills, agents, hooks, scripts,
// action-events) without updating a committed manifest shows up here as a
// working-tree change under manifests/. This gate rebuilds and fails if the
// committed manifests are stale. Editing file *content* (incl. frontmatter)
// does not touch the manifest, so it never trips this gate.
//
// Fast path: the UI bundle (output/ui.tgz) is written OUTSIDE the per-harness
// dirs that emit-manifest walks, so this rebuild skips the emit-ui-bundle
// step entirely (skipUiBundle) rather than running it with a stubbed `next
// build` — the latter would delete/overwrite whatever ui.tgz a prior real
// build had produced (emitUiBundle always cleans up ui/.next after packing,
// so a stubbed rerun finds nothing to bundle and clobbers it with a
// near-empty tarball). Manifest generation never reads ui.tgz's content, so
// leaving it untouched is safe and also faster than the old stub path.
//
// Cross-platform: every manifest field is platform-stable — POSIX-normalised
// bundlePaths, tokenised ${HARNESS_ROOT}/${RAD_HOME} destinations, entries
// sorted by bundlePath, and no per-file hash. The manifest therefore
// regenerates byte-identically regardless of OS or invoking cwd, so a single
// build here is sufficient and a Windows-authored manifest matches CI's Linux
// rebuild.
//
// Importing runBuild does not auto-run the build: build.js's self-run guard
// keys on process.argv[1].

import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBuild } from './build.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const MANIFESTS_REL = 'harness-installers/standard/manifests';

function git(args) {
  return execSync(`git ${args}`, { cwd: REPO_ROOT, encoding: 'utf8' });
}

async function main() {
  process.stderr.write('[check-manifest-drift] rebuilding standard manifests (UI skipped) ...\n');
  await runBuild({ rootDir: REPO_ROOT, skipUiBundle: true });

  // --porcelain catches modified, deleted, AND untracked manifest files (a
  // version bump that forgot to commit the new vX.json, say) — stricter than
  // `git diff --exit-code`, which ignores untracked files.
  const status = git(`status --porcelain -- ${MANIFESTS_REL}`).trim();

  if (status !== '') {
    process.stderr.write(
      '\n✗ Standard installer manifests are stale.\n\n' +
      'The build regenerated manifest content that differs from what is committed.\n' +
      'Drifted paths under ' + MANIFESTS_REL + '/:\n' + status + '\n\n' +
      'Fix: run `npm run build -w harness-installers/standard` and commit the\n' +
      'updated files under ' + MANIFESTS_REL + '/.\n\n',
    );
    // Surface the actual diff for tracked-file changes to aid review.
    const diff = git(`--no-pager diff -- ${MANIFESTS_REL}`);
    if (diff.trim()) process.stderr.write(diff + '\n');
    process.exit(1);
  }

  process.stdout.write('✓ Standard installer manifests are in sync.\n');
}

main().catch((err) => {
  process.stderr.write(`${err.message}\n`);
  process.exit(1);
});

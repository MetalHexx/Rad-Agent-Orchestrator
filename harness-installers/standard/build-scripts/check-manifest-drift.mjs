#!/usr/bin/env node
// check-manifest-drift.mjs — CI gate for the standard installer's manifests.
//
// The standard installer's manifests are GENERATED: emit-manifest.js walks each
// output/<harness>/ tree and writes a sha256 per file into the tracked
// manifests/<harness>/v<version>.json. So any change to the installable payload
// (skills, agents, hooks, scripts, action-events) that isn't reflected in a
// committed manifest shows up here as a working-tree change under manifests/.
// This gate rebuilds and fails if the committed manifests are stale.
//
// Fast path: the UI bundle (output/ui.tgz) is written OUTSIDE the per-harness
// dirs that emit-manifest walks, so skipping the ~3-min `next build`
// (skipUiRunner) yields byte-identical manifests in a fraction of the time.
//
// Reproducibility: the esbuild CLI bundle (skills/.../radorch.mjs) used to embed
// module labels relative to process.cwd(), so the manifest sha for that file
// differed between a repo-root build and an `npm run -w <workspace>` build (this
// gate's cwd). emit-cli-bundle.js now pins esbuild's absWorkingDir to a fixed
// base, making the bundle — and therefore every manifest entry — byte-identical
// regardless of the invoking cwd. A single build here is sufficient.
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
  await runBuild({ rootDir: REPO_ROOT, skipUiRunner: true });

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

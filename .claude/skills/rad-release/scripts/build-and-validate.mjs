import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PLUGIN_DIRS = [
  'harness-installers/claude-plugin',
  'harness-installers/copilot-cli-plugin',
  'harness-installers/copilot-vscode-plugin',
];

export async function runBuildAndValidate({ repoRoot, spawn = spawnSync }) {
  // Step A: the standard installer build translates canonical harness-files/
  // agents+skills for all three harnesses and emits output/ + manifests. This
  // is the same build published to npm in the release's publish step, so a
  // failure here halts before we ship a broken standard installer.
  const stdBuild = spawn('node', ['harness-installers/standard/build-scripts/build.js'], {
    cwd: repoRoot, encoding: 'utf8',
  });
  if (stdBuild.status !== 0) {
    return { ok: false, error: stdBuild.stderr || 'standard installer build failed' };
  }
  // Step B: each plugin build runs its own build-scripts/build.js, which
  // invokes its validate.js Gate 3. Validator failure surfaces as
  // build non-zero exit, which halts the flow.
  for (const dir of PLUGIN_DIRS) {
    // Plugin build scripts use `process.cwd()` as their `rootDir`, so they
    // must be invoked from the repo root — running them from inside the
    // plugin dir misresolves the adapter-engine path and fails at step 0.
    const res = spawn('node', [path.posix.join(dir, 'build-scripts/build.js')], {
      cwd: repoRoot, encoding: 'utf8',
    });
    if (res.status !== 0) {
      return { ok: false, error: `${dir} build/validate failed: ${res.stderr}` };
    }
  }
  return { ok: true };
}

// -----------------------------------------------------------------------------
// CLI entry point — `node build-and-validate.mjs [--repo-root <dir>]`
// -----------------------------------------------------------------------------
// SKILL.md step 4 invokes this file directly. Without this block the process
// would exit 0 without building anything — a silent skip that looks exactly
// like a passing build and ships whatever stale output/ happened to be on disk.

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const i = process.argv.indexOf('--repo-root');
  runBuildAndValidate({ repoRoot: i === -1 ? process.cwd() : process.argv[i + 1] }).then(
    (res) => {
      if (!res.ok) { console.error(res.error); process.exit(1); }
      console.log('build + validate ok: standard, claude-plugin, copilot-cli-plugin, copilot-vscode-plugin');
    },
    (err) => { console.error(err.message); process.exit(1); },
  );
}

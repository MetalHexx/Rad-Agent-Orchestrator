import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installHarness } from '../../lib/install/install-harness.js';
import { uninstallHarness } from '../../lib/install/uninstall-harness.js';

// ---------------------------------------------------------------------------
// Fixture builder — mirrors the pattern from install-harness.test.mjs
// ---------------------------------------------------------------------------

/** Set HOME / USERPROFILE to the given path. Returns a restore function. */
function withHome(home) {
  const prevHome = process.env.HOME;
  const prevUserProfile = process.env.USERPROFILE;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  return () => {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    if (prevUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = prevUserProfile;
  };
}

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/**
 * Build a minimal bundle on disk that installHarness/uninstallHarness accept,
 * pointing settingsPath at a temp file under a dedicated home, harness 'claude'.
 *
 * Returns:
 *   { opts, uninstallOpts, settingsPath, cleanup }
 *
 * Where:
 *   opts          — { bundleRoot, settingsPath } passed to installHarness
 *   uninstallOpts — { bundleRoot, settingsPath } passed to uninstallHarness
 *   settingsPath  — absolute path to the settings.json written during install
 *   cleanup       — call in `finally` to restore HOME and remove tmp dirs
 */
async function makeClaudeFixture() {
  const tmp = mkTmp('tel-wire-');
  const home = path.join(tmp, 'home');
  const restoreHome = withHome(home);

  const bundleRoot = path.join(tmp, 'bundle');
  const version = '1.0.0';

  // --- bundle skeleton -------------------------------------------------------
  fs.mkdirSync(bundleRoot, { recursive: true });
  fs.writeFileSync(
    path.join(bundleRoot, 'package.json'),
    JSON.stringify({ name: 'rad-orc', version }, null, 2),
  );

  fs.mkdirSync(path.join(bundleRoot, 'agents'), { recursive: true });
  fs.writeFileSync(path.join(bundleRoot, 'agents/coder.md'), `# coder v${version}\n`);

  const scriptsDir = path.join(bundleRoot, 'skills/rad-orchestration/scripts');
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.writeFileSync(path.join(scriptsDir, 'radorch.mjs'), `#!/usr/bin/env node\n// v${version}\n`);

  const manifest = {
    files: [
      {
        bundlePath: 'agents/coder.md',
        destinationPath: '${HARNESS_ROOT}/agents/coder.md',
        sha256: 'x',
      },
      {
        bundlePath: 'skills/rad-orchestration/scripts/radorch.mjs',
        destinationPath: '${HARNESS_ROOT}/skills/rad-orchestration/scripts/radorch.mjs',
        sha256: 'y',
      },
    ],
  };
  fs.mkdirSync(path.join(bundleRoot, 'manifests'), { recursive: true });
  fs.writeFileSync(
    path.join(bundleRoot, `manifests/v${version}.json`),
    JSON.stringify(manifest, null, 2),
  );
  // ---------------------------------------------------------------------------

  // settingsPath lives under the temp home so it doesn't touch the real ~/.claude/
  const settingsPath = path.join(home, '.claude', 'settings.json');
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });

  const opts = { bundleRoot, settingsPath };
  const uninstallOpts = { bundleRoot, settingsPath };

  const cleanup = () => {
    restoreHome();
    fs.rmSync(tmp, { recursive: true, force: true });
  };

  return { opts, uninstallOpts, settingsPath, cleanup };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// Build the smallest harness fixture installHarness/uninstallHarness accept (mirror the existing
// install-harness test's fixture), pointing settingsPath at a temp file, harness 'claude'.
test('install registers preamble + 3 telemetry hooks at telemetry-capture.mjs (FR-1)', async () => {
  const ctx = await makeClaudeFixture();          // temp greenfield + harnessRoot + settingsPath
  try {
    await installHarness({ ...ctx.opts, harness: 'claude' });
    const s = JSON.parse(fs.readFileSync(ctx.settingsPath, 'utf8'));
    assert.ok(s.hooks.SessionStart.some((e) => e.hooks[0].command.includes('session-preamble.mjs')));
    for (const ev of ['PostToolUse', 'Stop', 'SessionEnd']) {
      assert.ok(s.hooks[ev].some((e) => e.hooks[0].command.includes('telemetry-capture.mjs')));
    }
    await uninstallHarness({ ...ctx.uninstallOpts, harness: 'claude' });
    const after = JSON.parse(fs.readFileSync(ctx.settingsPath, 'utf8'));
    assert.ok(!after.hooks.PostToolUse && !after.hooks.Stop && !after.hooks.SessionEnd);
  } finally {
    ctx.cleanup();
  }
});

// harness-installers/standard/tests/install/uninstall-harness.test.mjs —
// End-to-end of the uninstall function. Each test installs a synthetic bundle
// first, then asserts that uninstall removes the per-harness files + registry
// entry but leaves ~/.radorc/ (orchestration.yml, projects/, etc.) untouched.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { installHarness } from '../../lib/install/install-harness.js';
import { uninstallHarness } from '../../lib/install/uninstall-harness.js';

function buildBundle(bundleRoot, version) {
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
}

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

test('uninstallHarness removes per-harness files and the registry entry; preserves ~/.radorc/ assets', async () => {
  const tmp = mkTmp('std-uih-happy-');
  const restoreHome = withHome(path.join(tmp, 'home'));
  try {
    const bundle = path.join(tmp, 'bundle');
    buildBundle(bundle, '1.0.0-alpha.10');

    // First install so there's something to remove.
    const installResult = await installHarness({ bundleRoot: bundle, harness: 'claude' });
    assert.equal(installResult.action, 'fresh-install');

    const home = path.join(tmp, 'home');
    const harnessRootPath = path.join(home, '.claude');
    const coderPath = path.join(harnessRootPath, 'agents/coder.md');
    const radorchMjsPath = path.join(harnessRootPath, 'skills/rad-orchestration/scripts/radorch.mjs');
    assert.ok(fs.existsSync(coderPath), 'install put coder.md in place');
    assert.ok(fs.existsSync(radorchMjsPath), 'install put radorch.mjs in place');

    // Seed ~/.radorc/ assets that the uninstall should leave alone. Some
    // would normally be put there by hydrateUserData; we stage them here so
    // we can prove uninstall doesn't touch them.
    const radorchDir = path.join(home, '.radorc');
    fs.mkdirSync(path.join(radorchDir, 'projects/my-cool-project'), { recursive: true });
    fs.writeFileSync(path.join(radorchDir, 'projects/my-cool-project/notes.md'), 'user data');
    fs.writeFileSync(path.join(radorchDir, 'orchestration.yml'), 'tier: medium\n');
    fs.mkdirSync(path.join(radorchDir, 'templates'), { recursive: true });
    fs.writeFileSync(path.join(radorchDir, 'templates/medium.yml'), 'shipped: yes\n');

    // Also seed a user-created file under the harness root that ISN'T in the
    // manifest. Uninstall must leave it.
    fs.writeFileSync(path.join(harnessRootPath, 'agents/my-personal-agent.md'), '# mine');

    // Now uninstall.
    const result = await uninstallHarness({ bundleRoot: bundle, harness: 'claude' });
    assert.equal(result.action, 'uninstalled');
    assert.equal(result.removedVersion, '1.0.0-alpha.10');
    assert.equal(result.removedCount, 2);
    assert.ok(result.prunedDirs >= 1, 'at least one empty installer subfolder was pruned');

    // Manifest files removed.
    assert.ok(!fs.existsSync(coderPath), 'coder.md removed');
    assert.ok(!fs.existsSync(radorchMjsPath), 'radorch.mjs removed');

    // User-authored file under agents/ keeps agents/ alive.
    assert.ok(
      fs.existsSync(path.join(harnessRootPath, 'agents/my-personal-agent.md')),
      'user file under agents/ preserved',
    );
    assert.ok(
      fs.existsSync(path.join(harnessRootPath, 'agents')),
      'agents/ kept alive by the user-authored file inside',
    );

    // skills/ had no user files — the installer-created tree should be gone.
    assert.ok(
      !fs.existsSync(path.join(harnessRootPath, 'skills/rad-orchestration/scripts')),
      'empty deep installer dir scripts/ was pruned',
    );
    assert.ok(
      !fs.existsSync(path.join(harnessRootPath, 'skills/rad-orchestration')),
      'empty rad-orchestration/ was pruned',
    );
    assert.ok(
      !fs.existsSync(path.join(harnessRootPath, 'skills')),
      'empty skills/ itself was pruned (no user content in there)',
    );

    // Harness root preserved no matter what.
    assert.ok(fs.existsSync(harnessRootPath), 'harness root preserved');

    // User-created file under the harness root is preserved.
    assert.ok(
      fs.existsSync(path.join(harnessRootPath, 'agents/my-personal-agent.md')),
      'user-authored agent file survives because it is not in the manifest',
    );

    // ~/.radorc/ assets all untouched.
    assert.ok(fs.existsSync(path.join(radorchDir, 'orchestration.yml')), 'orchestration.yml survives');
    assert.ok(
      fs.existsSync(path.join(radorchDir, 'projects/my-cool-project/notes.md')),
      'projects/ content survives',
    );
    assert.ok(
      fs.existsSync(path.join(radorchDir, 'templates/medium.yml')),
      'templates/ content survives',
    );

    // install.json file is still there, but the harnesses[<key>] entry is gone.
    const installJsonOnDisk = JSON.parse(fs.readFileSync(path.join(radorchDir, 'install.json'), 'utf8'));
    assert.equal(installJsonOnDisk.harnesses.claude, undefined, 'claude entry deleted');
    assert.deepStrictEqual(installJsonOnDisk.harnesses, {}, 'no other harnesses registered');
  } finally {
    restoreHome();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('uninstallHarness on a non-registered harness returns { action: "not-installed" } and changes nothing', async () => {
  const tmp = mkTmp('std-uih-not-installed-');
  const restoreHome = withHome(path.join(tmp, 'home'));
  try {
    const bundle = path.join(tmp, 'bundle');
    buildBundle(bundle, '1.0.0-alpha.10');

    // No prior install — install.json doesn't exist yet.
    const result = await uninstallHarness({ bundleRoot: bundle, harness: 'copilot-cli' });
    assert.equal(result.action, 'not-installed');

    // Nothing under .copilot got created either.
    const copilotRoot = path.join(tmp, 'home', '.copilot');
    assert.ok(!fs.existsSync(copilotRoot), 'no harness root created');
  } finally {
    restoreHome();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('uninstallHarness does not remove the harness root directory itself when it becomes empty', async () => {
  const tmp = mkTmp('std-uih-root-preserved-');
  const restoreHome = withHome(path.join(tmp, 'home'));
  try {
    const bundle = path.join(tmp, 'bundle');
    buildBundle(bundle, '1.0.0-alpha.10');

    await installHarness({ bundleRoot: bundle, harness: 'claude' });
    const home = path.join(tmp, 'home');
    const harnessRootPath = path.join(home, '.claude');

    await uninstallHarness({ bundleRoot: bundle, harness: 'claude' });

    assert.ok(
      fs.existsSync(harnessRootPath),
      'harness root directory is preserved even when no rad files remain',
    );
  } finally {
    restoreHome();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

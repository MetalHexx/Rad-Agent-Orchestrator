// harness-installers/standard/tests/install/hook-wiring.test.mjs —
// Exercises the preamble hook wiring across install/uninstall (FR-18, AD-10):
//   1. Installing claude: mergePreambleHook is called with an install-relative
//      absolute shim path; the marker appears in Claude's settings.json.
//   2. Uninstalling claude: removePreambleHook fires, marker is gone.
//   3. Build step: session-preamble.mjs is staged into each per-harness
//      output/<harness>/hooks/ tree so the Copilot manifest file-drop works
//      and the Claude harness has an on-disk shim to point its settings entry at.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { installHarness } from '../../lib/install/install-harness.js';
import { uninstallHarness } from '../../lib/install/uninstall-harness.js';
import { runBuild } from '../../build-scripts/build.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** Redirect HOME / USERPROFILE to a controlled tmp path. Returns a restore fn. */
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

/**
 * Build a synthetic per-harness bundle on disk. Includes:
 *   - package.json with `version`
 *   - agents/coder.md
 *   - skills/rad-orchestration/scripts/radorch.mjs
 *   - hooks/session-preamble.mjs  (the staged shim drop)
 *   - manifests/v<version>.json  (lists the three files above plus the shim)
 * The shim is added to the manifest so installManifestFiles copies it.
 *
 * @param {string} bundleRoot
 * @param {{ version: string, priorVersion?: string, includeHookShim?: boolean }} opts
 */
function buildBundle(bundleRoot, { version, priorVersion, includeHookShim = true } = {}) {
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

  const manifestFiles = [
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
  ];

  if (includeHookShim) {
    const hooksDir = path.join(bundleRoot, 'hooks');
    fs.mkdirSync(hooksDir, { recursive: true });
    fs.writeFileSync(
      path.join(hooksDir, 'session-preamble.mjs'),
      '// session-preamble.mjs shim\n',
    );
    manifestFiles.push({
      bundlePath: 'hooks/session-preamble.mjs',
      destinationPath: '${HARNESS_ROOT}/hooks/session-preamble.mjs',
      sha256: 'z',
    });
  }

  const manifest = { files: manifestFiles };
  fs.mkdirSync(path.join(bundleRoot, 'manifests'), { recursive: true });
  fs.writeFileSync(
    path.join(bundleRoot, `manifests/v${version}.json`),
    JSON.stringify(manifest, null, 2),
  );
  if (priorVersion) {
    fs.writeFileSync(
      path.join(bundleRoot, `manifests/v${priorVersion}.json`),
      JSON.stringify(manifest, null, 2),
    );
  }
  return manifest;
}

const HARNESSES = ['claude', 'copilot-vscode', 'copilot-cli'];

function agentFilename(h, name) {
  return (h === 'copilot-vscode' || h === 'copilot-cli') ? `${name}.agent.md` : `${name}.md`;
}

/**
 * Build a minimal fixture tree for runBuild. Mirrors the shape used by
 * build.test.mjs, augmented with:
 *   - harness-installers/shared/hooks/session-preamble.mjs  (source for the
 *     copy-hook-shim build step)
 */
function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'std-hook-wiring-'));

  for (const h of HARNESSES) {
    const agentsDir = path.join(root, 'harness-adapters/output', h, 'agents');
    const skillsDir = path.join(root, 'harness-adapters/output', h, 'skills/rad-orchestration');
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.mkdirSync(skillsDir, { recursive: true });
    fs.writeFileSync(
      path.join(agentsDir, agentFilename(h, 'reviewer')),
      '---\nname: reviewer\ndescription: test\n---\n# Reviewer\n',
    );
    fs.writeFileSync(
      path.join(agentsDir, agentFilename(h, 'coder')),
      '---\nname: coder\ndescription: test\n---\n# Coder\n',
    );
    fs.writeFileSync(
      path.join(skillsDir, 'SKILL.md'),
      '---\nname: rad-orchestration\ndescription: t\n---\n# Skill\n',
    );
  }

  // runtime-config/
  const rcDir = path.join(root, 'runtime-config');
  fs.mkdirSync(path.join(rcDir, 'templates'), { recursive: true });
  fs.writeFileSync(path.join(rcDir, 'orchestration.yml'), 'pipeline: {}\n');
  for (const tier of ['extra-high', 'high', 'medium', 'low']) {
    fs.writeFileSync(path.join(rcDir, 'templates', `${tier}.yml`), `name: ${tier}\n`);
  }
  const aeDir = path.join(rcDir, 'action-events');
  fs.mkdirSync(path.join(aeDir, 'custom'), { recursive: true });
  fs.writeFileSync(path.join(aeDir, 'README.md'), '# action-events\n');
  fs.writeFileSync(path.join(aeDir, 'action.spawn_coder.md'), '# spawn_coder\n');
  fs.writeFileSync(path.join(aeDir, 'event.task_completed.md'), '# task_completed\n');

  // cli/
  const cliBin = path.join(root, 'cli/src/bin');
  fs.mkdirSync(cliBin, { recursive: true });
  fs.writeFileSync(path.join(cliBin, 'radorch.ts'), 'console.log("radorch");\n');
  fs.writeFileSync(
    path.join(root, 'cli/package.json'),
    JSON.stringify({ name: 'cli', type: 'module', version: '0.0.0-fixture' }),
  );

  // ui/
  fs.mkdirSync(path.join(root, 'ui/.next/standalone'), { recursive: true });
  fs.mkdirSync(path.join(root, 'ui/.next/static'), { recursive: true });
  fs.writeFileSync(path.join(root, 'ui/.next/standalone/server.js'), '// ui\n');

  // harness-files/agents/ (needed by validate step)
  const canonicalAgentsDir = path.join(root, 'harness-files/agents');
  fs.mkdirSync(canonicalAgentsDir, { recursive: true });
  fs.writeFileSync(path.join(canonicalAgentsDir, 'reviewer.md'), '# reviewer\n');
  fs.writeFileSync(path.join(canonicalAgentsDir, 'coder.md'), '# coder\n');

  // harness-installers/standard/
  const installerSrc = path.join(root, 'harness-installers/standard');
  fs.mkdirSync(installerSrc, { recursive: true });
  fs.writeFileSync(
    path.join(installerSrc, 'package.json'),
    JSON.stringify({
      name: '@rad-orchestration/standard-source',
      version: '1.0.0-alpha.11',
      private: true,
      type: 'module',
      description: 'Standard installer source wrapper.',
      author: 'rad-orchestration',
      license: 'MIT',
      homepage: 'https://example.test/home',
      repository: { type: 'git', url: 'https://example.test/repo' },
      bugs: { url: 'https://example.test/bugs' },
      keywords: ['orchestration', 'installer'],
      dependencies: { chalk: '^5.0.0' },
      devDependencies: { esbuild: '^0.24.0' },
    }, null, 2),
  );
  for (const h of HARNESSES) {
    fs.mkdirSync(path.join(installerSrc, 'manifests', h), { recursive: true });
  }

  // harness-installers/shared/hooks/ — source for the copy-hook-shim step.
  const sharedHooksDir = path.join(root, 'harness-installers/shared/hooks');
  fs.mkdirSync(sharedHooksDir, { recursive: true });
  fs.writeFileSync(
    path.join(sharedHooksDir, 'session-preamble.mjs'),
    '// session-preamble.mjs shim (fixture)\n',
  );
  fs.writeFileSync(
    path.join(sharedHooksDir, 'telemetry-capture.mjs'),
    '// telemetry-capture.mjs shim (fixture)\n',
  );

  return root;
}

// ---------------------------------------------------------------------------
// Test 1: install claude → settings.json gets the preamble marker
// ---------------------------------------------------------------------------

test('install claude: settings.json gets a marked SessionStart preamble entry (FR-18, AD-10)', async () => {
  const tmp = mkTmp('std-hw-cl-install-');
  const restoreHome = withHome(path.join(tmp, 'home'));
  try {
    const home = path.join(tmp, 'home');
    const bundle = path.join(tmp, 'bundle');
    buildBundle(bundle, { version: '1.0.0' });

    // Seed an existing Claude settings.json so we can verify it is merged, not replaced.
    const settingsDir = path.join(home, '.claude');
    fs.mkdirSync(settingsDir, { recursive: true });
    const settingsPath = path.join(settingsDir, 'settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify({ theme: 'dark' }, null, 2));

    const result = await installHarness({
      bundleRoot: bundle,
      harness: 'claude',
      settingsPath,
    });
    assert.strictEqual(result.action, 'fresh-install');

    // The settings.json must now carry the preamble marker.
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert.ok(
      Array.isArray(settings.hooks?.SessionStart),
      'settings.json has hooks.SessionStart array',
    );

    // Find the marked entry and assert the command string carries both the
    // marker and the install-relative absolute shim path.
    const MARKER = 'rad-orc-preamble';
    const markedEntry = settings.hooks.SessionStart.find(
      (e) => Array.isArray(e.hooks) && e.hooks.some((h) => typeof h.command === 'string' && h.command.includes(MARKER)),
    );
    assert.ok(markedEntry, 'a rad-orc-preamble marked entry is present in hooks.SessionStart');

    // The hook command must reference the session-preamble.mjs file inside the
    // installed ~/.claude/hooks/ tree (install-relative absolute path).
    const expectedShimPath = path.join(home, '.claude', 'hooks', 'session-preamble.mjs');
    const markedHookCmd = markedEntry.hooks.find((h) => h.command.includes(MARKER)).command;
    assert.ok(
      markedHookCmd.includes(expectedShimPath),
      `hook command must reference installed shim at ${expectedShimPath}, got: ${markedHookCmd}`,
    );

    // Unrelated settings must be preserved.
    assert.strictEqual(settings.theme, 'dark', 'unrelated settings.json key preserved');
  } finally {
    restoreHome();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 2: uninstall claude → marker removed from settings.json (FR-18)
// ---------------------------------------------------------------------------

test('uninstall claude: rad-orc-preamble marker removed from settings.json (FR-18)', async () => {
  const tmp = mkTmp('std-hw-cl-uninstall-');
  const restoreHome = withHome(path.join(tmp, 'home'));
  try {
    const home = path.join(tmp, 'home');
    const bundle = path.join(tmp, 'bundle');
    buildBundle(bundle, { version: '1.0.0' });

    const settingsDir = path.join(home, '.claude');
    fs.mkdirSync(settingsDir, { recursive: true });
    const settingsPath = path.join(settingsDir, 'settings.json');
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'keep-me' }] }] } }, null, 2),
    );

    const MARKER = 'rad-orc-preamble';

    const hasMarker = (settings) =>
      Array.isArray(settings.hooks?.SessionStart) &&
      settings.hooks.SessionStart.some(
        (e) => Array.isArray(e.hooks) && e.hooks.some((h) => typeof h.command === 'string' && h.command.includes(MARKER)),
      );
    const hasKeepMe = (settings) =>
      Array.isArray(settings.hooks?.SessionStart) &&
      settings.hooks.SessionStart.some(
        (e) => Array.isArray(e.hooks) && e.hooks.some((h) => typeof h.command === 'string' && h.command.includes('keep-me')),
      );

    // Install to place the marker.
    await installHarness({ bundleRoot: bundle, harness: 'claude', settingsPath });
    const afterInstall = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert.ok(hasMarker(afterInstall), 'marker present after install');

    // Uninstall must remove it.
    const result = await uninstallHarness({ bundleRoot: bundle, harness: 'claude', settingsPath });
    assert.strictEqual(result.action, 'uninstalled');

    const afterUninstall = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert.ok(
      !hasMarker(afterUninstall),
      'rad-orc-preamble marker removed after uninstall',
    );
    // keep-me must survive.
    assert.ok(
      hasKeepMe(afterUninstall),
      'unrelated SessionStart hook preserved',
    );
  } finally {
    restoreHome();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 3: build step stages session-preamble.mjs into each harness hooks/ tree
// ---------------------------------------------------------------------------

test('build stages session-preamble.mjs into output/<harness>/hooks/ for all harnesses (FR-18, AD-13)', async () => {
  const root = makeFixture();
  try {
    await runBuild({
      rootDir: root,
      greenfieldRel: '.',
      skipAdapterEngine: true,
      skipUiRunner: true,
      skipBootstrap: true,
    });

    const out = path.join(root, 'harness-installers/standard/output');
    for (const h of HARNESSES) {
      const shimPath = path.join(out, h, 'hooks', 'session-preamble.mjs');
      assert.ok(
        fs.existsSync(shimPath),
        `output/${h}/hooks/session-preamble.mjs must exist after build`,
      );
      const telemetryShimPath = path.join(out, h, 'hooks', 'telemetry-capture.mjs');
      assert.ok(
        fs.existsSync(telemetryShimPath),
        `output/${h}/hooks/telemetry-capture.mjs must exist after build`,
      );
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 4: verify hook command quotes the shim path (handles paths with spaces)
// ---------------------------------------------------------------------------

test('install claude: generated hook command quotes the shim path to handle spaces (fresh-install)', async () => {
  const tmp = mkTmp('std-hw-cl-quote-fresh-');
  const restoreHome = withHome(path.join(tmp, 'home with spaces'));
  try {
    const home = path.join(tmp, 'home with spaces');
    const bundle = path.join(tmp, 'bundle');
    buildBundle(bundle, { version: '1.0.0' });

    const settingsDir = path.join(home, '.claude');
    fs.mkdirSync(settingsDir, { recursive: true });
    const settingsPath = path.join(settingsDir, 'settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify({}, null, 2));

    const result = await installHarness({
      bundleRoot: bundle,
      harness: 'claude',
      settingsPath,
    });
    assert.strictEqual(result.action, 'fresh-install');

    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const MARKER = 'rad-orc-preamble';
    const markedEntry = settings.hooks.SessionStart.find(
      (e) => Array.isArray(e.hooks) && e.hooks.some((h) => typeof h.command === 'string' && h.command.includes(MARKER)),
    );
    assert.ok(markedEntry, 'marked entry found');

    const markedHookCmd = markedEntry.hooks.find((h) => h.command.includes(MARKER)).command;

    // Verify that the path is quoted in the command.
    // The command should be like: node "/path/with spaces/to/session-preamble.mjs" # rad-orc-preamble
    assert.ok(
      markedHookCmd.includes('node "'),
      `hook command should start with 'node "' to quote the path, got: ${markedHookCmd}`,
    );
    assert.ok(
      markedHookCmd.includes('" #'),
      `hook command should have closing quote before comment, got: ${markedHookCmd}`,
    );
  } finally {
    restoreHome();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('upgrade claude: generated hook command quotes the shim path to handle spaces (upgrade)', async () => {
  const tmp = mkTmp('std-hw-cl-quote-upgrade-');
  const restoreHome = withHome(path.join(tmp, 'home with spaces'));
  try {
    const home = path.join(tmp, 'home with spaces');
    const bundle = path.join(tmp, 'bundle');
    buildBundle(bundle, { version: '1.0.1', priorVersion: '1.0.0' });

    // Seed prior install
    const claudeRoot = path.join(home, '.claude');
    fs.mkdirSync(path.join(claudeRoot, 'agents'), { recursive: true });
    fs.writeFileSync(path.join(claudeRoot, 'agents/coder.md'), '# old\n');
    fs.mkdirSync(path.join(claudeRoot, 'skills/rad-orchestration/scripts'), { recursive: true });
    fs.writeFileSync(path.join(claudeRoot, 'skills/rad-orchestration/scripts/radorch.mjs'), '# old\n');

    fs.mkdirSync(path.join(home, '.radorc'), { recursive: true });
    fs.writeFileSync(
      path.join(home, '.radorc/install.json'),
      JSON.stringify({
        harnesses: {
          claude: {
            version: '1.0.0',
            channel: 'standard',
            installed_at: '2024-01-01T00:00:00.000Z',
            last_writer_version: '1.0.0',
          },
        },
      }, null, 2),
    );

    const settingsPath = path.join(claudeRoot, 'settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify({}, null, 2));

    const result = await installHarness({
      bundleRoot: bundle,
      harness: 'claude',
      settingsPath,
    });
    assert.strictEqual(result.action, 'upgrade-complete');

    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const MARKER = 'rad-orc-preamble';
    const markedEntry = settings.hooks.SessionStart.find(
      (e) => Array.isArray(e.hooks) && e.hooks.some((h) => typeof h.command === 'string' && h.command.includes(MARKER)),
    );
    assert.ok(markedEntry, 'marked entry found on upgrade');

    const markedHookCmd = markedEntry.hooks.find((h) => h.command.includes(MARKER)).command;

    // Verify that the path is quoted in the command.
    assert.ok(
      markedHookCmd.includes('node "'),
      `upgrade: hook command should start with 'node "' to quote the path, got: ${markedHookCmd}`,
    );
    assert.ok(
      markedHookCmd.includes('" #'),
      `upgrade: hook command should have closing quote before comment, got: ${markedHookCmd}`,
    );
  } finally {
    restoreHome();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// harness-installers/standard/tests/install/install-harness.test.mjs —
// Action state-machine tests for `installHarness`. Each test builds a synthetic
// bundle under a tmp dir, points HOME / USERPROFILE at a tmp home, and asserts
// on the returned action plus the on-disk state of install.json and ~/.<harness>/.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { installHarness } from '../../lib/install/install-harness.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a self-contained synthetic bundle on disk:
 *   - bundle/package.json with the given version
 *   - bundle/manifests/v<version>.json with two file entries
 *   - bundle/agents/coder.md
 *   - bundle/skills/rad-orchestration/scripts/radorch.mjs
 *
 * Optionally also seed a prior manifest at bundle/manifests/v<priorVersion>.json
 * so upgrade flows can locate it.
 */
function buildBundle(bundleRoot, { version, priorVersion } = {}) {
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
  if (priorVersion) {
    fs.writeFileSync(
      path.join(bundleRoot, `manifests/v${priorVersion}.json`),
      JSON.stringify(manifest, null, 2),
    );
  }
  return manifest;
}

/** Capture stderr writes to an in-memory buffer instead of process.stderr. */
function captureStderr() {
  const chunks = [];
  const stream = {
    write(s) {
      chunks.push(String(s));
      return true;
    },
  };
  return {
    stream,
    get text() {
      return chunks.join('');
    },
  };
}

/** A stderr stream whose write() always throws — for NFR-4 best-effort test. */
function throwingStderr() {
  return {
    write() {
      throw new Error('stderr write failed (synthetic)');
    },
  };
}

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('fresh-install: install.json absent → action fresh-install, files copied, install.json written', async () => {
  const tmp = mkTmp('std-ih-fresh-');
  const restoreHome = withHome(path.join(tmp, 'home'));
  try {
    const bundle = path.join(tmp, 'bundle');
    buildBundle(bundle, { version: '1.0.0' });

    const stderr = captureStderr();
    const result = await installHarness({ bundleRoot: bundle, harness: 'claude', stderr: stderr.stream });

    assert.strictEqual(result.action, 'fresh-install');
    assert.strictEqual(result.code, 0);
    assert.strictEqual(result.deliveringVersion, '1.0.0');

    const installJson = JSON.parse(fs.readFileSync(path.join(tmp, 'home/.radorc/install.json'), 'utf8'));
    assert.strictEqual(installJson.harnesses.claude.version, '1.0.0');
    assert.strictEqual(installJson.harnesses.claude.channel, 'standard');

    // Files were copied into ~/.claude/.
    const sentinel = path.join(tmp, 'home/.claude/skills/rad-orchestration/scripts/radorch.mjs');
    assert.strictEqual(fs.existsSync(sentinel), true, 'sentinel copied');
    assert.strictEqual(fs.existsSync(path.join(tmp, 'home/.claude/agents/coder.md')), true);
  } finally {
    restoreHome();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('upgrade-complete: install.json registers lower version → prior manifest removed, new installed, installed_at preserved', async () => {
  const tmp = mkTmp('std-ih-upg-');
  const restoreHome = withHome(path.join(tmp, 'home'));
  try {
    const bundle = path.join(tmp, 'bundle');
    buildBundle(bundle, { version: '1.0.1', priorVersion: '1.0.0' });

    // Seed prior install: install.json + a file under ~/.claude/ that the
    // prior manifest references AND the sentinel (so the install-harness
    // doesn't take the sentinel-self-heal branch).
    const home = path.join(tmp, 'home');
    const claudeRoot = path.join(home, '.claude');
    fs.mkdirSync(path.join(claudeRoot, 'agents'), { recursive: true });
    fs.writeFileSync(path.join(claudeRoot, 'agents/coder.md'), '# old\n');
    fs.mkdirSync(path.join(claudeRoot, 'skills/rad-orchestration/scripts'), { recursive: true });
    fs.writeFileSync(path.join(claudeRoot, 'skills/rad-orchestration/scripts/radorch.mjs'), '# old\n');

    const installedAt = '2024-01-01T00:00:00.000Z';
    fs.mkdirSync(path.join(home, '.radorc'), { recursive: true });
    fs.writeFileSync(
      path.join(home, '.radorc/install.json'),
      JSON.stringify({
        harnesses: {
          claude: {
            version: '1.0.0',
            channel: 'standard',
            installed_at: installedAt,
            last_writer_version: '1.0.0',
          },
        },
      }, null, 2),
    );

    const stderr = captureStderr();
    const result = await installHarness({ bundleRoot: bundle, harness: 'claude', stderr: stderr.stream });

    assert.strictEqual(result.action, 'upgrade-complete');
    assert.strictEqual(result.code, 0);
    assert.strictEqual(result.deliveringVersion, '1.0.1');
    assert.strictEqual(result.installedVersion, '1.0.0');

    const installJson = JSON.parse(fs.readFileSync(path.join(home, '.radorc/install.json'), 'utf8'));
    assert.strictEqual(installJson.harnesses.claude.version, '1.0.1');
    assert.strictEqual(installJson.harnesses.claude.last_writer_version, '1.0.1');
    assert.strictEqual(installJson.harnesses.claude.installed_at, installedAt, 'installed_at preserved on upgrade');

    // New file content overwrote the old.
    const coder = fs.readFileSync(path.join(claudeRoot, 'agents/coder.md'), 'utf8');
    assert.match(coder, /v1\.0\.1/);
  } finally {
    restoreHome();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('noop: install.json claims delivering version AND sentinel present → action noop, no install.json rewrite', async () => {
  const tmp = mkTmp('std-ih-noop-');
  const restoreHome = withHome(path.join(tmp, 'home'));
  try {
    const bundle = path.join(tmp, 'bundle');
    buildBundle(bundle, { version: '1.0.0' });

    const home = path.join(tmp, 'home');
    // Seed sentinel in the harness root so the sentinel check passes.
    const sentinel = path.join(home, '.claude/skills/rad-orchestration/scripts/radorch.mjs');
    fs.mkdirSync(path.dirname(sentinel), { recursive: true });
    fs.writeFileSync(sentinel, '# existing\n');

    const installJsonPath = path.join(home, '.radorc/install.json');
    fs.mkdirSync(path.dirname(installJsonPath), { recursive: true });
    const original = {
      harnesses: {
        claude: {
          version: '1.0.0',
          channel: 'standard',
          installed_at: '2024-01-01T00:00:00.000Z',
          last_writer_version: '1.0.0',
        },
      },
    };
    fs.writeFileSync(installJsonPath, JSON.stringify(original, null, 2));
    const mtimeBefore = fs.statSync(installJsonPath).mtimeMs;

    // Make sure no stray agent file was copied — count files under ~/.claude/.
    const claudeFilesBefore = walkFiles(path.join(home, '.claude'));

    const stderr = captureStderr();
    const result = await installHarness({ bundleRoot: bundle, harness: 'claude', stderr: stderr.stream });

    assert.strictEqual(result.action, 'noop');
    assert.strictEqual(result.code, 0);

    // install.json must not have been rewritten.
    const mtimeAfter = fs.statSync(installJsonPath).mtimeMs;
    assert.strictEqual(mtimeAfter, mtimeBefore, 'install.json must not be rewritten on noop');

    // No new files copied.
    const claudeFilesAfter = walkFiles(path.join(home, '.claude'));
    assert.deepStrictEqual(claudeFilesAfter.sort(), claudeFilesBefore.sort(), 'no file copies on noop');
  } finally {
    restoreHome();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('sentinel-self-heal: install.json claims installed but sentinel missing → fresh-install with notice on stderr', async () => {
  const tmp = mkTmp('std-ih-heal-');
  const restoreHome = withHome(path.join(tmp, 'home'));
  try {
    const bundle = path.join(tmp, 'bundle');
    buildBundle(bundle, { version: '1.0.0' });

    const home = path.join(tmp, 'home');
    // install.json says claude@1.0.0 installed but ~/.claude/ is empty (no sentinel).
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

    const stderr = captureStderr();
    const result = await installHarness({ bundleRoot: bundle, harness: 'claude', stderr: stderr.stream });

    assert.strictEqual(result.action, 'fresh-install', 'sentinel-self-heal returns as fresh-install');
    assert.strictEqual(result.code, 0);
    assert.match(stderr.text, /sentinel missing/i, 'stderr carries a sentinel-missing notice');

    // Sentinel now exists.
    assert.strictEqual(
      fs.existsSync(path.join(home, '.claude/skills/rad-orchestration/scripts/radorch.mjs')),
      true,
    );
  } finally {
    restoreHome();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('downgrade-refused: install.json registers higher version → non-zero code, multi-line stderr message', async () => {
  const tmp = mkTmp('std-ih-down-');
  const restoreHome = withHome(path.join(tmp, 'home'));
  try {
    const bundle = path.join(tmp, 'bundle');
    buildBundle(bundle, { version: '1.0.0' });

    const home = path.join(tmp, 'home');
    // Seed sentinel so we don't fall into the self-heal branch.
    const sentinel = path.join(home, '.claude/skills/rad-orchestration/scripts/radorch.mjs');
    fs.mkdirSync(path.dirname(sentinel), { recursive: true });
    fs.writeFileSync(sentinel, '# newer\n');

    fs.mkdirSync(path.join(home, '.radorc'), { recursive: true });
    fs.writeFileSync(
      path.join(home, '.radorc/install.json'),
      JSON.stringify({
        harnesses: {
          claude: {
            version: '2.0.0',
            channel: 'standard',
            installed_at: '2024-01-01T00:00:00.000Z',
            last_writer_version: '2.0.0',
          },
        },
      }, null, 2),
    );

    const stderr = captureStderr();
    const result = await installHarness({ bundleRoot: bundle, harness: 'claude', stderr: stderr.stream });

    assert.strictEqual(result.action, 'downgrade-refused');
    assert.notStrictEqual(result.code, 0, 'downgrade-refused exits non-zero');
    assert.strictEqual(result.deliveringVersion, '1.0.0');
    assert.strictEqual(result.installedVersion, '2.0.0');

    // Stderr names both versions so the user can see the mismatch.
    assert.match(stderr.text, /2\.0\.0/);
    assert.match(stderr.text, /1\.0\.0/);
  } finally {
    restoreHome();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('folder-mutex: install copilot-vscode while copilot-cli registered → partner removed from registry (mutex eviction is now silent at install-time; the user-facing confirmation lives in the wizard)', async () => {
  const tmp = mkTmp('std-ih-mutex-');
  const restoreHome = withHome(path.join(tmp, 'home'));
  try {
    const bundle = path.join(tmp, 'bundle');
    buildBundle(bundle, { version: '1.0.1' });

    const home = path.join(tmp, 'home');
    fs.mkdirSync(path.join(home, '.radorc'), { recursive: true });
    fs.writeFileSync(
      path.join(home, '.radorc/install.json'),
      JSON.stringify({
        harnesses: {
          'copilot-cli': {
            version: '1.0.0',
            channel: 'standard',
            installed_at: '2024-01-01T00:00:00.000Z',
            last_writer_version: '1.0.0',
          },
        },
      }, null, 2),
    );

    const stderr = captureStderr();
    const result = await installHarness({ bundleRoot: bundle, harness: 'copilot-vscode', stderr: stderr.stream });

    assert.strictEqual(result.action, 'fresh-install', 'no prior copilot-vscode entry → fresh-install');

    // Partner removed.
    const installJson = JSON.parse(fs.readFileSync(path.join(home, '.radorc/install.json'), 'utf8'));
    assert.strictEqual(installJson.harnesses['copilot-cli'], undefined, 'partner copilot-cli removed');
    assert.strictEqual(installJson.harnesses['copilot-vscode'].version, '1.0.1');

    // The wizard now confirms mutex eviction pre-install, so install-harness
    // no longer emits a "Replaced …" line to stderr at this layer. The
    // cross-channel coexistence WARNING (claude ↔ claude-plugin) still does
    // — see the next test.
    assert.doesNotMatch(stderr.text, /Replaced/);
  } finally {
    restoreHome();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('cross-channel coexistence: install claude while claude-plugin registered → WARNING emitted, install completes (FR-13)', async () => {
  const tmp = mkTmp('std-ih-cross-');
  const restoreHome = withHome(path.join(tmp, 'home'));
  try {
    const bundle = path.join(tmp, 'bundle');
    buildBundle(bundle, { version: '1.0.0' });

    const home = path.join(tmp, 'home');
    fs.mkdirSync(path.join(home, '.radorc'), { recursive: true });
    fs.writeFileSync(
      path.join(home, '.radorc/install.json'),
      JSON.stringify({
        harnesses: {
          'claude-plugin': {
            version: '1.0.0',
            channel: 'plugin',
            installed_at: '2024-01-01T00:00:00.000Z',
            last_writer_version: '1.0.0',
          },
        },
      }, null, 2),
    );

    const stderr = captureStderr();
    const result = await installHarness({ bundleRoot: bundle, harness: 'claude', stderr: stderr.stream });

    assert.strictEqual(result.action, 'fresh-install');
    assert.strictEqual(result.code, 0);

    // Stderr names the cross-channel partner so the user knows what coexists.
    assert.match(stderr.text, /claude-plugin/);

    // claude-plugin entry untouched (they coexist).
    const installJson = JSON.parse(fs.readFileSync(path.join(home, '.radorc/install.json'), 'utf8'));
    assert.strictEqual(installJson.harnesses['claude-plugin'].version, '1.0.0');
    assert.strictEqual(installJson.harnesses['claude'].version, '1.0.0');

    // Install actually completed — files on disk.
    assert.strictEqual(
      fs.existsSync(path.join(home, '.claude/skills/rad-orchestration/scripts/radorch.mjs')),
      true,
    );
  } finally {
    restoreHome();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('plugin-coexist: install copilot-cli while copilot-cli-plugin registered → notice emitted, plugin entry preserved', async () => {
  const tmp = mkTmp('std-ih-coex-cli-');
  const restoreHome = withHome(path.join(tmp, 'home'));
  try {
    const bundle = path.join(tmp, 'bundle');
    buildBundle(bundle, { version: '1.0.0' });

    const home = path.join(tmp, 'home');
    fs.mkdirSync(path.join(home, '.radorc'), { recursive: true });
    fs.writeFileSync(
      path.join(home, '.radorc/install.json'),
      JSON.stringify({
        harnesses: {
          'copilot-cli-plugin': {
            version: '1.0.0',
            channel: 'plugin',
            installed_at: '2024-01-01T00:00:00.000Z',
            last_writer_version: '1.0.0',
          },
        },
      }, null, 2),
    );

    const stderr = captureStderr();
    const result = await installHarness({ bundleRoot: bundle, harness: 'copilot-cli', stderr: stderr.stream });

    assert.strictEqual(result.action, 'fresh-install');
    assert.strictEqual(result.code, 0);
    assert.match(stderr.text, /copilot-cli-plugin/, 'notice names the plugin partner');

    const installJson = JSON.parse(fs.readFileSync(path.join(home, '.radorc/install.json'), 'utf8'));
    assert.strictEqual(installJson.harnesses['copilot-cli-plugin'].version, '1.0.0', 'plugin entry preserved');
    assert.strictEqual(installJson.harnesses['copilot-cli'].version, '1.0.0');
  } finally {
    restoreHome();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('plugin-coexist: install copilot-vscode while copilot-vscode-plugin registered → notice emitted, plugin entry preserved', async () => {
  const tmp = mkTmp('std-ih-coex-vscode-');
  const restoreHome = withHome(path.join(tmp, 'home'));
  try {
    const bundle = path.join(tmp, 'bundle');
    buildBundle(bundle, { version: '1.0.0' });

    const home = path.join(tmp, 'home');
    fs.mkdirSync(path.join(home, '.radorc'), { recursive: true });
    fs.writeFileSync(
      path.join(home, '.radorc/install.json'),
      JSON.stringify({
        harnesses: {
          'copilot-vscode-plugin': {
            version: '1.0.0',
            channel: 'plugin',
            installed_at: '2024-01-01T00:00:00.000Z',
            last_writer_version: '1.0.0',
          },
        },
      }, null, 2),
    );

    const stderr = captureStderr();
    const result = await installHarness({ bundleRoot: bundle, harness: 'copilot-vscode', stderr: stderr.stream });

    assert.strictEqual(result.action, 'fresh-install');
    assert.match(stderr.text, /copilot-vscode-plugin/);

    const installJson = JSON.parse(fs.readFileSync(path.join(home, '.radorc/install.json'), 'utf8'));
    assert.strictEqual(installJson.harnesses['copilot-vscode-plugin'].version, '1.0.0', 'plugin entry preserved');
    assert.strictEqual(installJson.harnesses['copilot-vscode'].version, '1.0.0');
  } finally {
    restoreHome();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('plugin-coexist regression: install copilot-vscode while copilot-cli-plugin registered → CROSS-UI plugin entry preserved (no eviction)', async () => {
  const tmp = mkTmp('std-ih-coex-crossui-');
  const restoreHome = withHome(path.join(tmp, 'home'));
  try {
    const bundle = path.join(tmp, 'bundle');
    buildBundle(bundle, { version: '1.0.0' });

    const home = path.join(tmp, 'home');
    fs.mkdirSync(path.join(home, '.radorc'), { recursive: true });
    fs.writeFileSync(
      path.join(home, '.radorc/install.json'),
      JSON.stringify({
        harnesses: {
          'copilot-cli-plugin': {
            version: '1.0.0',
            channel: 'plugin',
            installed_at: '2024-01-01T00:00:00.000Z',
            last_writer_version: '1.0.0',
          },
        },
      }, null, 2),
    );

    const stderr = captureStderr();
    const result = await installHarness({ bundleRoot: bundle, harness: 'copilot-vscode', stderr: stderr.stream });

    assert.strictEqual(result.action, 'fresh-install');
    assert.match(stderr.text, /copilot-cli-plugin/, 'cross-UI plugin partner surfaced in notice');

    const installJson = JSON.parse(fs.readFileSync(path.join(home, '.radorc/install.json'), 'utf8'));
    assert.ok(installJson.harnesses['copilot-cli-plugin'], 'cross-UI plugin entry NOT evicted (regression guard)');
    assert.strictEqual(installJson.harnesses['copilot-cli-plugin'].version, '1.0.0');
    assert.strictEqual(installJson.harnesses['copilot-vscode'].version, '1.0.0');
  } finally {
    restoreHome();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('NFR-4 best-effort: stderr write throws during mutex/cross-channel emission → install still completes', async () => {
  const tmp = mkTmp('std-ih-besteff-');
  const restoreHome = withHome(path.join(tmp, 'home'));
  try {
    const bundle = path.join(tmp, 'bundle');
    buildBundle(bundle, { version: '1.0.1' });

    const home = path.join(tmp, 'home');
    fs.mkdirSync(path.join(home, '.radorc'), { recursive: true });
    // Seed BOTH a folder-mutex partner AND a cross-channel partner so both
    // emit paths fire and the throwing stderr is exercised.
    fs.writeFileSync(
      path.join(home, '.radorc/install.json'),
      JSON.stringify({
        harnesses: {
          'copilot-cli': {
            version: '1.0.0',
            channel: 'standard',
            installed_at: '2024-01-01T00:00:00.000Z',
            last_writer_version: '1.0.0',
          },
        },
      }, null, 2),
    );

    const result = await installHarness({
      bundleRoot: bundle,
      harness: 'copilot-vscode',
      stderr: throwingStderr(),
    });

    assert.strictEqual(result.action, 'fresh-install', 'install completes despite throwing stderr');
    assert.strictEqual(result.code, 0);

    // Registry was still updated (mutex resolved, partner removed, new entry written).
    const installJson = JSON.parse(fs.readFileSync(path.join(home, '.radorc/install.json'), 'utf8'));
    assert.strictEqual(installJson.harnesses['copilot-cli'], undefined);
    assert.strictEqual(installJson.harnesses['copilot-vscode'].version, '1.0.1');
  } finally {
    restoreHome();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Local helper used only by the noop test.
// ---------------------------------------------------------------------------

function walkFiles(root) {
  if (!fs.existsSync(root)) return [];
  const out = [];
  const stack = [root];
  while (stack.length) {
    const cur = stack.pop();
    for (const ent of fs.readdirSync(cur, { withFileTypes: true })) {
      const p = path.join(cur, ent.name);
      if (ent.isDirectory()) stack.push(p);
      else out.push(p);
    }
  }
  return out;
}

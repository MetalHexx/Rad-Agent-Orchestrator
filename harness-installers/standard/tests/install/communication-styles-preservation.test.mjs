// harness-installers/standard/tests/install/communication-styles-preservation.test.mjs —
// Asserts the standard installer's manifest-driven install of the
// communication-styles catalog:
//   - shipped style files land under ${RAD_HOME}/communication-styles/
//   - any user-authored file under custom/ survives uninstall
//   - removeManifestFiles refuses any manifest entry whose resolved destination
//     lives under communication-styles/custom/ — the slot is user-owned and
//     ships empty (defensive guard against future manifest drift)
//   - a user's `communication_style` selection in orchestration.yml survives
//     uninstall (the config file is hydration-owned and never manifested)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { withTempHome, installFull, uninstallHarness, stageCommunicationStylesBundle } from '../helpers/install-bench.js';
import { removeManifestFiles } from '../../lib/install/remove-files.js';

test('install hydrates communication-styles/, copies the four shipped style files', async () => {
  await withTempHome(async (home) => {
    installFull(home, { harness: 'claude' });
    const csRoot = path.join(home, '.radorc', 'communication-styles');
    assert.ok(fs.existsSync(csRoot), 'communication-styles/ created');
    for (const style of ['direct.md', 'caveman.md', 'high-level.md', 'socratic.md']) {
      assert.ok(fs.existsSync(path.join(csRoot, style)), `${style} present`);
    }
  });
});

test('user file under custom/ survives uninstall', async () => {
  await withTempHome(async (home) => {
    const { manifest } = installFull(home, { harness: 'claude' });
    const customDir = path.join(home, '.radorc', 'communication-styles', 'custom');
    fs.mkdirSync(customDir, { recursive: true });
    const userFile = path.join(customDir, 'mine.md');
    fs.writeFileSync(userFile, 'MINE');
    uninstallHarness(home, { harness: 'claude', manifest });
    assert.strictEqual(fs.readFileSync(userFile, 'utf8'), 'MINE', 'user file untouched by uninstall');
  });
});

test('uninstall removes the four shipped style files', async () => {
  await withTempHome(async (home) => {
    const { manifest } = installFull(home, { harness: 'claude' });
    uninstallHarness(home, { harness: 'claude', manifest });
    const csRoot = path.join(home, '.radorc', 'communication-styles');
    if (fs.existsSync(csRoot)) {
      const remaining = fs.readdirSync(csRoot).filter((f) => f.endsWith('.md'));
      assert.deepStrictEqual(remaining, [], 'shipped style files removed');
    }
  });
});

test('removeManifestFiles refuses any entry under communication-styles/custom/ (defensive guard)', async () => {
  await withTempHome(async (home) => {
    const { manifest } = stageCommunicationStylesBundle(home, { harness: 'claude' });
    // Tampered manifest — a user-authored custom payload appears as a manifest entry.
    const tamperedManifest = {
      files: [
        ...manifest.files,
        {
          bundlePath: 'communication-styles/custom/mine.md',
          destinationPath: '${RAD_HOME}/communication-styles/custom/mine.md',
          sha256: 'x',
        },
      ],
    };
    assert.throws(
      () => removeManifestFiles(tamperedManifest, 'claude'),
      /custom.*payload|communication-styles.*custom/i,
      'remove path must throw on any entry under communication-styles/custom/',
    );
  });
});

test('removeManifestFiles passes the shipped manifest (no custom/ entries trip the guard)', async () => {
  await withTempHome(async (home) => {
    const { manifest } = installFull(home, { harness: 'claude' });
    assert.doesNotThrow(
      () => removeManifestFiles(manifest, 'claude'),
      'shipped manifest (no communication-styles/custom/ entries) must pass the defensive guard',
    );
  });
});

test("user's communication_style selection in orchestration.yml survives uninstall", async () => {
  await withTempHome(async (home) => {
    const { manifest } = installFull(home, { harness: 'claude' });
    const radHome = path.join(home, '.radorc');
    fs.mkdirSync(radHome, { recursive: true });
    const orchestrationYmlPath = path.join(radHome, 'orchestration.yml');
    const userConfig = 'communication_style:\n  enabled: true\n  selected: caveman.md\n';
    fs.writeFileSync(orchestrationYmlPath, userConfig);
    uninstallHarness(home, { harness: 'claude', manifest });
    assert.strictEqual(
      fs.readFileSync(orchestrationYmlPath, 'utf8'),
      userConfig,
      "user's orchestration.yml communication_style selection survives uninstall",
    );
  });
});

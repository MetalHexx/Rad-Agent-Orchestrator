// harness-installers/copilot-vscode-plugin/tests/install/communication-styles-preservation.test.mjs —
// Asserts the copilot-vscode-plugin's manifest-driven install/upgrade preserves
// user payloads under communication-styles/custom/.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { withTempHome, installFull, uninstallHarness } from '../helpers/install-bench.js';
import { removeManifestFiles } from '../../lib/install/remove-files.js';

test('install hydrates communication-styles/ and the four shipped style files', async () => {
  await withTempHome(async (home, ctx) => {
    await installFull(home, ctx);
    const csRoot = path.join(home, '.radorc', 'communication-styles');
    assert.ok(fs.existsSync(csRoot), 'communication-styles/ created');
    for (const style of ['direct.md', 'caveman.md', 'high-level.md', 'socratic.md']) {
      assert.ok(fs.existsSync(path.join(csRoot, style)), `${style} present`);
    }
  });
});

test('user file under custom/ survives remove', async () => {
  await withTempHome(async (home, ctx) => {
    await installFull(home, ctx);
    const customDir = path.join(home, '.radorc', 'communication-styles', 'custom');
    fs.mkdirSync(customDir, { recursive: true });
    const userFile = path.join(customDir, 'mine.md');
    fs.writeFileSync(userFile, 'MINE');
    uninstallHarness(home, ctx);
    assert.strictEqual(fs.readFileSync(userFile, 'utf8'), 'MINE', 'user file untouched by remove');
  });
});

test('removeManifestFiles refuses any entry under communication-styles/custom/ (defensive guard)', async () => {
  await withTempHome(async (home) => {
    const tamperedManifest = {
      files: [
        {
          destinationPath: '${RAD_HOME}/communication-styles/custom/mine.md',
          sourcePath: '_install-source/communication-styles/custom/mine.md',
          ownership: 'installer-owned',
        },
      ],
    };
    assert.throws(
      () => removeManifestFiles(tamperedManifest, { radHome: path.join(home, '.radorc') }),
      /custom.*payload|communication-styles.*custom/i,
      'remove path must throw on any entry under communication-styles/custom/',
    );
  });
});

test("user's communication_style selection in orchestration.yml survives remove", async () => {
  await withTempHome(async (home, ctx) => {
    await installFull(home, ctx);
    const orchestrationYmlPath = path.join(home, '.radorc', 'orchestration.yml');
    const userConfig = 'communication_style:\n  enabled: true\n  selected: caveman.md\n';
    fs.writeFileSync(orchestrationYmlPath, userConfig);
    uninstallHarness(home, ctx);
    assert.strictEqual(
      fs.readFileSync(orchestrationYmlPath, 'utf8'),
      userConfig,
      "user's orchestration.yml communication_style selection survives remove",
    );
  });
});

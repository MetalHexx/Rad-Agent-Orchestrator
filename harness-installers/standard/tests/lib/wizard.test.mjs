// tests/lib/wizard.test.mjs — Headless wizard behavior and harness auto-detection.
//
// The wizard is single-select: it returns a length-1 array. Interactive
// branches (the inquirer `select` and `confirm` prompts) are not covered
// here — they would require mocking @inquirer/prompts and are exercised
// end-to-end via the smoke-test skill.
//
// All tests pass a synthetic `homeDir` (a tmpdir staging area) so the test
// suite never touches the real ~/.claude or ~/.radorc — that would couple
// CI results to the developer's local machine.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runWizard, detectInstalledHarnesses, installDestructivePromptLines, buildUninstallChoices } from '../../lib/wizard.js';

function mkHome(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('runWizard — headless (skipConfirmation) behavior', () => {
  it('defensive fallback returns ["claude"] when no override is provided', async () => {
    const home = mkHome('std-wiz-empty-');
    try {
      const result = await runWizard({
        skipConfirmation: true,
        cliOverrides: {},
        homeDir: home,
      });
      assert.deepEqual(result.harnesses, ['claude']);
      assert.equal(result.skipConfirmation, true);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('honors cliOverrides.harnesses verbatim', async () => {
    const home = mkHome('std-wiz-override-');
    try {
      const result = await runWizard({
        skipConfirmation: true,
        cliOverrides: { harnesses: ['copilot-cli'] },
        homeDir: home,
      });
      assert.deepEqual(result.harnesses, ['copilot-cli']);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('headless uninstall: forceAction + cliOverrides returns action="uninstall" and bypasses confirmation', async () => {
    const home = mkHome('std-wiz-uninstall-headless-');
    try {
      const radorchDir = path.join(home, '.radorc');
      fs.mkdirSync(radorchDir, { recursive: true });
      fs.writeFileSync(
        path.join(radorchDir, 'install.json'),
        JSON.stringify({
          harnesses: {
            'copilot-cli': {
              version: '1.0.0-alpha.11',
              channel: 'standard',
              installed_at: 't',
              last_writer_version: '1.0.0-alpha.11',
            },
          },
        }),
        'utf8',
      );

      const result = await runWizard({
        skipConfirmation: true,
        cliOverrides: { harnesses: ['copilot-cli'] },
        homeDir: home,
        forceAction: 'uninstall',
      });
      assert.equal(result.action, 'uninstall');
      assert.deepEqual(result.harnesses, ['copilot-cli']);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('headless uninstall: throws NOT_INSTALLED when the override harness is not registered', async () => {
    const home = mkHome('std-wiz-uninstall-not-installed-');
    try {
      const radorchDir = path.join(home, '.radorc');
      fs.mkdirSync(radorchDir, { recursive: true });
      fs.writeFileSync(
        path.join(radorchDir, 'install.json'),
        JSON.stringify({ harnesses: {} }),
        'utf8',
      );

      await assert.rejects(
        async () =>
          runWizard({
            skipConfirmation: true,
            cliOverrides: { harnesses: ['copilot-cli'] },
            homeDir: home,
            forceAction: 'uninstall',
          }),
        (err) => err.code === 'NOT_INSTALLED',
      );
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('skipConfirmation bypasses the destructive-pick confirm even when the override would otherwise prompt', async () => {
    // Stage a synthetic ~/.radorc/install.json with copilot-vscode already
    // registered. Picking copilot-cli would normally be destructive (mutex
    // eviction) and fire the confirm prompt — but skipConfirmation=true
    // short-circuits that.
    const home = mkHome('std-wiz-destructive-headless-');
    try {
      const radorchDir = path.join(home, '.radorc');
      fs.mkdirSync(radorchDir, { recursive: true });
      fs.writeFileSync(
        path.join(radorchDir, 'install.json'),
        JSON.stringify({
          harnesses: {
            'copilot-vscode': {
              version: '1.0.0-alpha.11',
              channel: 'standard',
              installed_at: 't',
              last_writer_version: '1.0.0-alpha.11',
            },
          },
        }),
        'utf8',
      );

      const result = await runWizard({
        skipConfirmation: true,
        cliOverrides: { harnesses: ['copilot-cli'] },
        homeDir: home,
        deliveringVersion: '1.0.0-alpha.11',
      });
      assert.deepEqual(result.harnesses, ['copilot-cli']);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});

describe('installDestructivePromptLines — plugin coexistence + folder mutex + downgrade', () => {
  function entry(version = '1.0.0', channel = 'plugin') {
    return { version, channel, installed_at: 't', last_writer_version: version };
  }

  it('no triggers → null', () => {
    const home = mkHome('std-pl-null-');
    try {
      assert.equal(installDestructivePromptLines({}, 'claude', '1.0.0', { home }), null);
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
  });

  it('claude + claude-plugin (registry) → lines mention claude-plugin and the duplicate-loading consequence', () => {
    const home = mkHome('std-pl-claude-');
    try {
      const lines = installDestructivePromptLines(
        { 'claude-plugin': entry('1.0.0') },
        'claude',
        '1.0.0',
        { home },
      );
      assert.ok(lines, 'expected non-null lines');
      const text = lines.join('\n');
      assert.match(text, /Claude Code \(plugin\)/);
      assert.match(text, /DUPLICATE rad-orc:<name> entries/);
      assert.match(text, /To avoid duplicates, cancel and run/);
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
  });

  it('copilot-cli + copilot-cli-plugin (registry) → lines mention the plugin partner and duplicate-loading', () => {
    const home = mkHome('std-pl-cli-');
    try {
      const lines = installDestructivePromptLines(
        { 'copilot-cli-plugin': entry('1.0.0') },
        'copilot-cli',
        '1.0.0',
        { home },
      );
      assert.ok(lines);
      const text = lines.join('\n');
      assert.match(text, /Copilot CLI \(plugin\)/);
      assert.match(text, /DUPLICATE rad-orc:<name> entries/);
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
  });

  it('copilot-cli + copilot-vscode-plugin (cross-UI registry) → lines mention the cross-UI plugin', () => {
    const home = mkHome('std-pl-cli-cross-');
    try {
      const lines = installDestructivePromptLines(
        { 'copilot-vscode-plugin': entry('1.0.0') },
        'copilot-cli',
        '1.0.0',
        { home },
      );
      assert.ok(lines);
      assert.match(lines.join('\n'), /Copilot VS Code \(plugin\)/);
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
  });

  it('copilot-vscode + disk-only plugin under ~/.copilot/installed-plugins/<mp>/rad-orc/ → lines surface "detected on disk"', () => {
    const home = mkHome('std-pl-disk-');
    try {
      fs.mkdirSync(path.join(home, '.copilot', 'installed-plugins', 'test-mp', 'rad-orc'), { recursive: true });
      const lines = installDestructivePromptLines({}, 'copilot-vscode', '1.0.0', { home });
      assert.ok(lines);
      const text = lines.join('\n');
      assert.match(text, /detected on disk/);
      assert.match(text, /Copilot VS Code \(plugin\)/, 'same-UI canonical partner reported');
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
  });

  it('copilot-cli + cross-UI mutex partner AND plugin partner → both blocks appear, separated by blank line', () => {
    const home = mkHome('std-pl-combined-');
    try {
      const lines = installDestructivePromptLines(
        {
          'copilot-vscode':     entry('1.0.0', 'standard'),
          'copilot-cli-plugin': entry('1.0.0'),
        },
        'copilot-cli',
        '1.0.0',
        { home },
      );
      assert.ok(lines);
      const text = lines.join('\n');
      assert.match(text, /will replace your existing Copilot VS Code/, 'block 1 (mutex) present');
      assert.match(text, /A Copilot CLI \(plugin\)/, 'block 2 (coexistence) present');
      // Verify order: mutex line precedes coexistence line.
      const mutexIdx = text.indexOf('will replace your existing');
      const coexistIdx = text.indexOf('install is already present');
      assert.ok(mutexIdx >= 0 && coexistIdx > mutexIdx, 'mutex block precedes coexistence block');
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
  });

  it('downgrade-only → returns the downgrade line', () => {
    const home = mkHome('std-pl-downgrade-');
    try {
      const lines = installDestructivePromptLines(
        { 'claude': entry('2.0.0', 'standard') },
        'claude',
        '1.0.0',
        { home },
      );
      assert.ok(lines);
      assert.match(lines.join('\n'), /will downgrade Claude Code from v2\.0\.0/);
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
  });
});

describe('detectInstalledHarnesses', () => {
  it('returns [] when neither .claude nor .copilot exists', () => {
    const home = mkHome('std-det-empty-');
    try {
      assert.deepEqual(detectInstalledHarnesses({ homeDir: home }), []);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('returns ["claude"] when only .claude exists', () => {
    const home = mkHome('std-det-claude-');
    try {
      fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
      assert.deepEqual(detectInstalledHarnesses({ homeDir: home }), ['claude']);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('returns [] when only .copilot exists (~/.copilot/ is not a Copilot install signal)', () => {
    const home = mkHome('std-det-copilot-');
    try {
      fs.mkdirSync(path.join(home, '.copilot'), { recursive: true });
      assert.deepEqual(detectInstalledHarnesses({ homeDir: home }), []);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('returns only ["claude"] when both .claude and .copilot exist (Copilot is opt-in)', () => {
    const home = mkHome('std-det-both-');
    try {
      fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
      fs.mkdirSync(path.join(home, '.copilot'), { recursive: true });
      assert.deepEqual(detectInstalledHarnesses({ homeDir: home }), ['claude']);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});

describe('runWizard — uninstall plugin filtering', () => {
  function seedRegistry(home, harnesses) {
    const radorchDir = path.join(home, '.radorc');
    fs.mkdirSync(radorchDir, { recursive: true });
    fs.writeFileSync(
      path.join(radorchDir, 'install.json'),
      JSON.stringify({ harnesses }),
      'utf8',
    );
  }

  function entry(version = '1.0.0-alpha.11', channel = 'claude-plugin') {
    return { version, channel, installed_at: 't', last_writer_version: version };
  }

  for (const pluginKey of ['claude-plugin', 'copilot-cli-plugin', 'copilot-vscode-plugin']) {
    it(`headless --uninstall --harness ${pluginKey} → PLUGIN_NOT_UNINSTALLABLE_HERE`, async () => {
      const home = mkHome(`std-wiz-uninstall-${pluginKey}-`);
      try {
        seedRegistry(home, { [pluginKey]: entry('1.0.0-alpha.11', pluginKey) });
        await assert.rejects(
          async () =>
            runWizard({
              skipConfirmation: true,
              cliOverrides: { harnesses: [pluginKey] },
              homeDir: home,
              forceAction: 'uninstall',
            }),
          (err) =>
            err.code === 'PLUGIN_NOT_UNINSTALLABLE_HERE' &&
            /\/plugin uninstall rad-orc/.test(err.message) &&
            err.message.includes(pluginKey),
        );
      } finally {
        fs.rmSync(home, { recursive: true, force: true });
      }
    });
  }

  it('forceAction uninstall against registry with only plugin entries → NOTHING_TO_UNINSTALL', async () => {
    // Interactive path (no cliOverrides.harnesses), forceAction='uninstall'.
    // standardInstalledCount === 0 even though installedCount > 0, so the
    // guard must fire on the standard-only count.
    const home = mkHome('std-wiz-uninstall-only-plugins-');
    try {
      seedRegistry(home, {
        'claude-plugin':      entry('1.0.0-alpha.11', 'claude-plugin'),
        'copilot-cli-plugin': entry('1.0.0-alpha.11', 'copilot-cli-plugin'),
      });
      await assert.rejects(
        async () =>
          runWizard({
            skipConfirmation: false,
            cliOverrides: {},
            homeDir: home,
            forceAction: 'uninstall',
          }),
        (err) => err.code === 'NOTHING_TO_UNINSTALL',
      );
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('buildUninstallChoices excludes plugin install-keys', () => {
    const choices = buildUninstallChoices({
      'claude':              { version: '1.0.0' },
      'claude-plugin':       { version: '1.0.0' },
      'copilot-cli':         { version: '1.0.0' },
      'copilot-cli-plugin':  { version: '1.0.0' },
      'copilot-vscode-plugin': { version: '1.0.0' },
    });
    const values = choices.map((c) => c.value).sort();
    assert.deepEqual(values, ['claude', 'copilot-cli']);
  });
});

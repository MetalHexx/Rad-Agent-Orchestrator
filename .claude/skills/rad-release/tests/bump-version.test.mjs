// Test suite for the lockstep version-bump engine.
// Runs against a synthetic tmp-directory git-init'd fixture; never the real repo.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';

import { bumpVersion } from '../scripts/bump-version.mjs';

const from = '1.0.0-alpha.9';
const to = '1.0.0-alpha.10';

// Files that hold a JSON `version` field bumped in-place (wrappers + plugin authoritative sources)
const WRAPPER_JSON_FILES = [
  'cli/package.json',
  'ui/package.json',
  'lib/repo-registry/package.json',
  'harness-adapters/engine/package.json',
  'harness-installers/standard/package.json',
  'harness-installers/shared/build-helpers/package.json',
  'harness-installers/claude-plugin/package.json',
  'harness-installers/copilot-cli-plugin/package.json',
  'harness-installers/copilot-vscode-plugin/package.json',
];

const PLUGIN_JSON_FILES = [
  'harness-installers/claude-plugin/.claude-plugin/plugin.json',
  'harness-installers/copilot-cli-plugin/plugin.json',
  'harness-installers/copilot-vscode-plugin/.claude-plugin/plugin.json',
];

const MANIFEST_DIRS = [
  'harness-installers/claude-plugin/manifests',
  'harness-installers/copilot-cli-plugin/manifests',
  'harness-installers/copilot-vscode-plugin/manifests',
  'harness-installers/standard/manifests/claude',
  'harness-installers/standard/manifests/copilot-cli',
  'harness-installers/standard/manifests/copilot-vscode',
];

const HARDCODED_LITERAL_FILES = [
  'harness-installers/claude-plugin/build-scripts/parity-check.js',
  'harness-installers/claude-plugin/tests/manifest-shape.test.mjs',
  'harness-installers/claude-plugin/tests/build-payload.test.mjs',
  'harness-installers/copilot-cli-plugin/tests/build-payload.test.mjs',
  'harness-installers/copilot-vscode-plugin/tests/build-payload.test.mjs',
  'harness-installers/standard/tests/build/build.test.mjs',
  'harness-installers/standard/tests/build/emit-manifest.test.mjs',
  'harness-installers/standard/tests/build/validate.test.mjs',
  'harness-installers/standard/tests/install/uninstall-harness.test.mjs',
  'harness-installers/standard/tests/integration/build-then-install.test.mjs',
  'harness-installers/standard/tests/lib/drift-hint.test.mjs',
  'harness-installers/standard/tests/lib/wizard.test.mjs',
];

function writeFileSyncRecursive(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

async function fileExists(p) {
  try {
    await fs.promises.access(p);
    return true;
  } catch {
    return false;
  }
}

function makeFixture() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bump-version-test-'));

  // git init so `git mv` and `git grep` work inside the fixture.
  execSync('git init -q', { cwd: tmp });
  execSync('git config user.email "test@example.com"', { cwd: tmp });
  execSync('git config user.name "Test"', { cwd: tmp });
  // Silence Windows CRLF warnings that flood stderr during the fixture lifecycle.
  execSync('git config core.autocrlf false', { cwd: tmp });
  execSync('git config core.safecrlf false', { cwd: tmp });

  // Wrappers + plugin authoritative sources: JSON files with version field.
  for (const p of [...WRAPPER_JSON_FILES, ...PLUGIN_JSON_FILES]) {
    const body = JSON.stringify({ name: 'fixture', version: from }, null, 2) + '\n';
    writeFileSyncRecursive(path.join(tmp, p), body);
  }

  // Per-version manifest catalog files: v<from>.json in each manifest dir.
  for (const dir of MANIFEST_DIRS) {
    const body = JSON.stringify({ version: from, entries: [] }, null, 2) + '\n';
    writeFileSyncRecursive(path.join(tmp, dir, `v${from}.json`), body);
  }

  // Hardcoded-literal files: include the bare `from` literal in JS source.
  for (const p of HARDCODED_LITERAL_FILES) {
    const body = `// fixture file\nconst V = '${from}';\nexport default V;\n`;
    writeFileSyncRecursive(path.join(tmp, p), body);
  }

  // runtime-config/orchestration.yml — auto-stamped carrier (explicitly excluded from guard).
  writeFileSyncRecursive(
    path.join(tmp, 'runtime-config/orchestration.yml'),
    `version: ${from}\n`,
  );

  // CHANGELOG.md — legacy historical-context comment region (excluded from guard).
  writeFileSyncRecursive(
    path.join(tmp, 'CHANGELOG.md'),
    `# Changelog\n\n<!-- legacy historical-context: ${from} -->\n`,
  );

  // Stage everything so `git mv` and `git grep` see the files as tracked.
  execSync('git add -A', { cwd: tmp });
  execSync('git commit -q -m "fixture"', { cwd: tmp });

  return tmp;
}

const fixtures = [];
after(() => {
  for (const tmp of fixtures) {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('bumpVersion edits every wrapper package.json', async () => {
  const tmp = makeFixture();
  fixtures.push(tmp);

  await bumpVersion({ from, to, repoRoot: tmp });

  for (const p of WRAPPER_JSON_FILES) {
    const pkg = JSON.parse(await fs.promises.readFile(path.join(tmp, p), 'utf8'));
    assert.strictEqual(pkg.version, to, `wrapper ${p} not bumped`);
  }

  for (const p of PLUGIN_JSON_FILES) {
    const pkg = JSON.parse(await fs.promises.readFile(path.join(tmp, p), 'utf8'));
    assert.strictEqual(pkg.version, to, `plugin source ${p} not bumped`);
  }
});

test('bumpVersion renames every per-version manifest catalog and updates internal version', async () => {
  const tmp = makeFixture();
  fixtures.push(tmp);

  await bumpVersion({ from, to, repoRoot: tmp });

  for (const dir of MANIFEST_DIRS) {
    const newFile = path.join(tmp, dir, `v${to}.json`);
    const oldFile = path.join(tmp, dir, `v${from}.json`);
    assert.ok(await fileExists(newFile), `expected renamed file ${newFile}`);
    assert.ok(!(await fileExists(oldFile)), `expected old file removed ${oldFile}`);
    const body = JSON.parse(await fs.promises.readFile(newFile, 'utf8'));
    assert.strictEqual(body.version, to, `manifest ${dir} internal version not bumped`);
  }
});

test('bumpVersion enrolls the repo-registry library wrapper', async () => {
  const { WRAPPER_JSON_FILES: inv } = await import('../scripts/bump-version.mjs');
  assert.ok(
    inv.includes('lib/repo-registry/package.json'),
    'repo-registry package.json must be in the bump inventory',
  );
});

test('bumpVersion fails loudly when stray copies of the prior version remain', async () => {
  const tmp = makeFixture();
  fixtures.push(tmp);

  // Seed a stray version literal in an un-listed file and stage it so `git grep` sees it.
  fs.writeFileSync(path.join(tmp, 'unknown-carrier.txt'), `v${from}`);
  execSync('git add unknown-carrier.txt', { cwd: tmp });

  await assert.rejects(
    () => bumpVersion({ from, to, repoRoot: tmp }),
    /unknown carrier/i,
  );
});

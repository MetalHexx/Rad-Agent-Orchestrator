// Test suite for the lockstep version-bump engine.
// Runs against a synthetic tmp-directory git-init'd fixture; never the real repo.
//
// The carrier inventories are imported straight from the engine rather than
// re-declared here, so the fixture can never drift out of sync with the lists
// the engine actually walks.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';

import {
  bumpVersion,
  WRAPPER_JSON_FILES,
  PLUGIN_JSON_FILES,
  MANIFEST_DIRS,
  PLUGIN_MANIFEST_DIRS,
  STANDARD_MANIFEST_DIRS,
  HARDCODED_LITERAL_FILES,
  LOCKFILE_JSON_FILES,
} from '../scripts/bump-version.mjs';

const from = '1.0.0-alpha.9';
const to = '1.0.0-alpha.10';

// A wrapper that also carries intra-repo dependency pins, so the fixture can
// prove the pin-rewrite behavior. `cli/package.json` is the real-world carrier
// of these pins; assert against it specifically.
const PIN_CARRIER = 'cli/package.json';

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
    const pkg = { name: 'fixture', version: from };
    // Give the pin carrier a realistic mix of intra-repo pins (must be rewritten)
    // and an external dependency (must be left untouched).
    if (p === PIN_CARRIER) {
      pkg.dependencies = {
        '@rad-orchestration/repo-registry': from,
        '@rad-orchestration/telemetry': from,
        'some-external-dep': '^2.3.4',
      };
      pkg.devDependencies = { '@rad-orchestration/work-graph': from };
    }
    writeFileSyncRecursive(path.join(tmp, p), JSON.stringify(pkg, null, 2) + '\n');
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

  // Nested per-workspace lockfiles: the two version fields the engine rewrites.
  for (const p of LOCKFILE_JSON_FILES) {
    const lock = {
      name: 'fixture',
      version: from,
      lockfileVersion: 3,
      packages: { '': { name: 'fixture', version: from } },
    };
    writeFileSyncRecursive(path.join(tmp, p), JSON.stringify(lock, null, 2) + '\n');
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

test('bumpVersion rewrites intra-repo @rad-orchestration dependency pins', async () => {
  const tmp = makeFixture();
  fixtures.push(tmp);

  await bumpVersion({ from, to, repoRoot: tmp });

  const pkg = JSON.parse(await fs.promises.readFile(path.join(tmp, PIN_CARRIER), 'utf8'));
  assert.strictEqual(pkg.dependencies['@rad-orchestration/repo-registry'], to);
  assert.strictEqual(pkg.dependencies['@rad-orchestration/telemetry'], to);
  assert.strictEqual(pkg.devDependencies['@rad-orchestration/work-graph'], to);
  // External dependency must be left exactly as-is.
  assert.strictEqual(pkg.dependencies['some-external-dep'], '^2.3.4');
});

test('bumpVersion rewrites both version fields in every nested lockfile', async () => {
  const tmp = makeFixture();
  fixtures.push(tmp);

  await bumpVersion({ from, to, repoRoot: tmp });

  for (const p of LOCKFILE_JSON_FILES) {
    const lock = JSON.parse(await fs.promises.readFile(path.join(tmp, p), 'utf8'));
    assert.strictEqual(lock.version, to, `lockfile ${p} top-level version not bumped`);
    assert.strictEqual(lock.packages[''].version, to, `lockfile ${p} self version not bumped`);
  }
});

test('bumpVersion leaves standard-installer manifest catalogs untouched (AD-4 accumulation)', async () => {
  const tmp = makeFixture();
  fixtures.push(tmp);

  await bumpVersion({ from, to, repoRoot: tmp });

  for (const dir of STANDARD_MANIFEST_DIRS) {
    const oldFile = path.join(tmp, dir, `v${from}.json`);
    const newFile = path.join(tmp, dir, `v${to}.json`);
    assert.ok(await fileExists(oldFile), `expected prior-version manifest to survive ${oldFile}`);
    assert.ok(!(await fileExists(newFile)), `bumpVersion must not emit the new manifest itself — that's the build step's job: ${newFile}`);
    const body = JSON.parse(await fs.promises.readFile(oldFile, 'utf8'));
    assert.strictEqual(body.version, from, `prior manifest ${dir} version must remain untouched`);
  }
});

test('bumpVersion renames each plugin manifest forward (single current-version file)', async () => {
  const tmp = makeFixture();
  fixtures.push(tmp);

  await bumpVersion({ from, to, repoRoot: tmp });

  for (const dir of PLUGIN_MANIFEST_DIRS) {
    const oldFile = path.join(tmp, dir, `v${from}.json`);
    const newFile = path.join(tmp, dir, `v${to}.json`);
    assert.ok(!(await fileExists(oldFile)), `expected prior-version plugin manifest to be renamed away: ${oldFile}`);
    assert.ok(await fileExists(newFile), `expected renamed plugin manifest to exist: ${newFile}`);
    const body = JSON.parse(await fs.promises.readFile(newFile, 'utf8'));
    assert.strictEqual(body.version, to, `renamed plugin manifest ${dir} version must be bumped`);
  }
});

test('bumpVersion enrolls the product library wrappers', async () => {
  for (const lib of [
    'lib/repo-registry/package.json',
    'lib/telemetry/package.json',
    'lib/work-graph/package.json',
  ]) {
    assert.ok(
      WRAPPER_JSON_FILES.includes(lib),
      `${lib} must be in the bump inventory`,
    );
  }
});

test('bumpVersion enrolls the graph-subsystem packages', async () => {
  for (const p of [
    'graph-service/package.json',
    'lib/graph-client/package.json',
    'lib/graph-engine/package.json',
    'lib/graph-node-types/package.json',
    'lib/graph-store-sqlite/package.json',
    'examples/example/package.json',
    'examples/node-blind-fixture/package.json',
  ]) {
    assert.ok(
      WRAPPER_JSON_FILES.includes(p),
      `${p} must be in the bump inventory`,
    );
  }
  assert.ok(
    HARDCODED_LITERAL_FILES.includes('lib/graph-node-types/tests/dependency-direction.test.ts'),
    'lib/graph-node-types/tests/dependency-direction.test.ts must be in the hardcoded-literal inventory',
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

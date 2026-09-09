import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { syncSatelliteAndTag } from '../scripts/sync-satellite-and-tag.mjs';

// Real filesystem end-to-end coverage: copyTree and rewriteCatalogRef run at their real defaults.
// Only spawn is injected, so the seam under test is exactly "real files, zero git effects".

const HARNESS_TREES = [
  { src: path.join('harness-installers', 'claude-plugin', 'output'), harness: 'claude' },
  { src: path.join('harness-installers', 'copilot-cli-plugin', 'output'), harness: 'copilot-cli' },
  { src: path.join('harness-installers', 'copilot-vscode-plugin', 'output'), harness: 'copilot-vscode' },
];

function makeRepoFixture() {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-repo-'));
  for (const { src, harness } of HARNESS_TREES) {
    const outputDir = path.join(repoRoot, src);
    fs.mkdirSync(path.join(outputDir, 'nested'), { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'top.txt'), `top-${harness}\n`);
    fs.writeFileSync(path.join(outputDir, 'nested', 'deep.txt'), `deep-${harness}\n`);
  }
  return repoRoot;
}

function makeSatelliteFixture() {
  const satelliteRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-sat-'));
  fs.mkdirSync(path.join(satelliteRoot, '.claude-plugin'), { recursive: true });
  fs.mkdirSync(path.join(satelliteRoot, '.github', 'plugin'), { recursive: true });
  fs.mkdirSync(path.join(satelliteRoot, 'neighbor-tool'), { recursive: true });
  fs.writeFileSync(path.join(satelliteRoot, 'neighbor-tool', 'payload.txt'), 'neighbor payload v0.4.1\n');

  const neighborNested = {
    name: 'neighbor-tool',
    source: { source: 'git-subdir', url: 'https://example.invalid/neighbor.git', ref: 'v0.4.1', path: 'neighbor-tool/claude' },
    description: 'a neighbor tenant',
  };
  const claudeCatalog = {
    plugins: [
      { name: 'rad-orc', source: { source: 'git-subdir', url: 'https://example.invalid/rad-orc.git', ref: 'v0.0.0', path: 'rad-orc/claude' } },
      neighborNested,
    ],
  };
  fs.writeFileSync(
    path.join(satelliteRoot, '.claude-plugin', 'marketplace.json'),
    JSON.stringify(claudeCatalog, null, 2) + '\n',
  );

  const neighborFlat = {
    name: 'neighbor-tool',
    source: 'neighbor-tool/copilot-cli',
    description: 'a neighbor tenant',
    version: '0.4.1',
  };
  const copilotCatalog = {
    metadata: { pluginRoot: '.' },
    plugins: [
      { name: 'rad-orc', source: 'rad-orc/copilot-cli', version: '0.0.0' },
      neighborFlat,
    ],
  };
  fs.writeFileSync(
    path.join(satelliteRoot, '.github', 'plugin', 'marketplace.json'),
    JSON.stringify(copilotCatalog, null, 2) + '\n',
  );

  return { satelliteRoot, neighborNested, neighborFlat };
}

function listFiles(dir, base = dir) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) out.push(...listFiles(full, base));
    else out.push(path.relative(base, full));
  }
  return out;
}

function snapshotTree(root) {
  const snapshot = new Map();
  for (const rel of listFiles(root)) snapshot.set(rel, fs.readFileSync(path.join(root, rel)));
  return snapshot;
}

function assertSnapshotsEqual(before, after) {
  assert.deepStrictEqual([...after.keys()].sort(), [...before.keys()].sort());
  for (const [rel, buf] of before) assert.ok(after.get(rel).equals(buf), `${rel} changed`);
}

function makeSpawnRecorder(originUrl) {
  const calls = [];
  const spawn = (cmd, args, opts) => {
    calls.push({ cmd, args, cwd: opts?.cwd });
    if (cmd === 'git' && args[0] === 'remote') return { status: 0, stdout: originUrl + '\n', stderr: '' };
    return { status: 0, stdout: '', stderr: '' };
  };
  return { spawn, calls };
}

test('syncSatelliteAndTag with real copyTree and rewriteCatalogRef lands nested payloads and re-stamped catalogs on disk', async () => {
  const repoRoot = makeRepoFixture();
  const { satelliteRoot, neighborNested, neighborFlat } = makeSatelliteFixture();
  try {
    const { spawn, calls } = makeSpawnRecorder('https://example.invalid/marketplace-satellite.git');
    const version = '2.3.4';
    const tag = `v${version}`;

    await syncSatelliteAndTag({ repoRoot, satelliteRoot, version, spawn });

    // The three payload trees exist under their harness folders, nested files intact — asserted
    // together (not one at a time) so a destination-path bug that clobbers a sibling can't hide.
    for (const { harness } of HARNESS_TREES) {
      const dest = path.join(satelliteRoot, 'rad-orc', harness);
      assert.strictEqual(fs.readFileSync(path.join(dest, 'top.txt'), 'utf8'), `top-${harness}\n`);
      assert.strictEqual(fs.readFileSync(path.join(dest, 'nested', 'deep.txt'), 'utf8'), `deep-${harness}\n`);
    }

    // The pre-existing neighbor payload directory is untouched.
    assert.strictEqual(
      fs.readFileSync(path.join(satelliteRoot, 'neighbor-tool', 'payload.txt'), 'utf8'),
      'neighbor payload v0.4.1\n',
    );

    // Claude catalog: rad-orc re-stamped, neighbor entry byte-identical in structure.
    const claudeCatalog = JSON.parse(
      fs.readFileSync(path.join(satelliteRoot, '.claude-plugin', 'marketplace.json'), 'utf8'),
    );
    assert.strictEqual(claudeCatalog.plugins[0].source.ref, tag);
    assert.strictEqual(claudeCatalog.plugins[0].source.url, 'https://example.invalid/rad-orc.git');
    assert.deepStrictEqual(claudeCatalog.plugins[1], neighborNested);

    // Copilot catalog: rad-orc version bumped (v-stripped), neighbor entry untouched.
    const copilotCatalog = JSON.parse(
      fs.readFileSync(path.join(satelliteRoot, '.github', 'plugin', 'marketplace.json'), 'utf8'),
    );
    assert.strictEqual(copilotCatalog.plugins[0].version, version);
    assert.strictEqual(copilotCatalog.plugins[0].source, 'rad-orc/copilot-cli');
    assert.deepStrictEqual(copilotCatalog.plugins[1], neighborFlat);

    // The recorded git sequence: guard first, then add/commit in the satellite, tag in both repos,
    // push HEAD+tag in both repos — and nothing reaches a URL beyond what the recorder itself stubs.
    const gitCalls = calls.filter(c => c.cmd === 'git');
    assert.strictEqual(gitCalls[0].args[0], 'remote');
    assert.ok(gitCalls.some(c => c.args[0] === 'add' && c.cwd === satelliteRoot));
    assert.ok(gitCalls.some(c => c.args[0] === 'commit' && c.cwd === satelliteRoot));
    const tagCalls = gitCalls.filter(c => c.args[0] === 'tag');
    assert.strictEqual(tagCalls.length, 2);
    assert.ok(tagCalls.some(c => c.cwd === repoRoot && c.args.includes(tag)));
    assert.ok(tagCalls.some(c => c.cwd === satelliteRoot && c.args.includes(tag)));
    const pushCalls = gitCalls.filter(c => c.args[0] === 'push');
    assert.strictEqual(pushCalls.length, 4);
    assert.ok(!calls.some(c => c.args?.some(a => /^https?:\/\//.test(a))));
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
    fs.rmSync(satelliteRoot, { recursive: true, force: true });
  }
});

test('syncSatelliteAndTag refuses a public-remote satellite before any write, leaving it byte-for-byte unchanged', async () => {
  const { satelliteRoot } = makeSatelliteFixture();
  try {
    const before = snapshotTree(satelliteRoot);
    const { spawn } = makeSpawnRecorder('https://example.invalid/MetalHexx/marketplace.git');

    await assert.rejects(
      () => syncSatelliteAndTag({
        repoRoot: path.join(os.tmpdir(), 'sync-repo-never-read'),
        satelliteRoot,
        version: '9.9.9',
        spawn,
      }),
      /public remote/i,
    );

    assertSnapshotsEqual(before, snapshotTree(satelliteRoot));
    assert.ok(!fs.existsSync(path.join(satelliteRoot, 'rad-orc')));
  } finally {
    fs.rmSync(satelliteRoot, { recursive: true, force: true });
  }
});

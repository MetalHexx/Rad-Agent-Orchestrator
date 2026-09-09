import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { syncSatelliteAndTag, defaultRewriteCatalogRef, entryOwner } from '../scripts/sync-satellite-and-tag.mjs';

function writeTempCatalog(body) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-catalog-'));
  const p = path.join(tmp, 'marketplace.json');
  fs.writeFileSync(p, JSON.stringify(body));
  return p;
}

function readCatalog(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

test('syncSatelliteAndTag copies each plugin output into the satellite, updates both catalogs, commits, tags both repos, pushes', async () => {
  const log = [];
  await syncSatelliteAndTag({
    repoRoot: '/repo',
    satelliteRoot: '/sat',
    version: '1.0.0-alpha.10',
    spawn: (cmd, args, opts) => { log.push({ cmd, args, cwd: opts?.cwd }); return { status: 0, stdout: '', stderr: '' }; },
    copyTree: (from, to) => { log.push({ copy: { from, to } }); },
    rewriteCatalogRef: (catPath, ref) => { log.push({ rewrite: { path: catPath, ref } }); },
  });
  // Three plugin payload copies, all under the tool-owned folder. Build expected
  // destinations with path.join so the assertion is portable across Windows (\) and POSIX (/).
  const copies = log.filter(e => e.copy);
  assert.strictEqual(copies.length, 3);
  assert.ok(copies.some(c => c.copy.to === path.join('/sat', 'rad-orc', 'claude')));
  assert.ok(copies.some(c => c.copy.to === path.join('/sat', 'rad-orc', 'copilot-cli')));
  assert.ok(copies.some(c => c.copy.to === path.join('/sat', 'rad-orc', 'copilot-vscode')));
  // Both catalogs rewritten to the new tag
  const rewrites = log.filter(e => e.rewrite);
  assert.ok(rewrites.some(r => r.rewrite.path === path.join('/sat', '.claude-plugin', 'marketplace.json') && r.rewrite.ref === 'v1.0.0-alpha.10'));
  assert.ok(rewrites.some(r => r.rewrite.path === path.join('/sat', '.github', 'plugin', 'marketplace.json') && r.rewrite.ref === 'v1.0.0-alpha.10'));
  // Tag both repos with matching v{X}
  const tagCalls = log.filter(e => e.cmd === 'git' && e.args && e.args[0] === 'tag');
  assert.strictEqual(tagCalls.length, 2);
  assert.ok(tagCalls.some(t => t.cwd === '/repo' && t.args.includes('v1.0.0-alpha.10')));
  assert.ok(tagCalls.some(t => t.cwd === '/sat' && t.args.includes('v1.0.0-alpha.10')));
  // Pushes — both repos, both tags
  const pushes = log.filter(e => e.cmd === 'git' && e.args && e.args[0] === 'push');
  assert.ok(pushes.length >= 2);
});

test('entryOwner reads the owner off a flat-shape source string', () => {
  assert.strictEqual(entryOwner({ name: 'rad-orc', source: 'rad-orc/copilot-cli' }), 'rad-orc');
});

test('entryOwner reads the owner off a nested git-subdir path', () => {
  assert.strictEqual(
    entryOwner({
      name: 'rad-orc',
      source: { source: 'git-subdir', url: 'https://example.invalid/x.git', ref: 'main', path: 'rad-orc/claude' },
    }),
    'rad-orc',
  );
});

test('entryOwner ignores a leading ./ on the payload path', () => {
  assert.strictEqual(
    entryOwner({ name: 'rad-orc', source: './rad-orc/copilot-cli' }),
    entryOwner({ name: 'rad-orc', source: 'rad-orc/copilot-cli' }),
  );
});

test('entryOwner ignores a leading / on a flat-shape payload path', () => {
  assert.strictEqual(
    entryOwner({ name: 'rad-orc', source: '/rad-orc/copilot-cli' }),
    entryOwner({ name: 'rad-orc', source: 'rad-orc/copilot-cli' }),
  );
});

test('entryOwner ignores a leading / on a nested git-subdir payload path', () => {
  assert.strictEqual(
    entryOwner({
      name: 'rad-orc',
      source: { source: 'git-subdir', url: 'https://example.invalid/x.git', ref: 'main', path: '/rad-orc/claude' },
    }),
    entryOwner({
      name: 'rad-orc',
      source: { source: 'git-subdir', url: 'https://example.invalid/x.git', ref: 'main', path: 'rad-orc/claude' },
    }),
  );
});

test('entryOwner treats a single-segment payload path as its own owner', () => {
  assert.strictEqual(entryOwner({ name: 'neighbor-tool', source: 'neighbor-tool' }), 'neighbor-tool');
});

test('entryOwner throws on a nested entry carrying url but no path', () => {
  assert.throws(
    () => entryOwner({ name: 'x', source: { source: 'git-subdir', url: 'https://example.invalid/x.git', ref: 'main' } }),
    /unreadable source shape/,
  );
});

test('entryOwner throws on a shape it cannot read', () => {
  assert.throws(() => entryOwner({ name: 'x', source: { source: 'github', repo: 'a/b', ref: 'v0' } }), /unreadable source shape/);
});

test('defaultRewriteCatalogRef rejects a rad-orc git-subdir entry missing the url field', () => {
  const p = writeTempCatalog({
    plugins: [{ name: 'rad-orc', source: { source: 'git-subdir', ref: 'v0', path: 'rad-orc/claude' } }],
  });
  assert.throws(() => defaultRewriteCatalogRef(p, 'v1'), /url/);
});

test('defaultRewriteCatalogRef rewrites ref on a well-formed rad-orc git-subdir entry', () => {
  const p = writeTempCatalog({
    plugins: [{
      name: 'rad-orc',
      source: { source: 'git-subdir', url: 'https://github.com/a/b.git', ref: 'v0', path: 'rad-orc/claude' },
    }],
  });
  defaultRewriteCatalogRef(p, 'v1');
  const after = readCatalog(p);
  assert.strictEqual(after.plugins[0].source.ref, 'v1');
  assert.strictEqual(after.plugins[0].source.source, 'git-subdir');
  assert.strictEqual(after.plugins[0].source.url, 'https://github.com/a/b.git');
});

test('defaultRewriteCatalogRef bumps version on a flat-shape rad-orc entry (Copilot)', () => {
  const p = writeTempCatalog({
    metadata: { pluginRoot: '.' },
    plugins: [{ name: 'rad-orc', source: 'rad-orc/copilot-cli', version: '0.0.0' }],
  });
  defaultRewriteCatalogRef(p, 'v9.9.9');
  const after = readCatalog(p);
  assert.strictEqual(after.plugins[0].version, '9.9.9');
  assert.strictEqual(after.plugins[0].source, 'rad-orc/copilot-cli');
});

test('defaultRewriteCatalogRef leaves another tool\'s nested entry untouched', () => {
  const neighbor = {
    name: 'neighbor-tool',
    source: { source: 'git-subdir', url: 'https://github.com/a/b.git', ref: 'v0.4.1', path: 'neighbor-tool/claude' },
    description: 'a neighbor tenant',
  };
  const body = {
    plugins: [
      {
        name: 'rad-orc',
        source: { source: 'git-subdir', url: 'https://github.com/a/b.git', ref: 'v0', path: 'rad-orc/claude' },
        description: 'rad-orc',
      },
      neighbor,
    ],
  };
  const p = writeTempCatalog(body);
  defaultRewriteCatalogRef(p, 'v1.2.3');
  const after = readCatalog(p);
  assert.strictEqual(after.plugins[0].source.ref, 'v1.2.3');
  assert.deepStrictEqual(after.plugins[1], neighbor);
});

test('defaultRewriteCatalogRef leaves another tool\'s flat entry untouched', () => {
  const neighbor = {
    name: 'neighbor-tool',
    source: 'neighbor-tool/copilot-cli',
    description: 'a neighbor tenant',
    version: '0.4.1',
  };
  const p = writeTempCatalog({
    metadata: { pluginRoot: '.' },
    plugins: [
      { name: 'rad-orc', source: 'rad-orc/copilot-cli', description: 'rad-orc', version: '0.0.0' },
      neighbor,
    ],
  });
  defaultRewriteCatalogRef(p, 'v1.2.3');
  const after = readCatalog(p);
  assert.strictEqual(after.plugins[0].version, '1.2.3');
  assert.deepStrictEqual(after.plugins[1], neighbor);
});

test('defaultRewriteCatalogRef skips and reports an entry whose shape has no derivable owner', () => {
  const unreadable = {
    name: 'neighbor-tool',
    source: { source: 'github', repo: 'a/b', ref: 'v0.4.1' },
    description: 'a shape rad-orc does not understand',
  };
  const p = writeTempCatalog({
    plugins: [
      {
        name: 'rad-orc',
        source: { source: 'git-subdir', url: 'https://github.com/a/b.git', ref: 'v0', path: 'rad-orc/claude' },
      },
      unreadable,
    ],
  });
  const skipped = defaultRewriteCatalogRef(p, 'v1.2.3');
  const after = readCatalog(p);
  assert.strictEqual(after.plugins[0].source.ref, 'v1.2.3');
  assert.deepStrictEqual(after.plugins[1], unreadable);
  assert.strictEqual(skipped.length, 1);
  assert.strictEqual(skipped[0].name, 'neighbor-tool');
  assert.strictEqual(skipped[0].catalogPath, p);
});

test('syncSatelliteAndTag refuses a satellite pointed at a public remote before writing anything', async () => {
  const log = [];
  await assert.rejects(
    () => syncSatelliteAndTag({
      repoRoot: '/repo',
      satelliteRoot: '/sat',
      version: '1.0.0-alpha.10',
      spawn: (cmd, args, opts) => {
        log.push({ cmd, args, cwd: opts?.cwd });
        if (args[0] === 'remote') return { status: 0, stdout: 'https://github.com/MetalHexx/some-marketplace.git\n', stderr: '' };
        return { status: 0, stdout: '', stderr: '' };
      },
      copyTree: () => { log.push({ copy: true }); },
      rewriteCatalogRef: () => { log.push({ rewrite: true }); },
    }),
    /public remote/i,
  );
  assert.ok(!log.some(e => e.copy || e.rewrite));
  assert.ok(!log.some(e => e.args && (e.args[0] === 'commit' || e.args[0] === 'tag' || e.args[0] === 'push')));
});

test('syncSatelliteAndTag halts on a non-zero spawn exit and names the failing operation', async () => {
  await assert.rejects(
    () => syncSatelliteAndTag({
      repoRoot: '/repo',
      satelliteRoot: '/sat',
      version: '1.0.0-alpha.10',
      spawn: () => ({ status: 1, stdout: '', stderr: 'simulated git failure' }),
      copyTree: () => {},
      rewriteCatalogRef: () => {},
    }),
    /git|simulated/i,
  );
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stageDocsCorpus } from '../docs-corpus.js';

function makeRepo() {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-corpus-repo-'));
  fs.writeFileSync(
    path.join(repoRoot, 'README.md'),
    '# repo\n\n[Contributing →](CONTRIBUTING.md) · [Feedback →](docs/feedback.md)\n',
  );

  const docsDir = path.join(repoRoot, 'docs');
  fs.mkdirSync(path.join(docsDir, 'internals/private'), { recursive: true });
  fs.mkdirSync(path.join(docsDir, 'research'), { recursive: true });
  fs.writeFileSync(path.join(docsDir, 'getting-started.md'), '# getting started\n');
  fs.writeFileSync(path.join(docsDir, 'internals/system-architecture.md'), '# internals\n');
  fs.writeFileSync(path.join(docsDir, 'internals/private/fork-divergence.md'), '# private\n');
  fs.writeFileSync(path.join(docsDir, 'research/some-research.md'), '# research\n');

  const assetsDir = path.join(repoRoot, 'assets');
  fs.mkdirSync(assetsDir, { recursive: true });
  fs.writeFileSync(path.join(assetsDir, 'diagram.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  fs.writeFileSync(path.join(assetsDir, 'notes.txt'), 'not an image\n');

  return repoRoot;
}

test('stages a page under each excluded prefix out, keeps a top-level sibling page', () => {
  const repoRoot = makeRepo();
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-corpus-target-'));
  try {
    const { files } = stageDocsCorpus({ repoRoot, target });
    assert.ok(files.includes('docs/getting-started.md'), 'top-level sibling page kept');
    assert.ok(!files.includes('docs/internals/system-architecture.md'), 'internals/ excluded');
    assert.ok(!files.includes('docs/internals/private/fork-divergence.md'), 'internals/private/ excluded');
    assert.ok(!files.includes('docs/research/some-research.md'), 'research/ excluded');
    assert.ok(!fs.existsSync(path.join(target, 'docs/internals')), 'no internals/ tree on disk');
    assert.ok(!fs.existsSync(path.join(target, 'docs/research')), 'no research/ tree on disk');
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('the three destination sub-trees land where they should', () => {
  const repoRoot = makeRepo();
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-corpus-target-'));
  try {
    stageDocsCorpus({ repoRoot, target });
    assert.ok(fs.existsSync(path.join(target, 'README.md')), 'README.md staged at target root');
    assert.ok(fs.existsSync(path.join(target, 'docs/getting-started.md')), 'docs/ page staged under docs/');
    assert.ok(fs.existsSync(path.join(target, 'assets/diagram.png')), 'image staged under assets/');
    assert.ok(!fs.existsSync(path.join(target, 'assets/notes.txt')), 'non-.png assets are not staged');
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('staged README.md drops the dead CONTRIBUTING.md link but keeps the Feedback link', () => {
  const repoRoot = makeRepo();
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-corpus-target-'));
  try {
    stageDocsCorpus({ repoRoot, target });
    const staged = fs.readFileSync(path.join(target, 'README.md'), 'utf8');
    assert.ok(!staged.includes('CONTRIBUTING.md'), 'CONTRIBUTING.md link stripped from staged README.md');
    assert.ok(staged.includes('[Feedback →](docs/feedback.md)'), 'Feedback link preserved');
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('manifestEntries is empty without sourcePrefix and correctly shaped with it', () => {
  const repoRoot = makeRepo();
  const targetA = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-corpus-target-'));
  const targetB = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-corpus-target-'));
  try {
    const withoutPrefix = stageDocsCorpus({ repoRoot, target: targetA });
    assert.deepStrictEqual(withoutPrefix.manifestEntries, []);

    const withPrefix = stageDocsCorpus({ repoRoot, target: targetB, sourcePrefix: 'docs' });
    const readmeEntry = withPrefix.manifestEntries.find((e) => e.sourcePath === 'docs/README.md');
    assert.ok(readmeEntry, 'README.md manifest entry present');
    assert.deepStrictEqual(readmeEntry, {
      destinationPath: '${RAD_HOME}/docs/README.md',
      sourcePath: 'docs/README.md',
      ownership: 'installer-owned',
    });

    const pageEntry = withPrefix.manifestEntries.find(
      (e) => e.sourcePath === 'docs/docs/getting-started.md',
    );
    assert.deepStrictEqual(pageEntry, {
      destinationPath: '${RAD_HOME}/docs/docs/getting-started.md',
      sourcePath: 'docs/docs/getting-started.md',
      ownership: 'installer-owned',
    });

    assert.strictEqual(
      withPrefix.manifestEntries.length,
      withPrefix.files.length,
      'one manifest entry per staged file',
    );
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
    fs.rmSync(targetA, { recursive: true, force: true });
    fs.rmSync(targetB, { recursive: true, force: true });
  }
});

test('returned paths are POSIX-normalised and sorted regardless of platform separator', () => {
  const repoRoot = makeRepo();
  fs.mkdirSync(path.join(repoRoot, 'docs/nested'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, 'docs/nested/deep.md'), '# deep\n');
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-corpus-target-'));
  try {
    const { files } = stageDocsCorpus({ repoRoot, target });
    assert.ok(files.every((f) => !f.includes('\\')), 'no backslashes in any staged path');
    assert.ok(files.includes('docs/nested/deep.md'), 'nested page staged with POSIX separators');
    const sorted = [...files].sort();
    assert.deepStrictEqual(files, sorted, 'files are sorted');
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('throws rather than staging a partial corpus when README.md, docs/, or assets/ is missing', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-corpus-target-'));
  try {
    const noReadme = makeRepo();
    fs.rmSync(path.join(noReadme, 'README.md'));
    assert.throws(() => stageDocsCorpus({ repoRoot: noReadme, target }));
    assert.deepStrictEqual(fs.readdirSync(target), [], 'nothing staged when README.md is missing');
    fs.rmSync(noReadme, { recursive: true, force: true });

    const noDocs = makeRepo();
    fs.rmSync(path.join(noDocs, 'docs'), { recursive: true, force: true });
    assert.throws(() => stageDocsCorpus({ repoRoot: noDocs, target }));
    fs.rmSync(noDocs, { recursive: true, force: true });

    const noAssets = makeRepo();
    fs.rmSync(path.join(noAssets, 'assets'), { recursive: true, force: true });
    assert.throws(() => stageDocsCorpus({ repoRoot: noAssets, target }));
    fs.rmSync(noAssets, { recursive: true, force: true });
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

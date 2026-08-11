/**
 * Tests for discoverProjects parallelization + per-project isolation.
 *
 * Iter 7 replaced the sequential state.json read loop with Promise.all + a
 * per-project try/catch. These tests cover:
 *   - a single malformed state.json does not poison sibling entries
 *   - result order mirrors readdir's directory-entry order (stable per fs)
 *   - a 50-project fixture completes without error
 *
 * Run with: npx tsx ui/lib/fs-reader-discover-parallel.test.ts
 */
import assert from 'node:assert';
import { mkdtemp, mkdir, writeFile, rm, readdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { discoverProjects } from './fs-reader';

let passed = 0;
let failed = 0;
let tmpDir = '';

function makeV5State(projectName: string): string {
  return JSON.stringify({
    $schema: 'orchestration-state-v5',
    project: {
      name: projectName,
      created: '2026-01-01T00:00:00.000Z',
      updated: '2026-04-19T00:00:00.000Z',
    },
    pipeline: {
      current_tier: 'execution',
      gate_mode: 'autonomous',
      source_control: null,
    },
    graph: {
      status: 'in_progress',
      current_node_path: null,
      nodes: {},
    },
  });
}

async function setupIsolation(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'fs-reader-parallel-'));
  const projectsDir = path.join(dir, '.radorc', 'projects');
  await mkdir(projectsDir, { recursive: true });

  // Interleave good + malformed entries to prove isolation.
  await mkdir(path.join(projectsDir, 'GOOD-1'));
  await writeFile(path.join(projectsDir, 'GOOD-1', 'state.json'), makeV5State('GOOD-1'));

  await mkdir(path.join(projectsDir, 'MALFORMED-1'));
  await writeFile(path.join(projectsDir, 'MALFORMED-1', 'state.json'), 'not json{');

  await mkdir(path.join(projectsDir, 'GOOD-2'));
  await writeFile(path.join(projectsDir, 'GOOD-2', 'state.json'), makeV5State('GOOD-2'));

  await mkdir(path.join(projectsDir, 'NO-STATE'));

  return dir;
}

async function setupLargeFixture(count: number): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'fs-reader-parallel-big-'));
  const projectsDir = path.join(dir, '.radorc', 'projects');
  await mkdir(projectsDir, { recursive: true });
  // Zero-pad to keep readdir's lexical order deterministic for assertions.
  const pad = String(count).length;
  for (let i = 0; i < count; i++) {
    const name = `PROJECT-${String(i).padStart(pad, '0')}`;
    await mkdir(path.join(projectsDir, name));
    await writeFile(path.join(projectsDir, name, 'state.json'), makeV5State(name));
  }
  return dir;
}

async function withFakeHome<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const origHomedir = os.homedir;
  (os as unknown as { homedir: () => string }).homedir = () => dir;
  try {
    return await fn();
  } finally {
    (os as unknown as { homedir: () => string }).homedir = origHomedir;
  }
}

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`  ✗ ${name}\n    ${msg}`);
    failed++;
  }
}

async function run() {
  try {
    console.log('discoverProjects — parallelization + per-project isolation');

    tmpDir = await setupIsolation();

    await test('malformed state.json does not poison sibling entries', async () => {
      const projects = await withFakeHome(tmpDir, () => discoverProjects());
      const byName = new Map(projects.map((p) => [p.name, p]));

      const good1 = byName.get('GOOD-1');
      const good2 = byName.get('GOOD-2');
      const mal = byName.get('MALFORMED-1');
      const none = byName.get('NO-STATE');

      assert.ok(good1, 'GOOD-1 present');
      assert.ok(good2, 'GOOD-2 present');
      assert.ok(mal, 'MALFORMED-1 present');
      assert.ok(none, 'NO-STATE present');

      assert.strictEqual(good1!.hasState, true);
      assert.strictEqual(good1!.hasMalformedState, false);
      assert.strictEqual(good2!.hasState, true);
      assert.strictEqual(good2!.hasMalformedState, false);
      assert.strictEqual(mal!.hasState, true);
      assert.strictEqual(mal!.hasMalformedState, true);
      assert.strictEqual(none!.hasState, false);
      assert.strictEqual(none!.hasMalformedState, false);
    });

    await test('result order matches readdir directory-entry order', async () => {
      // readdir order is filesystem-defined; we compare against readdir's
      // own output to prove the Promise.all traversal is stable.
      const projectsDir = path.join(tmpDir, '.radorc', 'projects');
      const entries = await readdir(projectsDir, { withFileTypes: true });
      const expectedNames = entries
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
      const projects = await withFakeHome(tmpDir, () => discoverProjects());
      const actualNames = projects.map((p) => p.name);
      assert.deepStrictEqual(actualNames, expectedNames);
    });

    await rm(tmpDir, { recursive: true, force: true });
    tmpDir = '';

    tmpDir = await setupLargeFixture(50);

    await test('50-project fixture returns without error', async () => {
      const projects = await withFakeHome(tmpDir, () => discoverProjects());
      assert.strictEqual(projects.length, 50);
      for (const p of projects) {
        assert.strictEqual(p.hasState, true);
        assert.strictEqual(p.hasMalformedState, false);
      }
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed > 0) process.exitCode = 1;
  } finally {
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true });
    }
  }
}

run();

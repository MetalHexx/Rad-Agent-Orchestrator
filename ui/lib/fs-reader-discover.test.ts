/**
 * Tests for discoverProjects lastUpdated behavior.
 * Run with: npx tsx ui/lib/fs-reader-discover.test.ts
 */
import assert from 'node:assert';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { discoverProjects } from './fs-reader';
import { withHomedir } from './test-helpers.js';

let passed = 0;
let failed = 0;
let tmpDir = '';

async function setup(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'fs-reader-discover-test-'));
  const projectsDir = path.join(dir, '.radorc', 'projects');
  await mkdir(projectsDir, { recursive: true });

  // (a) INITIALIZED-PROJECT: valid v5 state.json with project.updated set
  await mkdir(path.join(projectsDir, 'INITIALIZED-PROJECT'));
  await writeFile(
    path.join(projectsDir, 'INITIALIZED-PROJECT', 'state.json'),
    JSON.stringify({
      $schema: 'orchestration-state-v5',
      project: {
        name: 'INITIALIZED-PROJECT',
        created: '2026-01-01T00:00:00.000Z',
        updated: '2026-04-06T12:00:00.000Z',
      },
      config: {
        gate_mode: 'task',
        limits: { max_retries_per_task: 3 },
        source_control: { auto_commit: 'always', auto_pr: 'never' },
      },
      pipeline: {
        gate_mode: 'task',
        source_control: null,
        current_tier: 'execution',
        halt_reason: null,
      },
      graph: {
        template_id: 'extra-high',
        status: 'in_progress',
        current_node_path: null,
        nodes: {},
      },
    })
  );

  // (b) NO-STATE-PROJECT: directory without state.json
  await mkdir(path.join(projectsDir, 'NO-STATE-PROJECT'));

  // (c) MALFORMED-PROJECT: state.json with invalid JSON
  await mkdir(path.join(projectsDir, 'MALFORMED-PROJECT'));
  await writeFile(path.join(projectsDir, 'MALFORMED-PROJECT', 'state.json'), 'not valid json{{{');

  // (d) non-project directories that must never surface as projects
  await mkdir(path.join(projectsDir, '.git'));
  await mkdir(path.join(projectsDir, '_archived'));
  await mkdir(path.join(projectsDir, '_future'));

  return dir;
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
    tmpDir = await setup();
    // withHomedir swaps os.homedir for the duration and restores it in finally (AD-9)
    let projects!: Awaited<ReturnType<typeof discoverProjects>>;
    await withHomedir(tmpDir, async () => {
      projects = await discoverProjects();
    });

    console.log('discoverProjects — lastUpdated behavior');

    await test('(a) initialized project — lastUpdated equals state.project.updated', async () => {
      const p = projects.find(x => x.name === 'INITIALIZED-PROJECT');
      assert.ok(p, 'INITIALIZED-PROJECT should be in results');
      assert.strictEqual(p!.lastUpdated, '2026-04-06T12:00:00.000Z');
    });

    await test('(b) not-initialized project — lastUpdated is undefined', async () => {
      const p = projects.find(x => x.name === 'NO-STATE-PROJECT');
      assert.ok(p, 'NO-STATE-PROJECT should be in results');
      assert.strictEqual(p!.lastUpdated, undefined);
    });

    await test('(c) malformed-state project — lastUpdated is undefined', async () => {
      const p = projects.find(x => x.name === 'MALFORMED-PROJECT');
      assert.ok(p, 'MALFORMED-PROJECT should be in results');
      assert.strictEqual(p!.lastUpdated, undefined);
    });

    // graphStatus assertions
    await test('(a2) v5 initialized project — graphStatus reflects graph.status', async () => {
      const p = projects.find(x => x.name === 'INITIALIZED-PROJECT');
      assert.ok(p, 'INITIALIZED-PROJECT should be in results');
      assert.strictEqual(p!.graphStatus, 'in_progress');
    });

    await test('(b2) no-state project — graphStatus is "not_initialized"', async () => {
      const p = projects.find(x => x.name === 'NO-STATE-PROJECT');
      assert.ok(p, 'NO-STATE-PROJECT should be in results');
      assert.strictEqual(p!.graphStatus, 'not_initialized');
    });

    await test('(c2) malformed-state project — graphStatus is "not_initialized"', async () => {
      const p = projects.find(x => x.name === 'MALFORMED-PROJECT');
      assert.ok(p, 'MALFORMED-PROJECT should be in results');
      assert.strictEqual(p!.graphStatus, 'not_initialized');
    });

    // project-name rule assertions
    await test('(d) non-project directories are excluded from discovery', async () => {
      const names = projects.map(x => x.name);
      assert.ok(!names.includes('.git'), '.git should be excluded');
      assert.ok(!names.includes('_archived'), '_archived should be excluded');
      assert.ok(!names.includes('_future'), '_future should be excluded');
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

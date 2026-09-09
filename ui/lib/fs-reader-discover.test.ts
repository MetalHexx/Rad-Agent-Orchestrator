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

  // (e) LEGACY-COMPLETE-PROJECT: a legacy engine's `current_tier: "complete"`
  // (not one of the current schema's active tiers) on a graph that IS
  // structurally finished — must still resolve to "complete".
  await mkdir(path.join(projectsDir, 'LEGACY-COMPLETE-PROJECT'));
  await writeFile(
    path.join(projectsDir, 'LEGACY-COMPLETE-PROJECT', 'state.json'),
    JSON.stringify({
      $schema: 'orchestration-state-v5',
      project: { name: 'LEGACY-COMPLETE-PROJECT', created: '2026-01-01T00:00:00.000Z', updated: '2026-04-07T00:00:00.000Z' },
      config: { gate_mode: 'task', limits: { max_retries_per_task: 3 }, source_control: { auto_commit: 'always', auto_pr: 'never' } },
      pipeline: { gate_mode: 'task', source_control: null, current_tier: 'complete', halt_reason: null },
      graph: { template_id: 'extra-high', status: 'completed', current_node_path: null, nodes: {} },
    })
  );

  // (f) CURRENT-COMPLETE-PROJECT: a current-engine file that never writes a
  // "complete" tier at all — the graph reaching `completed` is what decides it.
  await mkdir(path.join(projectsDir, 'CURRENT-COMPLETE-PROJECT'));
  await writeFile(
    path.join(projectsDir, 'CURRENT-COMPLETE-PROJECT', 'state.json'),
    JSON.stringify({
      $schema: 'orchestration-state-v6',
      project: { name: 'CURRENT-COMPLETE-PROJECT', created: '2026-01-01T00:00:00.000Z', updated: '2026-04-08T00:00:00.000Z' },
      config: { gate_mode: 'task', limits: { max_retries_per_task: 3 }, source_control: { auto_commit: 'always', auto_pr: 'never' } },
      pipeline: { gate_mode: 'task', source_control: null, current_tier: 'execution', halt_reason: null },
      graph: { template_id: 'extra-high', status: 'completed', current_node_path: null, nodes: {} },
    })
  );

  // (g) HALTED-PROJECT: a currently-halted graph.
  await mkdir(path.join(projectsDir, 'HALTED-PROJECT'));
  await writeFile(
    path.join(projectsDir, 'HALTED-PROJECT', 'state.json'),
    JSON.stringify({
      $schema: 'orchestration-state-v5',
      project: { name: 'HALTED-PROJECT', created: '2026-01-01T00:00:00.000Z', updated: '2026-04-09T00:00:00.000Z' },
      config: { gate_mode: 'task', limits: { max_retries_per_task: 3 }, source_control: { auto_commit: 'always', auto_pr: 'never' } },
      pipeline: { gate_mode: 'task', source_control: null, current_tier: 'halted', halt_reason: 'boom' },
      graph: { template_id: 'extra-high', status: 'halted', current_node_path: null, nodes: {} },
    })
  );

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

    // state / stateLabel fixture set (P02-T01) — legacy-tier finished,
    // current-engine finished, halted, and no-state.json all render the one
    // canonical answer the library derives, never a locally reconstructed word.
    await test('(e) legacy-tier finished project — tier/state "complete", stateLabel "Complete"', async () => {
      const p = projects.find(x => x.name === 'LEGACY-COMPLETE-PROJECT');
      assert.ok(p, 'LEGACY-COMPLETE-PROJECT should be in results');
      assert.strictEqual(p!.tier, 'complete');
      assert.strictEqual(p!.state, 'complete');
      assert.strictEqual(p!.stateLabel, 'Complete');
    });

    await test('(f) current-engine finished project — tier/state "complete", stateLabel "Complete"', async () => {
      const p = projects.find(x => x.name === 'CURRENT-COMPLETE-PROJECT');
      assert.ok(p, 'CURRENT-COMPLETE-PROJECT should be in results');
      assert.strictEqual(p!.tier, 'complete');
      assert.strictEqual(p!.state, 'complete');
      assert.strictEqual(p!.stateLabel, 'Complete');
    });

    await test('(g) halted project — tier/state "halted", stateLabel "Halted"', async () => {
      const p = projects.find(x => x.name === 'HALTED-PROJECT');
      assert.ok(p, 'HALTED-PROJECT should be in results');
      assert.strictEqual(p!.tier, 'halted');
      assert.strictEqual(p!.state, 'halted');
      assert.strictEqual(p!.stateLabel, 'Halted');
    });

    await test('(h) project with no state.json — tier/state "not_initialized", stateLabel "Not Initialized"', async () => {
      const p = projects.find(x => x.name === 'NO-STATE-PROJECT');
      assert.ok(p, 'NO-STATE-PROJECT should be in results');
      assert.strictEqual(p!.tier, 'not_initialized');
      assert.strictEqual(p!.state, 'not_initialized');
      assert.strictEqual(p!.stateLabel, 'Not Initialized');
    });

    await test('(i) malformed-state project — tier/state "not_initialized", stateLabel "Not Initialized"', async () => {
      const p = projects.find(x => x.name === 'MALFORMED-PROJECT');
      assert.ok(p, 'MALFORMED-PROJECT should be in results');
      assert.strictEqual(p!.tier, 'not_initialized');
      assert.strictEqual(p!.state, 'not_initialized');
      assert.strictEqual(p!.stateLabel, 'Not Initialized');
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

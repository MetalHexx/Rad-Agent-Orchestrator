/**
 * Tests for fs-reader v5 state support.
 * Run with: npx tsx ui/lib/fs-reader-v5.test.ts
 */
import assert from 'node:assert';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { discoverProjects, readProjectState } from './fs-reader';
import { withHomedir } from './test-helpers.js';

let passed = 0;
let failed = 0;
let tmpDir = '';

/** Minimal v5 state.json fixture */
function makeV5State(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    $schema: 'orchestration-state-v5',
    project: {
      name: 'v5-project',
      created: '2026-01-01T00:00:00.000Z',
      updated: '2026-04-10T08:00:00.000Z',
    },
    config: {
      gate_mode: 'task',
      limits: {
        max_phases: 10,
        max_tasks_per_phase: 20,
        max_retries_per_task: 3,
      },
      source_control: {
        auto_commit: 'always',
        auto_pr: 'never',
      },
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
      current_node_path: 'phase_loop',
      nodes: {
        research: { kind: 'step', status: 'completed', doc_path: 'reports/RESEARCH.md', retries: 0 },
        prd: { kind: 'step', status: 'completed', doc_path: 'reports/PRD.md', retries: 0 },
        design: { kind: 'step', status: 'completed', doc_path: 'reports/DESIGN.md', retries: 0 },
        architecture: { kind: 'step', status: 'completed', doc_path: 'reports/ARCHITECTURE.md', retries: 0 },
        master_plan: { kind: 'step', status: 'completed', doc_path: 'reports/MASTER-PLAN.md', retries: 0 },
        phase_loop: { kind: 'for_each_phase', status: 'in_progress', iterations: [] },
        final_review: { kind: 'step', status: 'not_started', doc_path: null, retries: 0 },
      },
    },
    ...overrides,
  });
}

async function setup(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'fs-reader-v5-test-'));
  const projectsDir = path.join(dir, '.radorc', 'projects');
  await mkdir(projectsDir, { recursive: true });

  // v5-project: valid v5 state.json (execution tier, in_progress graph)
  await mkdir(path.join(projectsDir, 'v5-project'));
  await writeFile(path.join(projectsDir, 'v5-project', 'state.json'), makeV5State());

  // v5-completed-project: v5 state with graph.status === 'completed'
  await mkdir(path.join(projectsDir, 'v5-completed-project'));
  await writeFile(
    path.join(projectsDir, 'v5-completed-project', 'state.json'),
    makeV5State({
      pipeline: {
        gate_mode: null,
        source_control: null,
        current_tier: 'execution',
        halt_reason: null,
      },
      graph: {
        template_id: 'extra-high',
        status: 'completed',
        current_node_path: null,
        nodes: {
          research: { kind: 'step', status: 'completed', doc_path: 'reports/RESEARCH.md', retries: 0 },
          prd: { kind: 'step', status: 'completed', doc_path: 'reports/PRD.md', retries: 0 },
          design: { kind: 'step', status: 'completed', doc_path: 'reports/DESIGN.md', retries: 0 },
          architecture: { kind: 'step', status: 'completed', doc_path: 'reports/ARCHITECTURE.md', retries: 0 },
          master_plan: { kind: 'step', status: 'completed', doc_path: 'reports/MASTER-PLAN.md', retries: 0 },
          phase_loop: { kind: 'for_each_phase', status: 'completed', iterations: [] },
          final_review: { kind: 'step', status: 'completed', doc_path: 'reports/FINAL-REVIEW.md', retries: 0 },
        },
      },
    })
  );

  // no-state-project: directory without state.json
  await mkdir(path.join(projectsDir, 'no-state-project'));

  // malformed-project: state.json with invalid JSON
  await mkdir(path.join(projectsDir, 'malformed-project'));
  await writeFile(path.join(projectsDir, 'malformed-project', 'state.json'), 'not valid json{{{');

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

    const projectsDir = path.join(tmpDir, '.radorc', 'projects');

    console.log('discoverProjects — v5 state support');

    await test('v5 project — schemaVersion is "v5"', async () => {
      const p = projects.find(x => x.name === 'v5-project');
      assert.ok(p, 'v5-project should be in results');
      assert.strictEqual(p!.schemaVersion, 'v5');
    });

    await test('v5 project — tier mapped from pipeline.current_tier', async () => {
      const p = projects.find(x => x.name === 'v5-project');
      assert.ok(p, 'v5-project should be in results');
      assert.strictEqual(p!.tier, 'execution');
    });

    await test('v5 project — planningStatus derived from graph nodes (all planning nodes completed → "complete")', async () => {
      const p = projects.find(x => x.name === 'v5-project');
      assert.ok(p, 'v5-project should be in results');
      assert.strictEqual(p!.planningStatus, 'complete');
    });

    await test('v5 project — executionStatus derived from graph (phase_loop in_progress → "in_progress")', async () => {
      const p = projects.find(x => x.name === 'v5-project');
      assert.ok(p, 'v5-project should be in results');
      assert.strictEqual(p!.executionStatus, 'in_progress');
    });

    await test('v5 project — lastUpdated from project.updated', async () => {
      const p = projects.find(x => x.name === 'v5-project');
      assert.ok(p, 'v5-project should be in results');
      assert.strictEqual(p!.lastUpdated, '2026-04-10T08:00:00.000Z');
    });

    await test('v5 project — hasState: true, hasMalformedState: false', async () => {
      const p = projects.find(x => x.name === 'v5-project');
      assert.ok(p, 'v5-project should be in results');
      assert.strictEqual(p!.hasState, true);
      assert.strictEqual(p!.hasMalformedState, false);
    });

    await test('v5 completed project — tier is "complete" when graph.status === "completed"', async () => {
      const p = projects.find(x => x.name === 'v5-completed-project');
      assert.ok(p, 'v5-completed-project should be in results');
      assert.strictEqual(p!.tier, 'complete');
    });

    await test('no-state project — hasState: false, schemaVersion undefined (no regression)', async () => {
      const p = projects.find(x => x.name === 'no-state-project');
      assert.ok(p, 'no-state-project should be in results');
      assert.strictEqual(p!.hasState, false);
      assert.strictEqual(p!.schemaVersion, undefined);
    });

    await test('malformed-state project — hasMalformedState: true (no regression)', async () => {
      const p = projects.find(x => x.name === 'malformed-project');
      assert.ok(p, 'malformed-project should be in results');
      assert.strictEqual(p!.hasMalformedState, true);
    });

    // graphStatus assertions
    await test('v5 project — graphStatus equals state.graph.status ("in_progress")', async () => {
      const p = projects.find(x => x.name === 'v5-project');
      assert.ok(p, 'v5-project should be in results');
      assert.strictEqual(p!.graphStatus, 'in_progress');
    });

    await test('v5 completed project — graphStatus equals state.graph.status ("completed")', async () => {
      const p = projects.find(x => x.name === 'v5-completed-project');
      assert.ok(p, 'v5-completed-project should be in results');
      assert.strictEqual(p!.graphStatus, 'completed');
    });

    await test('no-state project — graphStatus is "not_initialized"', async () => {
      const p = projects.find(x => x.name === 'no-state-project');
      assert.ok(p, 'no-state-project should be in results');
      assert.strictEqual(p!.graphStatus, 'not_initialized');
    });

    await test('malformed-state project — graphStatus is "not_initialized"', async () => {
      const p = projects.find(x => x.name === 'malformed-project');
      assert.ok(p, 'malformed-project should be in results');
      assert.strictEqual(p!.graphStatus, 'not_initialized');
    });

    // readProjectState tests
    console.log('\nreadProjectState — v5 state support');

    await test('readProjectState — parses v5 state and returns $schema === "orchestration-state-v5"', async () => {
      const projectDir = path.join(projectsDir, 'v5-project');
      const state = await readProjectState(projectDir);
      assert.ok(state, 'state should not be null');
      assert.strictEqual(state!.$schema, 'orchestration-state-v5');
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

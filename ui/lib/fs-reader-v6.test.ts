/**
 * Tests for fs-reader v6 state support.
 * Run with: cd ui; npm test
 */
import assert from 'node:assert';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { discoverProjects, readProjectState } from './fs-reader';
import { withHomedir } from './test-helpers.js';
import { isV6State } from '@/types/state';

let passed = 0;
let failed = 0;
let tmpDir = '';

/** Minimal v6 state.json fixture — structurally identical to v5 but with $schema = 'orchestration-state-v6' */
function makeV6State(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    $schema: 'orchestration-state-v6',
    project: {
      name: 'v6-project',
      created: '2026-01-01T00:00:00.000Z',
      updated: '2026-05-01T09:00:00.000Z',
    },
    config: {
      gate_mode: 'task',
      limits: {
        max_retries_per_task: 3,
        max_consecutive_review_rejections: 3,
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
  const dir = await mkdtemp(path.join(os.tmpdir(), 'fs-reader-v6-test-'));
  const projectsDir = path.join(dir, '.radorc', 'projects');
  await mkdir(projectsDir, { recursive: true });

  // v6-project: valid v6 state.json (execution tier, in_progress graph)
  await mkdir(path.join(projectsDir, 'v6-project'));
  await writeFile(path.join(projectsDir, 'v6-project', 'state.json'), makeV6State());

  // v6-completed-project: v6 state with graph.status === 'completed'
  await mkdir(path.join(projectsDir, 'v6-completed-project'));
  await writeFile(
    path.join(projectsDir, 'v6-completed-project', 'state.json'),
    makeV6State({
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
    let projects!: Awaited<ReturnType<typeof discoverProjects>>;
    await withHomedir(tmpDir, async () => {
      projects = await discoverProjects();
    });

    const projectsDir = path.join(tmpDir, '.radorc', 'projects');

    // ── discoverProjects — v6 state support ────────────────────────────────
    console.log('discoverProjects — v6 state support');

    await test('v6 state.json is recognized on the current render path (FR-22, AD-8) — schemaVersion is "v6"', async () => {
      const p = projects.find(x => x.name === 'v6-project');
      assert.ok(p, 'v6-project should be in results');
      assert.strictEqual(p!.schemaVersion, 'v6');
    });

    await test('v6 project — tier mapped from pipeline.current_tier (not v4 path)', async () => {
      const p = projects.find(x => x.name === 'v6-project');
      assert.ok(p, 'v6-project should be in results');
      assert.strictEqual(p!.tier, 'execution');
    });

    await test('v6 project — planningStatus derived from graph nodes (all planning nodes completed → "complete")', async () => {
      const p = projects.find(x => x.name === 'v6-project');
      assert.ok(p, 'v6-project should be in results');
      assert.strictEqual(p!.planningStatus, 'complete');
    });

    await test('v6 project — executionStatus derived from graph (phase_loop in_progress → "in_progress")', async () => {
      const p = projects.find(x => x.name === 'v6-project');
      assert.ok(p, 'v6-project should be in results');
      assert.strictEqual(p!.executionStatus, 'in_progress');
    });

    await test('v6 project — graphStatus equals state.graph.status ("in_progress")', async () => {
      const p = projects.find(x => x.name === 'v6-project');
      assert.ok(p, 'v6-project should be in results');
      assert.strictEqual(p!.graphStatus, 'in_progress');
    });

    await test('v6 project — hasState: true, hasMalformedState: false', async () => {
      const p = projects.find(x => x.name === 'v6-project');
      assert.ok(p, 'v6-project should be in results');
      assert.strictEqual(p!.hasState, true);
      assert.strictEqual(p!.hasMalformedState, false);
    });

    await test('v6 completed project — tier is "complete" when graph.status === "completed"', async () => {
      const p = projects.find(x => x.name === 'v6-completed-project');
      assert.ok(p, 'v6-completed-project should be in results');
      assert.strictEqual(p!.tier, 'complete');
    });

    await test('v6 completed project — graphStatus equals state.graph.status ("completed")', async () => {
      const p = projects.find(x => x.name === 'v6-completed-project');
      assert.ok(p, 'v6-completed-project should be in results');
      assert.strictEqual(p!.graphStatus, 'completed');
    });

    // ── readProjectState — v6 state support ───────────────────────────────
    console.log('\nreadProjectState — v6 state support');

    await test('v6 state.json is recognized on the current render path (FR-22, AD-8) — isV6State guard passes', async () => {
      const dir = path.join(projectsDir, 'v6-project');
      const state = await readProjectState(dir);
      assert.ok(state && isV6State(state), 'state should be non-null and pass isV6State guard');
    });

    await test('readProjectState — parses v6 state and returns $schema === "orchestration-state-v6"', async () => {
      const projectDir = path.join(projectsDir, 'v6-project');
      const state = await readProjectState(projectDir);
      assert.ok(state, 'state should not be null');
      assert.strictEqual(state!.$schema, 'orchestration-state-v6');
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

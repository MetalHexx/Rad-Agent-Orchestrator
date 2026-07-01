// cli/tests/behavioral/pipeline/events/optimistic.behavioral.test.ts
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildWorld } from '../helpers/world.js';
import { useRealCatalog } from '../helpers/catalog.js';
import { driveToNode } from '../helpers/drive.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const EXTRA_HIGH_PATH = path.resolve(__dirname, '../../../../../runtime-config/templates/extra-high.yml');
const EXTRA_HIGH_BODY = fs.readFileSync(EXTRA_HIGH_PATH, 'utf8');

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });
beforeEach(() => { cleanups.push(useRealCatalog()); });

type StateNode = {
  status: string;
  iterations?: Array<{ nodes: Record<string, StateNode> }>;
  nodes?: Record<string, StateNode>;
};

type PersistedState = {
  graph: {
    nodes: Record<string, StateNode>;
  };
};

function readPersistedState(projectDir: string): PersistedState {
  return JSON.parse(fs.readFileSync(path.join(projectDir, 'state.json'), 'utf8')) as PersistedState;
}

function mkWorld() {
  const w = buildWorld({
    template: { id: 'extra-high', body: EXTRA_HIGH_BODY },
    state: null,
    config: { default_template: 'extra-high' },
    sideFiles: [],
  });
  cleanups.push(w.cleanup);
  return w;
}

describe('optimistic in_progress at action-return — top-level steps (FR-5)', () => {
  it('master_plan is in_progress after start', async () => {
    const w = mkWorld();
    await driveToNode(w, 'master_plan');
    const s = readPersistedState(w.projectDir);
    expect(s.graph.nodes.master_plan.status).toBe('in_progress');
  });

  it('explode_master_plan is in_progress after master_plan_completed', async () => {
    const w = mkWorld();
    await driveToNode(w, 'explode_master_plan');
    const s = readPersistedState(w.projectDir);
    expect(s.graph.nodes.explode_master_plan.status).toBe('in_progress');
  });

  it('final_review is in_progress after phase_review_completed', async () => {
    const w = mkWorld();
    await driveToNode(w, 'final_review');
    const s = readPersistedState(w.projectDir);
    expect(s.graph.nodes.final_review.status).toBe('in_progress');
  });
});

describe('optimistic in_progress at action-return — loop-internal steps (FR-6)', () => {
  it('task_executor is in_progress inside phase_loop[0].task_loop[0]', async () => {
    const w = mkWorld();
    await driveToNode(w, 'task_executor');
    const s = readPersistedState(w.projectDir);
    expect(s.graph.nodes.phase_loop.iterations[0].nodes.task_loop.iterations[0].nodes.task_executor.status).toBe('in_progress');
  });

  it('code_review is in_progress after task_completed', async () => {
    const w = mkWorld();
    await driveToNode(w, 'code_review');
    const s = readPersistedState(w.projectDir);
    const taskIter = s.graph.nodes.phase_loop.iterations[0].nodes.task_loop.iterations[0];
    expect(taskIter.nodes.code_review.status).toBe('in_progress');
  });

  it('phase_review is in_progress after code_review_completed', async () => {
    const w = mkWorld();
    await driveToNode(w, 'phase_review');
    const s = readPersistedState(w.projectDir);
    expect(s.graph.nodes.phase_loop.iterations[0].nodes.phase_review.status).toBe('in_progress');
  });

  it('final_pr is in_progress when auto_pr is enabled', async () => {
    const w = mkWorld();
    await driveToNode(w, 'final_pr');
    const s = readPersistedState(w.projectDir);
    // final_pr lives inside the pr_gate conditional's true branch, scaffolded
    // at the top level under nodes.final_pr when the branch is taken.
    expect(s.graph.nodes.final_pr.status).toBe('in_progress');
  });
});

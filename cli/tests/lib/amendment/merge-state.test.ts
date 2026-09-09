import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { deriveProjectState } from '@rad-orchestration/work-graph';
import { parseMasterPlan } from '../../../src/lib/explode-master-plan.js';
import { computeFrontier } from '../../../src/lib/amendment/frontier.js';
import { buildMergePlan } from '../../../src/lib/amendment/merge-check.js';
import { mergeAmendmentIntoPlan } from '../../../src/lib/amendment/merge-plan.js';
import { mergeAmendmentIntoState } from '../../../src/lib/amendment/merge-state.js';
import type { AmendableState } from '../../../src/lib/amendment/merge-state.js';
import type { StagedWrite } from '../../../src/lib/amendment/merge-plan.js';
import type { AmendmentMergePlan } from '../../../src/lib/amendment/merge-check.js';
import {
  ADDS_A_TASK,
  ALL_PHASES_DONE,
  APPENDS_A_PHASE,
  INSERTS_A_PHASE,
  MID_PHASE,
  NOW,
  REVISES_A_TASK,
  amendmentDoc,
  graphNode,
  makeProject,
  phaseIterations,
  taskBlock,
  taskIterations,
} from '../../helpers/amendment-fixture.js';
import type { Fixture, FixtureOptions, PhaseProfile } from '../../helpers/amendment-fixture.js';

type Json = Record<string, unknown>;

interface Merge {
  before: AmendableState;
  after: AmendableState;
  plan: AmendmentMergePlan;
  writes: StagedWrite[];
  projectDir: string;
}

/**
 * Run both halves of the merge over a state and an amendment, with nothing
 * committed: the plan writer's staged writes stay in memory and the state writer's
 * output is returned. `apply` composes exactly this pair before it touches the disk.
 *
 * The Master Plan is re-read from the fixture's path on every call, so a caller
 * chaining a second amendment lands the first one's staged plan text there first.
 */
function mergeOnce(fixture: Fixture, state: AmendableState, amendmentPath: string): Omit<Merge, 'before'> {
  const existing = parseMasterPlan(fixture.masterPlanPath);
  const amendment = parseMasterPlan(amendmentPath);
  const frontier = computeFrontier(state, existing);

  const outcome = buildMergePlan({ existing, amendment, frontier, state });
  if (outcome.type !== 'ok') throw new Error(`fixture produced a non-ok merge outcome: ${JSON.stringify(outcome)}`);

  const planMerge = mergeAmendmentIntoPlan({
    projectDir: fixture.projectDir,
    projectName: fixture.projectName,
    masterPlanPath: fixture.masterPlanPath,
    requirementsPath: fixture.requirementsPath,
    masterPlanRaw: fixture.masterPlan(),
    existing,
    amendment,
    amendmentDocFileName: path.basename(amendmentPath),
    mergePlan: outcome.plan,
    frontier,
    nowIso: NOW,
  });

  const after = mergeAmendmentIntoState({
    state,
    existing,
    merged: planMerge.merged,
    mergePlan: outcome.plan,
    projectDir: fixture.projectDir,
    projectName: fixture.projectName,
    amendmentDocPath: path.basename(amendmentPath),
    nowIso: NOW,
  });

  return { after, plan: outcome.plan, writes: planMerge.writes, projectDir: fixture.projectDir };
}

/** The same run against a freshly built project, with its pre-merge state alongside. */
function merge(opts: FixtureOptions): Merge {
  const fixture = makeProject(opts);
  const before = fixture.state() as AmendableState;
  const merged = mergeOnce(fixture, fixture.state() as AmendableState, fixture.amendmentPath);
  return { before, ...merged };
}

/** Every iteration in the state, phases and tasks alike. */
function everyIteration(state: AmendableState): Json[] {
  const all: Json[] = [];
  for (const phase of phaseIterations(state as unknown as Json)) {
    all.push(phase);
    for (const task of taskIterations(phase)) all.push(task);
  }
  return all;
}

/** The final-scope halt an amendment exists to clear. */
const HALTED_AT_FINAL_SCOPE: FixtureOptions = {
  phases: ALL_PHASES_DONE,
  phaseLoop: 'completed',
  graphStatus: 'halted',
  currentTier: 'halted',
  haltReason: 'Final review rejected: reviewer issued a rejected verdict.',
  finalReview: {
    status: 'halted',
    doc_path: 'reviews/DEMO-FINAL-REVIEW.md',
    verdict: 'rejected',
    corrective_tasks: [
      {
        index: 1,
        reason: 'Final review requested changes',
        injected_after: 'final_review',
        status: 'completed',
        nodes: {},
        repos: [{ name: 'alpha', commit_hash: null }],
      },
    ],
    corrective_budget_origin: 0,
  },
  amendment: APPENDS_A_PHASE,
};

// ── Placement ────────────────────────────────────────────────────────────────

describe('mergeAmendmentIntoState — placing new work', () => {
  it('appends the amendment-born phase and its tasks at the merged slot', () => {
    const { after } = merge({ phases: MID_PHASE, amendment: APPENDS_A_PHASE });
    const iterations = phaseIterations(after as unknown as Json);
    expect(iterations).toHaveLength(4);

    const added = iterations[3]!;
    expect(added['status']).toBe('not_started');
    expect(added['index']).toBe(3);
    expect(taskIterations(added).map(task => task['index'])).toEqual([0, 1]);
    expect(taskIterations(added).map(task => task['status'])).toEqual(['not_started', 'not_started']);
  });

  it('splices a new task in beside the running phase’s finished one', () => {
    const { before, after } = merge({ phases: MID_PHASE, amendment: ADDS_A_TASK });
    const running = phaseIterations(after as unknown as Json)[1]!;
    const tasks = taskIterations(running);

    expect(tasks).toHaveLength(2);
    expect(JSON.stringify(tasks[0])).toBe(JSON.stringify(taskIterations(phaseIterations(before as unknown as Json)[1]!)[0]));
    expect(tasks[1]!['status']).toBe('not_started');
    expect(tasks[1]!['index']).toBe(1);
  });

  it('moves a displaced iteration to its new slot without rewriting anything else about it', () => {
    const { before, after } = merge({
      phases: MID_PHASE,
      currentNodePath: 'phase_loop[1].task_loop[0].task_executor',
      amendment: INSERTS_A_PHASE,
    });
    const displaced = phaseIterations(after as unknown as Json)[2]!;
    const source = phaseIterations(before as unknown as Json)[1]!;

    expect(displaced['index']).toBe(2);
    expect({ ...displaced, index: source['index'] }).toEqual(source);
    // The cursor was inside that iteration, so it follows it to the new index.
    expect(after.graph.current_node_path).toBe('phase_loop[2].task_loop[0].task_executor');
  });

  it('stamps the amendment index on everything it introduced and on nothing else', () => {
    const { after, plan } = merge({ phases: MID_PHASE, amendment: APPENDS_A_PHASE });
    const stamped = everyIteration(after).filter(entry => entry['amendment'] !== undefined);
    expect(stamped).toHaveLength(plan.addsPhases.length + plan.addsTasks.length);
    for (const entry of stamped) expect(entry['amendment']).toBe(plan.amendmentIndex);
  });

  it('points every new iteration at a document the transaction actually writes', () => {
    const { after, projectDir, writes } = merge({ phases: MID_PHASE, amendment: APPENDS_A_PHASE });
    const staged = new Set(writes.map(write => write.path));
    const introduced = everyIteration(after).filter(entry => entry['amendment'] !== undefined);

    expect(introduced.length).toBeGreaterThan(0);
    for (const entry of introduced) {
      expect(staged.has(path.join(projectDir, String(entry['doc_path'])))).toBe(true);
    }
  });
});

// ── The reopen cascade ───────────────────────────────────────────────────────

describe('mergeAmendmentIntoState — reopening the downstream', () => {
  const { before, after, plan } = merge({ phases: MID_PHASE, amendment: ADDS_A_TASK });
  const state = after as unknown as Json;

  it('reopens the amended running phase’s task loop, review and gate', () => {
    const running = phaseIterations(state)[1]!;
    const nodes = running['nodes'] as Json;
    expect((nodes['task_loop'] as Json)['status']).toBe('in_progress');
    expect((nodes['phase_review'] as Json)['status']).toBe('not_started');
    expect((nodes['phase_gate'] as Json)['status']).toBe('not_started');
    expect((nodes['phase_gate'] as Json)['gate_active']).toBe(false);
  });

  it('leaves a finished phase’s own review and gate alone', () => {
    const finished = phaseIterations(state)[0]!;
    const before2 = phaseIterations(before as unknown as Json)[0]!;
    expect(JSON.stringify(finished)).toBe(JSON.stringify(before2));
  });

  it('resets every top-level node the cascade names', () => {
    for (const id of plan.reopens) {
      const node = graphNode(state, id);
      if (node === undefined || id === 'phase_loop') continue;
      expect(node['status']).toBe('not_started');
      if (node['kind'] === 'gate') expect(node['gate_active']).toBe(false);
    }
    expect(plan.reopens).toContain('final_review');
    expect(plan.reopens).toContain('final_approval_gate');
  });

  it('clears the final review’s judgement while keeping its corrective history', () => {
    const merged = merge(HALTED_AT_FINAL_SCOPE);
    const finalReview = graphNode(merged.after as unknown as Json, 'final_review')!;
    const history = (graphNode(merged.before as unknown as Json, 'final_review')!['corrective_tasks'] as unknown[]);

    expect(finalReview['doc_path']).toBeNull();
    expect(finalReview['verdict']).toBeNull();
    expect(finalReview['corrective_tasks']).toEqual(history);
    expect(finalReview['corrective_budget_origin']).toBe(history.length);
  });

  it('clears the cursor to null when the finished loop is reopened', () => {
    const reopened = merge({
      phases: ALL_PHASES_DONE,
      phaseLoop: 'completed',
      currentNodePath: 'phase_loop[2].task_loop[0].task_executor',
      amendment: APPENDS_A_PHASE,
    });
    expect(reopened.after.graph.current_node_path).toBeNull();
    expect(reopened.after.graph.current_node_path).not.toBe(reopened.before.graph.current_node_path);
  });

  it('clears the cursor to null when a running phase’s task loop is reopened', () => {
    const reopened = merge({
      phases: MID_PHASE,
      currentNodePath: 'phase_loop[1].task_loop[0].task_executor',
      amendment: ADDS_A_TASK,
    });
    expect(reopened.after.graph.current_node_path).toBeNull();
    expect(reopened.after.graph.current_node_path).not.toBe(reopened.before.graph.current_node_path);
  });

  it('leaves a running phase the amendment never touched exactly as it was', () => {
    const appended = merge({ phases: MID_PHASE, amendment: APPENDS_A_PHASE });
    const running = phaseIterations(appended.after as unknown as Json)[1]!;
    expect(JSON.stringify(running)).toBe(JSON.stringify(phaseIterations(appended.before as unknown as Json)[1]));
  });
});

describe('mergeAmendmentIntoState — a tier that declares almost none of those nodes', () => {
  const { after, plan } = merge({ tier: 'low', phases: MID_PHASE, amendment: ADDS_A_TASK });
  const state = after as unknown as Json;

  it('names no phase review or gate in the cascade it was handed', () => {
    expect(plan.reopens).not.toContain('phase_review');
    expect(plan.reopens).not.toContain('phase_gate');
  });

  it('still reopens the running phase’s task loop and every final node', () => {
    const running = phaseIterations(state)[1]!;
    expect(((running['nodes'] as Json)['task_loop'] as Json)['status']).toBe('in_progress');
    expect(graphNode(state, 'final_review')!['status']).toBe('not_started');
    expect(graphNode(state, 'final_approval_gate')!['status']).toBe('not_started');
  });

  it('adds no node the template never declared', () => {
    const running = phaseIterations(state)[1]!;
    expect(Object.keys(running['nodes'] as Json)).toEqual(['task_loop']);
  });
});

// ── A cursor the amendment never invalidated ─────────────────────────────────

/**
 * A plan whose running phase carries two tasks, so a fixture can put the cursor
 * inside one that is genuinely still in flight. The shared MASTER_PLAN's running
 * phase holds a single finished task, which can only express the reset case.
 */
const WORK_IN_FLIGHT_PLAN = [
  '---',
  'project: DEMO',
  'type: master_plan',
  'status: approved',
  'created: "2026-08-01"',
  'repos: [alpha, beta]',
  'total_phases: 2',
  'total_tasks: 3',
  '---',
  '',
  '# DEMO — Master Plan',
  '',
  '## Introduction',
  '',
  'A plan whose running phase still has work in flight.',
  '',
  '## P01: First',
  '',
  '**Intent**',
  'The foundation exists.',
  '',
  '### P01-T01: Lay the foundation',
  '',
  'Lay the foundation.',
  '',
  '**Task type:** code',
  '**Complexity:** standard',
  '**Target repo:** alpha',
  '',
  '## P02: Second',
  '',
  '**Intent**',
  'The reader is served.',
  '',
  '### P02-T01: Serve the reader',
  '',
  'Serve the reader.',
  '',
  '**Task type:** code',
  '**Complexity:** standard',
  '**Target repo:** beta',
  '',
  '### P02-T02: Audit the reader',
  '',
  'Audit the reader.',
  '',
  '**Task type:** code',
  '**Complexity:** standard',
  '**Target repo:** beta',
  '',
].join('\n');

/** P01 done; P02 running with its first task finished and its second still running. */
const WORK_IN_FLIGHT: PhaseProfile[] = [
  { status: 'completed', tasks: ['completed'], review: 'completed' },
  { status: 'in_progress', tasks: ['completed', 'in_progress'], review: 'not_started' },
];

/** Where the run actually is: inside the running phase's second, unfinished task. */
const CURSOR_IN_FLIGHT = 'phase_loop[1].task_loop[1].task_executor';

/** A third task appended to the running phase — it displaces nothing. */
const APPENDS_A_TASK = amendmentDoc({
  index: 1,
  addsTasks: ['P02-T03'],
  blocks: ['## P02: Second', '', ...taskBlock('P02-T03', 'Publish the audit', 'beta')],
});

/** A task inserted ahead of the running one, renumbering it without resetting it. */
const INSERTS_A_TASK = amendmentDoc({
  index: 1,
  addsTasks: ['P02-T02'],
  blocks: ['## P02: Second', '', ...taskBlock('P02-T02', 'Stage the audit', 'beta')],
});

describe('mergeAmendmentIntoState — a cursor sitting on work in flight', () => {
  it('leaves the cursor exactly as it was handed it when nothing was reset', () => {
    const { before, after } = merge({
      masterPlan: WORK_IN_FLIGHT_PLAN,
      phases: WORK_IN_FLIGHT,
      currentNodePath: CURSOR_IN_FLIGHT,
      amendment: APPENDS_A_TASK,
    });

    const running = phaseIterations(after as unknown as Json)[1]!;
    expect(taskIterations(running)).toHaveLength(3);
    expect(after.graph.current_node_path).toBe(before.graph.current_node_path);
  });

  it('follows the in-flight task to the slot an insertion ahead of it moved it to', () => {
    const { after } = merge({
      masterPlan: WORK_IN_FLIGHT_PLAN,
      phases: WORK_IN_FLIGHT,
      currentNodePath: CURSOR_IN_FLIGHT,
      amendment: INSERTS_A_TASK,
    });

    const tasks = taskIterations(phaseIterations(after as unknown as Json)[1]!);
    expect(tasks[1]!['status']).toBe('not_started');
    expect(tasks[2]!['status']).toBe('in_progress');
    expect(after.graph.current_node_path).toBe('phase_loop[1].task_loop[2].task_executor');
  });
});

// ── Halt clearing and reopening a finished project ───────────────────────────

describe('mergeAmendmentIntoState — a project halted on the final review', () => {
  const { after } = merge(HALTED_AT_FINAL_SCOPE);
  const state = after as unknown as Json;

  it('restores a running shape across all four halt fields', () => {
    expect((state['graph'] as Json)['status']).toBe('in_progress');
    expect((state['pipeline'] as Json)['halt_reason']).toBeNull();
    expect((state['pipeline'] as Json)['current_tier']).toBe('execution');
    expect(graphNode(state, 'final_review')!['status']).toBe('not_started');
  });

  it('derives as executing through the ordinary derivation', () => {
    expect(deriveProjectState(state).state).toBe('executing');
  });
});

describe('mergeAmendmentIntoState — a project parked at the final gate', () => {
  const { after } = merge({
    phases: ALL_PHASES_DONE,
    phaseLoop: 'completed',
    currentTier: 'review',
    finalReview: { status: 'completed', verdict: 'approved', doc_path: 'reviews/DEMO-FINAL-REVIEW.md' },
    finalApprovalGate: { status: 'in_progress', gate_active: true },
    amendment: APPENDS_A_PHASE,
  });
  const state = after as unknown as Json;

  it('stands the waiting gate down so it does not approve work that no longer exists', () => {
    expect(graphNode(state, 'final_approval_gate')).toMatchObject({ status: 'not_started', gate_active: false });
  });

  it('sends the run back into the phase loop', () => {
    expect(graphNode(state, 'phase_loop')!['status']).toBe('in_progress');
    expect(deriveProjectState(state).state).toBe('executing');
  });
});

describe('mergeAmendmentIntoState — a project that had finished', () => {
  const { after } = merge({
    phases: ALL_PHASES_DONE,
    phaseLoop: 'completed',
    graphStatus: 'completed',
    currentTier: 'review',
    finalReview: { status: 'completed', verdict: 'approved', doc_path: 'reviews/DEMO-FINAL-REVIEW.md' },
    prGate: { status: 'completed', branch_taken: 'true' },
    finalPr: { status: 'completed' },
    finalApprovalGate: { status: 'completed', gate_active: false },
    amendment: APPENDS_A_PHASE,
  });
  const state = after as unknown as Json;

  it('reopens the phase loop the walker had closed', () => {
    expect(graphNode(state, 'phase_loop')!['status']).toBe('in_progress');
  });

  it('resets the pull-request nodes so the existing PR is edited rather than re-opened', () => {
    expect(graphNode(state, 'pr_gate')!['status']).toBe('not_started');
    expect(graphNode(state, 'final_pr')!['status']).toBe('not_started');
  });

  it('derives as executing again rather than staying complete', () => {
    expect(deriveProjectState(state).state).toBe('executing');
  });
});

// ── The record ───────────────────────────────────────────────────────────────

describe('mergeAmendmentIntoState — the project record', () => {
  it('records what the amendment added, and stamps the write', () => {
    const { after, plan } = merge({ phases: MID_PHASE, amendment: APPENDS_A_PHASE });
    const project = (after as unknown as Json)['project'] as Json;
    const amendments = project['amendments'] as Json[];

    expect(amendments).toHaveLength(1);
    expect(amendments[0]).toEqual({
      index: plan.amendmentIndex,
      doc_path: 'DEMO-AMENDMENT-01.md',
      applied: NOW,
      adds_phases: plan.addsPhases.map(phase => phase.id),
      adds_tasks: plan.addsTasks.map(task => task.id),
      revises_tasks: [],
      drops_tasks: [],
      drops_phases: [],
    });
    expect(project['updated']).toBe(NOW);
  });

  it('records the revise and drop lists alongside the add lists', () => {
    const { after, plan } = merge({ phases: P01_DONE_REST_UNSTARTED, amendment: REVISES_AND_DROPS });
    const project = (after as unknown as Json)['project'] as Json;
    const amendments = project['amendments'] as Json[];

    expect(amendments[0]).toEqual({
      index: plan.amendmentIndex,
      doc_path: 'DEMO-AMENDMENT-01.md',
      applied: NOW,
      adds_phases: [],
      adds_tasks: [],
      revises_tasks: plan.revisesTasks.map(task => task.id),
      drops_tasks: plan.dropsTasks,
      drops_phases: plan.dropsPhases,
    });
  });

  it('leaves the state it was handed untouched', () => {
    const { before } = merge({ phases: MID_PHASE, amendment: APPENDS_A_PHASE });
    expect((before as unknown as Json)['project']).not.toHaveProperty('amendments');
    expect(phaseIterations(before as unknown as Json)).toHaveLength(3);
  });
});

// ── Revise and drop ──────────────────────────────────────────────────────────

/** Drops the running phase's in-flight second task, without emptying the phase. */
const DROPS_A_TASK = amendmentDoc({
  index: 1,
  addsTasks: [],
  dropsTasks: ['P02-T02'],
  blocks: ['## P02: Second', ''],
});

/** Drops the sole not-started phase's only task, which empties the phase too. */
const DROPS_A_PHASE = amendmentDoc({
  index: 1,
  addsTasks: [],
  dropsTasks: ['P03-T01'],
  dropsPhases: ['P03'],
  blocks: ['## P03: Third', ''],
});

/** Revises the running phase's in-flight second task — legal since it carries no commit. */
const REVISES_THE_IN_FLIGHT_TASK = amendmentDoc({
  index: 1,
  addsTasks: [],
  revisesTasks: ['P02-T02'],
  blocks: ['## P02: Second', '', ...taskBlock('P02-T02', 'Audit the reader thoroughly', 'beta')],
});

/** P01 done, P02 and P03 both untouched — a floor every revise or drop below stays legal against. */
const P01_DONE_REST_UNSTARTED: PhaseProfile[] = [
  { status: 'completed', tasks: ['completed', 'completed'], review: 'completed' },
  { status: 'not_started', tasks: ['not_started'], review: 'not_started' },
  { status: 'not_started', tasks: ['not_started'], review: 'not_started' },
];

/** Revises P02's task in place and drops P03 entirely, in the same amendment. */
const REVISES_AND_DROPS = amendmentDoc({
  index: 1,
  addsTasks: [],
  revisesTasks: ['P02-T01'],
  dropsTasks: ['P03-T01'],
  dropsPhases: ['P03'],
  blocks: ['## P02: Second', '', ...taskBlock('P02-T01', 'Serve the reader, revised', 'beta')],
});

describe('mergeAmendmentIntoState — dropping work', () => {
  it('removes a dropped task without disturbing the phase it leaves behind', () => {
    const { after } = merge({
      masterPlan: WORK_IN_FLIGHT_PLAN,
      phases: WORK_IN_FLIGHT,
      amendment: DROPS_A_TASK,
    });
    const running = phaseIterations(after as unknown as Json)[1]!;
    const tasks = taskIterations(running);

    expect(tasks).toHaveLength(1);
    expect(tasks[0]!['index']).toBe(0);
    expect(tasks[0]!['status']).toBe('completed');
  });

  it('removes a dropped phase entirely and reindexes the survivors contiguously from 0', () => {
    const { after } = merge({ phases: MID_PHASE, amendment: DROPS_A_PHASE });
    const iterations = phaseIterations(after as unknown as Json);

    expect(iterations).toHaveLength(2);
    expect(iterations.map(iteration => iteration['index'])).toEqual([0, 1]);
  });

  it('drops an in-progress, uncommitted task without refusing the apply', () => {
    const { plan } = merge({
      masterPlan: WORK_IN_FLIGHT_PLAN,
      phases: WORK_IN_FLIGHT,
      amendment: DROPS_A_TASK,
    });
    expect(plan.dropsTasks).toEqual(['P02-T02']);
  });
});

describe('mergeAmendmentIntoState — revising a task in place', () => {
  it('resets a revised task back to unrun without losing its identity', () => {
    const { before, after } = merge({
      masterPlan: WORK_IN_FLIGHT_PLAN,
      phases: WORK_IN_FLIGHT,
      amendment: REVISES_THE_IN_FLIGHT_TASK,
    });
    const beforeTask = taskIterations(phaseIterations(before as unknown as Json)[1]!)[1]!;
    const afterTask = taskIterations(phaseIterations(after as unknown as Json)[1]!)[1]!;

    expect(beforeTask['status']).toBe('in_progress');
    expect(afterTask['status']).toBe('not_started');
    expect((afterTask['nodes'] as Json)['task_executor']).toMatchObject({ status: 'not_started' });
    expect(afterTask['doc_path']).toBe(beforeTask['doc_path']);
    expect(afterTask['repos']).toEqual(beforeTask['repos']);
  });

  it('keeps a revised task’s own origin amendment marker, not the reviser’s index', () => {
    const fixture = makeProject({
      masterPlan: WORK_IN_FLIGHT_PLAN,
      phases: WORK_IN_FLIGHT,
      amendment: REVISES_THE_IN_FLIGHT_TASK,
    });
    const state = fixture.state() as AmendableState;
    // Pretend an earlier amendment introduced this task, before this one revises it.
    (taskIterations(phaseIterations(state as unknown as Json)[1]!)[1]! as Json)['amendment'] = 1;

    const existing = parseMasterPlan(fixture.masterPlanPath);
    const amendment = parseMasterPlan(fixture.amendmentPath);
    const frontier = computeFrontier(state, existing);
    const outcome = buildMergePlan({ existing, amendment, frontier, state });
    if (outcome.type !== 'ok') throw new Error(`fixture produced a non-ok merge outcome: ${JSON.stringify(outcome)}`);

    const planMerge = mergeAmendmentIntoPlan({
      projectDir: fixture.projectDir,
      projectName: fixture.projectName,
      masterPlanPath: fixture.masterPlanPath,
      requirementsPath: fixture.requirementsPath,
      masterPlanRaw: fixture.masterPlan(),
      existing,
      amendment,
      amendmentDocFileName: path.basename(fixture.amendmentPath),
      mergePlan: outcome.plan,
      frontier,
      nowIso: NOW,
    });

    const after = mergeAmendmentIntoState({
      state,
      existing,
      merged: planMerge.merged,
      mergePlan: outcome.plan,
      projectDir: fixture.projectDir,
      projectName: fixture.projectName,
      amendmentDocPath: path.basename(fixture.amendmentPath),
      nowIso: NOW,
    });

    const afterTask = taskIterations(phaseIterations(after as unknown as Json)[1]!)[1]!;
    expect(afterTask['amendment']).toBe(1);
  });
});

describe('mergeAmendmentIntoState — a completed iteration elsewhere in a revise-and-drop amendment', () => {
  it('leaves a completed phase and its completed tasks byte-identical', () => {
    const { before, after } = merge({ phases: P01_DONE_REST_UNSTARTED, amendment: REVISES_AND_DROPS });
    const beforePhase = phaseIterations(before as unknown as Json)[0]!;
    const afterPhase = phaseIterations(after as unknown as Json)[0]!;

    expect(JSON.stringify(afterPhase)).toBe(JSON.stringify(beforePhase));
  });
});

describe('mergeAmendmentIntoState — a revise or a drop alone invalidates the cursor', () => {
  it('clears the cursor to null on a revise alone, even though nothing was structurally displaced', () => {
    const reopened = merge({
      phases: MID_PHASE,
      currentNodePath: 'phase_loop[1].task_loop[0].task_executor',
      amendment: REVISES_A_TASK,
    });
    expect(reopened.after.graph.current_node_path).toBeNull();
    expect(reopened.after.graph.current_node_path).not.toBe(reopened.before.graph.current_node_path);
  });

  it('clears the cursor to null on a drop alone, even though nothing was structurally displaced', () => {
    const reopened = merge({
      phases: MID_PHASE,
      currentNodePath: 'phase_loop[1].task_loop[0].task_executor',
      amendment: DROPS_A_PHASE,
    });
    expect(reopened.after.graph.current_node_path).toBeNull();
    expect(reopened.after.graph.current_node_path).not.toBe(reopened.before.graph.current_node_path);
  });

  it('never leaves a bare REOPEN_CASCADE node id as the cursor when the cursor is invalidated', () => {
    const cascadeIds = new Set(['phase_loop', 'phase_review', 'phase_gate', 'final_review', 'pr_gate', 'final_pr', 'final_approval_gate']);
    const cases = [
      merge({
        phases: MID_PHASE,
        currentNodePath: 'phase_loop[1].task_loop[0].task_executor',
        amendment: REVISES_A_TASK,
      }),
      merge({
        phases: MID_PHASE,
        currentNodePath: 'phase_loop[1].task_loop[0].task_executor',
        amendment: DROPS_A_PHASE,
      }),
      merge({
        phases: ALL_PHASES_DONE,
        phaseLoop: 'completed',
        currentNodePath: 'phase_loop[2].task_loop[0].task_executor',
        amendment: APPENDS_A_PHASE,
      }),
    ];

    for (const { after } of cases) {
      const cursor = after.graph.current_node_path;
      expect(typeof cursor === 'string' && cascadeIds.has(cursor)).toBe(false);
    }
  });
});

// ── A plan numbered continuously across its phases ───────────────────────────

/** Three phases holding three, two and two tasks, by the titles at each position. */
const NUMBERING_PHASES = [
  { id: 'P01', title: 'First', repo: 'alpha', tasks: ['Lay the foundation', 'Wire the seam', 'Prove the seam'] },
  { id: 'P02', title: 'Second', repo: 'beta', tasks: ['Serve the reader', 'Audit the reader'] },
  { id: 'P03', title: 'Third', repo: 'beta', tasks: ['Close the loop', 'Publish the loop'] },
];

/**
 * The same plan under either numbering: task numbers restarting at T01 in every
 * phase, or running straight through them — P01 holding T01–T03, P02 T04–T05 and
 * P03 T06–T07.
 */
function numberedPlan(continuous: boolean): string {
  let across = 0;
  const totalTasks = NUMBERING_PHASES.reduce((count, phase) => count + phase.tasks.length, 0);
  return [
    '---',
    'project: DEMO',
    'type: master_plan',
    'status: approved',
    'created: "2026-08-01"',
    'repos: [alpha, beta]',
    `total_phases: ${NUMBERING_PHASES.length}`,
    `total_tasks: ${totalTasks}`,
    '---',
    '',
    '# DEMO — Master Plan',
    '',
    '## Introduction',
    '',
    'A plan whose task numbering is the whole subject.',
    '',
    ...NUMBERING_PHASES.flatMap(phase => [
      `## ${phase.id}: ${phase.title}`,
      '',
      '**Intent**',
      `${phase.title} is delivered.`,
      '',
      ...phase.tasks.flatMap((title, position) => {
        across += 1;
        const number = String(continuous ? across : position + 1).padStart(2, '0');
        return taskBlock(`${phase.id}-T${number}`, title, phase.repo);
      }),
    ]),
  ].join('\n');
}

/** P01 done; P02 running with one task finished and one in flight; P03 untouched. */
const CONTINUOUS_PROFILE: PhaseProfile[] = [
  { status: 'completed', tasks: ['completed', 'completed', 'completed'], review: 'completed' },
  { status: 'in_progress', tasks: ['completed', 'in_progress'], review: 'not_started' },
  { status: 'not_started', tasks: ['not_started', 'not_started'], review: 'not_started' },
];

/**
 * A project whose state was seeded before the numbering guard existed: explosion
 * ran against the restarting form, and the plan on disk is the continuous one.
 */
const CONTINUOUSLY_NUMBERED: FixtureOptions = {
  masterPlan: numberedPlan(false),
  masterPlanAfterExplode: numberedPlan(true),
  phases: CONTINUOUS_PROFILE,
};

// An amendment names an EXISTING task by the id the plan gives it, and a NEW one by
// the position it is to take in the merged phase — which the merge always numbers
// from T01. So the declarations below revise P02-T05 and drop P03-T06 while adding
// P02-T03 and P03-T01.

/** Appends a task to the running phase, which the plan numbers P02-T04 and P02-T05. */
const APPENDS_BESIDE_CONTINUOUS_TASKS = amendmentDoc({
  index: 1,
  addsTasks: ['P02-T03'],
  blocks: ['## P02: Second', '', ...taskBlock('P02-T03', 'Publish the audit', 'beta')],
});

/** Revises the running phase's in-flight task, which the plan numbers P02-T05. */
const REVISES_A_CONTINUOUS_TASK = amendmentDoc({
  index: 1,
  addsTasks: [],
  revisesTasks: ['P02-T05'],
  blocks: ['## P02: Second', '', ...taskBlock('P02-T05', 'Audit the reader thoroughly', 'beta')],
});

/** Drops the first of the untouched phase's two tasks, which the plan numbers P03-T06. */
const DROPS_A_CONTINUOUS_TASK = amendmentDoc({
  index: 1,
  addsTasks: [],
  dropsTasks: ['P03-T06'],
  blocks: ['## P03: Third', ''],
});

/** Inserts a task ahead of P03-T06, displacing both of that phase's tasks. */
const INSERTS_BEFORE_A_CONTINUOUS_TASK = amendmentDoc({
  index: 1,
  addsTasks: ['P03-T01'],
  blocks: ['## P03: Third', '', ...taskBlock('P03-T01', 'Stage the close', 'beta')],
});

/**
 * Inserts a task ahead of the running phase's in-flight one (P02-T05), which the
 * merge always numbers from T01 in the merged phase — so the new task lands at
 * the in-flight task's own position, pushing it one slot down.
 */
const INSERTS_BEFORE_THE_INFLIGHT_CONTINUOUS_TASK = amendmentDoc({
  index: 1,
  addsTasks: ['P02-T02'],
  blocks: ['## P02: Second', '', ...taskBlock('P02-T02', 'Stage the audit', 'beta')],
});

/** The second amendment's target: P02-T05 as the first merge renumbered it. */
const REVISES_THE_RENUMBERED_TASK = amendmentDoc({
  index: 2,
  addsTasks: [],
  revisesTasks: ['P02-T02'],
  blocks: ['## P02: Second', '', ...taskBlock('P02-T02', 'Audit the reader thoroughly', 'beta')],
});

describe('mergeAmendmentIntoState — a plan numbered continuously across its phases', () => {
  it('appends a task beside the phase’s continuously numbered ones', () => {
    const { before, after } = merge({ ...CONTINUOUSLY_NUMBERED, amendment: APPENDS_BESIDE_CONTINUOUS_TASKS });
    const carried = taskIterations(phaseIterations(before as unknown as Json)[1]!);
    const tasks = taskIterations(phaseIterations(after as unknown as Json)[1]!);

    expect(tasks).toHaveLength(3);
    expect(tasks[0]).toEqual(carried[0]);
    expect(tasks[1]).toEqual(carried[1]);
    expect(tasks[2]!['status']).toBe('not_started');
    expect(tasks[2]!['amendment']).toBe(1);
  });

  it('resets the revised task, and leaves the one beside it untouched', () => {
    const { before, after } = merge({ ...CONTINUOUSLY_NUMBERED, amendment: REVISES_A_CONTINUOUS_TASK });
    const carried = taskIterations(phaseIterations(before as unknown as Json)[1]!);
    const tasks = taskIterations(phaseIterations(after as unknown as Json)[1]!);

    expect(tasks).toHaveLength(2);
    expect(tasks[0]).toEqual(carried[0]);
    expect(tasks[1]!['status']).toBe('not_started');
    expect(tasks[1]!['doc_path']).toBe(carried[1]!['doc_path']);
    expect((tasks[1]!['nodes'] as Json)['task_executor']).toMatchObject({ status: 'not_started' });
  });

  it('removes the dropped task and slides its successor into the freed slot', () => {
    const { before, after } = merge({ ...CONTINUOUSLY_NUMBERED, amendment: DROPS_A_CONTINUOUS_TASK });
    const survivor = taskIterations(phaseIterations(before as unknown as Json)[2]!)[1]!;
    const tasks = taskIterations(phaseIterations(after as unknown as Json)[2]!);

    expect(tasks).toHaveLength(1);
    expect(tasks[0]!['index']).toBe(0);
    expect(tasks[0]!['doc_path']).toBe(survivor['doc_path']);
  });

  it('carries both displaced tasks down a slot when one is inserted ahead of them', () => {
    const { before, after } = merge({ ...CONTINUOUSLY_NUMBERED, amendment: INSERTS_BEFORE_A_CONTINUOUS_TASK });
    const displaced = taskIterations(phaseIterations(before as unknown as Json)[2]!);
    const tasks = taskIterations(phaseIterations(after as unknown as Json)[2]!);

    expect(tasks).toHaveLength(3);
    expect(tasks.map(task => task['index'])).toEqual([0, 1, 2]);
    expect(tasks[0]!['amendment']).toBe(1);
    expect(tasks[1]!['doc_path']).toBe(displaced[0]!['doc_path']);
    expect(tasks[2]!['doc_path']).toBe(displaced[1]!['doc_path']);
  });

  it('follows an in-flight cursor to the slot an insertion ahead of it moved it to', () => {
    const { after } = merge({
      ...CONTINUOUSLY_NUMBERED,
      currentNodePath: 'phase_loop[1].task_loop[1].task_executor',
      amendment: INSERTS_BEFORE_THE_INFLIGHT_CONTINUOUS_TASK,
    });

    const tasks = taskIterations(phaseIterations(after as unknown as Json)[1]!);
    expect(tasks).toHaveLength(3);
    expect(tasks[1]!['status']).toBe('not_started');
    expect(tasks[2]!['status']).toBe('in_progress');
    expect(after.graph.current_node_path).toBe('phase_loop[1].task_loop[2].task_executor');
  });

  it('leaves a phase the amendment never touched byte-identical', () => {
    const { before, after } = merge({ ...CONTINUOUSLY_NUMBERED, amendment: INSERTS_BEFORE_A_CONTINUOUS_TASK });

    expect(JSON.stringify(phaseIterations(after as unknown as Json)[0]))
      .toBe(JSON.stringify(phaseIterations(before as unknown as Json)[0]));
  });

  it('applies a second amendment on top of the first without losing an iteration', () => {
    const fixture = makeProject({ ...CONTINUOUSLY_NUMBERED, amendment: INSERTS_BEFORE_A_CONTINUOUS_TASK });
    const seeded = fixture.state() as AmendableState;

    const first = mergeOnce(fixture, fixture.state() as AmendableState, fixture.amendmentPath);
    const mergedPlan = first.writes.find(write => write.path === fixture.masterPlanPath);
    if (mergedPlan === undefined) throw new Error('the first merge staged no Master Plan write');
    // Only the plan is landed: the second merge re-reads it, and the state it is
    // handed is the first merge's output rather than anything read back off disk.
    fs.writeFileSync(fixture.masterPlanPath, mergedPlan.contents, 'utf8');

    const secondPath = path.join(fixture.projectDir, 'DEMO-AMENDMENT-02.md');
    fs.writeFileSync(secondPath, REVISES_THE_RENUMBERED_TASK, 'utf8');
    const second = mergeOnce(fixture, first.after, secondPath);
    const state = second.after as unknown as Json;

    const seededRunning = taskIterations(phaseIterations(seeded as unknown as Json)[1]!);
    const running = taskIterations(phaseIterations(state)[1]!);
    expect(running).toHaveLength(2);
    expect(running[0]).toEqual(seededRunning[0]);
    expect(running[1]!['status']).toBe('not_started');
    expect(running[1]!['doc_path']).toBe(seededRunning[1]!['doc_path']);

    // The phase the first amendment reshaped survives the second one intact — the
    // regression a doc_path-derived key would have introduced, since two of these
    // three iterations still name the document they were first exploded under.
    const third = taskIterations(phaseIterations(state)[2]!);
    expect(third.map(task => task['index'])).toEqual([0, 1, 2]);
    expect(third.map(task => task['amendment'])).toEqual([1, undefined, undefined]);

    expect(second.after.project?.amendments?.map(record => record.index)).toEqual([1, 2]);
  });
});

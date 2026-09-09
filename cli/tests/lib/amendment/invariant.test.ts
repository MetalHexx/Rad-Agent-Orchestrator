/**
 * The project's central safety property, end to end.
 *
 * An amendment is additive-only and has no undo: any path that writes behind the
 * frontier silently destroys execution history. This suite runs the real `apply`
 * transaction against real project directories and asserts that every frozen
 * iteration subtree and every frozen Master Plan block comes out the other side
 * byte-identical.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseMasterPlan } from '../../../src/lib/explode-master-plan.js';
import { applyAmendment } from '../../../src/lib/amendment/apply.js';
import type { AppliedAmendment } from '../../../src/lib/amendment/apply.js';
import {
  ADDS_A_TASK,
  ALL_PHASES_DONE,
  APPENDS_A_PHASE,
  INSERTS_A_PHASE,
  MASTER_PLAN,
  MID_PHASE,
  NOW,
  REQUIREMENTS,
  REVISES_A_TASK,
  makeProject,
  phaseIterations,
  taskIterations,
  withCrlf,
} from '../../helpers/amendment-fixture.js';
import type { Fixture, FixtureOptions, PhaseProfile } from '../../helpers/amendment-fixture.js';

type Json = Record<string, unknown>;

/** A phase brief is soft while its phase has not run or is still running. */
const EDITABLE_PHASE_STATUSES = new Set(['not_started', 'in_progress']);

// ── Frozen state ─────────────────────────────────────────────────────────────

/** Every iteration subtree the frontier holds frozen, serialized. */
function frozenSubtrees(state: Json): string[] {
  const frozen: string[] = [];
  for (const phase of phaseIterations(state)) {
    if (!EDITABLE_PHASE_STATUSES.has(String(phase['status']))) frozen.push(JSON.stringify(phase));
    for (const task of taskIterations(phase)) {
      if (task['status'] !== 'not_started') frozen.push(JSON.stringify(task));
    }
  }
  return frozen;
}

/** Every iteration subtree present, frozen or not — what the frozen ones must still be found in. */
function allSubtrees(state: Json): Set<string> {
  const all = new Set<string>();
  for (const phase of phaseIterations(state)) {
    all.add(JSON.stringify(phase));
    for (const task of taskIterations(phase)) all.add(JSON.stringify(task));
  }
  return all;
}

// ── Frozen plan text ─────────────────────────────────────────────────────────

// Blocks are sliced on `\n` alone and rejoined the same way, so a line keeps its
// own terminator and a block is the source's exact bytes. Normalising here —
// splitting on `\r?\n` — would erase a line-ending conversion before the
// comparison could see it, which is the one thing these assertions exist to catch.

function phaseBlocks(text: string): Map<string, string> {
  const parsed = parseMasterPlan(writeTemp(text));
  const lines = text.split('\n');
  const blocks = new Map<string, string>();
  parsed.phases.forEach((phase, i) => {
    const end = parsed.phases[i + 1]?.startLine ?? lines.length + 1;
    blocks.set(phase.id, lines.slice(phase.startLine - 1, end - 1).join('\n'));
  });
  return blocks;
}

function taskBlocks(text: string): Map<string, string> {
  const parsed = parseMasterPlan(writeTemp(text));
  const lines = text.split('\n');
  const blocks = new Map<string, string>();
  parsed.phases.forEach((phase, p) => {
    const phaseEnd = parsed.phases[p + 1]?.startLine ?? lines.length + 1;
    phase.tasks.forEach((task, t) => {
      const end = phase.tasks[t + 1]?.startLine ?? phaseEnd;
      blocks.set(task.id, lines.slice(task.startLine - 1, end - 1).join('\n'));
    });
  });
  return blocks;
}

/** A block with its anchor ids neutralised, so a displaced block can be compared to its source. */
function belowTheAnchor(block: string): string {
  return block
    .replace(/^##\s+P\d{2}(?=:)/gm, '## P')
    .replace(/^###\s+P\d{2}-T\d{2}(?=:)/gm, '### P-T');
}

/** Block slicing runs off a real parse, so the text has to sit on disk to be parsed. */
const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amend-parse-'));
let tempSeq = 0;
function writeTemp(text: string): string {
  const file = path.join(scratchDir, `parse-${tempSeq++}.md`);
  fs.writeFileSync(file, text, 'utf8');
  return file;
}

// ── Harness ──────────────────────────────────────────────────────────────────

interface Run {
  fixture: Fixture;
  applied: AppliedAmendment;
  before: { state: Json; plan: string };
  after: { state: Json; plan: string };
  /** Old anchor → the anchor it holds in the merged plan. */
  moved: Map<string, string>;
}

function apply(options: FixtureOptions): Run {
  const fixture = makeProject(options);
  const before = { state: fixture.state(), plan: fixture.masterPlan() };

  const outcome = applyAmendment({
    projectDir: fixture.projectDir,
    amendmentPath: fixture.amendmentPath,
    nowIso: NOW,
  });
  if (outcome.type !== 'applied') throw new Error(`apply refused the fixture: ${JSON.stringify(outcome)}`);

  return {
    fixture,
    applied: outcome.applied,
    before,
    after: { state: fixture.state(), plan: fixture.masterPlan() },
    moved: new Map(outcome.applied.renumbered.map(entry => [entry.from, entry.to])),
  };
}

/** Every frozen phase and task id in a profile, as the plan anchors them. */
function frozenAnchors(profiles: PhaseProfile[]): { phases: string[]; tasks: string[] } {
  const phases: string[] = [];
  const tasks: string[] = [];
  profiles.forEach((profile, i) => {
    const anchor = `P0${i + 1}`;
    if (!EDITABLE_PHASE_STATUSES.has(profile.status)) phases.push(anchor);
    profile.tasks.forEach((status, j) => {
      if (status !== 'not_started') tasks.push(`${anchor}-T0${j + 1}`);
    });
  });
  return { phases, tasks };
}

// ── The invariant ────────────────────────────────────────────────────────────

/** One fixture per frontier position an amendment can legally land at. */
const CASES: { name: string; options: FixtureOptions }[] = [
  {
    name: 'appending a phase to a mid-phase project',
    options: { phases: MID_PHASE, amendment: APPENDS_A_PHASE },
  },
  {
    name: 'adding a task to the running phase',
    options: { phases: MID_PHASE, amendment: ADDS_A_TASK },
  },
  {
    name: 'inserting a phase that displaces everything after it',
    options: { phases: MID_PHASE, amendment: INSERTS_A_PHASE },
  },
  {
    name: 'revising the sole not-started task',
    options: { phases: MID_PHASE, amendment: REVISES_A_TASK },
  },
  {
    name: 'appending a phase to a project parked at the final gate',
    options: {
      phases: ALL_PHASES_DONE,
      phaseLoop: 'completed',
      currentTier: 'review',
      finalReview: { status: 'completed', verdict: 'approved', doc_path: 'reviews/DEMO-FINAL-REVIEW.md' },
      prGate: { status: 'completed', branch_taken: 'true' },
      finalPr: { status: 'completed' },
      finalApprovalGate: { status: 'in_progress', gate_active: true },
      amendment: APPENDS_A_PHASE,
    },
  },
  {
    name: 'appending a phase to a project halted on the final review',
    options: {
      phases: ALL_PHASES_DONE,
      phaseLoop: 'completed',
      graphStatus: 'halted',
      currentTier: 'halted',
      haltReason: 'Final review rejected: reviewer issued a rejected verdict.',
      finalReview: { status: 'halted', verdict: 'rejected', doc_path: 'reviews/DEMO-FINAL-REVIEW.md' },
      amendment: APPENDS_A_PHASE,
    },
  },
  {
    name: 'appending a phase to a completed project',
    options: { phases: ALL_PHASES_DONE, phaseLoop: 'completed', graphStatus: 'completed', currentTier: 'review', amendment: APPENDS_A_PHASE },
  },
  {
    name: 'adding a task on a tier that declares no phase review or gate',
    options: { tier: 'low', phases: MID_PHASE, amendment: ADDS_A_TASK },
  },
  {
    name: 'adding a task on a tier that reviews and gates every task',
    options: { tier: 'extra-high', phases: MID_PHASE, amendment: ADDS_A_TASK },
  },
  {
    name: 'appending a phase to a plan authored with CRLF line endings',
    options: { phases: MID_PHASE, amendment: APPENDS_A_PHASE, masterPlan: withCrlf(MASTER_PLAN) },
  },
];

describe.each(CASES)('the frozen region survives $name', testCase => {
  const run = apply(testCase.options);
  const frozen = frozenAnchors(testCase.options.phases ?? MID_PHASE);

  it('carries every frozen iteration subtree across byte-identical', () => {
    const before = frozenSubtrees(run.before.state);
    expect(before.length).toBeGreaterThan(0);
    const after = allSubtrees(run.after.state);
    for (const subtree of before) {
      expect(after.has(subtree)).toBe(true);
    }
  });

  it('leaves every frozen phase block byte-identical, anchor included', () => {
    const before = phaseBlocks(run.before.plan);
    const after = phaseBlocks(run.after.plan);
    expect(frozen.phases.length).toBeGreaterThan(0);
    for (const anchor of frozen.phases) {
      // A frozen phase can never be renumbered, so its whole block must match.
      expect(run.moved.has(anchor)).toBe(false);
      expect(after.get(anchor)).toBe(before.get(anchor));
    }
  });

  it('leaves every frozen task block byte-identical below its anchor', () => {
    const before = taskBlocks(run.before.plan);
    const after = taskBlocks(run.after.plan);
    expect(frozen.tasks.length).toBeGreaterThan(0);
    for (const anchor of frozen.tasks) {
      const merged = run.moved.get(anchor) ?? anchor;
      expect(belowTheAnchor(after.get(merged) ?? '')).toBe(belowTheAnchor(before.get(anchor) ?? ''));
    }
  });

  it('re-parses into a plan whose totals match the blocks it carries', () => {
    const parsed = parseMasterPlan(run.fixture.masterPlanPath);
    const tasks = parsed.phases.reduce((sum, phase) => sum + phase.tasks.length, 0);
    expect(parsed.frontmatter['total_phases']).toBe(parsed.phases.length);
    expect(parsed.frontmatter['total_tasks']).toBe(tasks);
  });

  it('leaves state and plan agreeing on how many phases and tasks the project holds', () => {
    const parsed = parseMasterPlan(run.fixture.masterPlanPath);
    const iterations = phaseIterations(run.after.state);
    expect(iterations).toHaveLength(parsed.phases.length);
    iterations.forEach((iteration, i) => {
      expect(taskIterations(iteration)).toHaveLength(parsed.phases[i]!.tasks.length);
      expect(iteration['index']).toBe(i);
    });
  });
});

// ── Line endings ─────────────────────────────────────────────────────────────

/**
 * A plan a Windows editor wrote. The assertions below read the merged file as one
 * string rather than through the block helpers, so nothing between the disk and the
 * comparison can normalise a terminator away.
 */
describe('the frozen region survives a CRLF-authored Master Plan', () => {
  const run = apply({
    phases: MID_PHASE,
    amendment: APPENDS_A_PHASE,
    masterPlan: withCrlf(MASTER_PLAN),
    requirements: withCrlf(REQUIREMENTS),
  });

  it('carries the frozen phase block into the merged file as the exact bytes it held', () => {
    const frozen = phaseBlocks(run.before.plan).get('P01')!;
    expect(frozen).toContain('\r\n');
    expect(run.after.plan).toContain(frozen);
  });

  it('writes the whole document back in the convention it was authored in', () => {
    const orphanedLf = run.after.plan.split('\n').slice(0, -1).filter(line => !line.endsWith('\r'));
    expect(orphanedLf).toEqual([]);
  });

  it('keeps the amendment record in the requirements doc in that convention too', () => {
    const requirements = fs.readFileSync(run.fixture.requirementsPath, 'utf8');
    const orphanedLf = requirements.split('\n').slice(0, -1).filter(line => !line.endsWith('\r'));
    expect(orphanedLf).toEqual([]);
  });
});

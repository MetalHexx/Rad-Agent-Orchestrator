import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { amendmentApplyCommand } from '../../../src/commands/amendment/apply.js';
import { applyAmendment } from '../../../src/lib/amendment/apply.js';
import type { AmendmentApplyOutcome } from '../../../src/lib/amendment/apply.js';
import { validateStateSchema } from '../../../src/lib/pipeline-engine/schema-validator.js';
import type { PipelineState } from '../../../src/lib/pipeline-engine/types.js';
import { UserError } from '../../../src/framework/errors.js';
import {
  ADDS_A_TASK,
  APPENDS_A_PHASE,
  HALTED_MID_PLAN,
  MID_PHASE,
  NOW,
  TIERS,
  amendmentDoc,
  makeProject,
  phaseIterations,
  taskBlock,
  taskIterations,
} from '../../helpers/amendment-fixture.js';
import type { Fixture, FixtureOptions, PhaseProfile } from '../../helpers/amendment-fixture.js';

type Json = Record<string, unknown>;

/** Content digest of every file under `dir`, keyed by path relative to it. */
function snapshot(dir: string): Record<string, string> {
  const digests: Record<string, string> = {};
  const walk = (current: string, prefix: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full, relative);
      else digests[relative] = createHash('sha256').update(fs.readFileSync(full)).digest('hex');
    }
  };
  walk(dir, '');
  return digests;
}

function run(fixture: Fixture): AmendmentApplyOutcome {
  return applyAmendment({ projectDir: fixture.projectDir, amendmentPath: fixture.amendmentPath, nowIso: NOW });
}

/** Runs apply and proves the project directory came out untouched. */
function refusedWithoutWriting(opts: FixtureOptions): AmendmentApplyOutcome {
  const fixture = makeProject(opts);
  const before = snapshot(fixture.projectDir);
  const outcome = run(fixture);
  expect(snapshot(fixture.projectDir)).toEqual(before);
  return outcome;
}

// ── The happy path ───────────────────────────────────────────────────────────

describe('amendment apply — landing an amendment', () => {
  const fixture = makeProject({ phases: MID_PHASE, amendment: APPENDS_A_PHASE });
  const outcome = run(fixture);
  if (outcome.type !== 'applied') throw new Error(`expected applied, got ${outcome.type}`);

  it('maps to ok:true with the applied record and exit 0', () => {
    const envelope = amendmentApplyCommand.mapResult!(outcome);
    expect(envelope.ok).toBe(true);
    expect(envelope.exit_code).toBe(0);
    const applied = (envelope.data as { applied: { index: number; docPath: string } }).applied;
    expect(applied.index).toBe(1);
    expect(applied.docPath).toBe('DEMO-AMENDMENT-01.md');
  });

  it('lands every file it reports writing, state.json last', () => {
    for (const relative of outcome.applied.wrote) {
      expect(fs.existsSync(path.join(fixture.projectDir, relative))).toBe(true);
    }
    expect(outcome.applied.wrote.at(-1)).toBe('state.json');
  });

  it('writes a state.json that validates against the v6 schema', () => {
    expect(validateStateSchema(fixture.state() as unknown as PipelineState)).toEqual([]);
  });

  it('leaves no temporary state file behind', () => {
    expect(fs.existsSync(path.join(fixture.projectDir, 'state.json.tmp'))).toBe(false);
  });

  it('emits a handoff for each new task and re-emits none of the existing ones', () => {
    const handoffs = outcome.applied.wrote.filter(relative => relative.startsWith('tasks/'));
    expect(handoffs).toHaveLength(outcome.applied.addsTasks.length);
  });

  it('records the amendment on the project so a later read can find it', () => {
    const project = (fixture.state() as Json)['project'] as Json;
    expect((project['amendments'] as Json[]).map(entry => entry['index'])).toEqual([1]);
  });
});

// ── Every review intensity ───────────────────────────────────────────────────

/** The tiers whose template puts a review and gate beside each phase's task loop. */
const DECLARES_A_PHASE_REVIEW = new Set(['medium', 'extra-high']);

describe.each(TIERS)('amendment apply — on a %s-intensity project', tier => {
  const fixture = makeProject({ tier, phases: MID_PHASE, amendment: ADDS_A_TASK });
  const before = fixture.state() as Json;
  const outcome = run(fixture);
  if (outcome.type !== 'applied') throw new Error(`expected applied, got ${outcome.type}`);

  it('lands the amendment and leaves a state.json that validates against the v6 schema', () => {
    expect(outcome.applied.addsTasks).toHaveLength(1);
    expect(validateStateSchema(fixture.state() as unknown as PipelineState)).toEqual([]);
  });

  it('reopens the phase review only where the tier declares one', () => {
    expect(outcome.applied.reopened.includes('phase_review')).toBe(DECLARES_A_PHASE_REVIEW.has(tier));
    expect(outcome.applied.reopened.includes('phase_gate')).toBe(DECLARES_A_PHASE_REVIEW.has(tier));
  });

  it('never reaches into the per-task review nodes a tier adds', () => {
    expect(outcome.applied.reopened).not.toContain('code_review');
    expect(outcome.applied.reopened).not.toContain('task_gate');

    const finished = taskIterations(phaseIterations(fixture.state() as Json)[1]!)[0]!;
    expect(finished['nodes']).toEqual(taskIterations(phaseIterations(before)[1]!)[0]!['nodes']);
  });
});

// ── Refusals ─────────────────────────────────────────────────────────────────

describe('amendment apply — refusing before any write', () => {
  it('blocks on a halt that sits inside the plan, and writes nothing', () => {
    const outcome = refusedWithoutWriting({
      phases: HALTED_MID_PLAN,
      haltReason: 'coder could not proceed',
      amendment: APPENDS_A_PHASE,
    });
    if (outcome.type !== 'blocked') throw new Error(`expected blocked, got ${outcome.type}`);
    expect(outcome.blocked.haltedNode).toContain('phase_loop[1]');

    const envelope = amendmentApplyCommand.mapResult!(outcome);
    expect(envelope.ok).toBe(true);
    expect(envelope.exit_code).toBe(2);
  });

  it('reports an authoring fault at its line in the amendment, and writes nothing', () => {
    const outcome = refusedWithoutWriting({
      phases: MID_PHASE,
      amendment: amendmentDoc({
        index: 1,
        addsTasks: ['P01-T03'],
        blocks: ['## P01: First', '', ...taskBlock('P01-T03', 'Slip past a frozen phase', 'alpha')],
      }),
    });
    if (outcome.type !== 'invalid') throw new Error(`expected invalid, got ${outcome.type}`);
    expect(outcome.error.line).toBeGreaterThan(0);

    const envelope = amendmentApplyCommand.mapResult!(outcome);
    expect(envelope.ok).toBe(true);
    expect(envelope.exit_code).toBe(2);
  });

  it('rejects a --project-dir whose trailing segment walks out of the projects root', async () => {
    await expect(
      amendmentApplyCommand.handler({
        args: { 'project-dir': '/home/me/.radorc/projects/..', 'amendment': '/tmp/A.md' },
        flags: {},
        ctx: {} as never,
      }),
    ).rejects.toBeInstanceOf(UserError);
  });

  it('rejects an --amendment that lives outside the project directory, leaving the project untouched', () => {
    const fixture = makeProject({ phases: MID_PHASE, amendment: APPENDS_A_PHASE });
    // A readable document with legitimate content — only its location is wrong,
    // which is what would leave the Master Plan's same-directory link broken.
    const elsewhere = path.join(fixture.projectDir, '..', `${fixture.projectName}-AMENDMENT-01.md`);
    fs.writeFileSync(elsewhere, fs.readFileSync(fixture.amendmentPath));
    const before = snapshot(fixture.projectDir);

    expect(() =>
      applyAmendment({ projectDir: fixture.projectDir, amendmentPath: elsewhere, nowIso: NOW }),
    ).toThrow(UserError);
    expect(snapshot(fixture.projectDir)).toEqual(before);
  });

  it('rejects an --amendment at the project root that is not this project\'s amendment document', () => {
    const fixture = makeProject({ phases: MID_PHASE, amendment: APPENDS_A_PHASE });
    const misnamed = path.join(fixture.projectDir, 'my-amendment.md');
    fs.writeFileSync(misnamed, fs.readFileSync(fixture.amendmentPath));
    const before = snapshot(fixture.projectDir);

    expect(() =>
      applyAmendment({ projectDir: fixture.projectDir, amendmentPath: misnamed, nowIso: NOW }),
    ).toThrow(UserError);
    expect(snapshot(fixture.projectDir)).toEqual(before);
  });
});

// ── All or nothing ───────────────────────────────────────────────────────────

describe('amendment apply — the transaction', () => {
  /** The staged path of a task handoff this amendment will write. */
  function handoffPathOf(opts: FixtureOptions): string {
    const probe = makeProject(opts);
    const outcome = run(probe);
    if (outcome.type !== 'applied') throw new Error(`probe refused the fixture: ${outcome.type}`);
    const handoff = outcome.applied.wrote.find(relative => relative.startsWith('tasks/'));
    if (handoff === undefined) throw new Error('probe wrote no task handoff to obstruct');
    return handoff;
  }

  it('leaves the project in its pre-apply state when a write fails partway through', () => {
    const opts: FixtureOptions = { phases: MID_PHASE, amendment: ADDS_A_TASK };
    const obstructed = handoffPathOf(opts);

    const fixture = makeProject(opts);
    // A directory where a file must land: the commit gets as far as the Master
    // Plan and the Requirements doc, then cannot write the handoff.
    fs.mkdirSync(path.join(fixture.projectDir, obstructed), { recursive: true });
    const before = snapshot(fixture.projectDir);

    expect(() => run(fixture)).toThrow(/left unchanged/);
    expect(snapshot(fixture.projectDir)).toEqual(before);
  });

  it('does not half-apply the state either — the plan and state still agree', () => {
    const opts: FixtureOptions = { phases: MID_PHASE, amendment: ADDS_A_TASK };
    const fixture = makeProject(opts);
    fs.mkdirSync(path.join(fixture.projectDir, handoffPathOf(opts)), { recursive: true });

    expect(() => run(fixture)).toThrow();
    const running = phaseIterations(fixture.state() as Json)[1]!;
    expect((running['nodes'] as Json)['task_loop']).toMatchObject({ status: 'completed' });
    expect((fixture.state() as Json)['project']).not.toHaveProperty('amendments');
  });

  it('restores a dropped file’s bytes when a later step in the commit fails', () => {
    const opts: FixtureOptions = { phases: MID_PHASE, amendment: DROPS_A_PHASE };

    // Prove this amendment actually removes something before relying on that to
    // exercise the rollback path.
    const probe = makeProject(opts);
    const probeOutcome = run(probe);
    if (probeOutcome.type !== 'applied') throw new Error(`probe refused the fixture: ${probeOutcome.type}`);
    expect(probeOutcome.applied.removed.length).toBeGreaterThan(0);

    const fixture = makeProject(opts);
    const before = snapshot(fixture.projectDir);
    // Every write and every deletion lands before state.json does, so obstructing
    // its tmp file fails the commit only after both have already happened.
    fs.mkdirSync(path.join(fixture.projectDir, 'state.json.tmp'), { recursive: true });

    expect(() => run(fixture)).toThrow();
    expect(snapshot(fixture.projectDir)).toEqual(before);
  });
});

// ── Revising and dropping ────────────────────────────────────────────────────

/** P01 done, P02 and P03 both untouched — a floor a revise or drop below stays legal against. */
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

/** Drops the sole not-started phase's only task, which empties the phase too. */
const DROPS_A_PHASE = amendmentDoc({
  index: 1,
  addsTasks: [],
  dropsTasks: ['P03-T01'],
  dropsPhases: ['P03'],
  blocks: ['## P03: Third', ''],
});

describe('amendment apply — revising and dropping', () => {
  const fixture = makeProject({ phases: P01_DONE_REST_UNSTARTED, amendment: REVISES_AND_DROPS });
  const outcome = run(fixture);
  if (outcome.type !== 'applied') throw new Error(`expected applied, got ${outcome.type}`);

  it('reports what it revised and dropped, and validates against the v6 schema', () => {
    expect(outcome.applied.revisesTasks.map(task => task.id)).toEqual(['P02-T01']);
    expect(outcome.applied.dropsTasks).toEqual(['P03-T01']);
    expect(outcome.applied.dropsPhases).toEqual(['P03']);
    expect(outcome.applied.removed).toHaveLength(2);
    expect(validateStateSchema(fixture.state() as unknown as PipelineState)).toEqual([]);
  });

  it('leaves no file it reported removing still on disk', () => {
    for (const relative of outcome.applied.removed) {
      expect(fs.existsSync(path.join(fixture.projectDir, relative))).toBe(false);
    }
  });

  it('records the same five id lists on the project’s amendment history', () => {
    const recorded = ((fixture.state() as Json)['project'] as Json)['amendments'] as Json[];
    expect(recorded[0]).toMatchObject({
      revises_tasks: ['P02-T01'],
      drops_tasks: ['P03-T01'],
      drops_phases: ['P03'],
    });
  });
});

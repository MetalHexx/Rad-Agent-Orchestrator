import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseMasterPlan } from '../../../src/lib/explode-master-plan.js';
import type { ParsedMasterPlan } from '../../../src/lib/explode-master-plan.js';
import { computeFrontier } from '../../../src/lib/amendment/frontier.js';
import type { PhaseIteration, PipelineState } from '../../../src/lib/amendment/frontier.js';
import { buildMergePlan } from '../../../src/lib/amendment/merge-check.js';
import type { AmendmentMergeOutcome, AmendmentMergePlan, MergeError } from '../../../src/lib/amendment/merge-check.js';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const EXISTING_PLAN = [
  '---',
  'project: DEMO',
  'repos: [alpha, beta]',
  '---',
  '',
  '# Intro',
  '',
  '## P01: First',
  'Phase one body.',
  '',
  '### P01-T01: Task one',
  '**Target repo:** alpha',
  '',
  'Do the thing.',
  '',
  '### P01-T02: Task two',
  '**Target repo:** alpha',
  '',
  'Do the other thing.',
  '',
  '## P02: Second',
  'Phase two body.',
  '',
  '### P02-T01: Beta work',
  '**Target repo:** beta',
  '',
  'Beta work body.',
  '',
  '## P03: Third',
  'Phase three body.',
  '',
  '### P03-T01: More beta',
  '**Target repo:** beta',
  '',
  'More beta work.',
  '',
].join('\n');

function parseDoc(text: string): ParsedMasterPlan {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amend-'));
  const file = path.join(dir, 'doc.md');
  fs.writeFileSync(file, text, 'utf8');
  return parseMasterPlan(file);
}

function lineOf(text: string, needle: string): number {
  return text.split('\n').findIndex(line => line.includes(needle)) + 1;
}

/**
 * An amendment carries no `repos:` seal — that absence is what makes the parser
 * skip its whole target-repo enforcement block, and what the merge checker's own
 * presence checks exist to cover.
 */
function amendmentDoc(opts: {
  /** Defaults to 1 — the first amendment of a project that has never been amended. */
  index?: number;
  addsPhases?: string[];
  addsTasks?: string[];
  revisesTasks?: string[];
  dropsTasks?: string[];
  dropsPhases?: string[];
  blocks: string[];
}): string {
  return [
    '---',
    'project: DEMO',
    'type: amendment',
    `amendment: ${opts.index ?? 1}`,
    'created: "2026-08-24"',
    ...(opts.addsPhases === undefined ? [] : [`adds_phases: [${opts.addsPhases.join(', ')}]`]),
    `adds_tasks: [${(opts.addsTasks ?? []).join(', ')}]`,
    ...(opts.revisesTasks === undefined ? [] : [`revises_tasks: [${opts.revisesTasks.join(', ')}]`]),
    ...(opts.dropsTasks === undefined ? [] : [`drops_tasks: [${opts.dropsTasks.join(', ')}]`]),
    ...(opts.dropsPhases === undefined ? [] : [`drops_phases: [${opts.dropsPhases.join(', ')}]`]),
    '---',
    '',
    '## Rationale',
    '',
    'The operator wants more.',
    '',
    '## Amendment Blocks',
    '',
    ...opts.blocks,
    '',
  ].join('\n');
}

/** A task fixture: bare status, or a status plus the `repos[]` the frontier reads. */
type TaskSpec = string | { status: string; repos?: { name: string; commit_hash: string | null }[] };

function phaseIteration(index: number, status: string, tasks: TaskSpec[], reviewNodes: boolean): PhaseIteration {
  return {
    index,
    status,
    doc_path: null,
    nodes: {
      task_loop: {
        kind: 'for_each_task',
        status,
        iterations: tasks.map((task, i) => ({
          index: i,
          doc_path: null,
          ...(typeof task === 'string' ? { status: task } : task),
        })),
      },
      ...(reviewNodes
        ? { phase_review: { kind: 'step', status: 'not_started' }, phase_gate: { kind: 'gate', status: 'not_started' } }
        : {}),
    },
  };
}

interface StateOpts {
  phases?: { status: string; tasks: TaskSpec[] }[];
  provisioned?: string[];
  tier?: 'low' | 'rich';
  finalReviewStatus?: string;
  haltReason?: string | null;
  /** Indices of the amendments this project has already applied; none by default. */
  appliedAmendments?: number[];
}

/** The mid-run shape the frontier and the reopen filter read. */
function makeState(opts: StateOpts = {}): PipelineState {
  const tier = opts.tier ?? 'low';
  const phases = opts.phases ?? [
    { status: 'completed', tasks: ['completed', 'completed'] },
    { status: 'in_progress', tasks: ['completed'] },
    { status: 'not_started', tasks: ['not_started'] },
  ];
  return {
    project: { amendments: (opts.appliedAmendments ?? []).map(index => ({ index })) },
    graph: {
      nodes: {
        master_plan: { kind: 'step', status: 'completed', doc_path: 'DEMO-MASTER-PLAN.md' },
        explode_master_plan: { kind: 'step', status: 'completed', doc_path: null },
        plan_approval_gate: { kind: 'gate', status: 'completed' },
        gate_mode_selection: { kind: 'gate', status: 'completed' },
        phase_loop: {
          kind: 'for_each_phase',
          status: 'in_progress',
          iterations: phases.map((p, i) => phaseIteration(i, p.status, p.tasks, tier === 'rich')),
        },
        final_review: { kind: 'step', status: opts.finalReviewStatus ?? 'not_started', doc_path: null },
        pr_gate: { kind: 'conditional', status: 'not_started' },
        ...(tier === 'rich' ? { final_pr: { kind: 'step', status: 'not_started', doc_path: null } } : {}),
        final_approval_gate: { kind: 'gate', status: 'not_started' },
      },
    },
    pipeline: {
      gate_mode: 'task',
      current_tier: tier === 'rich' ? 'extra-high' : 'low',
      halt_reason: opts.haltReason ?? null,
      source_control: { repos: (opts.provisioned ?? ['alpha', 'beta']).map(name => ({ name })) },
    },
  };
}

function runMerge(amendmentText: string, opts: StateOpts = {}, existing?: ParsedMasterPlan): AmendmentMergeOutcome {
  const state = makeState(opts);
  const plan = existing ?? parseDoc(EXISTING_PLAN);
  return buildMergePlan({
    existing: plan,
    amendment: parseDoc(amendmentText),
    frontier: computeFrontier(state, plan),
    state,
  });
}

function expectOk(outcome: AmendmentMergeOutcome): AmendmentMergePlan {
  if (outcome.type !== 'ok') throw new Error(`expected ok, got ${outcome.type}: ${JSON.stringify(outcome)}`);
  return outcome.plan;
}

function expectInvalid(outcome: AmendmentMergeOutcome): MergeError {
  if (outcome.type !== 'invalid') throw new Error(`expected invalid, got ${outcome.type}: ${JSON.stringify(outcome)}`);
  return outcome.error;
}

// ── Positional insertion ─────────────────────────────────────────────────────

describe('buildMergePlan — positional insertion', () => {
  it('appends a phase that claims the first free number, moving nothing', () => {
    const doc = amendmentDoc({
      addsPhases: ['P04'],
      addsTasks: ['P04-T01'],
      blocks: ['## P04: Fourth', 'Revised intent.', '', '### P04-T01: New work', '**Target repo:** alpha', '', 'New work body.'],
    });
    const plan = expectOk(runMerge(doc));

    expect(plan.addsPhases).toEqual([{ id: 'P04', title: 'Fourth', taskCount: 1 }]);
    expect(plan.addsTasks).toEqual([{ id: 'P04-T01', title: 'New work', repo: 'alpha' }]);
    expect(plan.renumbered).toEqual([]);
    expect(plan.mergedTotals).toEqual({ phases: 4, tasks: 5 });
    expect(plan.mergedRepos).toEqual(['alpha', 'beta']);
    expect(Object.fromEntries(plan.numbering.phases)).toEqual({ P01: 'P01', P02: 'P02', P03: 'P03' });
  });

  it('displaces a pending phase upward and records the full numbering, identities included', () => {
    const doc = amendmentDoc({
      addsPhases: ['P03'],
      addsTasks: ['P03-T01'],
      blocks: ['## P03: Inserted', 'Revised intent.', '', '### P03-T01: Inserted work', '**Target repo:** beta', '', 'Inserted body.'],
    });
    const plan = expectOk(runMerge(doc));

    expect(plan.addsPhases).toEqual([{ id: 'P03', title: 'Inserted', taskCount: 1 }]);
    expect(plan.renumbered).toEqual(expect.arrayContaining([
      { from: 'P03', to: 'P04' },
      { from: 'P03-T01', to: 'P04-T01' },
    ]));
    expect(plan.renumbered).toHaveLength(2);
    expect(Object.fromEntries(plan.numbering.phases)).toEqual({ P01: 'P01', P02: 'P02', P03: 'P04' });
    expect(Object.fromEntries(plan.numbering.tasks)).toEqual({
      'P01-T01': 'P01-T01',
      'P01-T02': 'P01-T02',
      'P02-T01': 'P02-T01',
      'P03-T01': 'P04-T01',
    });
    expect(plan.mergedTotals).toEqual({ phases: 4, tasks: 5 });
  });

  it('rejects a phase number held by a frozen phase', () => {
    const doc = amendmentDoc({
      addsPhases: ['P01'],
      addsTasks: ['P01-T01'],
      blocks: ['## P01: Squeezed in', 'Revised intent.', '', '### P01-T01: Squeezed work', '**Target repo:** alpha', '', 'Body.'],
    });
    const error = expectInvalid(runMerge(doc));
    expect(error.line).toBe(lineOf(doc, '## P01: Squeezed in'));
    expect(error.found).toContain('P01');
    expect(Object.keys(error).sort()).toEqual(['expected', 'found', 'line', 'message']);
  });

  it('rejects a discontinuous phase number', () => {
    const doc = amendmentDoc({
      addsPhases: ['P06'],
      addsTasks: ['P06-T01'],
      blocks: ['## P06: Far future', 'Revised intent.', '', '### P06-T01: Later work', '**Target repo:** alpha', '', 'Body.'],
    });
    const error = expectInvalid(runMerge(doc));
    expect(error.line).toBe(lineOf(doc, '## P06: Far future'));
    expect(error.found).toBe('P06');
  });

  it('appends a task to a phase whose brief is still editable', () => {
    const doc = amendmentDoc({
      addsTasks: ['P03-T02'],
      blocks: ['## P03: Third', 'Revised intent and exit criteria.', '', '### P03-T02: Extra beta', '**Target repo:** beta', '', 'Body.'],
    });
    const plan = expectOk(runMerge(doc));
    expect(plan.addsPhases).toEqual([]);
    expect(plan.addsTasks).toEqual([{ id: 'P03-T02', title: 'Extra beta', repo: 'beta' }]);
    expect(plan.renumbered).toEqual([]);
    expect(plan.mergedTotals).toEqual({ phases: 3, tasks: 5 });
  });

  it('rejects a task inserted at a completed task position', () => {
    const doc = amendmentDoc({
      addsTasks: ['P02-T01'],
      blocks: ['## P02: Second', 'Revised intent.', '', '### P02-T01: Jumps the queue', '**Target repo:** beta', '', 'Body.'],
    });
    const error = expectInvalid(runMerge(doc));
    expect(error.line).toBe(lineOf(doc, '### P02-T01: Jumps the queue'));
    expect(error.found).toContain('P02-T01');
  });

  it('rejects a discontinuous task number', () => {
    const doc = amendmentDoc({
      addsTasks: ['P03-T05'],
      blocks: ['## P03: Third', 'Revised intent.', '', '### P03-T05: Skips ahead', '**Target repo:** beta', '', 'Body.'],
    });
    const error = expectInvalid(runMerge(doc));
    expect(error.line).toBe(lineOf(doc, '### P03-T05: Skips ahead'));
  });

  it('rejects tasks added to a phase whose brief is frozen', () => {
    const doc = amendmentDoc({
      addsTasks: ['P01-T03'],
      blocks: ['## P01: First', 'Revised intent.', '', '### P01-T03: Late addition', '**Target repo:** alpha', '', 'Body.'],
    });
    const error = expectInvalid(runMerge(doc));
    expect(error.line).toBe(lineOf(doc, '## P01: First'));
    expect(error.found).toContain('P01');
  });
});

// ── Declarations ─────────────────────────────────────────────────────────────

describe('buildMergePlan — frontmatter declarations against the blocks present', () => {
  it('rejects a task block the adds_tasks frontmatter does not name', () => {
    const doc = amendmentDoc({
      addsPhases: ['P04'],
      addsTasks: ['P04-T01'],
      blocks: [
        '## P04: Fourth', 'Revised intent.', '',
        '### P04-T01: First new', '**Target repo:** alpha', '', 'Body.', '',
        '### P04-T02: Undeclared', '**Target repo:** alpha', '', 'Body.',
      ],
    });
    const error = expectInvalid(runMerge(doc));
    expect(error.line).toBe(lineOf(doc, '### P04-T02: Undeclared'));
    expect(error.found).toContain('P04-T02');
  });

  it('rejects an adds_tasks id with no matching block', () => {
    const doc = amendmentDoc({
      addsPhases: ['P04'],
      addsTasks: ['P04-T01', 'P04-T09'],
      blocks: ['## P04: Fourth', 'Revised intent.', '', '### P04-T01: First new', '**Target repo:** alpha', '', 'Body.'],
    });
    const error = expectInvalid(runMerge(doc));
    expect(error.found).toContain('P04-T09');
  });

  it('rejects a phase block that neither adds_phases nor the existing plan knows about', () => {
    const doc = amendmentDoc({
      addsTasks: ['P04-T01'],
      blocks: ['## P04: Fourth', 'Revised intent.', '', '### P04-T01: First new', '**Target repo:** alpha', '', 'Body.'],
    });
    const error = expectInvalid(runMerge(doc));
    expect(error.line).toBe(lineOf(doc, '## P04: Fourth'));
    expect(error.found).toBe('P04');
  });

  it('rejects an amendment with no positive integer index', () => {
    const doc = amendmentDoc({
      addsPhases: ['P04'],
      addsTasks: ['P04-T01'],
      blocks: ['## P04: Fourth', 'Revised intent.', '', '### P04-T01: First new', '**Target repo:** alpha', '', 'Body.'],
    }).replace('amendment: 1', 'amendment: "two"');
    const error = expectInvalid(runMerge(doc));
    expect(error.line).toBe(1);
    expect(error.expected).toContain('amendment:');
  });
});

// ── The declared index against the applied record ────────────────────────────

describe('buildMergePlan — the declared index against what the project has applied', () => {
  const appendsPhaseFour = (index: number): string =>
    amendmentDoc({
      index,
      addsPhases: ['P04'],
      addsTasks: ['P04-T01'],
      blocks: ['## P04: Fourth', 'Revised intent.', '', '### P04-T01: New work', '**Target repo:** alpha', '', 'Body.'],
    });

  it('accepts index 1 against a project that has never been amended', () => {
    expect(expectOk(runMerge(appendsPhaseFour(1))).amendmentIndex).toBe(1);
  });

  it('accepts the next index against a project that has already applied one', () => {
    const plan = expectOk(runMerge(appendsPhaseFour(2), { appliedAmendments: [1] }));
    expect(plan.amendmentIndex).toBe(2);
  });

  it('rejects an index this project has already applied, so re-running a landed document cannot duplicate its work', () => {
    const error = expectInvalid(runMerge(appendsPhaseFour(1), { appliedAmendments: [1] }));
    expect(error.line).toBe(1);
    expect(error.found).toBe('1');
    expect(error.expected).toContain('2');
  });

  it('rejects an index that skips ahead of the next one', () => {
    const error = expectInvalid(runMerge(appendsPhaseFour(3), { appliedAmendments: [1] }));
    expect(error.line).toBe(1);
    expect(error.found).toBe('3');
    expect(error.expected).toContain('2');
  });
});

// ── Duplicate ids within one amendment ───────────────────────────────────────

describe('buildMergePlan — duplicate ids within one amendment', () => {
  it('rejects two task blocks sharing an id within one phase, rather than silently renumbering', () => {
    const doc = amendmentDoc({
      addsTasks: ['P03-T02'],
      blocks: [
        '## P03: Third', 'Revised intent.', '',
        '### P03-T02: Extra beta A', '**Target repo:** beta', '', 'Body A.', '',
        '### P03-T02: Extra beta B', '**Target repo:** beta', '', 'Body B.',
      ],
    });
    const error = expectInvalid(runMerge(doc));
    expect(error.line).toBe(lineOf(doc, '### P03-T02: Extra beta B'));
    expect(error.found).toContain('P03-T02');
    expect(error.message).toContain('more than once');
  });
});

// ── Target-repo presence, on a seal-less document ────────────────────────────

describe('buildMergePlan — target-repo presence the parser cannot reach', () => {
  const missingLine = amendmentDoc({
    addsPhases: ['P04'],
    addsTasks: ['P04-T01'],
    blocks: ['## P04: Fourth', 'Revised intent.', '', '### P04-T01: Repo-less', '', 'Body with no target repo line.'],
  });
  const emptyLine = amendmentDoc({
    addsPhases: ['P04'],
    addsTasks: ['P04-T01'],
    blocks: ['## P04: Fourth', 'Revised intent.', '', '### P04-T01: Repo-less', '**Target repo:**', '', 'Body.'],
  });

  it('parses both seal-less documents without the parser raising anything', () => {
    // The reachability premise: with no `repos:` seal the parser skips its entire
    // target-repo enforcement block, so these documents reach the merge checker.
    expect(parseDoc(missingLine).phases[0]?.tasks[0]?.targetRepos).toEqual([]);
    expect(parseDoc(emptyLine).phases[0]?.tasks[0]?.targetRepos).toEqual([]);
  });

  it('flags a task with no Target repo line at all', () => {
    const error = expectInvalid(runMerge(missingLine));
    expect(error.line).toBe(lineOf(missingLine, '### P04-T01: Repo-less'));
    expect(error.found).toContain('no Target repo line');
  });

  it('flags a present-but-empty Target repo line', () => {
    const error = expectInvalid(runMerge(emptyLine));
    expect(error.line).toBe(lineOf(emptyLine, '### P04-T01: Repo-less'));
    expect(error.found).toContain('empty Target repo line');
  });
});

// ── Merged repo equality, both directions ────────────────────────────────────

describe('buildMergePlan — merged repo equality', () => {
  it('rejects a task naming a repo that would not be in the merged repos array', () => {
    const doc = amendmentDoc({
      addsPhases: ['P04'],
      addsTasks: ['P04-T01'],
      blocks: ['## P04: Fourth', 'Revised intent.', '', '### P04-T01: Stray', '**Target repo:** gamma', '', 'Body.'],
    });
    const error = expectInvalid(runMerge(doc));
    expect(error.line).toBe(lineOf(doc, '### P04-T01: Stray'));
    expect(error.found).toContain('gamma');
  });

  it('widens the merged repos array for a repo the project already provisions', () => {
    const doc = amendmentDoc({
      addsPhases: ['P04'],
      addsTasks: ['P04-T01'],
      blocks: ['## P04: Fourth', 'Revised intent.', '', '### P04-T01: Stray', '**Target repo:** gamma', '', 'Body.'],
    });
    const plan = expectOk(runMerge(doc, { provisioned: ['alpha', 'beta', 'gamma'] }));
    expect(plan.mergedRepos).toEqual(['alpha', 'beta', 'gamma']);
    expect(plan.addsTasks).toEqual([{ id: 'P04-T01', title: 'Stray', repo: 'gamma' }]);
  });

  it('shrinks the merged repos array when a drop orphans the only repo that named it', () => {
    // repos: [alpha, beta] — P01 targets alpha; P02 and P03 both target beta.
    // Dropping every task that names beta must drop beta from the merged seal:
    // the array is derived from what the merged plan actually targets, not
    // accumulated from what it used to hold.
    const doc = amendmentDoc({
      dropsTasks: ['P02-T01', 'P03-T01'],
      dropsPhases: ['P02', 'P03'],
      blocks: ['## P01: First', ''],
    });
    const plan = expectOk(runMerge(doc, {
      phases: [
        { status: 'completed', tasks: ['completed', 'completed'] },
        { status: 'not_started', tasks: ['not_started'] },
        { status: 'not_started', tasks: ['not_started'] },
      ],
    }));
    expect(plan.mergedRepos).toEqual(['alpha']);
    expect(plan.mergedTotals).toEqual({ phases: 1, tasks: 2 });
  });
});

// ── Reopen cascade ───────────────────────────────────────────────────────────

describe('buildMergePlan — the reopen cascade', () => {
  const doc = amendmentDoc({
    addsPhases: ['P04'],
    addsTasks: ['P04-T01'],
    blocks: ['## P04: Fourth', 'Revised intent.', '', '### P04-T01: New work', '**Target repo:** alpha', '', 'Body.'],
  });

  it('names only the nodes a low-tier project actually carries', () => {
    const plan = expectOk(runMerge(doc, { tier: 'low' }));
    expect(plan.reopens).toEqual(['phase_loop', 'final_review', 'pr_gate', 'final_approval_gate']);
  });

  it('names the phase review nodes on a tier that declares them', () => {
    const plan = expectOk(runMerge(doc, { tier: 'rich' }));
    expect(plan.reopens).toEqual([
      'phase_loop', 'phase_review', 'phase_gate', 'final_review', 'pr_gate', 'final_pr', 'final_approval_gate',
    ]);
  });

  it('reports a final-review halt as one the amendment clears', () => {
    const plan = expectOk(runMerge(doc, { finalReviewStatus: 'halted', haltReason: 'final review found gaps' }));
    expect(plan.clearsHalt).toEqual({ node: 'final_review', reason: 'final review found gaps' });
  });

  it('leaves clearsHalt null on a run that never halted', () => {
    expect(expectOk(runMerge(doc)).clearsHalt).toBeNull();
  });
});

// ── Upstream halt ────────────────────────────────────────────────────────────

describe('buildMergePlan — upstream halt', () => {
  it('blocks on a halt sitting anywhere inside the phase loop', () => {
    const doc = amendmentDoc({
      addsPhases: ['P04'],
      addsTasks: ['P04-T01'],
      blocks: ['## P04: Fourth', 'Revised intent.', '', '### P04-T01: New work', '**Target repo:** alpha', '', 'Body.'],
    });
    const outcome = runMerge(doc, {
      phases: [
        { status: 'completed', tasks: ['completed', 'completed'] },
        { status: 'in_progress', tasks: ['halted'] },
        { status: 'not_started', tasks: ['not_started'] },
      ],
      haltReason: 'coder could not proceed',
    });
    if (outcome.type !== 'blocked') throw new Error(`expected blocked, got ${outcome.type}`);
    expect(outcome.blocked.haltedNode).toBe('phase_loop[1].task_loop[0]');
    expect(outcome.blocked.reason).toBe('coder could not proceed');
    expect(outcome.blocked.message).toContain('phase_loop[1].task_loop[0]');
  });
});

// ── Revise ───────────────────────────────────────────────────────────────────

describe('buildMergePlan — revise', () => {
  it('restates a not-started task, reporting it under revisesTasks at its merged id and absent from addsTasks', () => {
    const doc = amendmentDoc({
      revisesTasks: ['P03-T01'],
      blocks: [
        '## P03: Third', 'Phase three body, revised.', '',
        '### P03-T01: Close the loop, revised', '**Target repo:** beta', '', 'Revised body.',
      ],
    });
    const plan = expectOk(runMerge(doc));
    expect(plan.revisesTasks).toEqual([{ id: 'P03-T01', title: 'Close the loop, revised', repo: 'beta' }]);
    expect(plan.addsTasks).toEqual([]);
    expect(plan.numbering.tasks.get('P03-T01')).toBe('P03-T01');
    expect(plan.renumbered).toEqual([]);
  });

  it('refuses to revise a completed task, pointing at the revising block and naming the reason', () => {
    const doc = amendmentDoc({
      revisesTasks: ['P01-T01'],
      blocks: [
        '## P01: First', 'Phase one body, revised.', '',
        '### P01-T01: Revised task one', '**Target repo:** alpha', '', 'Revised body.',
      ],
    });
    const error = expectInvalid(runMerge(doc));
    expect(error.line).toBe(lineOf(doc, '### P01-T01: Revised task one'));
    expect(error.found).toContain('P01-T01');
    expect(error.found).toContain('completed');
    expect(error.message).toContain('P01-T01');
    expect(error.message).toContain('completed');
  });

  it('refuses to revise an in-progress task with a commit hash recorded, naming the committed repo', () => {
    const doc = amendmentDoc({
      revisesTasks: ['P02-T01'],
      blocks: [
        '## P02: Second', 'Phase two body, revised.', '',
        '### P02-T01: Beta work, revised', '**Target repo:** beta', '', 'Revised body.',
      ],
    });
    const error = expectInvalid(runMerge(doc, {
      phases: [
        { status: 'completed', tasks: ['completed', 'completed'] },
        { status: 'in_progress', tasks: [{ status: 'in_progress', repos: [{ name: 'beta', commit_hash: 'abc123' }] }] },
        { status: 'not_started', tasks: ['not_started'] },
      ],
    }));
    expect(error.found).toContain('P02-T01');
    expect(error.found).toContain('in progress with work committed to beta');
  });

  it('does not trip the phase-brief-frozen guard when a block only revises a task', () => {
    // P02's brief is frozen (skipped), but its lone task never started — the
    // guard that blocks a frozen phase from GAINING tasks must not fire here,
    // because this block adds nothing; it only revises.
    const doc = amendmentDoc({
      revisesTasks: ['P02-T01'],
      blocks: [
        '## P02: Second', 'Phase two body, revised.', '',
        '### P02-T01: Beta work, revised', '**Target repo:** beta', '', 'Revised body.',
      ],
    });
    const plan = expectOk(runMerge(doc, {
      phases: [
        { status: 'completed', tasks: ['completed', 'completed'] },
        { status: 'skipped', tasks: ['not_started'] },
        { status: 'not_started', tasks: ['not_started'] },
      ],
    }));
    expect(plan.revisesTasks).toEqual([{ id: 'P02-T01', title: 'Beta work, revised', repo: 'beta' }]);
  });
});

// ── Drop ─────────────────────────────────────────────────────────────────────

describe('buildMergePlan — drop', () => {
  it('drops a not-started task, shifts the tasks behind it into renumbered, and leaves the id in no numbering map', () => {
    const doc = amendmentDoc({ dropsTasks: ['P01-T01'], blocks: ['## P01: First', ''] });
    const plan = expectOk(runMerge(doc, {
      phases: [
        { status: 'not_started', tasks: ['not_started', 'not_started'] },
        { status: 'in_progress', tasks: ['completed'] },
        { status: 'not_started', tasks: ['not_started'] },
      ],
    }));
    expect(plan.dropsTasks).toEqual(['P01-T01']);
    expect(plan.numbering.tasks.has('P01-T01')).toBe(false);
    expect(plan.numbering.tasks.get('P01-T02')).toBe('P01-T01');
    expect(plan.renumbered).toEqual(expect.arrayContaining([{ from: 'P01-T02', to: 'P01-T01' }]));
    expect(plan.mergedTotals).toEqual({ phases: 3, tasks: 3 });
  });

  it('refuses to drop a completed task, naming the id and the reason', () => {
    const doc = amendmentDoc({ dropsTasks: ['P01-T01'], blocks: ['## P01: First', ''] });
    const error = expectInvalid(runMerge(doc));
    expect(error.line).toBe(1);
    expect(error.found).toContain('P01-T01');
    expect(error.found).toContain('completed');
  });

  it('refuses to drop an in-progress task with a commit hash recorded, naming the committed repo', () => {
    const doc = amendmentDoc({ dropsTasks: ['P02-T01'], blocks: ['## P02: Second', ''] });
    const error = expectInvalid(runMerge(doc, {
      phases: [
        { status: 'completed', tasks: ['completed', 'completed'] },
        { status: 'in_progress', tasks: [{ status: 'in_progress', repos: [{ name: 'beta', commit_hash: 'abc123' }] }] },
        { status: 'not_started', tasks: ['not_started'] },
      ],
    }));
    expect(error.found).toContain('P02-T01');
    expect(error.found).toContain('in progress with work committed to beta');
  });

  it('splices an added task into the slot a drop just freed, in the same amendment', () => {
    const doc = amendmentDoc({
      dropsTasks: ['P01-T01'],
      addsTasks: ['P01-T02'],
      blocks: [
        '## P01: First', 'Phase one body.', '',
        '### P01-T02: New work', '**Target repo:** alpha', '', 'New work body.',
      ],
    });
    const plan = expectOk(runMerge(doc, {
      phases: [
        { status: 'in_progress', tasks: ['not_started', 'not_started'] },
        { status: 'in_progress', tasks: ['completed'] },
        { status: 'not_started', tasks: ['not_started'] },
      ],
    }));
    expect(plan.dropsTasks).toEqual(['P01-T01']);
    expect(plan.numbering.tasks.has('P01-T01')).toBe(false);
    expect(plan.numbering.tasks.get('P01-T02')).toBe('P01-T01');
    expect(plan.renumbered).toEqual(expect.arrayContaining([{ from: 'P01-T02', to: 'P01-T01' }]));
    expect(plan.addsTasks).toEqual([{ id: 'P01-T02', title: 'New work', repo: 'alpha' }]);
  });
});

// ── Phase removal ────────────────────────────────────────────────────────────

describe('buildMergePlan — phase removal', () => {
  it('removes a phase this amendment emptied, when drops_phases declares it', () => {
    const doc = amendmentDoc({ dropsTasks: ['P03-T01'], dropsPhases: ['P03'], blocks: ['## P03: Third', ''] });
    const plan = expectOk(runMerge(doc));
    expect(plan.dropsPhases).toEqual(['P03']);
    expect(plan.numbering.phases.has('P03')).toBe(false);
    expect(plan.mergedTotals).toEqual({ phases: 2, tasks: 3 });
  });

  it('rejects an emptied phase that drops_phases does not declare', () => {
    const doc = amendmentDoc({ dropsTasks: ['P03-T01'], blocks: ['## P03: Third', ''] });
    const error = expectInvalid(runMerge(doc));
    expect(error.found).toContain('P03');
  });

  it('rejects a drops_phases entry the merge does not actually empty', () => {
    const doc = amendmentDoc({
      addsPhases: ['P04'],
      addsTasks: ['P04-T01'],
      dropsPhases: ['P02'],
      blocks: ['## P04: Fourth', 'Revised intent.', '', '### P04-T01: New work', '**Target repo:** alpha', '', 'Body.'],
    });
    const error = expectInvalid(runMerge(doc));
    expect(error.found).toContain('P02');
  });

  it('refuses to remove a phase whose brief is frozen, even though the drop that empties it is itself legal', () => {
    const doc = amendmentDoc({ dropsTasks: ['P02-T01'], dropsPhases: ['P02'], blocks: ['## P02: Second', ''] });
    const error = expectInvalid(runMerge(doc, {
      phases: [
        { status: 'completed', tasks: ['completed', 'completed'] },
        { status: 'skipped', tasks: ['not_started'] },
        { status: 'not_started', tasks: ['not_started'] },
      ],
    }));
    expect(error.found).toContain('P02');
    expect(error.found).toContain('skipped');
  });
});

// ── Declaration cross-checks for revise and drop ────────────────────────────

describe('buildMergePlan — revise/drop declaration cross-checks', () => {
  it('rejects a task id declared in both adds_tasks and revises_tasks', () => {
    const doc = amendmentDoc({
      addsTasks: ['P03-T01'],
      revisesTasks: ['P03-T01'],
      blocks: ['## P03: Third', 'Phase three body.', '', '### P03-T01: Restated', '**Target repo:** beta', '', 'Body.'],
    });
    const error = expectInvalid(runMerge(doc));
    expect(error.found).toContain('P03-T01');
    expect(error.message).toContain('both');
  });

  it('rejects a drops_tasks id that also carries a block', () => {
    const doc = amendmentDoc({
      dropsTasks: ['P03-T01'],
      blocks: [
        '## P03: Third', 'Phase three body.', '',
        '### P03-T01: Restated fully', '**Target repo:** beta', '', 'Body.',
      ],
    });
    const error = expectInvalid(runMerge(doc));
    expect(error.found).toContain('P03-T01');
  });

  it('rejects a revises_tasks id naming a task the existing plan does not hold', () => {
    const doc = amendmentDoc({
      addsPhases: ['P04'],
      revisesTasks: ['P04-T09'],
      addsTasks: ['P04-T01'],
      blocks: [
        '## P04: Fourth', 'Revised intent.', '',
        '### P04-T01: New work', '**Target repo:** alpha', '', 'Body.', '',
        '### P04-T09: Bogus revise', '**Target repo:** alpha', '', 'Body.',
      ],
    });
    const error = expectInvalid(runMerge(doc));
    expect(error.found).toContain('P04-T09');
  });
});

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseMasterPlan } from '../../../src/lib/explode-master-plan.js';
import type { ParsedMasterPlan } from '../../../src/lib/explode-master-plan.js';
import { phaseFilename, taskFilename } from '../../../src/lib/plan-emitters.js';
import { parseYaml } from '../../../src/lib/yaml.js';
import { computeFrontier } from '../../../src/lib/amendment/frontier.js';
import type { PipelineState } from '../../../src/lib/amendment/frontier.js';
import { buildMergePlan } from '../../../src/lib/amendment/merge-check.js';
import type { AmendmentMergePlan } from '../../../src/lib/amendment/merge-check.js';
import { mergeAmendmentIntoPlan } from '../../../src/lib/amendment/merge-plan.js';
import type { PlanMergeResult, StagedWrite } from '../../../src/lib/amendment/merge-plan.js';
import { withCrlf } from '../../helpers/amendment-fixture.js';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const PROJECT = 'DEMO';
const NOW = '2026-08-24T12:00:00.000Z';

const MASTER_PLAN = [
  '---',
  'project: DEMO',
  'type: master_plan',
  'status: draft',
  'created: "2026-08-01"',
  'repos: [alpha, beta]',
  'total_phases: 3',
  'total_tasks: 4',
  '---',
  '',
  '# DEMO — Master Plan',
  '',
  '## Introduction',
  '',
  'A small plan, carried here so the writer has real frozen text to preserve.',
  '',
  '## Execution Map',
  '',
  '**P01 · First** · repos: alpha · order: T01 → T02',
  '',
  '| Task | Repo | Complexity | Purpose |',
  '|---|---|---|---|',
  '| T01 | alpha | standard | Lay the foundation. |',
  '| T02 | alpha | simple | Wire the seam. |',
  '',
  '**P02 · Second** · repos: beta · order: T01',
  '',
  '| Task | Repo | Complexity | Purpose |',
  '|---|---|---|---|',
  '| T01 | beta | standard | Serve the reader. |',
  '',
  '**P03 · Third** · repos: beta · order: T01',
  '',
  '| Task | Repo | Complexity | Purpose |',
  '|---|---|---|---|',
  '| T01 | beta | complex | Close the loop. |',
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
  '### P01-T02: Wire the seam',
  '',
  'Wire the seam.',
  '',
  '**Task type:** code',
  '**Complexity:** simple',
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
  '## P03: Third',
  '',
  '**Intent**',
  'The loop closes.',
  '',
  '### P03-T01: Close the loop',
  '',
  'Close the loop.',
  '',
  '**Task type:** code',
  '**Complexity:** complex',
  '**Target repo:** beta',
  '',
].join('\n');

const REQUIREMENTS = [
  '---',
  'project: DEMO',
  'type: requirements',
  '---',
  '',
  '# DEMO — Requirements',
  '',
  '## Functional',
  '',
  '- FR-1 the system carries the reader from end to end.',
  '',
].join('\n');

const RATIONALE = 'The operator found work the original plan did not carry.';

function amendmentDoc(opts: {
  index: number;
  addsPhases?: string[];
  addsTasks: string[];
  /** Task ids restated in full at their existing id. */
  revisesTasks?: string[];
  /** Task ids removed; no block accompanies them, so `blocks` need not mention them. */
  dropsTasks?: string[];
  /** Phase ids the amendment's drops empty. */
  dropsPhases?: string[];
  blocks: string[];
}): string {
  return [
    '---',
    'project: DEMO',
    'type: amendment',
    `amendment: ${opts.index}`,
    'created: "2026-08-24"',
    ...(opts.addsPhases === undefined ? [] : [`adds_phases: [${opts.addsPhases.join(', ')}]`]),
    `adds_tasks: [${opts.addsTasks.join(', ')}]`,
    ...(opts.revisesTasks === undefined ? [] : [`revises_tasks: [${opts.revisesTasks.join(', ')}]`]),
    ...(opts.dropsTasks === undefined ? [] : [`drops_tasks: [${opts.dropsTasks.join(', ')}]`]),
    ...(opts.dropsPhases === undefined ? [] : [`drops_phases: [${opts.dropsPhases.join(', ')}]`]),
    '---',
    '',
    '## Rationale',
    '',
    RATIONALE,
    '',
    '## Amendment Blocks',
    '',
    ...opts.blocks,
    '',
  ].join('\n');
}

function taskBlock(anchor: string, title: string, repo: string, complexity = 'standard'): string[] {
  return [
    `### ${anchor}: ${title}`,
    '',
    `${title}, in full.`,
    '',
    '**Task type:** code',
    `**Complexity:** ${complexity}`,
    `**Target repo:** ${repo}`,
    '',
  ];
}

interface StateOpts {
  phases?: { status: string; tasks: string[] }[];
  provisioned?: string[];
  /** Indices of the amendments this project has already applied; none by default.
   *  The merge checker reads it to decide which index the next one may declare. */
  appliedAmendments?: number[];
}

/** The mid-run shape the frontier reads: P01 done, P02 running, P03 untouched. */
function makeState(opts: StateOpts = {}): PipelineState {
  const phases = opts.phases ?? [
    { status: 'completed', tasks: ['completed', 'completed'] },
    { status: 'in_progress', tasks: ['completed'] },
    { status: 'not_started', tasks: ['not_started'] },
  ];
  return {
    project: { amendments: (opts.appliedAmendments ?? []).map(index => ({ index })) },
    graph: {
      nodes: {
        phase_loop: {
          kind: 'for_each_phase',
          status: 'in_progress',
          iterations: phases.map((phase, i) => ({
            index: i,
            status: phase.status,
            doc_path: null,
            nodes: {
              task_loop: {
                kind: 'for_each_task',
                status: phase.status,
                iterations: phase.tasks.map((status, j) => ({ index: j, status, doc_path: null })),
              },
            },
          })),
        },
        final_review: { kind: 'step', status: 'not_started', doc_path: null },
        final_approval_gate: { kind: 'gate', status: 'not_started' },
      },
    },
    pipeline: {
      source_control: { repos: (opts.provisioned ?? ['alpha', 'beta']).map(name => ({ name })) },
    },
  };
}

// ── Harness ──────────────────────────────────────────────────────────────────

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'merge-plan-'));
}

function parseText(text: string): ParsedMasterPlan {
  const file = path.join(tmpDir(), 'doc.md');
  fs.writeFileSync(file, text, 'utf8');
  return parseMasterPlan(file);
}

interface MergeRun {
  result: PlanMergeResult;
  plan: AmendmentMergePlan;
  masterPlanPath: string;
  requirementsPath: string;
  projectDir: string;
}

function runMerge(opts: {
  planText?: string;
  requirementsText?: string;
  amendmentText: string;
  amendmentFileName?: string;
  state?: PipelineState;
}): MergeRun {
  const projectDir = tmpDir();
  const masterPlanPath = path.join(projectDir, `${PROJECT}-MASTER-PLAN.md`);
  const requirementsPath = path.join(projectDir, `${PROJECT}-REQUIREMENTS.md`);
  const amendmentDocFileName = opts.amendmentFileName ?? `${PROJECT}-AMENDMENT-01.md`;
  const amendmentPath = path.join(projectDir, amendmentDocFileName);

  const masterPlanRaw = opts.planText ?? MASTER_PLAN;
  fs.writeFileSync(masterPlanPath, masterPlanRaw, 'utf8');
  fs.writeFileSync(requirementsPath, opts.requirementsText ?? REQUIREMENTS, 'utf8');
  fs.writeFileSync(amendmentPath, opts.amendmentText, 'utf8');

  const existing = parseMasterPlan(masterPlanPath);
  const amendment = parseMasterPlan(amendmentPath);
  const state = opts.state ?? makeState();
  const frontier = computeFrontier(state, existing);

  const outcome = buildMergePlan({ existing, amendment, frontier, state });
  if (outcome.type !== 'ok') {
    throw new Error(`fixture produced a non-ok merge outcome: ${JSON.stringify(outcome)}`);
  }

  const result = mergeAmendmentIntoPlan({
    projectDir,
    projectName: PROJECT,
    masterPlanPath,
    requirementsPath,
    masterPlanRaw,
    existing,
    amendment,
    amendmentDocFileName,
    mergePlan: outcome.plan,
    frontier,
    nowIso: NOW,
  });

  return { result, plan: outcome.plan, masterPlanPath, requirementsPath, projectDir };
}

function writtenAt(run: MergeRun, target: string): string {
  const write = run.result.writes.find(entry => entry.path === target);
  if (write === undefined) throw new Error(`no staged write for ${target}`);
  return write.contents;
}

function writesUnder(run: MergeRun, dir: string): StagedWrite[] {
  const prefix = path.join(run.projectDir, dir) + path.sep;
  return run.result.writes.filter(entry => entry.path.startsWith(prefix));
}

// Every helper below slices on `\n` alone and rejoins the same way, so a line keeps
// its own terminator and a block is the source's exact bytes. Splitting on `\r?\n`
// would erase a line-ending conversion before the comparison could see it.

/** Every phase's block, keyed by anchor: the exact source lines from its heading to the next. */
function phaseBlocks(text: string): Map<string, string> {
  const parsed = parseText(text);
  const lines = text.split('\n');
  const blocks = new Map<string, string>();
  parsed.phases.forEach((phase, i) => {
    const end = parsed.phases[i + 1]?.startLine ?? lines.length + 1;
    blocks.set(phase.id, lines.slice(phase.startLine - 1, end - 1).join('\n'));
  });
  return blocks;
}

/** Every task's block, keyed by anchor, on the same slicing rule. */
function taskBlocks(text: string): Map<string, string> {
  const parsed = parseText(text);
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

/** A phase's brief: its heading through to its first task heading. */
function briefRegion(text: string, anchor: string): string {
  const parsed = parseText(text);
  const lines = text.split('\n');
  const at = parsed.phases.findIndex(phase => phase.id === anchor);
  const phase = parsed.phases[at]!;
  const end = phase.tasks[0]?.startLine ?? parsed.phases[at + 1]?.startLine ?? lines.length + 1;
  return lines.slice(phase.startLine - 1, end - 1).join('\n');
}

/** A block with its anchors neutralised, so a renumbered block can be compared to its source. */
function withoutAnchorIds(block: string): string {
  return block
    .replace(/^##\s+P\d{2}(?=:)/gm, '## P')
    .replace(/^###\s+P\d{2}-T\d{2}(?=:)/gm, '### P-T');
}

function preambleRegion(text: string): string[] {
  const parsed = parseText(text);
  const first = parsed.phases[0]!.startLine;
  return text.split('\n').slice(0, first - 1);
}

function countMatches(text: string, re: RegExp): number {
  return (text.match(re) ?? []).length;
}

/** The YAML frontmatter of an emitted phase plan or task handoff. */
function frontmatterOf(doc: string): Record<string, unknown> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(doc);
  if (match === null) throw new Error('emitted document carries no frontmatter');
  return parseYaml<Record<string, unknown>>(match[1]!) ?? {};
}

// ── Amendments used across the suite ─────────────────────────────────────────

const APPENDS_A_PHASE = amendmentDoc({
  index: 1,
  addsPhases: ['P04'],
  addsTasks: ['P04-T01', 'P04-T02'],
  blocks: [
    '## P04: Follow on',
    '',
    '**Intent**',
    'The follow-on capability exists.',
    '',
    ...taskBlock('P04-T01', 'Build the follow on', 'alpha'),
    ...taskBlock('P04-T02', 'Verify the follow on', 'beta', 'simple'),
  ],
});

const ADDS_A_TASK = amendmentDoc({
  index: 1,
  addsTasks: ['P02-T02'],
  blocks: [
    '## P02: Second',
    '',
    '**Intent**',
    'The reader is served, and now audited too.',
    '',
    '**Exit criteria**',
    '- The audit trail is readable.',
    '',
    ...taskBlock('P02-T02', 'Audit the reader', 'beta'),
  ],
});

const INSERTS_A_PHASE = amendmentDoc({
  index: 1,
  addsPhases: ['P02'],
  addsTasks: ['P02-T01'],
  blocks: [
    '## P02: Interlude',
    '',
    '**Intent**',
    'A step the plan skipped.',
    '',
    ...taskBlock('P02-T01', 'Fill the gap', 'beta'),
  ],
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('mergeAmendmentIntoPlan — appending a phase', () => {
  const run = runMerge({ amendmentText: APPENDS_A_PHASE });
  const merged = writtenAt(run, run.masterPlanPath);

  it('leaves every pre-existing phase block byte-identical', () => {
    const before = phaseBlocks(MASTER_PLAN);
    const after = phaseBlocks(merged);
    for (const [anchor, block] of before) {
      expect(after.get(anchor)).toBe(block);
    }
  });

  it('carries the new phase and its tasks into the plan', () => {
    const after = parseText(merged);
    expect(after.phases).toHaveLength(4);
    expect(after.phases[3]!.tasks.map(task => task.id)).toEqual(['P04-T01', 'P04-T02']);
  });

  it('regenerates the Execution Map above the first phase heading, indexing every phase', () => {
    const region = preambleRegion(merged);
    expect(region.some(line => /^##\s+Execution Map\s*$/.test(line))).toBe(true);
    for (const phase of parseText(merged).phases) {
      expect(region.some(line => line.includes(`**${phase.id} · ${phase.title}**`))).toBe(true);
    }
  });

  it('keeps the Execution Map region free of lines the parser would read as anchors', () => {
    for (const line of preambleRegion(merged)) {
      expect(/^##\s+(P\d|Phase\b)/i.test(line)).toBe(false);
      expect(/^###\s+P\d/.test(line)).toBe(false);
    }
  });

  it('describes the file it built — merged startLines match a fresh parse', () => {
    const after = parseText(merged);
    expect(run.result.merged.phases.map(phase => phase.startLine)).toEqual(
      after.phases.map(phase => phase.startLine),
    );
    expect(run.result.merged.phases.flatMap(p => p.tasks.map(t => t.startLine))).toEqual(
      after.phases.flatMap(p => p.tasks.map(t => t.startLine)),
    );
  });

  it('re-parses with frontmatter totals matching the merged block counts', () => {
    const after = parseText(merged);
    const taskCount = after.phases.reduce((sum, phase) => sum + phase.tasks.length, 0);
    expect(after.frontmatter['total_phases']).toBe(after.phases.length);
    expect(after.frontmatter['total_tasks']).toBe(taskCount);
  });

  it('marks the introduced phase and tasks in frontmatter, and leaves their titles bare', () => {
    const phaseWrites = writesUnder(run, 'phases');
    expect(phaseWrites).toHaveLength(1);
    expect(frontmatterOf(phaseWrites[0]!.contents)['amendment']).toBe(1);

    const taskWrites = writesUnder(run, 'tasks');
    expect(taskWrites).toHaveLength(2);
    for (const write of taskWrites) {
      const frontmatter = frontmatterOf(write.contents);
      expect(frontmatter['amendment']).toBe(1);
      expect(String(frontmatter['title'])).not.toContain('(Amendment 1)');
    }
    expect(run.result.merged.phases[3]!.title).not.toContain('(Amendment 1)');
  });

  it('names the new documents through the shared filename emitters', () => {
    const newPhase = run.result.merged.phases[3]!;
    expect(writesUnder(run, 'phases').map(w => path.basename(w.path))).toEqual([
      phaseFilename(PROJECT, newPhase),
    ]);
    expect(writesUnder(run, 'tasks').map(w => path.basename(w.path))).toEqual(
      newPhase.tasks.map(task => taskFilename(PROJECT, task)),
    );
  });
});

describe('mergeAmendmentIntoPlan — adding a task to a running phase', () => {
  const run = runMerge({ amendmentText: ADDS_A_TASK });
  const merged = writtenAt(run, run.masterPlanPath);

  it('leaves every frozen phase block byte-identical', () => {
    const before = phaseBlocks(MASTER_PLAN);
    const after = phaseBlocks(merged);
    for (const anchor of ['P01', 'P03']) {
      expect(after.get(anchor)).toBe(before.get(anchor));
    }
  });

  it('replaces the running phase brief but carries its worked task through verbatim', () => {
    expect(phaseBlocks(merged).get('P02')).not.toBe(phaseBlocks(MASTER_PLAN).get('P02'));
    expect(taskBlocks(merged).get('P02-T01')).toBe(taskBlocks(MASTER_PLAN).get('P02-T01'));
    expect(parseText(merged).phases[1]!.body).toContain('audited');
  });

  it('rewrites only the amended phase document', () => {
    const phaseWrites = writesUnder(run, 'phases');
    expect(phaseWrites.map(w => path.basename(w.path))).toEqual([
      phaseFilename(PROJECT, run.result.merged.phases[1]!),
    ]);
  });

  it('emits a handoff for the new task and for no other', () => {
    const newTask = run.result.merged.phases[1]!.tasks[1]!;
    expect(writesUnder(run, 'tasks').map(w => path.basename(w.path))).toEqual([
      taskFilename(PROJECT, newTask),
    ]);
    expect(run.plan.addsTasks.map(task => task.id)).toEqual(['P02-T02']);
  });

  it('re-parses with the new task counted in the frontmatter totals', () => {
    const after = parseText(merged);
    const taskCount = after.phases.reduce((sum, phase) => sum + phase.tasks.length, 0);
    expect(taskCount).toBe(5);
    expect(after.frontmatter['total_tasks']).toBe(taskCount);
  });

  it('keeps the brief when the amendment block carries only a heading to host the task', () => {
    const hostOnly = runMerge({
      amendmentText: amendmentDoc({
        index: 1,
        addsTasks: ['P02-T02'],
        blocks: ['## P02: Second', '', ...taskBlock('P02-T02', 'Audit the reader', 'beta')],
      }),
    });
    const plan = writtenAt(hostOnly, hostOnly.masterPlanPath);
    expect(briefRegion(plan, 'P02')).toBe(briefRegion(MASTER_PLAN, 'P02'));
    expect(writesUnder(hostOnly, 'phases')).toHaveLength(1);
    expect(parseText(plan).phases[1]!.tasks).toHaveLength(2);
  });
});

describe('mergeAmendmentIntoPlan — inserting a phase that renumbers what follows', () => {
  const run = runMerge({ amendmentText: INSERTS_A_PHASE });
  const merged = writtenAt(run, run.masterPlanPath);

  it('leaves the completed phase ahead of the insertion point byte-identical', () => {
    expect(phaseBlocks(merged).get('P01')).toBe(phaseBlocks(MASTER_PLAN).get('P01'));
  });

  it('renumbers the displaced phases without touching a byte below their anchors', () => {
    const before = phaseBlocks(MASTER_PLAN);
    const after = phaseBlocks(merged);
    expect(withoutAnchorIds(after.get('P03')!)).toBe(withoutAnchorIds(before.get('P02')!));
    expect(withoutAnchorIds(after.get('P04')!)).toBe(withoutAnchorIds(before.get('P03')!));
  });

  it('re-parses, and the displaced phases keep their titles at their new anchors', () => {
    const after = parseText(merged);
    expect(after.phases.map(phase => phase.title)).toEqual([
      'First',
      'Interlude',
      'Second',
      'Third',
    ]);
    expect(after.frontmatter['total_phases']).toBe(4);
  });

  it('carries no pre-existing task handoff in the writes', () => {
    const newTask = run.result.merged.phases[1]!.tasks[0]!;
    expect(writesUnder(run, 'tasks').map(w => path.basename(w.path))).toEqual([
      taskFilename(PROJECT, newTask),
    ]);
  });

  it('preserves a completed phase that sits after the insertion point', () => {
    // Statuses out of run order are unreachable in a sequential run, but the frontier
    // reads status per phase — so the displaced-frozen case is exercised deliberately.
    const outOfOrder = runMerge({
      amendmentText: INSERTS_A_PHASE,
      state: makeState({
        phases: [
          { status: 'completed', tasks: ['completed', 'completed'] },
          { status: 'not_started', tasks: ['not_started'] },
          { status: 'completed', tasks: ['completed'] },
        ],
      }),
    });
    const after = phaseBlocks(writtenAt(outOfOrder, outOfOrder.masterPlanPath));
    expect(withoutAnchorIds(after.get('P04')!)).toBe(withoutAnchorIds(phaseBlocks(MASTER_PLAN).get('P03')!));
  });
});

describe('mergeAmendmentIntoPlan — repo scope', () => {
  const run = runMerge({
    amendmentText: amendmentDoc({
      index: 1,
      addsPhases: ['P04'],
      addsTasks: ['P04-T01'],
      blocks: [
        '## P04: Reach further',
        '',
        '**Intent**',
        'A third repo joins the plan.',
        '',
        ...taskBlock('P04-T01', 'Extend into gamma', 'gamma'),
      ],
    }),
    state: makeState({ provisioned: ['alpha', 'beta', 'gamma'] }),
  });

  it('grows the sealed repo array to cover the new task target', () => {
    const after = parseText(writtenAt(run, run.masterPlanPath));
    expect(after.frontmatter['repos']).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('holds the seal equality in both directions — the parse itself enforces it', () => {
    const after = parseText(writtenAt(run, run.masterPlanPath));
    const targeted = new Set(after.phases.flatMap(p => p.tasks.flatMap(t => t.targetRepos)));
    expect([...(after.frontmatter['repos'] as string[])].sort()).toEqual([...targeted].sort());
  });
});

describe('mergeAmendmentIntoPlan — the requirements record', () => {
  const run = runMerge({ amendmentText: APPENDS_A_PHASE });
  const requirements = writtenAt(run, run.requirementsPath);

  it('leaves the original body byte-identical above the appended section', () => {
    expect(requirements.startsWith(REQUIREMENTS)).toBe(true);
  });

  it('opens an amendments section carrying a link to the amendment document', () => {
    expect(countMatches(requirements, /^##\s+Amendments\s*$/gm)).toBe(1);
    expect(countMatches(requirements, /\]\(DEMO-AMENDMENT-01\.md\)/g)).toBe(1);
  });

  it('transcribes the rationale out of the amendment document', () => {
    expect(requirements).toContain(RATIONALE);
  });

  it('carries neither a Revises nor a Drops line for a purely additive amendment', () => {
    expect(requirements).not.toContain('Revises:');
    expect(requirements).not.toContain('Drops:');
  });
});

describe('mergeAmendmentIntoPlan — the requirements record for a revising and dropping amendment', () => {
  const run = runMerge({
    amendmentText: amendmentDoc({
      index: 1,
      addsTasks: [],
      revisesTasks: ['P02-T01'],
      dropsTasks: ['P03-T01'],
      dropsPhases: ['P03'],
      blocks: [
        '## P02: Second',
        '',
        ...taskBlock('P02-T01', 'Serve the reader, revised', 'beta'),
      ],
    }),
    state: makeState({
      phases: [
        { status: 'completed', tasks: ['completed', 'completed'] },
        { status: 'not_started', tasks: ['not_started'] },
        { status: 'not_started', tasks: ['not_started'] },
      ],
    }),
  });
  const requirements = writtenAt(run, run.requirementsPath);

  it('names what the amendment revised and dropped, not only what it added', () => {
    expect(requirements).toContain('Revises: P02-T01');
    expect(requirements).toContain('Drops: P03-T01, P03');
  });
});

describe('mergeAmendmentIntoPlan — a second amendment', () => {
  const first = runMerge({ amendmentText: APPENDS_A_PHASE });
  const firstPlan = writtenAt(first, first.masterPlanPath);
  const firstRequirements = writtenAt(first, first.requirementsPath);

  const second = runMerge({
    planText: firstPlan,
    requirementsText: firstRequirements,
    amendmentFileName: `${PROJECT}-AMENDMENT-02.md`,
    amendmentText: amendmentDoc({
      index: 2,
      addsPhases: ['P05'],
      addsTasks: ['P05-T01'],
      blocks: [
        '## P05: Later still',
        '',
        '**Intent**',
        'One more capability.',
        '',
        ...taskBlock('P05-T01', 'Land the last piece', 'beta'),
      ],
    }),
    state: makeState({
      appliedAmendments: [1],
      phases: [
        { status: 'completed', tasks: ['completed', 'completed'] },
        { status: 'in_progress', tasks: ['completed'] },
        { status: 'not_started', tasks: ['not_started'] },
        { status: 'not_started', tasks: ['not_started', 'not_started'] },
      ],
    }),
  });
  const secondPlan = writtenAt(second, second.masterPlanPath);
  const secondRequirements = writtenAt(second, second.requirementsPath);

  it('appends its own entry under the one section, leaving the first entry intact', () => {
    expect(secondRequirements.startsWith(firstRequirements)).toBe(true);
    expect(countMatches(secondRequirements, /^##\s+Amendments\s*$/gm)).toBe(1);
    expect(countMatches(secondRequirements, /\]\(DEMO-AMENDMENT-\d\d\.md\)/g)).toBe(2);
  });

  it('lists both amendment documents in the plan preamble', () => {
    const region = preambleRegion(secondPlan).join('\n');
    expect(countMatches(region, /\]\(DEMO-AMENDMENT-\d\d\.md\)/g)).toBe(2);
  });

  it('leaves the first amendment’s phase block byte-identical in the second merge', () => {
    expect(phaseBlocks(secondPlan).get('P04')).toBe(phaseBlocks(firstPlan).get('P04'));
    expect(parseText(secondPlan).phases).toHaveLength(5);
  });
});

describe('mergeAmendmentIntoPlan — a second amendment restating a phase the first introduced', () => {
  // `runMerge` starts each call from a fresh project directory; this scenario needs
  // the first merge's staged writes actually landed on disk before the second runs,
  // the way `amendment apply`'s commit lands them — otherwise there is nothing on
  // disk for the second merge to read the origin marker back off.
  const projectDir = tmpDir();
  const masterPlanPath = path.join(projectDir, `${PROJECT}-MASTER-PLAN.md`);
  const requirementsPath = path.join(projectDir, `${PROJECT}-REQUIREMENTS.md`);

  function landWrites(writes: StagedWrite[]): void {
    for (const write of writes) {
      fs.mkdirSync(path.dirname(write.path), { recursive: true });
      fs.writeFileSync(write.path, write.contents, 'utf8');
    }
  }

  fs.writeFileSync(masterPlanPath, MASTER_PLAN, 'utf8');
  fs.writeFileSync(requirementsPath, REQUIREMENTS, 'utf8');

  const firstAmendmentPath = path.join(projectDir, `${PROJECT}-AMENDMENT-01.md`);
  fs.writeFileSync(firstAmendmentPath, APPENDS_A_PHASE, 'utf8');

  const stateAfterFirst = makeState({
    appliedAmendments: [1],
    phases: [
      { status: 'completed', tasks: ['completed', 'completed'] },
      { status: 'in_progress', tasks: ['completed'] },
      { status: 'not_started', tasks: ['not_started'] },
      { status: 'not_started', tasks: ['not_started', 'not_started'] },
    ],
  });

  const firstExisting = parseMasterPlan(masterPlanPath);
  const firstAmendment = parseMasterPlan(firstAmendmentPath);
  const firstFrontier = computeFrontier(makeState(), firstExisting);
  const firstOutcome = buildMergePlan({
    existing: firstExisting,
    amendment: firstAmendment,
    frontier: firstFrontier,
    state: makeState(),
  });
  if (firstOutcome.type !== 'ok') throw new Error('fixture produced a non-ok first merge outcome');
  const firstResult = mergeAmendmentIntoPlan({
    projectDir,
    projectName: PROJECT,
    masterPlanPath,
    requirementsPath,
    masterPlanRaw: MASTER_PLAN,
    existing: firstExisting,
    amendment: firstAmendment,
    amendmentDocFileName: `${PROJECT}-AMENDMENT-01.md`,
    mergePlan: firstOutcome.plan,
    frontier: firstFrontier,
    nowIso: NOW,
  });
  landWrites(firstResult.writes);
  const firstPlanText = writtenAt({ result: firstResult, plan: firstOutcome.plan, masterPlanPath, requirementsPath, projectDir }, masterPlanPath);

  // The second amendment restates P04 (amendment 1's phase) to host a new task.
  // Its own block carries the plain, unmarked title — exactly what the amendment
  // author writes, since nothing derives meaning from parsing a title string.
  const secondAmendmentPath = path.join(projectDir, `${PROJECT}-AMENDMENT-02.md`);
  const secondAmendmentText = amendmentDoc({
    index: 2,
    addsTasks: ['P04-T03'],
    blocks: [
      '## P04: Follow on',
      '',
      '**Intent**',
      'The follow-on capability exists.',
      '',
      ...taskBlock('P04-T03', 'Extend the follow on', 'alpha'),
    ],
  });
  fs.writeFileSync(secondAmendmentPath, secondAmendmentText, 'utf8');

  const secondExisting = parseMasterPlan(masterPlanPath);
  const secondAmendment = parseMasterPlan(secondAmendmentPath);
  const secondFrontier = computeFrontier(stateAfterFirst, secondExisting);
  const secondOutcome = buildMergePlan({
    existing: secondExisting,
    amendment: secondAmendment,
    frontier: secondFrontier,
    state: stateAfterFirst,
  });
  if (secondOutcome.type !== 'ok') throw new Error('fixture produced a non-ok second merge outcome');
  const secondResult = mergeAmendmentIntoPlan({
    projectDir,
    projectName: PROJECT,
    masterPlanPath,
    requirementsPath,
    masterPlanRaw: firstPlanText,
    existing: secondExisting,
    amendment: secondAmendment,
    amendmentDocFileName: `${PROJECT}-AMENDMENT-02.md`,
    mergePlan: secondOutcome.plan,
    frontier: secondFrontier,
    nowIso: NOW,
  });
  const secondPlan = secondResult.writes.find(w => w.path === masterPlanPath)!.contents;
  const secondPhaseWrite = secondResult.writes.find(w => w.path.includes(`${path.sep}phases${path.sep}`) && w.path.includes('FOLLOW-ON'))!;

  it('leaves the restated phase’s Master Plan heading bare, from either amendment', () => {
    const after = parseText(secondPlan);
    const p04 = after.phases.find(phase => phase.id === 'P04')!;
    expect(p04.title).toBe('Follow on');
  });

  it('leaves the regenerated Execution Map line bare, from either amendment', () => {
    const region = preambleRegion(secondPlan).join('\n');
    expect(region).toContain('**P04 · Follow on**');
    expect(region).not.toContain('(Amendment');
  });

  it('keeps the origin amendment key on the rewritten phase-plan document, with a bare title', () => {
    expect(secondPhaseWrite).toBeDefined();
    const frontmatter = frontmatterOf(secondPhaseWrite.contents);
    expect(frontmatter['amendment']).toBe(1);
    expect(String(frontmatter['title'])).toBe('Follow on');
  });

  it('marks the second amendment’s own new task with its own index', () => {
    const taskWrite = secondResult.writes.find(w => w.path.includes(`${path.sep}tasks${path.sep}`) && w.path.includes('EXTEND-THE-FOLLOW-ON'))!;
    expect(taskWrite).toBeDefined();
    expect(frontmatterOf(taskWrite.contents)['amendment']).toBe(2);
  });
});

const REVISES_A_TASK = amendmentDoc({
  index: 1,
  addsTasks: [],
  revisesTasks: ['P03-T01'],
  blocks: [
    '## P03: Third',
    '',
    ...taskBlock('P03-T01', 'Close the loop for good', 'beta', 'complex'),
  ],
});

describe('mergeAmendmentIntoPlan — revising a task the original plan carried', () => {
  const run = runMerge({ amendmentText: REVISES_A_TASK });
  const merged = writtenAt(run, run.masterPlanPath);

  it('leaves every other phase and task block byte-identical', () => {
    const before = phaseBlocks(MASTER_PLAN);
    const after = phaseBlocks(merged);
    expect(after.get('P01')).toBe(before.get('P01'));
    expect(after.get('P02')).toBe(before.get('P02'));
    for (const anchor of ['P01-T01', 'P01-T02', 'P02-T01']) {
      expect(taskBlocks(merged).get(anchor)).toBe(taskBlocks(MASTER_PLAN).get(anchor));
    }
  });

  it("renders the revised block at the task's existing id, carrying the amendment's new text", () => {
    const after = parseText(merged);
    const task = after.phases[2]!.tasks[0]!;
    expect(task.id).toBe('P03-T01');
    expect(task.title).toBe('Close the loop for good');
    expect(task.complexity).toBe('complex');
    expect(task.body).toContain('Close the loop for good, in full.');
  });

  it("rewrites the task's handoff from the revised text, at its existing filename, carrying no marker", () => {
    const writes = writesUnder(run, 'tasks');
    expect(writes).toHaveLength(1);
    expect(path.basename(writes[0]!.path)).toBe(
      taskFilename(PROJECT, parseText(MASTER_PLAN).phases[2]!.tasks[0]!),
    );
    const frontmatter = frontmatterOf(writes[0]!.contents);
    expect(frontmatter['amendment']).toBeUndefined();
    expect(String(frontmatter['title'])).toBe('Close the loop for good');
    expect(writes[0]!.contents).toContain('Close the loop for good, in full.');
  });

  it('emits no deletions, and carries the phase brief through unchanged even though its task table is rewritten', () => {
    expect(run.result.deletes).toEqual([]);
    const phaseWrites = writesUnder(run, 'phases');
    expect(phaseWrites).toHaveLength(1);
    expect(phaseWrites[0]!.contents).toContain('The loop closes.');
    expect(frontmatterOf(phaseWrites[0]!.contents)['amendment']).toBeUndefined();
  });
});

describe('mergeAmendmentIntoPlan — revising and introducing a task in the same amendment', () => {
  const run = runMerge({
    amendmentText: amendmentDoc({
      index: 1,
      addsPhases: ['P04'],
      addsTasks: ['P04-T01'],
      revisesTasks: ['P03-T01'],
      blocks: [
        '## P03: Third',
        '',
        ...taskBlock('P03-T01', 'Close the loop for good', 'beta', 'complex'),
        '## P04: Follow on',
        '',
        '**Intent**',
        'The follow-on capability exists.',
        '',
        ...taskBlock('P04-T01', 'Build the follow on', 'alpha'),
      ],
    }),
  });
  const merged = writtenAt(run, run.masterPlanPath);

  it("marks the introduced task with the reviser's own index in frontmatter, and leaves both titles bare", () => {
    const after = parseText(merged);
    expect(after.phases[2]!.tasks[0]!.title).toBe('Close the loop for good');
    expect(after.phases[3]!.tasks[0]!.title).toBe('Build the follow on');

    const taskWrites = writesUnder(run, 'tasks');
    const revisedWrite = taskWrites.find(write => path.basename(write.path).includes('CLOSE-THE-LOOP'))!;
    const introducedWrite = taskWrites.find(write => path.basename(write.path).includes('BUILD-THE-FOLLOW-ON'))!;
    expect(revisedWrite).toBeDefined();
    expect(introducedWrite).toBeDefined();
    expect(frontmatterOf(revisedWrite.contents)['amendment']).toBeUndefined();
    expect(frontmatterOf(introducedWrite.contents)['amendment']).toBe(1);
  });
});

describe('mergeAmendmentIntoPlan — a second amendment revising a task the first introduced', () => {
  // Mirrors the phase-level fixture above: the second merge needs the first merge's
  // staged writes actually landed on disk, so there is a task handoff to read the
  // origin marker back off.
  const projectDir = tmpDir();
  const masterPlanPath = path.join(projectDir, `${PROJECT}-MASTER-PLAN.md`);
  const requirementsPath = path.join(projectDir, `${PROJECT}-REQUIREMENTS.md`);

  function landWrites(writes: StagedWrite[]): void {
    for (const write of writes) {
      fs.mkdirSync(path.dirname(write.path), { recursive: true });
      fs.writeFileSync(write.path, write.contents, 'utf8');
    }
  }

  fs.writeFileSync(masterPlanPath, MASTER_PLAN, 'utf8');
  fs.writeFileSync(requirementsPath, REQUIREMENTS, 'utf8');

  const firstAmendmentPath = path.join(projectDir, `${PROJECT}-AMENDMENT-01.md`);
  fs.writeFileSync(firstAmendmentPath, APPENDS_A_PHASE, 'utf8');

  const stateAfterFirst = makeState({
    appliedAmendments: [1],
    phases: [
      { status: 'completed', tasks: ['completed', 'completed'] },
      { status: 'in_progress', tasks: ['completed'] },
      { status: 'not_started', tasks: ['not_started'] },
      { status: 'not_started', tasks: ['not_started', 'not_started'] },
    ],
  });

  const firstExisting = parseMasterPlan(masterPlanPath);
  const firstAmendment = parseMasterPlan(firstAmendmentPath);
  const firstFrontier = computeFrontier(makeState(), firstExisting);
  const firstOutcome = buildMergePlan({
    existing: firstExisting,
    amendment: firstAmendment,
    frontier: firstFrontier,
    state: makeState(),
  });
  if (firstOutcome.type !== 'ok') throw new Error('fixture produced a non-ok first merge outcome');
  const firstResult = mergeAmendmentIntoPlan({
    projectDir,
    projectName: PROJECT,
    masterPlanPath,
    requirementsPath,
    masterPlanRaw: MASTER_PLAN,
    existing: firstExisting,
    amendment: firstAmendment,
    amendmentDocFileName: `${PROJECT}-AMENDMENT-01.md`,
    mergePlan: firstOutcome.plan,
    frontier: firstFrontier,
    nowIso: NOW,
  });
  landWrites(firstResult.writes);
  const firstPlanText = firstResult.writes.find(w => w.path === masterPlanPath)!.contents;

  // The second amendment revises P04-T01 (amendment 1's task). Its own block carries
  // the plain, unmarked title — exactly what the amendment author writes, since
  // nothing derives meaning from parsing a title string.
  const secondAmendmentPath = path.join(projectDir, `${PROJECT}-AMENDMENT-02.md`);
  const secondAmendmentText = amendmentDoc({
    index: 2,
    addsTasks: [],
    revisesTasks: ['P04-T01'],
    blocks: [
      '## P04: Follow on',
      '',
      ...taskBlock('P04-T01', 'Build the follow on, revised', 'alpha'),
    ],
  });
  fs.writeFileSync(secondAmendmentPath, secondAmendmentText, 'utf8');

  const secondExisting = parseMasterPlan(masterPlanPath);
  const secondAmendment = parseMasterPlan(secondAmendmentPath);
  const secondFrontier = computeFrontier(stateAfterFirst, secondExisting);
  const secondOutcome = buildMergePlan({
    existing: secondExisting,
    amendment: secondAmendment,
    frontier: secondFrontier,
    state: stateAfterFirst,
  });
  if (secondOutcome.type !== 'ok') throw new Error('fixture produced a non-ok second merge outcome');
  const secondResult = mergeAmendmentIntoPlan({
    projectDir,
    projectName: PROJECT,
    masterPlanPath,
    requirementsPath,
    masterPlanRaw: firstPlanText,
    existing: secondExisting,
    amendment: secondAmendment,
    amendmentDocFileName: `${PROJECT}-AMENDMENT-02.md`,
    mergePlan: secondOutcome.plan,
    frontier: secondFrontier,
    nowIso: NOW,
  });
  const secondPlan = secondResult.writes.find(w => w.path === masterPlanPath)!.contents;
  const secondTaskWrite = secondResult.writes.find(
    w => w.path.includes(`${path.sep}tasks${path.sep}`) && w.path.includes('BUILD-THE-FOLLOW-ON'),
  )!;

  it("leaves the revised task's Master Plan heading bare, from either amendment", () => {
    const after = parseText(secondPlan);
    const task = after.phases[3]!.tasks[0]!;
    expect(task.title).toBe('Build the follow on, revised');
  });

  it('keeps the origin amendment key on the rewritten task handoff, with a bare title', () => {
    expect(secondTaskWrite).toBeDefined();
    const frontmatter = frontmatterOf(secondTaskWrite.contents);
    expect(frontmatter['amendment']).toBe(1);
    expect(String(frontmatter['title'])).toBe('Build the follow on, revised');
  });

  it('rewrites the same handoff file amendment 1 already created, rather than a new one at the merged id', () => {
    const firstTaskWrite = firstResult.writes.find(
      w => w.path.includes(`${path.sep}tasks${path.sep}`) && w.path.includes('BUILD-THE-FOLLOW-ON'),
    )!;
    expect(firstTaskWrite).toBeDefined();
    expect(secondTaskWrite.path).toBe(firstTaskWrite.path);
  });
});

describe('mergeAmendmentIntoPlan — dropping a task and the phase it empties', () => {
  const run = runMerge({
    amendmentText: amendmentDoc({
      index: 1,
      addsTasks: [],
      dropsTasks: ['P03-T01'],
      dropsPhases: ['P03'],
      blocks: ['## P03: Third', ''],
    }),
  });
  const merged = writtenAt(run, run.masterPlanPath);

  it('removes the dropped phase from the rebuilt Master Plan and recomputes the totals', () => {
    const after = parseText(merged);
    expect(after.phases.map(phase => phase.id)).toEqual(['P01', 'P02']);
    expect(after.frontmatter['total_phases']).toBe(2);
    expect(after.frontmatter['total_tasks']).toBe(3);
  });

  it('leaves the surviving phases byte-identical', () => {
    const before = phaseBlocks(MASTER_PLAN);
    const after = phaseBlocks(merged);
    expect(after.get('P01')).toBe(before.get('P01'));
    expect(after.get('P02')).toBe(before.get('P02'));
  });

  it("stages the dropped task's handoff and the dropped phase's plan document for deletion, and nothing else", () => {
    const original = parseText(MASTER_PLAN);
    const p03Phase = original.phases[2]!;
    const p03Task = p03Phase.tasks[0]!;
    expect(run.result.deletes).toEqual(expect.arrayContaining([
      { path: path.join(run.projectDir, 'tasks', taskFilename(PROJECT, p03Task)), what: 'task handoff P03-T01' },
      { path: path.join(run.projectDir, 'phases', phaseFilename(PROJECT, p03Phase)), what: 'phase plan P03' },
    ]));
    expect(run.result.deletes).toHaveLength(2);
  });

  it('emits no write for the dropped phase or task', () => {
    expect(writesUnder(run, 'phases')).toEqual([]);
    expect(writesUnder(run, 'tasks')).toEqual([]);
  });
});

const DROPS_AND_SPLICES = amendmentDoc({
  index: 1,
  addsPhases: ['P02'],
  addsTasks: ['P01-T02', 'P02-T01'],
  dropsTasks: ['P01-T01'],
  blocks: [
    '## P01: First',
    '',
    ...taskBlock('P01-T02', 'Reinforce the foundation', 'alpha'),
    '## P02: Interlude',
    '',
    '**Intent**',
    'A step the plan skipped.',
    '',
    ...taskBlock('P02-T01', 'Fill the gap', 'beta'),
  ],
});

describe('mergeAmendmentIntoPlan — a drop and a splice in the same amendment', () => {
  const run = runMerge({
    amendmentText: DROPS_AND_SPLICES,
    state: makeState({
      phases: [
        { status: 'not_started', tasks: ['not_started', 'not_started'] },
        { status: 'in_progress', tasks: ['completed'] },
        { status: 'not_started', tasks: ['not_started'] },
      ],
    }),
  });
  const merged = writtenAt(run, run.masterPlanPath);

  it("drops P01's first task and carries its surviving task down into the freed slot", () => {
    expect(run.plan.dropsTasks).toEqual(['P01-T01']);
    const before = taskBlocks(MASTER_PLAN);
    const after = taskBlocks(merged);
    expect(withoutAnchorIds(after.get('P01-T01')!)).toBe(withoutAnchorIds(before.get('P01-T02')!));
  });

  it("lands the added task after the carried one, and the new phase ahead of the displaced ones", () => {
    const after = parseText(merged);
    expect(after.phases.map(phase => phase.id)).toEqual(['P01', 'P02', 'P03', 'P04']);
    expect(after.phases[0]!.tasks.map(task => task.id)).toEqual(['P01-T01', 'P01-T02']);
    expect(after.phases[0]!.tasks[1]!.title).toBe('Reinforce the foundation');
    expect(after.phases.map(phase => phase.title)).toEqual(['First', 'Interlude', 'Second', 'Third']);
  });

  it('agrees with the merge plan on where every displaced task and phase landed', () => {
    expect(run.plan.numbering.tasks.get('P01-T02')).toBe('P01-T01');
    expect(run.plan.numbering.tasks.get('P02-T01')).toBe('P03-T01');
    expect(run.plan.numbering.tasks.get('P03-T01')).toBe('P04-T01');
    expect(run.plan.numbering.phases.get('P02')).toBe('P03');
    expect(run.plan.numbering.phases.get('P03')).toBe('P04');
  });

  it("stages only the dropped task's handoff for deletion, built from its pre-merge filename", () => {
    const original = parseText(MASTER_PLAN);
    const droppedTask = original.phases[0]!.tasks[0]!;
    expect(run.result.deletes).toEqual([
      { path: path.join(run.projectDir, 'tasks', taskFilename(PROJECT, droppedTask)), what: 'task handoff P01-T01' },
    ]);
  });
});

describe('mergeAmendmentIntoPlan — a CRLF source that both revises and drops', () => {
  const CRLF_PLAN = withCrlf(MASTER_PLAN);
  const run = runMerge({
    planText: CRLF_PLAN,
    amendmentText: amendmentDoc({
      index: 1,
      addsTasks: [],
      revisesTasks: ['P02-T01'],
      dropsTasks: ['P03-T01'],
      dropsPhases: ['P03'],
      blocks: [
        '## P02: Second',
        '',
        ...taskBlock('P02-T01', 'Serve the reader, revised', 'beta'),
      ],
    }),
    state: makeState({
      phases: [
        { status: 'completed', tasks: ['completed', 'completed'] },
        { status: 'not_started', tasks: ['not_started'] },
        { status: 'not_started', tasks: ['not_started'] },
      ],
    }),
  });
  const merged = writtenAt(run, run.masterPlanPath);

  /** The lines a document ended the other way — empty when its convention held. */
  function terminatedWithLfOnly(text: string): string[] {
    return text.split('\n').slice(0, -1).filter(line => !line.endsWith('\r'));
  }

  it('leaves no line of the rebuilt document ended the other way', () => {
    expect(terminatedWithLfOnly(merged)).toEqual([]);
  });

  it("renders the revised block in the document's own convention", () => {
    const after = parseText(merged);
    expect(after.phases[1]!.tasks[0]!.title).toBe('Serve the reader, revised');
  });

  it('leaves the untouched frozen block byte-identical, CRLF included', () => {
    const before = phaseBlocks(CRLF_PLAN).get('P01')!;
    expect(before).toContain('\r\n');
    expect(merged).toContain(before);
  });

  it('removes the dropped phase and stages its deletion alongside the dropped task', () => {
    const after = parseText(merged);
    expect(after.phases.map(phase => phase.id)).toEqual(['P01', 'P02']);
    expect(run.result.deletes).toHaveLength(2);
  });
});

describe('mergeAmendmentIntoPlan — a source authored with CRLF line endings', () => {
  const CRLF_PLAN = withCrlf(MASTER_PLAN);
  const CRLF_REQUIREMENTS = withCrlf(REQUIREMENTS);
  const run = runMerge({
    planText: CRLF_PLAN,
    requirementsText: CRLF_REQUIREMENTS,
    amendmentText: APPENDS_A_PHASE,
  });
  const merged = writtenAt(run, run.masterPlanPath);

  /** The lines a document ended the other way — empty when its convention held. */
  function terminatedWithLfOnly(text: string): string[] {
    return text.split('\n').slice(0, -1).filter(line => !line.endsWith('\r'));
  }

  it('carries every pre-existing block into the merged file as the exact bytes it held', () => {
    for (const block of phaseBlocks(CRLF_PLAN).values()) {
      expect(block).toContain('\r\n');
      expect(merged).toContain(block);
    }
  });

  it('leaves no line of the rebuilt document — frontmatter and new blocks included — ended the other way', () => {
    expect(terminatedWithLfOnly(merged)).toEqual([]);
  });

  it('re-parses into the same merged plan the LF-authored source produces', () => {
    const lfRun = runMerge({ amendmentText: APPENDS_A_PHASE });
    const fromLf = parseText(writtenAt(lfRun, lfRun.masterPlanPath));
    const fromCrlf = parseText(merged);
    expect(fromCrlf.phases.map(phase => phase.id)).toEqual(fromLf.phases.map(phase => phase.id));
    expect(fromCrlf.frontmatter).toEqual(fromLf.frontmatter);
  });

  it('appends the requirements record in that document’s own convention', () => {
    const requirements = writtenAt(run, run.requirementsPath);
    expect(requirements.startsWith(CRLF_REQUIREMENTS)).toBe(true);
    expect(terminatedWithLfOnly(requirements)).toEqual([]);
  });

  it('preserves a frozen block whose terminators differ from the rest of the document', () => {
    const frozen = phaseBlocks(MASTER_PLAN).get('P01')!;
    const mixed = MASTER_PLAN.replace(frozen, withCrlf(frozen));
    const mixedRun = runMerge({ planText: mixed, amendmentText: APPENDS_A_PHASE });

    const out = writtenAt(mixedRun, mixedRun.masterPlanPath);
    expect(out).toContain(withCrlf(frozen));
    // The document's own majority still decides what the new block is terminated with.
    expect(phaseBlocks(out).get('P04')).not.toContain('\r');
  });
});

describe('mergeAmendmentIntoPlan — guarding the raw slice', () => {
  it('refuses to slice a raw text that does not line up with the parsed plan', () => {
    const projectDir = tmpDir();
    const masterPlanPath = path.join(projectDir, `${PROJECT}-MASTER-PLAN.md`);
    const requirementsPath = path.join(projectDir, `${PROJECT}-REQUIREMENTS.md`);
    const amendmentPath = path.join(projectDir, `${PROJECT}-AMENDMENT-01.md`);
    fs.writeFileSync(masterPlanPath, MASTER_PLAN, 'utf8');
    fs.writeFileSync(requirementsPath, REQUIREMENTS, 'utf8');
    fs.writeFileSync(amendmentPath, APPENDS_A_PHASE, 'utf8');

    const existing = parseMasterPlan(masterPlanPath);
    const amendment = parseMasterPlan(amendmentPath);
    const state = makeState();
    const frontier = computeFrontier(state, existing);
    const outcome = buildMergePlan({ existing, amendment, frontier, state });
    if (outcome.type !== 'ok') throw new Error('fixture produced a non-ok merge outcome');

    expect(() =>
      mergeAmendmentIntoPlan({
        projectDir,
        projectName: PROJECT,
        masterPlanPath,
        requirementsPath,
        masterPlanRaw: `${'\n'}${MASTER_PLAN}`,
        existing,
        amendment,
        amendmentDocFileName: `${PROJECT}-AMENDMENT-01.md`,
        mergePlan: outcome.plan,
        frontier,
        nowIso: NOW,
      }),
    ).toThrow(/does not line up/);
  });
});

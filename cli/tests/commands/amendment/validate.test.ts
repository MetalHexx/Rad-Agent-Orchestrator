import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { amendmentValidate, amendmentValidateCommand, guardProjectDir } from '../../../src/commands/amendment/validate.js';
import type { AmendmentValidateResult } from '../../../src/commands/amendment/validate.js';
import { UserError } from '../../../src/framework/errors.js';

// amendmentValidate() resolves data.document.url via resolveInstallRoot(), which
// reads os.homedir(). Redirect it to a throwaway temp directory so the suite
// never touches the real ~/.radorc/ — resolveUiPort degrades to the default
// port there since no orchestration.yml exists.
let fakeHome: string;
let homedirSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'amend-cmd-home-'));
  homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
});
afterEach(() => {
  homedirSpy.mockRestore();
  fs.rmSync(fakeHome, { recursive: true, force: true });
});

const MASTER_PLAN = [
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
  '## P02: Second',
  'Phase two body.',
  '',
  '### P02-T01: Beta work',
  '**Target repo:** beta',
  '',
  'Beta work body.',
  '',
].join('\n');

function amendmentDoc(blocks: string[], addsTasks = ['P03-T01'], addsPhases = ['P03']): string {
  return [
    '---',
    'project: DEMO',
    'type: amendment',
    'amendment: 1',
    'created: "2026-08-24"',
    `adds_phases: [${addsPhases.join(', ')}]`,
    `adds_tasks: [${addsTasks.join(', ')}]`,
    '---',
    '',
    '## Rationale',
    '',
    'A third phase is needed.',
    '',
    '## Amendment Blocks',
    '',
    ...blocks,
    '',
  ].join('\n');
}

const WELL_FORMED_BLOCKS = [
  '## P03: Third',
  'Revised intent and exit criteria.',
  '',
  '### P03-T01: New work',
  '**Target repo:** alpha',
  '',
  'New work body.',
];

interface Project {
  projectDir: string;
  amendmentPath: string;
  amendmentText: string;
}

function makeProject(opts: {
  amendmentText?: string;
  masterPlanDocPath?: string | null;
  phases?: { status: string; tasks: string[] }[];
  haltReason?: string | null;
} = {}): Project {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'amend-cmd-'));
  const projectDir = path.join(root, 'DEMO');
  fs.mkdirSync(projectDir);
  fs.writeFileSync(path.join(projectDir, 'DEMO-MASTER-PLAN.md'), MASTER_PLAN, 'utf8');

  const phases = opts.phases ?? [
    { status: 'completed', tasks: ['completed'] },
    { status: 'not_started', tasks: ['not_started'] },
  ];
  const state = {
    graph: {
      nodes: {
        master_plan: {
          kind: 'step',
          status: 'completed',
          doc_path: opts.masterPlanDocPath === undefined ? 'DEMO-MASTER-PLAN.md' : opts.masterPlanDocPath,
        },
        phase_loop: {
          kind: 'for_each_phase',
          status: 'in_progress',
          iterations: phases.map((phase, index) => ({
            index,
            status: phase.status,
            doc_path: null,
            corrective_tasks: [],
            nodes: {
              task_loop: {
                kind: 'for_each_task',
                status: phase.status,
                iterations: phase.tasks.map((taskStatus, i) => ({
                  index: i,
                  status: taskStatus,
                  doc_path: null,
                  nodes: {},
                  corrective_tasks: [],
                })),
              },
            },
          })),
        },
        final_review: { kind: 'step', status: 'not_started', doc_path: null, retries: 0 },
        pr_gate: { kind: 'conditional', status: 'not_started', branch_taken: null },
        final_approval_gate: { kind: 'gate', status: 'not_started', gate_active: false },
      },
    },
    pipeline: {
      gate_mode: 'task',
      current_tier: 'low',
      halt_reason: opts.haltReason ?? null,
      source_control: { worktree_name: 'demo', repos: [{ name: 'alpha' }, { name: 'beta' }] },
    },
  };
  fs.writeFileSync(path.join(projectDir, 'state.json'), JSON.stringify(state, null, 2), 'utf8');

  const amendmentText = opts.amendmentText ?? amendmentDoc(WELL_FORMED_BLOCKS);
  const amendmentPath = path.join(projectDir, 'DEMO-AMENDMENT-01.md');
  fs.writeFileSync(amendmentPath, amendmentText, 'utf8');

  return { projectDir, amendmentPath, amendmentText };
}

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

/** Runs the core and proves the project directory came out byte-identical. */
function validateWithoutWriting(project: Project): AmendmentValidateResult {
  const before = snapshot(project.projectDir);
  const result = amendmentValidate({ projectDir: project.projectDir, amendmentPath: project.amendmentPath });
  expect(snapshot(project.projectDir)).toEqual(before);
  return result;
}

function lineOf(text: string, needle: string): number {
  return text.split('\n').findIndex(line => line.includes(needle)) + 1;
}

describe('amendment validate — envelope mapping', () => {
  it('maps a well-formed amendment to ok:true with a report and exit 0', () => {
    const project = makeProject();
    const result = validateWithoutWriting(project);
    expect(result.type).toBe('report');

    const envelope = amendmentValidateCommand.mapResult!(result);
    expect(envelope.ok).toBe(true);
    expect(envelope.exit_code).toBe(0);

    const report = (envelope.data as { report: Record<string, unknown> }).report;
    expect(report['addsPhases']).toEqual([{ id: 'P03', title: 'Third', taskCount: 1 }]);
    expect(report['addsTasks']).toEqual([{ id: 'P03-T01', title: 'New work', repo: 'alpha' }]);
    expect(report['reopens']).toEqual(['phase_loop', 'final_review', 'pr_gate', 'final_approval_gate']);
    expect(report['mergedTotals']).toEqual({ phases: 3, tasks: 3 });
    expect(report['mergedRepos']).toEqual(['alpha', 'beta']);
    // Maps do not survive JSON.stringify — the wire form must carry real entries.
    expect(report['numbering']).toEqual({
      phases: { P01: 'P01', P02: 'P02' },
      tasks: { 'P01-T01': 'P01-T01', 'P02-T01': 'P02-T01' },
    });

    const document = (envelope.data as { document: { path: string; url: string } }).document;
    expect(document.path).toBe('DEMO-AMENDMENT-01.md');
    expect(document.url).toBe('http://localhost:1337/projects/DEMO/docs/DEMO-AMENDMENT-01.md');
  });

  it('maps an authoring error to ok:true with a structured data.error and exit 2', () => {
    const amendmentText = amendmentDoc([
      '## P03: Third',
      'Revised intent.',
      '',
      '### P03-TX: Malformed id',
      '**Target repo:** alpha',
      '',
      'Body.',
    ]);
    const project = makeProject({ amendmentText });
    const result = validateWithoutWriting(project);
    expect(result.type).toBe('invalid');

    const envelope = amendmentValidateCommand.mapResult!(result);
    expect(envelope.ok).toBe(true);
    expect(envelope.exit_code).toBe(2);

    const error = (envelope.data as { error: { line: number } }).error;
    expect(Object.keys(error).sort()).toEqual(['expected', 'found', 'line', 'message']);
    expect(error.line).toBe(lineOf(amendmentText, '### P03-TX: Malformed id'));
    expect(envelope.data).not.toHaveProperty('document');
  });

  it('reports a task whose phase id disagrees with its enclosing phase at the real file line', () => {
    const amendmentText = amendmentDoc([
      '## P03: Third',
      'Revised intent.',
      '',
      '### P04-T01: Wrong phase',
      '**Target repo:** alpha',
      '',
      'Body.',
    ]);
    const project = makeProject({ amendmentText });
    const result = validateWithoutWriting(project);
    if (result.type !== 'invalid') throw new Error(`expected invalid, got ${result.type}`);
    expect(result.error.line).toBe(lineOf(amendmentText, '### P04-T01: Wrong phase'));
  });

  it.each([
    ['a malformed phase heading', ['## Phase Three', 'Revised intent.', '', '### P03-T01: New work', '**Target repo:** alpha'], '## Phase Three'],
    ['a task with no Target repo line', ['## P03: Third', 'Revised intent.', '', '### P03-T01: New work', '', 'Body.'], '### P03-T01: New work'],
    ['a present-but-empty Target repo line', ['## P03: Third', 'Revised intent.', '', '### P03-T01: New work', '**Target repo:**', '', 'Body.'], '### P03-T01: New work'],
  ])('points %s at its real line in the amendment on disk', (_label, blocks, offendingLine) => {
    const amendmentText = amendmentDoc(blocks);
    const project = makeProject({ amendmentText });
    const result = validateWithoutWriting(project);

    const envelope = amendmentValidateCommand.mapResult!(result);
    expect(envelope.ok).toBe(true);
    expect(envelope.exit_code).toBe(2);
    const error = (envelope.data as { error: { line: number } }).error;
    expect(error.line).toBe(lineOf(amendmentText, offendingLine));
  });

  it('maps an upstream halt to ok:true with data.blocked and exit 2', () => {
    const project = makeProject({
      phases: [
        { status: 'completed', tasks: ['completed'] },
        { status: 'in_progress', tasks: ['halted'] },
      ],
      haltReason: 'coder could not proceed',
    });
    const result = validateWithoutWriting(project);
    expect(result.type).toBe('blocked');

    const envelope = amendmentValidateCommand.mapResult!(result);
    expect(envelope.ok).toBe(true);
    expect(envelope.exit_code).toBe(2);

    const blocked = (envelope.data as { blocked: { haltedNode: string; reason: string; message: string } }).blocked;
    expect(blocked.haltedNode).toBe('phase_loop[1].task_loop[0]');
    expect(blocked.reason).toBe('coder could not proceed');
    expect(blocked.message).toContain('phase_loop[1].task_loop[0]');
    expect(envelope.data).not.toHaveProperty('document');
  });

  it('maps a system fault to ok:false with a system_error', () => {
    const project = makeProject({ masterPlanDocPath: null });
    const result = validateWithoutWriting(project);
    expect(result.type).toBe('real_error');

    const envelope = amendmentValidateCommand.mapResult!(result);
    expect(envelope.ok).toBe(false);
    expect(envelope.error?.type).toBe('system_error');
  });
});

describe('amendment validate — amendment document guard', () => {
  it('rejects an --amendment that lives outside the project directory', () => {
    const project = makeProject();
    // A readable document with legitimate content — only its location is wrong.
    const elsewhere = path.join(project.projectDir, '..', 'DEMO-AMENDMENT-01.md');
    fs.writeFileSync(elsewhere, project.amendmentText, 'utf8');
    const before = snapshot(project.projectDir);

    expect(() => amendmentValidate({ projectDir: project.projectDir, amendmentPath: elsewhere })).toThrow(UserError);
    expect(snapshot(project.projectDir)).toEqual(before);
  });

  it('rejects an --amendment at the project root that is not this project\'s amendment document', () => {
    const project = makeProject();
    const misnamed = path.join(project.projectDir, 'my-amendment.md');
    fs.writeFileSync(misnamed, project.amendmentText, 'utf8');

    expect(() => amendmentValidate({ projectDir: project.projectDir, amendmentPath: misnamed })).toThrow(UserError);
  });
});

describe('amendment validate — project directory guard', () => {
  it('rejects a --project-dir whose trailing segment walks out of the projects root', () => {
    // Raw argv, not path.join — join would normalise the traversal away before
    // the guard ever saw it, which is exactly what an attacker would not do.
    expect(() => guardProjectDir('/home/me/.radorc/projects/..')).toThrow(UserError);
  });

  it('accepts a --project-dir ending in a plain project name', () => {
    expect(() => guardProjectDir(path.join(os.tmpdir(), 'projects', 'DEMO'))).not.toThrow();
  });
});

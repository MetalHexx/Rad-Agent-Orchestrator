import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildPhaseIterationEntry, buildTaskIterationEntry } from '../../src/lib/plan-emitters.js';
import { parseMasterPlan } from '../../src/lib/explode-master-plan.js';
import type { ParsedPhase, ParsedTask } from '../../src/lib/explode-master-plan.js';

function makeTask(overrides: Partial<ParsedTask> = {}): ParsedTask {
  return {
    id: 'P01-T01',
    phaseIndex: 1,
    taskIndex: 1,
    title: 'A task',
    complexity: 'standard',
    purpose: 'Does a thing.',
    targetRepos: ['backend'],
    body: 'body',
    startLine: 5,
    ...overrides,
  };
}

function makePhase(overrides: Partial<ParsedPhase> = {}): ParsedPhase {
  return {
    id: 'P01',
    index: 1,
    title: 'A phase',
    body: 'phase body',
    tasks: [],
    startLine: 1,
    ...overrides,
  };
}

describe('buildTaskIterationEntry', () => {
  it('builds a not_started task iteration entry with mapped repos and complexity', () => {
    const task = makeTask({ complexity: 'complex', targetRepos: ['backend', 'frontend'] });
    const entry = buildTaskIterationEntry({ index: 2, task, docPath: 'tasks/foo.md' });
    expect(entry).toEqual({
      index: 2,
      status: 'not_started',
      nodes: {},
      corrective_tasks: [],
      doc_path: 'tasks/foo.md',
      repos: [
        { name: 'backend', commit_hash: null },
        { name: 'frontend', commit_hash: null },
      ],
      complexity: 'complex',
    });
  });

  it('carries a null doc_path through untouched', () => {
    const entry = buildTaskIterationEntry({ index: 0, task: makeTask(), docPath: null });
    expect(entry.doc_path).toBeNull();
  });
});

describe('buildPhaseIterationEntry', () => {
  it('builds a not_started phase iteration entry with a nested task_loop and unioned repos', () => {
    const task1 = makeTask({ id: 'P01-T01', taskIndex: 1, targetRepos: ['backend'] });
    const task2 = makeTask({ id: 'P01-T02', taskIndex: 2, targetRepos: ['frontend'] });
    const phase = makePhase({ tasks: [task1, task2] });
    const taskIterations = [
      buildTaskIterationEntry({ index: 0, task: task1, docPath: 'tasks/a.md' }),
      buildTaskIterationEntry({ index: 1, task: task2, docPath: 'tasks/b.md' }),
    ];

    const entry = buildPhaseIterationEntry({
      index: 0,
      phase,
      docPath: 'phases/p.md',
      taskIterations,
    });

    expect(entry).toEqual({
      index: 0,
      status: 'not_started',
      nodes: {
        task_loop: {
          kind: 'for_each_task',
          status: 'not_started',
          iterations: taskIterations,
        },
      },
      corrective_tasks: [],
      doc_path: 'phases/p.md',
      repos: [
        { name: 'backend', commit_hash: null },
        { name: 'frontend', commit_hash: null },
      ],
    });
    expect(entry).not.toHaveProperty('complexity');
  });
});

describe('ParsedPhase.startLine', () => {
  function makeMasterPlan(): { projectDir: string; masterPlanPath: string } {
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-emitters-'));
    return { projectDir, masterPlanPath: path.join(projectDir, 'MP.md') };
  }

  it('reports the file-absolute line of the phase heading, and raw slices between startLines round-trip the source', () => {
    const { masterPlanPath } = makeMasterPlan();
    const raw =
      '---\n' +
      'project: X\n' +
      '---\n' +
      '\n' +
      'Intro line.\n' +
      '\n' +
      '## P01: First\n' +
      'phase one body\n' +
      '\n' +
      '### P01-T01: T One\n' +
      'task body\n' +
      '\n' +
      '## P02: Second\n' +
      'phase two body\n';
    fs.writeFileSync(masterPlanPath, raw, 'utf8');

    const parsed = parseMasterPlan(masterPlanPath);
    expect(parsed.phases).toHaveLength(2);

    const lines = raw.split('\n');
    const phase1StartLine = parsed.phases[0]!.startLine;
    const phase2StartLine = parsed.phases[1]!.startLine;

    expect(lines[phase1StartLine - 1]).toBe('## P01: First');
    expect(lines[phase2StartLine - 1]).toBe('## P02: Second');

    // A raw slice taken between consecutive startLines reproduces phase one's
    // source text (heading through the line before the next phase heading).
    const phaseOneSlice = lines.slice(phase1StartLine - 1, phase2StartLine - 1).join('\n');
    expect(phaseOneSlice).toBe(
      '## P01: First\nphase one body\n\n### P01-T01: T One\ntask body\n',
    );
  });
});

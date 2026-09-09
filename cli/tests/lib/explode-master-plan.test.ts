import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { explodeMasterPlan, ParseError } from '../../src/lib/explode-master-plan.js';
import { parseYaml } from '../../src/lib/yaml.js';

function makeProject(): { projectDir: string; masterPlanPath: string } {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'exp-'));
  const masterPlanPath = path.join(projectDir, 'MP.md');
  return { projectDir, masterPlanPath };
}

describe('explodeMasterPlan core', () => {
  it('parses a minimal plan and emits per-phase + per-task files', () => {
    const { projectDir, masterPlanPath } = makeProject();
    fs.writeFileSync(masterPlanPath,
      '## P01: First\nphase body\n\n### P01-T01: T One\nDoes the first thing.\n**Complexity:** simple\nt body\n', 'utf8');
    const result = explodeMasterPlan({
      projectDir, masterPlanPath, projectName: 'X',
      nowIso: '2026-05-22T00:00:00.000Z',
    });
    expect(result.emittedPhaseFiles).toHaveLength(1);
    expect(result.emittedTaskFiles).toHaveLength(1);
    expect(fs.existsSync(path.join(projectDir, 'backups'))).toBe(false);
    expect(fs.existsSync(path.join(projectDir, 'phases'))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, 'tasks'))).toBe(true);
  });

  it('throws ParseError with byte-identical toDetail() shape on malformed plan', () => {
    const { projectDir, masterPlanPath } = makeProject();
    fs.writeFileSync(masterPlanPath, '### P01-T01: Orphan task before any phase\n', 'utf8');
    try { explodeMasterPlan({ projectDir, masterPlanPath, projectName: 'X', nowIso: '2026-05-22T00:00:00.000Z' }); }
    catch (err) {
      expect(err).toBeInstanceOf(ParseError);
      const d = (err as ParseError).toDetail();
      expect(Object.keys(d).sort()).toEqual(['expected', 'found', 'line', 'message']);
      expect(typeof d.line).toBe('number');
      expect(typeof d.expected).toBe('string');
      expect(typeof d.found).toBe('string');
      expect(typeof d.message).toBe('string');
      return;
    }
    throw new Error('expected ParseError');
  });

  it('clears populated phases/ and tasks/ on rerun rather than archiving them', () => {
    const { projectDir, masterPlanPath } = makeProject();
    fs.writeFileSync(masterPlanPath,
      '## P01: A\n\n### P01-T01: T\nb\n', 'utf8');
    explodeMasterPlan({ projectDir, masterPlanPath, projectName: 'X', nowIso: '2026-05-22T00:00:00.000Z' });
    const second = explodeMasterPlan({ projectDir, masterPlanPath, projectName: 'X', nowIso: '2026-05-22T01:00:00.000Z' });

    const phasesOnDisk = fs.readdirSync(path.join(projectDir, 'phases'));
    const tasksOnDisk = fs.readdirSync(path.join(projectDir, 'tasks'));
    expect(phasesOnDisk.sort()).toEqual(second.emittedPhaseFiles.map(f => path.basename(f)).sort());
    expect(tasksOnDisk.sort()).toEqual(second.emittedTaskFiles.map(f => path.basename(f)).sort());
    expect(fs.existsSync(path.join(projectDir, 'backups'))).toBe(false);
  });

  it('leaves no file under a retitled task\'s old name after a rerun', () => {
    const { projectDir, masterPlanPath } = makeProject();
    fs.writeFileSync(masterPlanPath,
      '## P01: A\n\n### P01-T01: Original Title\nb\n', 'utf8');
    const first = explodeMasterPlan({ projectDir, masterPlanPath, projectName: 'X', nowIso: '2026-05-22T00:00:00.000Z' });
    const oldTaskFile = first.emittedTaskFiles[0]!;
    expect(fs.existsSync(oldTaskFile)).toBe(true);

    fs.writeFileSync(masterPlanPath,
      '## P01: A\n\n### P01-T01: Renamed Title\nb\n', 'utf8');
    const second = explodeMasterPlan({ projectDir, masterPlanPath, projectName: 'X', nowIso: '2026-05-22T01:00:00.000Z' });
    const newTaskFile = second.emittedTaskFiles[0]!;

    expect(newTaskFile).not.toBe(oldTaskFile);
    expect(fs.existsSync(oldTaskFile)).toBe(false);
    expect(fs.existsSync(newTaskFile)).toBe(true);
  });
});

describe('explosion derives phase repos as task union (FR-2, AD-2)', () => {
  it('unions task repos deterministically and ignores the decorative phase-body line', () => {
    const { projectDir, masterPlanPath } = makeProject();
    fs.writeFileSync(masterPlanPath,
      '---\nrepos: [backend, frontend, shared]\n---\n\n' +
      '## P01: First\n' +
      '**Target repo:** shared\n\n' +
      '### P01-T01: A\nWires backend to shared.\n**Complexity:** standard\n**Target repo:** backend, shared\n**Files for backend:**\n- Create: `a.ts`\n**Files for shared:**\n- Create: `b.ts`\n\n' +
      '### P01-T02: B\nAdds the frontend view.\n**Complexity:** complex\n**Target repo:** frontend\n**Files for frontend:**\n- Create: `c.ts`\n', 'utf8');
    const result = explodeMasterPlan({
      projectDir, masterPlanPath, projectName: 'X', nowIso: '2026-05-22T00:00:00.000Z',
    });
    const raw = fs.readFileSync(result.emittedPhaseFiles[0]!, 'utf8');
    const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/)![1]!;
    const parsed = parseYaml(fm) as Record<string, unknown>;
    expect(parsed.repos).toEqual(['backend', 'shared', 'frontend']);
  });
});

describe('explosion lifts task target repos (FR-1, FR-3)', () => {
  it('emits a deterministic deduped repos: frontmatter field and leaves Files-for-repo as body text', () => {
    const { projectDir, masterPlanPath } = makeProject();
    fs.writeFileSync(masterPlanPath,
      '---\n' +
      'repos: [backend, frontend]\n' +
      '---\n\n' +
      '## P01: First\n\n' +
      '### P01-T01: T One\n' +
      'Connects the API to the app shell.\n' +
      '**Complexity:** standard\n' +
      '**Target repo:** frontend, backend, frontend\n' +
      '**Files for backend:**\n' +
      '- Create: `src/api/x.ts`\n' +
      '**Files for frontend:**\n' +
      '- Modify: `app/y.ts`\n', 'utf8');
    const result = explodeMasterPlan({
      projectDir, masterPlanPath, projectName: 'X',
      nowIso: '2026-05-22T00:00:00.000Z',
    });
    const raw = fs.readFileSync(result.emittedTaskFiles[0]!, 'utf8');
    const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/)![1]!;
    const parsed = parseYaml(fm) as Record<string, unknown>;
    expect(parsed.repos).toEqual(['frontend', 'backend']);
    // New task shape: no requirement_tags, no author; complexity is surfaced.
    expect(parsed).not.toHaveProperty('requirement_tags');
    expect(parsed).not.toHaveProperty('author');
    expect(parsed.complexity).toBe('standard');
    expect(raw).toContain('**Files for backend:**');
    expect(raw).toContain('- Modify: `app/y.ts`');
  });
});

describe('explosion enforces task repo shape (FR-4, FR-5, FR-6)', () => {
  const seal = '---\nrepos: [backend, frontend]\n---\n\n';
  function expectParseError(plan: string) {
    const { projectDir, masterPlanPath } = makeProject();
    fs.writeFileSync(masterPlanPath, plan, 'utf8');
    try {
      explodeMasterPlan({ projectDir, masterPlanPath, projectName: 'X', nowIso: '2026-05-22T00:00:00.000Z' });
    } catch (err) {
      expect(err).toBeInstanceOf(ParseError);
      expect(Object.keys((err as ParseError).toDetail()).sort()).toEqual(['expected', 'found', 'line', 'message']);
      return;
    }
    throw new Error('expected ParseError');
  }
  it('fails on a missing Target repo line (FR-4)', () => {
    expectParseError(seal + '## P01: P\n\n### P01-T01: A\n**Complexity:** simple\nbody only\n');
  });
  it('fails on a present-but-empty Target repo line (FR-5)', () => {
    expectParseError(seal + '## P01: P\n\n### P01-T01: A\n**Complexity:** simple\n**Target repo:**\n**Files for backend:**\n- Create: `a.ts`\n');
  });
  it('fails on a repo outside the sealed repos (FR-6)', () => {
    expectParseError(seal + '## P01: P\n\n### P01-T01: A\n**Complexity:** simple\n**Target repo:** payments\n**Files for payments:**\n- Create: `a.ts`\n');
  });
});

describe('explosion enforces the reverse seal check', () => {
  function expectedRepoLine(plan: string): number {
    return plan.split('\n').findIndex(l => /^\s*repos\s*:/.test(l)) + 1;
  }

  it('fires when the sealed repos: carries a repo no task targets', () => {
    const plan =
      '---\nrepos: [backend, frontend]\n---\n\n' +
      '## P01: P\n\n### P01-T01: A\n**Complexity:** simple\n**Target repo:** backend\n**Files for backend:**\n- Create: `a.ts`\n';
    const { projectDir, masterPlanPath } = makeProject();
    fs.writeFileSync(masterPlanPath, plan, 'utf8');
    const expectedLine = expectedRepoLine(plan);
    try {
      explodeMasterPlan({ projectDir, masterPlanPath, projectName: 'X', nowIso: '2026-05-22T00:00:00.000Z' });
    } catch (err) {
      expect(err).toBeInstanceOf(ParseError);
      const detail = (err as ParseError).toDetail();
      expect(Object.keys(detail).sort()).toEqual(['expected', 'found', 'line', 'message']);
      expect(detail.line).toBe(expectedLine);
      expect(String(detail.message)).toContain('frontend');
      expect(String(detail.message)).toMatch(/remove/i);
      expect(String(detail.message)).toMatch(/add/i);
      return;
    }
    throw new Error('expected a ParseError for the untargeted sealed repo');
  });

  it('names every untargeted repo together rather than one at a time', () => {
    const plan =
      '---\nrepos: [backend, frontend, payments]\n---\n\n' +
      '## P01: P\n\n### P01-T01: A\n**Complexity:** simple\n**Target repo:** backend\n**Files for backend:**\n- Create: `a.ts`\n';
    const { projectDir, masterPlanPath } = makeProject();
    fs.writeFileSync(masterPlanPath, plan, 'utf8');
    try {
      explodeMasterPlan({ projectDir, masterPlanPath, projectName: 'X', nowIso: '2026-05-22T00:00:00.000Z' });
    } catch (err) {
      const detail = (err as ParseError).toDetail();
      expect(String(detail.message)).toContain('frontend');
      expect(String(detail.message)).toContain('payments');
      return;
    }
    throw new Error('expected a ParseError naming both untargeted repos');
  });

  it('explodes cleanly when the seal exactly equals the task union', () => {
    const { projectDir, masterPlanPath } = makeProject();
    fs.writeFileSync(masterPlanPath,
      '---\nrepos: [backend, frontend]\n---\n\n' +
      '## P01: P\n\n' +
      '### P01-T01: A\n**Complexity:** simple\n**Target repo:** backend\n**Files for backend:**\n- Create: `a.ts`\n\n' +
      '### P01-T02: B\n**Complexity:** simple\n**Target repo:** frontend\n**Files for frontend:**\n- Create: `b.ts`\n', 'utf8');
    const result = explodeMasterPlan({ projectDir, masterPlanPath, projectName: 'X', nowIso: '2026-05-22T00:00:00.000Z' });
    expect(result.emittedTaskFiles).toHaveLength(2);
  });

  it('still fires the forward check for a task naming an unsealed repo', () => {
    const { projectDir, masterPlanPath } = makeProject();
    fs.writeFileSync(masterPlanPath,
      '---\nrepos: [backend, frontend]\n---\n\n' +
      '## P01: P\n\n### P01-T01: A\n**Complexity:** simple\n**Target repo:** payments\n**Files for payments:**\n- Create: `a.ts`\n', 'utf8');
    try {
      explodeMasterPlan({ projectDir, masterPlanPath, projectName: 'X', nowIso: '2026-05-22T00:00:00.000Z' });
    } catch (err) {
      const detail = (err as ParseError).toDetail();
      expect(String(detail.message)).toMatch(/not in the Master Plan's sealed repos/);
      return;
    }
    throw new Error('expected the forward FR-6 ParseError');
  });

  it('explodes cleanly for a side-project plan whose seal is the project name', () => {
    const { projectDir, masterPlanPath } = makeProject();
    fs.writeFileSync(masterPlanPath,
      '---\nrepos: [SOME-PROJECT]\n---\n\n' +
      '## P01: P\n\n### P01-T01: A\n**Complexity:** simple\n**Target repo:** SOME-PROJECT\n**Files for SOME-PROJECT:**\n- Create: `a.ts`\n', 'utf8');
    const result = explodeMasterPlan({ projectDir, masterPlanPath, projectName: 'X', nowIso: '2026-05-22T00:00:00.000Z' });
    expect(result.emittedTaskFiles).toHaveLength(1);
  });

  it('raises nothing new when repos: is absent', () => {
    const { projectDir, masterPlanPath } = makeProject();
    fs.writeFileSync(masterPlanPath,
      '## P01: P\n\n### P01-T01: A\n**Complexity:** simple\nno target repo needed here\n', 'utf8');
    const result = explodeMasterPlan({ projectDir, masterPlanPath, projectName: 'X', nowIso: '2026-05-22T00:00:00.000Z' });
    expect(result.emittedTaskFiles).toHaveLength(1);
  });

  it('raises nothing new when repos: is an empty array', () => {
    const { projectDir, masterPlanPath } = makeProject();
    fs.writeFileSync(masterPlanPath,
      '---\nrepos: []\n---\n\n' +
      '## P01: P\n\n### P01-T01: A\n**Complexity:** simple\nno target repo needed here\n', 'utf8');
    const result = explodeMasterPlan({ projectDir, masterPlanPath, projectName: 'X', nowIso: '2026-05-22T00:00:00.000Z' });
    expect(result.emittedTaskFiles).toHaveLength(1);
  });

  it('reports the no-phase-headings error, not the reverse-check error, for a seal-bearing plan with no phases', () => {
    const { projectDir, masterPlanPath } = makeProject();
    fs.writeFileSync(masterPlanPath, '---\nrepos: [backend, frontend]\n---\n\nJust prose, no phase headings.\n', 'utf8');
    try {
      explodeMasterPlan({ projectDir, masterPlanPath, projectName: 'X', nowIso: '2026-05-22T00:00:00.000Z' });
    } catch (err) {
      const detail = (err as ParseError).toDetail();
      expect(String(detail.message)).toMatch(/no parseable phase headings/);
      return;
    }
    throw new Error('expected the no-phase-headings ParseError');
  });
});

describe('explosion repo-shape enforcement precision (FR-5, NFR-8)', () => {
  const seal = '---\nrepos: [backend, frontend]\n---\n\n';

  it('classifies a present-but-empty Target repo line as the FR-5 empty-line error', () => {
    const { projectDir, masterPlanPath } = makeProject();
    fs.writeFileSync(masterPlanPath,
      seal +
      '## P01: P\n\n' +
      '### P01-T01: A\n**Complexity:** simple\n**Target repo:**\n' +
      '**Files for backend:**\n- Create: `a.ts`\n', 'utf8');
    try {
      explodeMasterPlan({ projectDir, masterPlanPath, projectName: 'X', nowIso: '2026-05-22T00:00:00.000Z' });
    } catch (err) {
      expect(err).toBeInstanceOf(ParseError);
      const detail = (err as ParseError).toDetail();
      expect(String(detail.message)).toMatch(/present-but-empty/i);
      expect(String(detail.found)).toMatch(/empty/i);
      return;
    }
    throw new Error('expected a ParseError for the present-but-empty Target repo line');
  });

  it('reports the offending task heading line in enforcement errors', () => {
    const { projectDir, masterPlanPath } = makeProject();
    const plan =
      seal +
      '## P01: P\n\n' +
      '### P01-T01: A\n**Complexity:** simple\n**Target repo:**\n' +
      '**Files for backend:**\n- Create: `a.ts`\n';
    fs.writeFileSync(masterPlanPath, plan, 'utf8');
    const expectedLine = plan.split('\n').findIndex(l => l.startsWith('### P01-T01:')) + 1;
    try {
      explodeMasterPlan({ projectDir, masterPlanPath, projectName: 'X', nowIso: '2026-05-22T00:00:00.000Z' });
    } catch (err) {
      expect((err as ParseError).toDetail().line).toBe(expectedLine);
      return;
    }
    throw new Error('expected a ParseError reporting the task heading line');
  });
});

describe('explosion stamps task complexity', () => {
  function complexityOf(plan: string): unknown {
    const { projectDir, masterPlanPath } = makeProject();
    fs.writeFileSync(masterPlanPath, plan, 'utf8');
    const result = explodeMasterPlan({ projectDir, masterPlanPath, projectName: 'X', nowIso: '2026-05-22T00:00:00.000Z' });
    const raw = fs.readFileSync(result.emittedTaskFiles[0]!, 'utf8');
    const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/)![1]!;
    return (parseYaml(fm) as Record<string, unknown>).complexity;
  }

  it('stamps the authored complexity value', () => {
    expect(complexityOf('## P01: P\n\n### P01-T01: A\nDoes a thing.\n**Complexity:** complex\n**Target repo:** foo\n')).toBe('complex');
  });

  it('defaults to standard when the task has no Complexity line', () => {
    expect(complexityOf('## P01: P\n\n### P01-T01: A\nDoes a thing.\n**Target repo:** foo\n')).toBe('standard');
  });

  it('defaults to standard on an invalid Complexity value', () => {
    expect(complexityOf('## P01: P\n\n### P01-T01: A\nDoes a thing.\n**Complexity:** trivial\n**Target repo:** foo\n')).toBe('standard');
  });
});

describe('explosion parses a singular Target repo line into a repos array', () => {
  it('lifts "**Target repo:** foo" to repos: ["foo"]', () => {
    const { projectDir, masterPlanPath } = makeProject();
    fs.writeFileSync(masterPlanPath,
      '## P01: P\n\n### P01-T01: A\nDoes a thing.\n**Complexity:** simple\n**Target repo:** foo\n', 'utf8');
    const result = explodeMasterPlan({ projectDir, masterPlanPath, projectName: 'X', nowIso: '2026-05-22T00:00:00.000Z' });
    const raw = fs.readFileSync(result.emittedTaskFiles[0]!, 'utf8');
    const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/)![1]!;
    const parsed = parseYaml(fm) as Record<string, unknown>;
    expect(parsed.repos).toEqual(['foo']);
  });
});

describe('explosion renders the new phase/task body shape', () => {
  it('renders the 4-column phase task table and an Order line; no bullet list; no author', () => {
    const { projectDir, masterPlanPath } = makeProject();
    fs.writeFileSync(masterPlanPath,
      '## P01: First\n\n' +
      '### P01-T01: A\nWires the API.\n**Complexity:** simple\n**Target repo:** backend\n' +
      '**Files for backend:**\n- Create: `a.ts`\n\n' +
      '### P01-T02: B\nAdds the view.\n**Complexity:** complex\n**Target repo:** backend\n' +
      '**Files for backend:**\n- Create: `b.ts`\n', 'utf8');
    const result = explodeMasterPlan({ projectDir, masterPlanPath, projectName: 'X', nowIso: '2026-05-22T00:00:00.000Z' });
    const phaseRaw = fs.readFileSync(result.emittedPhaseFiles[0]!, 'utf8');
    const phaseFm = phaseRaw.match(/^---\r?\n([\s\S]*?)\r?\n---/)![1]!;
    expect(parseYaml(phaseFm)).not.toHaveProperty('author');
    expect(phaseRaw).toContain('| Task | Repo | Complexity | Purpose |');
    expect(phaseRaw).toContain('| T01 | backend | simple | Wires the API. |');
    expect(phaseRaw).toContain('| T02 | backend | complex | Adds the view. |');
    expect(phaseRaw).toContain('**Order:** T01 → T02');
    expect(phaseRaw).not.toMatch(/- \*\*T01\*\*:/);
  });

  it('renders an em dash in the Purpose cell when no lead sentence exists', () => {
    const { projectDir, masterPlanPath } = makeProject();
    fs.writeFileSync(masterPlanPath,
      '## P01: First\n\n### P01-T01: A\n**Complexity:** standard\n**Target repo:** backend\n', 'utf8');
    const result = explodeMasterPlan({ projectDir, masterPlanPath, projectName: 'X', nowIso: '2026-05-22T00:00:00.000Z' });
    const phaseRaw = fs.readFileSync(result.emittedPhaseFiles[0]!, 'utf8');
    expect(phaseRaw).toContain('| T01 | backend | standard | — |');
  });

  it('appends a reserved Execution Notes section to each task body', () => {
    const { projectDir, masterPlanPath } = makeProject();
    fs.writeFileSync(masterPlanPath,
      '## P01: First\n\n### P01-T01: A\nDoes a thing.\n**Complexity:** simple\n**Target repo:** backend\n', 'utf8');
    const result = explodeMasterPlan({ projectDir, masterPlanPath, projectName: 'X', nowIso: '2026-05-22T00:00:00.000Z' });
    const taskRaw = fs.readFileSync(result.emittedTaskFiles[0]!, 'utf8');
    expect(taskRaw).toContain('## Execution Notes');
    expect(taskRaw).toContain('_(none yet — appended at runtime)_');
  });
});

describe('explosion enforces per-phase task numbering restart', () => {
  it('rejects a phase whose first task is not T01', () => {
    const { projectDir, masterPlanPath } = makeProject();
    fs.writeFileSync(masterPlanPath,
      '## P01: First\n\n### P01-T01: A\nb\n\n' +
      '## P02: Second\n\n### P02-T04: C\nd\n', 'utf8');
    try {
      explodeMasterPlan({ projectDir, masterPlanPath, projectName: 'X', nowIso: '2026-05-22T00:00:00.000Z' });
    } catch (err) {
      expect(err).toBeInstanceOf(ParseError);
      const detail = (err as ParseError).toDetail();
      expect(Object.keys(detail).sort()).toEqual(['expected', 'found', 'line', 'message']);
      expect(detail.expected).toContain('P02');
      expect(detail.found).toContain('P02-T04');
      return;
    }
    throw new Error('expected a ParseError for the wrong-start phase');
  });

  it('rejects an internal gap in a phase\'s task numbering', () => {
    const { projectDir, masterPlanPath } = makeProject();
    fs.writeFileSync(masterPlanPath,
      '## P01: First\n\n### P01-T01: A\nb\n\n### P01-T03: C\nd\n', 'utf8');
    try {
      explodeMasterPlan({ projectDir, masterPlanPath, projectName: 'X', nowIso: '2026-05-22T00:00:00.000Z' });
    } catch (err) {
      expect(err).toBeInstanceOf(ParseError);
      const detail = (err as ParseError).toDetail();
      expect(Object.keys(detail).sort()).toEqual(['expected', 'found', 'line', 'message']);
      expect(detail.expected).toContain('P01');
      expect(detail.found).toContain('P01-T03');
      return;
    }
    throw new Error('expected a ParseError for the mid-phase gap');
  });

  it('explodes a valid multi-phase plan whose second phase correctly restarts at T01', () => {
    const { projectDir, masterPlanPath } = makeProject();
    fs.writeFileSync(masterPlanPath,
      '## P01: First\n\n### P01-T01: A\nb\n### P01-T02: B\nc\n\n' +
      '## P02: Second\n\n### P02-T01: C\nd\n### P02-T02: D\ne\n', 'utf8');
    const result = explodeMasterPlan({ projectDir, masterPlanPath, projectName: 'X', nowIso: '2026-05-22T00:00:00.000Z' });
    expect(result.emittedTaskFiles).toHaveLength(4);
  });

  it('still explodes a task-less phase without tripping the numbering guard', () => {
    const { projectDir, masterPlanPath } = makeProject();
    fs.writeFileSync(masterPlanPath,
      '## P01: First\nno tasks yet\n\n## P02: Second\n\n### P02-T01: A\nb\n', 'utf8');
    const result = explodeMasterPlan({ projectDir, masterPlanPath, projectName: 'X', nowIso: '2026-05-22T00:00:00.000Z' });
    expect(result.emittedPhaseFiles).toHaveLength(2);
    expect(result.emittedTaskFiles).toHaveLength(1);
  });

  it('leaves phases/ and tasks/ untouched when the numbering guard rejects the plan', () => {
    const { projectDir, masterPlanPath } = makeProject();
    fs.writeFileSync(masterPlanPath,
      '## P01: First\n\n### P01-T01: A\nb\n', 'utf8');
    explodeMasterPlan({ projectDir, masterPlanPath, projectName: 'X', nowIso: '2026-05-22T00:00:00.000Z' });
    const phasesBefore = fs.readdirSync(path.join(projectDir, 'phases')).sort();
    const tasksBefore = fs.readdirSync(path.join(projectDir, 'tasks')).sort();

    fs.writeFileSync(masterPlanPath,
      '## P01: First\n\n### P01-T01: A\nb\n\n## P02: Second\n\n### P02-T04: C\nd\n', 'utf8');
    try {
      explodeMasterPlan({ projectDir, masterPlanPath, projectName: 'X', nowIso: '2026-05-22T01:00:00.000Z' });
    } catch (err) {
      expect(err).toBeInstanceOf(ParseError);
      expect(fs.readdirSync(path.join(projectDir, 'phases')).sort()).toEqual(phasesBefore);
      expect(fs.readdirSync(path.join(projectDir, 'tasks')).sort()).toEqual(tasksBefore);
      return;
    }
    throw new Error('expected a ParseError that leaves phases/ and tasks/ unmodified');
  });
});

describe("explosion's purpose-extraction heuristic", () => {
  it('extracts a genuine one-line purpose unchanged', () => {
    const { projectDir, masterPlanPath } = makeProject();
    fs.writeFileSync(masterPlanPath,
      '## P01: First\n\n### P01-T01: A\nWires the API to the new backend.\n**Complexity:** simple\n**Target repo:** backend\n', 'utf8');
    const result = explodeMasterPlan({ projectDir, masterPlanPath, projectName: 'X', nowIso: '2026-05-22T00:00:00.000Z' });
    const phaseRaw = fs.readFileSync(result.emittedPhaseFiles[0]!, 'utf8');
    expect(phaseRaw).toContain('| T01 | backend | simple | Wires the API to the new backend. |');
  });

  it('does not leak a colon-less bold section label as the purpose when no purpose paragraph exists', () => {
    const { projectDir, masterPlanPath } = makeProject();
    fs.writeFileSync(masterPlanPath,
      '## P01: First\n\n### P01-T01: A\n**Complexity:** simple\n**Target repo:** backend\n**Files**\n- Create: `a.ts`\n', 'utf8');
    const result = explodeMasterPlan({ projectDir, masterPlanPath, projectName: 'X', nowIso: '2026-05-22T00:00:00.000Z' });
    const phaseRaw = fs.readFileSync(result.emittedPhaseFiles[0]!, 'utf8');
    expect(phaseRaw).toContain('| T01 | backend | simple | — |');
    expect(phaseRaw).not.toContain('**Files**');
  });

  it('joins a hard-wrapped purpose paragraph into the full first sentence instead of truncating it', () => {
    const { projectDir, masterPlanPath } = makeProject();
    fs.writeFileSync(masterPlanPath,
      '## P01: First\n\n### P01-T01: A\n' +
      'Stop the parser from truncating a hard-wrapped paragraph\n' +
      'into a fragment of the intended purpose sentence.\n' +
      '**Complexity:** simple\n**Target repo:** backend\n', 'utf8');
    const result = explodeMasterPlan({ projectDir, masterPlanPath, projectName: 'X', nowIso: '2026-05-22T00:00:00.000Z' });
    const phaseRaw = fs.readFileSync(result.emittedPhaseFiles[0]!, 'utf8');
    expect(phaseRaw).toContain(
      '| T01 | backend | simple | Stop the parser from truncating a hard-wrapped paragraph into a fragment of the intended purpose sentence. |'
    );
  });
});

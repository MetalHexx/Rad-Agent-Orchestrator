import { describe, it, expect, vi } from 'vitest';
import { planPrepare } from '../../../src/commands/plan/prepare.js';
import type { PlanPrepareOptions } from '../../../src/commands/plan/prepare.js';
import { UserError } from '../../../src/framework/errors.js';
import { parseYaml } from '../../../src/lib/yaml.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const DRAFT_DOC =
  '---\n'
  + 'project: P\n'
  + 'type: requirements\n'
  + "created: '2026-01-01T00:00:00.000Z'\n"
  + 'project-type: standard\n'
  + 'repos:\n'
  + '  - rad-orc-source\n'
  + 'status: draft\n'
  + '---\n'
  + '# Requirements\n\nSome operator-authored body.\n';

const CRLF_DOC =
  '---\r\n'
  + 'project: P\r\n'
  + 'status: draft\r\n'
  + '---\r\n'
  + '# Requirements\r\n\r\nCRLF body with\r\nmultiple lines.\r\n';

const options = (over: Partial<PlanPrepareOptions> = {}): PlanPrepareOptions => ({
  project: 'P',
  template: 'medium',
  taskSize: 'Large',
  requirementsPath: '/projects/P/P-REQUIREMENTS.md',
  readDoc: () => DRAFT_DOC,
  writeDoc: vi.fn(),
  ...over,
});

// ── draft → approved ──────────────────────────────────────────────────────────

describe('planPrepare — stamps approval and freezes parameters', () => {
  it('sets status/template/task-size and reports changed: true', () => {
    const writeDoc = vi.fn();
    const r = planPrepare(options({ writeDoc }));
    expect(r).toEqual({
      requirementsPath: '/projects/P/P-REQUIREMENTS.md',
      status: 'approved',
      template: 'medium',
      taskSize: 'Large',
      changed: true,
    });
    expect(writeDoc).toHaveBeenCalledTimes(1);
  });

  it('the written frontmatter carries the three target keys and every prior field survives', () => {
    let written = '';
    const writeDoc = (_p: string, content: string) => { written = content; };
    planPrepare(options({ writeDoc }));
    const match = written.match(/^---\n([\s\S]*?)\n---\n/);
    expect(match).not.toBeNull();
    const fm = parseYaml<Record<string, unknown>>(match![1] ?? '') ?? {};
    expect(fm).toEqual({
      project: 'P',
      type: 'requirements',
      created: '2026-01-01T00:00:00.000Z',
      'project-type': 'standard',
      repos: ['rad-orc-source'],
      status: 'approved',
      template: 'medium',
      'task-size': 'Large',
    });
  });

  it('preserves the body byte-for-byte, including a CRLF fixture', () => {
    let written = '';
    const writeDoc = (_p: string, content: string) => { written = content; };
    planPrepare(options({ readDoc: () => CRLF_DOC, writeDoc }));
    const originalBody = CRLF_DOC.slice(CRLF_DOC.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)![0].length);
    const writtenBody = written.slice(written.match(/^---\n([\s\S]*?)\n---\n/)![0].length);
    expect(writtenBody).toBe(originalBody);
  });

  it('round-trips a multi-word prose task-size with an apostrophe intact', () => {
    const prose = "each task is one React component, tests included — don't split";
    let written = '';
    const writeDoc = (_p: string, content: string) => { written = content; };
    const r = planPrepare(options({ taskSize: prose, writeDoc }));
    expect(r.taskSize).toBe(prose);
    const match = written.match(/^---\n([\s\S]*?)\n---\n/);
    const fm = parseYaml<Record<string, unknown>>(match![1] ?? '') ?? {};
    expect(fm['task-size']).toBe(prose);
  });
});

// ── Idempotency ───────────────────────────────────────────────────────────────

describe('planPrepare — idempotent re-run', () => {
  it('returns changed: false and never calls writeDoc when values already match', () => {
    const APPROVED_DOC =
      '---\n'
      + 'project: P\n'
      + 'status: approved\n'
      + 'template: medium\n'
      + "task-size: Large\n"
      + '---\n'
      + 'Body.\n';
    const writeDoc = vi.fn();
    const r = planPrepare(options({ readDoc: () => APPROVED_DOC, writeDoc }));
    expect(r.changed).toBe(false);
    expect(r.status).toBe('approved');
    expect(writeDoc).not.toHaveBeenCalled();
  });

  it('re-runs with a different template/task-size and reports changed: true', () => {
    const APPROVED_DOC =
      '---\n'
      + 'project: P\n'
      + 'status: approved\n'
      + 'template: low\n'
      + 'task-size: Small\n'
      + '---\n'
      + 'Body.\n';
    const writeDoc = vi.fn();
    const r = planPrepare(options({ readDoc: () => APPROVED_DOC, writeDoc }));
    expect(r.changed).toBe(true);
    expect(writeDoc).toHaveBeenCalledTimes(1);
  });
});

// ── Missing/malformed frontmatter ─────────────────────────────────────────────

describe('planPrepare — no frontmatter', () => {
  it('throws a UserError naming the path', () => {
    expect(() => planPrepare(options({ readDoc: () => '# No frontmatter here\n' }))).toThrow(UserError);
    expect(() => planPrepare(options({ readDoc: () => '# No frontmatter here\n' }))).toThrow(/\/projects\/P\/P-REQUIREMENTS\.md/);
  });
});

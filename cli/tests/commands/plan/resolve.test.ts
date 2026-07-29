import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { planResolve, planResolveCommand, validateTemplate, SHIPPED_TIERS } from '../../../src/commands/plan/resolve.js';
import type { PlanResolveDeps } from '../../../src/commands/plan/resolve.js';
import { UserError } from '../../../src/framework/errors.js';
import type { CommandContext } from '../../../src/framework/context.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const deps = (over: Partial<PlanResolveDeps> = {}): PlanResolveDeps => ({
  project: 'P',
  template: undefined,
  projectsDir: '/projects',
  fileExists: () => true,
  ...over,
});

// ── Halt shape — no Requirements doc ─────────────────────────────────────────

describe('planResolve — halt when no Requirements doc', () => {
  it('returns the exact halt shape and reason', () => {
    const r = planResolve(deps({ fileExists: () => false }));
    const requirementsPath = path.join('/projects', 'P', 'P-REQUIREMENTS.md');
    expect(r.projectDir).toBeNull();
    expect(r.requirementsPath).toBeNull();
    expect(r.ask).toEqual({});
    expect(r.next).toEqual([]);
    expect(r.reason).toBe(
      `No requirements document at ${requirementsPath}. Run /rad-brainstorm P first to collaborate on goals and scribe the Requirements doc, then re-run /rad-plan P.`,
    );
  });
});

// ── Success path — ask gating and next[] substitution ────────────────────────

describe('planResolve — success path', () => {
  it('no --template: ask.template/taskSize/audit all set, both next[] lines carry the {template} token', () => {
    const r = planResolve(deps());
    const projectDir = path.join('/projects', 'P');
    expect(r.projectDir).toBe(projectDir);
    expect(r.requirementsPath).toBe(path.join(projectDir, 'P-REQUIREMENTS.md'));
    expect(r.ask).toEqual({ template: true, taskSize: true, audit: true });
    expect(r.next).toEqual([
      'plan prepare --project P --template {template} --task-size "{size}"',
      `pipeline signal --event start --project-dir "${projectDir}" --template {template}`,
    ]);
  });

  it('--template supplied: ask.template is omitted and the value is substituted into both next[] lines', () => {
    const r = planResolve(deps({ template: 'medium' }));
    const projectDir = path.join('/projects', 'P');
    expect(r.ask).toEqual({ taskSize: true, audit: true });
    expect(r.next).toEqual([
      'plan prepare --project P --template medium --task-size "{size}"',
      `pipeline signal --event start --project-dir "${projectDir}" --template medium`,
    ]);
  });

  it('{size} is always left as a token, and always double-quoted', () => {
    const withTemplate = planResolve(deps({ template: 'high' }));
    const withoutTemplate = planResolve(deps());
    expect(withTemplate.next[0]).toMatch(/--task-size "\{size\}"$/);
    expect(withoutTemplate.next[0]).toMatch(/--task-size "\{size\}"$/);
  });
});

// ── validateTemplate — pure validator ─────────────────────────────────────────

describe('validateTemplate', () => {
  it('accepts undefined (operator will choose)', () => {
    expect(validateTemplate(undefined)).toEqual({ ok: true });
  });

  it.each(SHIPPED_TIERS)('accepts the shipped tier "%s"', (tier) => {
    expect(validateTemplate(tier)).toEqual({ ok: true, template: tier });
  });

  it('rejects an unknown tier', () => {
    const r = validateTemplate('bogus');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/bogus/);
  });
});

// ── Project-name guard ────────────────────────────────────────────────────────

describe('planResolve — project-name guard', () => {
  it('a plain name passes', () => {
    expect(() => planResolve(deps({ project: 'plain-name' }))).not.toThrow();
  });

  it('rejects a relative-escape segment', () => {
    expect(() => planResolve(deps({ project: '../escape' }))).toThrow(UserError);
  });

  it('rejects a value with a path separator', () => {
    expect(() => planResolve(deps({ project: 'a/b' }))).toThrow(UserError);
  });

  it('rejects an absolute path', () => {
    expect(() => planResolve(deps({ project: path.resolve('/abs/path') }))).toThrow(UserError);
  });
});

// ── Project-name guard (handler level) ────────────────────────────────────────

describe('planResolveCommand.handler — project-name guard', () => {
  const ctx = {} as CommandContext;

  it('rejects a relative-escape segment', async () => {
    await expect(planResolveCommand.handler({ args: { project: '../escape' }, ctx })).rejects.toThrow(UserError);
  });

  it('rejects a value with a path separator', async () => {
    await expect(planResolveCommand.handler({ args: { project: 'a/b' }, ctx })).rejects.toThrow(UserError);
  });
});

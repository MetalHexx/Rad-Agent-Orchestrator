import { describe, it, expect } from 'vitest';
import { buildProgram } from '../../src/cli.js';

describe('radorch where removal', () => {
  it('no longer registers a top-level `where` command', () => {
    const program = buildProgram('0.0.0-test');
    expect(program.commands.find((c) => c.name() === 'where')).toBeUndefined();
  });
  it('drops the stale `radorch where` help tip', () => {
    const program = buildProgram('0.0.0-test');
    expect(program.helpInformation()).not.toMatch(/radorch where/);
  });
});

describe('radorch git doer removal (PLANNING-OVERHAUL-3)', () => {
  it('no longer registers a top-level `git` command', () => {
    // The git commit/pr doers were removed; the coder owns its commit and the
    // orchestrator opens PRs directly. `radorch` stays the pipeline engine only.
    const program = buildProgram('0.0.0-test');
    expect(program.commands.find((c) => c.name() === 'git')).toBeUndefined();
  });
});

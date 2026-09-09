import { describe, it, expect, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { readWorktreeCommitFacts } from '../../src/lib/worktree-commit-facts.js';
import type { CloneExec } from '../../src/lib/clone-facts.js';

// A real directory, so the `isDirectory` check passes and the stubbed exec is
// what actually decides the outcome.
const WORKTREE = os.tmpdir();

const execStub = (byArgs: (args: string[]) => string): CloneExec =>
  vi.fn((_file: string, args: string[]) => byArgs(args));

describe('readWorktreeCommitFacts', () => {
  it('a well-formed git log line parses into a numeric lastCommitAt and a verbatim lastCommitRelative', () => {
    const facts = readWorktreeCommitFacts(WORKTREE, {
      exec: execStub((args) => (args[0] === 'log' ? '1700000000\x1f3 hours ago' : 'feature/thing\n')),
    });
    expect(facts).toEqual({ lastCommitAt: 1700000000, lastCommitRelative: '3 hours ago', branch: 'feature/thing' });
  });

  it('a detached HEAD reports branch: null while keeping the commit facts', () => {
    const facts = readWorktreeCommitFacts(WORKTREE, {
      exec: execStub((args) => {
        if (args[0] === 'log') return '1700000000\x1f3 hours ago';
        throw new Error('fatal: ref HEAD is not a symbolic ref');
      }),
    });
    expect(facts).toEqual({ lastCommitAt: 1700000000, lastCommitRelative: '3 hours ago', branch: null });
  });

  it('a failing git log degrades to null rather than throwing', () => {
    const facts = readWorktreeCommitFacts(WORKTREE, {
      exec: () => { throw new Error('not a git repository'); },
    });
    expect(facts).toBeNull();
  });

  it('a non-directory path degrades to null without consulting git', () => {
    const exec = execStub(() => 'should-not-run');
    const missing = path.join(WORKTREE, 'rad-worktree-commit-facts-absent-dir');
    expect(readWorktreeCommitFacts(missing, { exec })).toBeNull();
  });
});

import { describe, it, expect, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { readCloneFacts } from '../../src/lib/clone-facts.js';
import type { CloneExec } from '../../src/lib/clone-facts.js';

// A real directory, so the `exists` check passes and the stubbed exec is what
// actually decides the outcome.
const CLONE = os.tmpdir();

const execStub = (byArgs: (args: string[]) => string): CloneExec =>
  vi.fn((_file: string, args: string[]) => byArgs(args));

describe('readCloneFacts', () => {
  it('a clean clone reports its branch and no dirty entries', () => {
    const facts = readCloneFacts('repo', {
      registryLocalPaths: { repo: CLONE },
      exec: execStub((args) => (args[0] === 'symbolic-ref' ? 'feature/thing\n' : '')),
    });
    expect(facts).toEqual({ path: CLONE, exists: true, branch: 'feature/thing', dirty: [] });
  });

  it('a dirty clone reports every porcelain entry, staged, modified and untracked alike', () => {
    const facts = readCloneFacts('repo', {
      registryLocalPaths: { repo: CLONE },
      exec: execStub((args) => (args[0] === 'symbolic-ref' ? 'wip\n' : 'A  added.ts\n M changed.ts\n?? new.ts\n')),
    });
    expect(facts?.dirty).toEqual(['A  added.ts', ' M changed.ts', '?? new.ts']);
  });

  it('a repo with no bound local path resolves to null', () => {
    expect(readCloneFacts('repo', { registryLocalPaths: {}, exec: execStub(() => '') })).toBeNull();
  });

  it('a bound path that is not on disk reports exists: false without consulting git', () => {
    const exec = execStub(() => 'should-not-run');
    const missing = path.join(CLONE, 'rad-clone-facts-absent-dir');
    const facts = readCloneFacts('repo', { registryLocalPaths: { repo: missing }, exec });
    expect(facts).toEqual({ path: missing, exists: false, branch: null, dirty: [] });
  });

  it('a failing git degrades to branch: null and no dirty entries rather than throwing', () => {
    const facts = readCloneFacts('repo', {
      registryLocalPaths: { repo: CLONE },
      exec: () => { throw new Error('not a git repository'); },
    });
    expect(facts).toEqual({ path: CLONE, exists: true, branch: null, dirty: [] });
  });

  it('an unreadable HEAD that yields empty output reports branch: null', () => {
    const facts = readCloneFacts('repo', {
      registryLocalPaths: { repo: CLONE },
      exec: execStub(() => ''),
    });
    expect(facts?.branch).toBeNull();
  });

  it('a detached HEAD reports branch: null rather than the literal string "HEAD"', () => {
    const facts = readCloneFacts('repo', {
      registryLocalPaths: { repo: CLONE },
      exec: execStub((args) => {
        if (args[0] === 'symbolic-ref') throw new Error('fatal: ref HEAD is not a symbolic ref');
        return '';
      }),
    });
    expect(facts?.branch).toBeNull();
  });
});

import { describe, it, expect, vi } from 'vitest';
import {
  slugify,
  deriveSlugFromRemote,
  normalizeRemote,
  getMainWorktreePath,
  getRemotes,
  selectRemote,
  getDefaultBranch,
  isInsideWorkTree,
  samePath,
} from '../../src/lib/repo-identity.js';

describe('slugify', () => {
  it('splits PascalCase / camelCase boundaries', () => {
    expect(slugify('RadOrchestration')).toBe('rad-orchestration');
    expect(slugify('myCoolRepo')).toBe('my-cool-repo');
    expect(slugify('HTTPServer')).toBe('http-server');
  });
  it('preserves existing kebab and lowercases', () => {
    expect(slugify('web-app')).toBe('web-app');
    expect(slugify('My_Repo.v2')).toBe('my-repo-v2');
  });
  it('returns empty when nothing alphanumeric survives', () => {
    expect(slugify('---')).toBe('');
  });
});

describe('deriveSlugFromRemote', () => {
  it('takes the last path segment of a normalized remote', () => {
    expect(deriveSlugFromRemote('https://github.com/MetalHexx/RadOrchestration')).toBe('rad-orchestration');
    expect(deriveSlugFromRemote('https://github.com/o/web-app')).toBe('web-app');
  });
});

describe('normalizeRemote', () => {
  it('strips .git and converts ssh to https', () => {
    expect(normalizeRemote('git@github.com:org/repo.git')).toBe('https://github.com/org/repo');
    expect(normalizeRemote('https://github.com/org/repo.git')).toBe('https://github.com/org/repo');
  });
});

describe('getMainWorktreePath', () => {
  it('returns the first worktree entry from porcelain output', () => {
    const exec = vi.fn(() => 'worktree /src/main\nHEAD abc\nbranch refs/heads/main\n\nworktree /wt/feature\nHEAD def\n');
    expect(getMainWorktreePath(exec)).toBe('/src/main');
  });
  it('returns null when git fails', () => {
    const exec = vi.fn(() => { throw new Error('not a git repo'); });
    expect(getMainWorktreePath(exec)).toBeNull();
  });
});

describe('getRemotes / selectRemote', () => {
  it('parses fetch URLs and selects the sole remote', () => {
    const exec = vi.fn(() => 'origin\thttps://github.com/o/r.git (fetch)\norigin\thttps://github.com/o/r.git (push)');
    const remotes = getRemotes(exec);
    expect(selectRemote(remotes)).toEqual({ name: 'origin', url: 'https://github.com/o/r', others: [] });
  });
  it('selects the sole remote even when it is not named origin', () => {
    const exec = vi.fn(() => 'upstream\thttps://github.com/o/r.git (fetch)\nupstream\thttps://github.com/o/r.git (push)');
    const remotes = getRemotes(exec);
    expect(selectRemote(remotes)).toEqual({ name: 'upstream', url: 'https://github.com/o/r', others: [] });
  });
  it('prefers origin and lists the others when several exist', () => {
    const remotes = new Map([['upstream', 'https://x/up'], ['origin', 'https://x/o']]);
    const sel = selectRemote(remotes);
    expect(sel.name).toBe('origin');
    expect(sel.others).toContain('upstream');
  });
  it('throws on no remote and on ambiguous multi-remote', () => {
    expect(() => selectRemote(new Map())).toThrow(/no remote/i);
    expect(() => selectRemote(new Map([['a', 'x'], ['b', 'y']]))).toThrow(/more than one remote/i);
  });
});

describe('getDefaultBranch', () => {
  it('reads the branch from the symref', () => {
    const ok = vi.fn(() => 'refs/remotes/origin/develop\n');
    expect(getDefaultBranch(ok, 'origin')).toBe('develop');
  });
  it('returns null when the symref cannot be read, never a guessed value', () => {
    const bad = vi.fn(() => { throw new Error('no symref'); });
    expect(getDefaultBranch(bad, 'origin')).toBeNull();
  });
});

describe('isInsideWorkTree / samePath', () => {
  it('detects a work tree', () => {
    expect(isInsideWorkTree(vi.fn(() => 'true\n'))).toBe(true);
    expect(isInsideWorkTree(vi.fn(() => { throw new Error('no'); }))).toBe(false);
  });
  it('compares paths ignoring slash direction, trailing slash, and case', () => {
    expect(samePath('C:\\dev\\repo', 'C:/dev/repo/')).toBe(true);
    expect(samePath('/src/a', '/src/b')).toBe(false);
    expect(samePath(null, '/x')).toBe(false);
  });
});

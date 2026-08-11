import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { repoAdd, type RepoAddResult, type RepoAddDryRunResult } from '../../../src/commands/repo/add.js';

let root: string;
let tempRepos: string[] = [];
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'add-')); tempRepos = []; });
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  for (const d of tempRepos) fs.rmSync(d, { recursive: true, force: true });
});

const DESC = 'A test repo for the suite';

// Realistic git stub: a single-clone repo whose toplevel == main worktree,
// unless overridden to simulate a linked worktree.
function execOk(
  remote = 'https://github.com/o/web-app.git',
  opts: { toplevel?: string; mainWorktree?: string } = {},
) {
  const toplevel = opts.toplevel ?? '/src/web-app';
  const mainWorktree = opts.mainWorktree ?? toplevel;
  return vi.fn((_file: string, args: string[]) => {
    if (args[0] === 'rev-parse' && args[1] === '--git-dir') return '.git';
    if (args[0] === 'rev-parse' && args[1] === '--is-inside-work-tree') return 'true';
    if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') return toplevel;
    if (args[0] === 'worktree' && args[1] === 'list') return `worktree ${mainWorktree}\nHEAD abc\nbranch refs/heads/main\n`;
    if (args.includes('remote') && args.includes('-v')) return `origin\t${remote} (fetch)\norigin\t${remote} (push)`;
    if (args[0] === 'symbolic-ref') return 'refs/remotes/origin/main';
    return '';
  });
}

function asResult(r: RepoAddResult | RepoAddDryRunResult): RepoAddResult {
  if ('dryRun' in r) throw new Error('expected a write result, got dry-run');
  return r;
}

describe('repo add', () => {
  it('registers a remote-derived slug, remote, and default branch', () => {
    const r = asResult(repoAdd({ root, repoPath: '/src/web-app', description: DESC, exec: execOk() }));
    expect(r.name).toBe('web-app');
    expect(r.remote).toBe('https://github.com/o/web-app');
    expect(r.default_branch).toBe('main');
    expect(r.path).toBe('/src/web-app');
  });

  it('derives a kebab slug from a PascalCase remote name', () => {
    const exec = execOk('https://github.com/MetalHexx/RadOrchestration.git', { toplevel: '/src/anything', mainWorktree: '/src/anything' });
    const r = asResult(repoAdd({ root, repoPath: '/src/anything', description: DESC, exec }));
    expect(r.name).toBe('rad-orchestration');
  });

  it('honors an explicit --name override', () => {
    const exec = execOk('https://github.com/MetalHexx/RadOrchestration.git');
    const r = asResult(repoAdd({ root, repoPath: '/src/x', name: 'custom-slug', description: DESC, exec }));
    expect(r.name).toBe('custom-slug');
  });

  it('resolves a worktree path to the main clone', () => {
    const exec = execOk('https://github.com/o/web-app.git', { toplevel: '/wt/FEATURE', mainWorktree: '/src/web-app' });
    const r = asResult(repoAdd({ root, repoPath: '/wt/FEATURE', description: DESC, exec }));
    expect(r.path).toBe('/src/web-app');
    expect(r.resolvedFrom).toBe('/wt/FEATURE');
  });

  it('requires a non-empty description for a real registration', () => {
    expect(() => repoAdd({ root, repoPath: '/src/web-app', exec: execOk() })).toThrow(/description is required/i);
    expect(() => repoAdd({ root, repoPath: '/src/web-app', description: '   ', exec: execOk() })).toThrow(/description is required/i);
  });

  it('fails when path is not a git repository', () => {
    const exec = vi.fn((_f: string, a: string[]) => { if (a[0] === 'rev-parse') throw new Error('not a git repository'); return ''; });
    expect(() => repoAdd({ root, repoPath: '/x', description: DESC, exec })).toThrow(/not a git repository/i);
  });

  it('fails when there is no remote', () => {
    const exec = execOk();
    const e = vi.fn((f: string, a: string[]) => a.includes('-v') ? '' : exec(f, a));
    expect(() => repoAdd({ root, repoPath: '/src/x', description: DESC, exec: e })).toThrow(/no remote/i);
  });

  it('fails when multiple remotes and none is origin', () => {
    const e = vi.fn((_f: string, a: string[]) => {
      if (a[0] === 'rev-parse') return a[1] === '--is-inside-work-tree' ? 'true' : '.git';
      if (a.includes('-v')) return 'upstream\tg (fetch)\nfork\th (fetch)';
      return '';
    });
    expect(() => repoAdd({ root, repoPath: '/src/x', description: DESC, exec: e })).toThrow(/more than one remote/i);
  });

  it('fails when the derived name already exists', () => {
    repoAdd({ root, repoPath: '/src/web-app', description: DESC, exec: execOk() });
    expect(() => repoAdd({ root, repoPath: '/src/web-app', description: DESC, exec: execOk() })).toThrow(/already exists/i);
  });

  it('blocks re-registering the same remote under a different slug', () => {
    repoAdd({ root, repoPath: '/src/web-app', description: DESC, exec: execOk() });
    expect(() => repoAdd({ root, repoPath: '/src/web-app', name: 'other-name', description: DESC, exec: execOk() }))
      .toThrow(/already registered as 'web-app'/i);
  });

  it('throws when neither remote nor path yields a valid slug', () => {
    const exec = execOk('https://github.com/o/---.git', { toplevel: '/src/---', mainWorktree: '/src/---' });
    expect(() => repoAdd({ root, repoPath: '/src/---', description: DESC, exec })).toThrow(/not a valid slug/i);
  });

  it('fails loud naming the repo when the remote HEAD symref cannot be read, and writes nothing', () => {
    const exec = vi.fn((_file: string, args: string[]) => {
      if (args[0] === 'rev-parse') return args[1] === '--is-inside-work-tree' ? 'true' : (args[1] === '--show-toplevel' ? '/src/web-app' : '.git');
      if (args[0] === 'worktree' && args[1] === 'list') return 'worktree /src/web-app\n';
      if (args.includes('remote') && args.includes('-v'))
        return 'origin\thttps://github.com/o/web-app.git (fetch)\norigin\thttps://github.com/o/web-app.git (push)';
      if (args[0] === 'symbolic-ref') throw new Error('unable to read symref');
      return '';
    });
    expect(() => repoAdd({ root, repoPath: '/src/web-app', description: DESC, exec })).toThrow(/web-app/i);
    expect(fs.existsSync(path.join(root, 'repo-registry.yml'))).toBe(false);
  });

  it('uses the default branch from a sole remote named other than origin', () => {
    const exec = vi.fn((_file: string, args: string[]) => {
      if (args[0] === 'rev-parse') return args[1] === '--is-inside-work-tree' ? 'true' : (args[1] === '--show-toplevel' ? '/src/lib' : '.git');
      if (args[0] === 'worktree' && args[1] === 'list') return 'worktree /src/lib\n';
      if (args.includes('remote') && args.includes('-v'))
        return 'upstream\thttps://github.com/o/lib.git (fetch)\nupstream\thttps://github.com/o/lib.git (push)';
      if (args[0] === 'symbolic-ref' && args[1] === 'refs/remotes/upstream/HEAD')
        return 'refs/remotes/upstream/develop\n';
      return '';
    });
    const r = asResult(repoAdd({ root, repoPath: '/src/lib', description: DESC, exec }));
    expect(r.remote).toBe('https://github.com/o/lib');
    expect(r.default_branch).toBe('develop');
  });
});

describe('repo add — dry run', () => {
  it('writes nothing and reports detection for a worktree path (no description needed)', () => {
    const exec = execOk('https://github.com/MetalHexx/RadOrchestration.git', { toplevel: '/wt/FEATURE', mainWorktree: '/src/rad' });
    const r = repoAdd({ root, repoPath: '/wt/FEATURE', dryRun: true, exec });
    if (!('dryRun' in r)) throw new Error('expected dry-run');
    expect(r.wouldRegister.path).toBe('/src/rad');
    expect(r.wouldRegister.name).toBe('rad-orchestration');
    expect(r.detection.isWorktree).toBe(true);
    expect(r.detection.mainWorktreePath).toBe('/src/rad');
    expect(r.detection.nameAvailable).toBe(true);
    expect(fs.existsSync(path.join(root, 'repo-registry.yml'))).toBe(false);
  });

  it('flags a remote already registered under another slug', () => {
    repoAdd({ root, repoPath: '/src/web-app', description: DESC, exec: execOk() });
    const exec = execOk('https://github.com/o/web-app.git', { toplevel: '/src/web-app', mainWorktree: '/src/web-app' });
    const r = repoAdd({ root, repoPath: '/src/web-app', name: 'renamed', dryRun: true, exec });
    if (!('dryRun' in r)) throw new Error('expected dry-run');
    expect(r.detection.remoteAlreadyRegisteredAs).toBe('web-app');
    expect(r.detection.nameAvailable).toBe(true);
  });
});

describe('repo add — real git (FR-4)', () => {
  it('infers remote and default_branch from repoPath, not process.cwd()', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-cwd-'));
    tempRepos.push(tmp);
    const gitEnv = { ...process.env, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@test.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@test.com' };
    execFileSync('git', ['init', '-b', 'main'], { cwd: tmp, encoding: 'utf8' });
    execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/test/my-repo.git'], { cwd: tmp, encoding: 'utf8' });
    execFileSync('git', ['commit', '--allow-empty', '-m', 'init'], { cwd: tmp, encoding: 'utf8', env: gitEnv });
    // No real fetch happens against this fake remote, so the origin/HEAD symref
    // that getDefaultBranch reads must be set up by hand, mirroring what a real
    // `git fetch` records.
    execFileSync('git', ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main'], { cwd: tmp, encoding: 'utf8' });
    expect(process.cwd()).not.toBe(tmp);
    const result = asResult(repoAdd({ root, repoPath: tmp, description: DESC }));
    expect(result.remote).toBe('https://github.com/test/my-repo');
    expect(result.default_branch).toBe('main');
    expect(result.name).toBe('my-repo');
  });
});

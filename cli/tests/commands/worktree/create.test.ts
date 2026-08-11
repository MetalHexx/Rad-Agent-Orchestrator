import { describe, it, expect, vi } from 'vitest';
import { worktreeCreate, worktreeCreateCommand, provisionWorktrees, aggregateExitCode, defaultBranchDefault } from '../../../src/commands/worktree/create.js';
import { runCommand } from '../../../src/framework/command.js';

// Registry-backed base branch: 'old-repo' resolves to its recorded default_branch;
// an unregistered repo falls back to 'main'. (No real registry I/O.)
vi.mock('@rad-orchestration/repo-registry', () => ({
  readRegistry: () => ({
    repos: { 'old-repo': { default_branch: 'develop', remote: 'git@github.com:o/old-repo.git', description: '' } },
    repoGroups: {},
    localPaths: {},
  }),
  resolveRepoPath: () => ({ path: '/clones/x' }),
}));

function makeExecErr(stderr: string): Error & { stderr: string } {
  const e = new Error(stderr) as Error & { stderr: string };
  e.stderr = stderr;
  return e;
}

// Dispatches on the git subcommand (args[0]) rather than call order, so adding
// the show-ref/ls-remote probes ahead of `worktree add` doesn't shift every
// existing mockImplementationOnce chain by two calls.
type GitSubcommand = 'worktree' | 'show-ref' | 'ls-remote' | 'fetch' | 'push' | 'remote';
function makeExec(handlers: Partial<Record<GitSubcommand, (args: string[]) => string>>) {
  return vi.fn((_file: string, args: string[]) => {
    const key = args[0] as GitSubcommand;
    const handler = handlers[key];
    if (!handler) throw new Error(`unstubbed git subcommand in test: ${args.join(' ')}`);
    return handler(args);
  });
}

// Default probe stubs for tests that only care about the post-add behavior
// (push, remote-url, error classification) — branch absent locally and
// remotely, so worktreeCreate takes the create-new (`-b`) path.
function newBranchProbes() {
  return {
    'show-ref': () => { throw makeExecErr('not a valid ref'); },
    'ls-remote': () => '',
  } as const;
}

describe('worktreeCreate core', () => {
  it('creates the worktree, pushes, returns compareUrl with SSH→HTTPS conversion', () => {
    const exec = makeExec({
      ...newBranchProbes(),
      worktree: () => '',
      push: () => '',
      remote: () => 'git@github.com:org/repo.git\n',
    });
    const r = worktreeCreate({ repoRoot: '/r', branch: 'feat/x', worktreePath: '/r-wt/x', baseBranch: 'origin/main', exec });
    expect(r.created).toBe(true);
    expect(r.pushed).toBe(true);
    expect(r.remoteUrl).toBe('https://github.com/org/repo');
    expect(r.compareUrl).toBe('https://github.com/org/repo/compare/main...feat/x');
    expect(r.errorType).toBeNull();
    expect(r.branchMode).toBe('created');
  });

  it('classifies "already exists" path error and returns created:false', () => {
    const exec = makeExec({
      ...newBranchProbes(),
      worktree: () => { throw makeExecErr('fatal: \'/r-wt/x\' already exists'); },
    });
    const r = worktreeCreate({ repoRoot: '/r', branch: 'feat/x', worktreePath: '/r-wt/x', baseBranch: 'main', exec });
    expect(r.created).toBe(false);
    expect(r.errorType).toBe('already_exists_path');
    expect(r.branchMode).toBeNull();
  });

  it('classifies branch-collision error', () => {
    const exec = makeExec({
      ...newBranchProbes(),
      worktree: () => { throw makeExecErr('fatal: a branch named \'feat/x\' already exists'); },
    });
    const r = worktreeCreate({ repoRoot: '/r', branch: 'feat/x', worktreePath: '/r-wt/x', baseBranch: 'main', exec });
    expect(r.errorType).toBe('already_exists_branch');
    expect(r.branchMode).toBeNull();
  });

  it('classifies invalid_reference', () => {
    const exec = makeExec({
      ...newBranchProbes(),
      worktree: () => { throw makeExecErr('fatal: invalid reference: bogus-ref'); },
    });
    const r = worktreeCreate({ repoRoot: '/r', branch: 'feat/x', worktreePath: '/r-wt/x', baseBranch: 'bogus-ref', exec });
    expect(r.errorType).toBe('invalid_reference');
    expect(r.branchMode).toBeNull();
  });

  it('returns pushed:false when push fails after creation', () => {
    const exec = makeExec({
      ...newBranchProbes(),
      worktree: () => '',
      push: () => { throw makeExecErr('fatal: push failed'); },
      remote: () => 'https://github.com/o/r.git\n',
    });
    const r = worktreeCreate({ repoRoot: '/r', branch: 'feat/x', worktreePath: '/r-wt/x', baseBranch: 'main', exec });
    expect(r.created).toBe(true);
    expect(r.pushed).toBe(false);
  });
});

describe('worktreeCreate — branch-state probing decides the git sequence', () => {
  it('attaches an already-local branch: no -b, no fetch, branchMode attached-local', () => {
    const exec = makeExec({
      'show-ref': () => '', // exit 0: local ref exists
      worktree: () => '',
      push: () => '',
      remote: () => '',
    });
    const r = worktreeCreate({ repoRoot: '/r', branch: 'feat/x', worktreePath: '/r-wt/x', baseBranch: 'origin/main', exec });
    expect(r.branchMode).toBe('attached-local');
    expect(r.created).toBe(true);
    const worktreeCall = exec.mock.calls.find((c) => (c[1] as string[])[0] === 'worktree');
    expect(worktreeCall?.[1]).toEqual(['worktree', 'add', '/r-wt/x', 'feat/x']);
    expect(exec.mock.calls.some((c) => (c[1] as string[])[0] === 'fetch')).toBe(false);
    expect(exec.mock.calls.some((c) => (c[1] as string[])[0] === 'ls-remote')).toBe(false);
  });

  it('fetches then attaches a remote-only branch: no -b, branchMode attached-remote', () => {
    const exec = makeExec({
      'show-ref': () => { throw makeExecErr('not a valid ref'); },
      'ls-remote': () => 'abc123\trefs/heads/feat/x\n', // non-empty stdout: remote has it
      fetch: () => '',
      worktree: () => '',
      push: () => '',
      remote: () => '',
    });
    const r = worktreeCreate({ repoRoot: '/r', branch: 'feat/x', worktreePath: '/r-wt/x', baseBranch: 'origin/main', exec });
    expect(r.branchMode).toBe('attached-remote');
    expect(r.created).toBe(true);
    const fetchIdx = exec.mock.calls.findIndex((c) => (c[1] as string[])[0] === 'fetch');
    const worktreeIdx = exec.mock.calls.findIndex((c) => (c[1] as string[])[0] === 'worktree');
    expect(fetchIdx).toBeGreaterThanOrEqual(0);
    expect(fetchIdx).toBeLessThan(worktreeIdx);
    expect(exec.mock.calls[fetchIdx]?.[1]).toEqual(['fetch', 'origin', 'feat/x:refs/heads/feat/x']);
    expect(exec.mock.calls[worktreeIdx]?.[1]).toEqual(['worktree', 'add', '/r-wt/x', 'feat/x']);
  });

  it('creates a new branch when absent locally and remotely: -b and baseBranch present, no fetch', () => {
    const exec = makeExec({
      ...newBranchProbes(),
      worktree: () => '',
      push: () => '',
      remote: () => '',
    });
    const r = worktreeCreate({ repoRoot: '/r', branch: 'feat/x', worktreePath: '/r-wt/x', baseBranch: 'origin/main', exec });
    expect(r.branchMode).toBe('created');
    const worktreeCall = exec.mock.calls.find((c) => (c[1] as string[])[0] === 'worktree');
    expect(worktreeCall?.[1]).toEqual(['worktree', 'add', '-b', 'feat/x', '/r-wt/x', 'origin/main']);
    expect(exec.mock.calls.some((c) => (c[1] as string[])[0] === 'fetch')).toBe(false);
  });

  it('reports branchMode: null when the worktree add fails despite a resolved branch state', () => {
    const exec = makeExec({
      'show-ref': () => '', // local branch exists
      worktree: () => { throw makeExecErr('fatal: boom'); },
    });
    const r = worktreeCreate({ repoRoot: '/r', branch: 'feat/x', worktreePath: '/r-wt/x', baseBranch: 'main', exec });
    expect(r.created).toBe(false);
    expect(r.branchMode).toBeNull();
  });

  it('does not create a new branch when the remote probe fails to run (network/exec failure)', () => {
    const exec = makeExec({
      'show-ref': () => { throw makeExecErr('not a valid ref'); },
      'ls-remote': () => { throw makeExecErr('fatal: unable to access origin: Could not resolve host'); },
    });
    const r = worktreeCreate({ repoRoot: '/r', branch: 'feat/x', worktreePath: '/r-wt/x', baseBranch: 'origin/main', exec });
    expect(r.created).toBe(false);
    expect(r.branchMode).toBeNull();
    expect(r.errorType).toBe('remote_probe_failed');
    expect(r.error).toMatch(/feat\/x/);
    expect(exec.mock.calls.some((c) => (c[1] as string[])[0] === 'worktree')).toBe(false);
  });
});

describe('worktreeCreate CLI path (runCommand argv → handler args)', () => {
  // Locks the framework contract: --project and optional --worktree-name/--repo
  // must arrive at the handler under their hyphenated keys.
  it('passes --project, --worktree-name, --repo through runCommand', async () => {
    type CreateArgs = { project?: string; 'worktree-name'?: string; repo?: string };
    let received: CreateArgs = {};
    const probeDef = {
      ...worktreeCreateCommand,
      handler: async ({ args }: { args: CreateArgs; ctx: unknown }) => {
        received = args;
        return { repos: [] } as never;
      },
      mapResult: undefined,
    };
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined as never) as never);
    await runCommand(probeDef, {
      argv: [
        '--project', 'MY-PROJECT',
        '--worktree-name', 'MY-WORKTREE',
        '--repo', 'my-repo',
      ],
      env: { RADORCH_NO_LOG: '1' },
      isTTY: false,
      stderr: process.stderr,
    });
    expect(received.project).toBe('MY-PROJECT');
    expect(received['worktree-name']).toBe('MY-WORKTREE');
    expect(received.repo).toBe('my-repo');
    const arg = (log.mock.calls[0]?.[0] ?? '') as string;
    const env = JSON.parse(arg);
    expect(env.ok).toBe(true);
    expect(exit).toHaveBeenCalledWith(0);
    log.mockRestore(); exit.mockRestore();
  });

  it('returns a well-formed user_error envelope when --project is omitted in non-interactive mode', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined as never) as never);
    await runCommand(worktreeCreateCommand, {
      argv: ['--non-interactive'],
      env: { RADORCH_NO_LOG: '1' },
      isTTY: true,
      stderr: process.stderr,
    });
    const arg = (log.mock.calls[0]?.[0] ?? '') as string;
    const env = JSON.parse(arg);
    expect(env.ok).toBe(false);
    expect(env.error.type).toBe('user_error');
    expect(env.error.message).toMatch(/project/);
    expect(exit).toHaveBeenCalledWith(1);
    log.mockRestore(); exit.mockRestore();
  });
});

describe('worktreeCreateCommand.mapResult — provision result exit codes', () => {
  const mr = worktreeCreateCommand.mapResult!;
  it('exits 0 when all repos succeed without error', () => {
    const result = { repos: [
      { name: 'a', created: true, pushed: true, path: '/wt/P/a', branch: 'radorch/P', error: null, errorType: null },
      { name: 'b', created: true, pushed: true, path: '/wt/P/b', branch: 'radorch/P', error: null, errorType: null },
    ] };
    const env = mr(result as never);
    expect(env.ok).toBe(true);
    expect(env.exit_code).toBe(0);
  });
  it('exits 2 when at least one repo failed to create (has an error)', () => {
    const result = { repos: [
      { name: 'a', created: false, pushed: false, path: '/wt/P/a', branch: 'radorch/P', error: 'boom', errorType: 'unknown' },
      { name: 'b', created: true, pushed: true, path: '/wt/P/b', branch: 'radorch/P', error: null, errorType: null },
    ] };
    const env = mr(result as never);
    expect(env.ok).toBe(true);
    expect(env.exit_code).toBe(2);
  });
  it('exits 1 when a repo was created but its push failed', () => {
    const result = { repos: [
      { name: 'a', created: true, pushed: false, path: '/wt/P/a', branch: 'radorch/P', error: null, errorType: null },
    ] };
    const env = mr(result as never);
    expect(env.ok).toBe(true);
    expect(env.exit_code).toBe(1);
  });
  it('carries repos data in the ok:true envelope', () => {
    const result = { repos: [
      { name: 'a', created: false, pushed: true, path: '/wt/P/a', branch: 'radorch/P', error: null, errorType: null },
    ] };
    const env = mr(result as never) as { ok: boolean; data: unknown; exit_code: number };
    expect(env.ok).toBe(true);
    expect(env.data).toEqual(result);
  });
});

describe('worktree create aggregate exit code (AD-5)', () => {
  it('returns 0 when every repo is present/created and pushed', () => {
    expect(aggregateExitCode([{ created: true, pushed: true }, { created: false, pushed: true }] as never)).toBe(0);
  });
  it('returns 1 when a repo was created but its push failed', () => {
    expect(aggregateExitCode([{ created: true, pushed: false }] as never)).toBe(1);
  });
  it('returns 2 when any repo failed to create', () => {
    expect(aggregateExitCode([{ created: false, pushed: false, error: 'boom' }, { created: true, pushed: true }] as never)).toBe(2);
  });
});

describe('defaultBranchDefault — base branch from the registry (no hardcoded main)', () => {
  it('returns the registered default_branch for a known repo', () => {
    expect(defaultBranchDefault('old-repo')).toBe('develop');
  });
  it('throws for an unregistered repo instead of guessing main', () => {
    expect(() => defaultBranchDefault('unregistered-repo')).toThrow(/unregistered-repo/);
  });
});

describe('provisionWorktrees convention-bound (FR-3, FR-4, NFR-2, NFR-6)', () => {
  const deps = (over: Partial<Record<string, unknown>> = {}) => ({
    worktreesDir: '/wt',
    readProjectRepos: () => ({ repos: ['a', 'b'], projectType: 'standard' as const }),
    resolveClonePath: (r: string) => `/clones/${r}`,
    defaultBranch: () => 'main',
    exists: () => false,
    create: vi.fn(() => ({ created: true, worktreePath: '/x', branch: 'radorch/p', baseBranch: 'main', pushed: true, remoteUrl: 'u', compareUrl: 'c', error: null, errorType: null, branchMode: 'created' as const })),
    ...over,
  });
  it('provisions every repo in the set and returns a per-repo result array', () => {
    const d = deps();
    const r = provisionWorktrees({ project: 'P', ...d });
    expect(r.repos.map((x) => x.name)).toEqual(['a', 'b']);
    expect(r.repos.every((x) => x.created)).toBe(true);
    expect((d.create as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(2);
  });
  it('is an idempotent no-op for an already-present worktree', () => {
    const create = vi.fn();
    const r = provisionWorktrees({ project: 'P', ...deps({ exists: () => true, create }) });
    expect(create).not.toHaveBeenCalled();
    expect(r.repos.every((x) => x.created === false && x.error == null)).toBe(true);
    expect(r.repos.every((x) => x.branchMode === null)).toBe(true);
  });
  it('isolates a per-repo failure without blocking the others', () => {
    const create = vi.fn()
      .mockImplementationOnce(() => ({ created: false, error: 'boom', errorType: 'unknown', worktreePath: null, branch: null, baseBranch: null, pushed: false, remoteUrl: '', compareUrl: '', branchMode: null }))
      .mockImplementationOnce(() => ({ created: true, worktreePath: '/x', branch: 'b', baseBranch: 'main', pushed: true, remoteUrl: 'u', compareUrl: 'c', error: null, errorType: null, branchMode: 'attached-local' }));
    const r = provisionWorktrees({ project: 'P', ...deps({ create }) });
    expect(r.repos[0]?.error).toBe('boom');
    expect(r.repos[0]?.branchMode).toBeNull();
    expect(r.repos[1]?.created).toBe(true);
    expect(r.repos[1]?.branchMode).toBe('attached-local');
  });
  it('throws naming the bad repo and listing the valid set when --repo is not in the project', () => {
    const create = vi.fn();
    expect(() => provisionWorktrees({ project: 'P', repo: 'nope', ...deps({ create }) }))
      .toThrow(/nope/);
    expect(() => provisionWorktrees({ project: 'P', repo: 'nope', ...deps({ create }) }))
      .toThrow(/\ba\b.*\bb\b/);
    expect(create).not.toHaveBeenCalled();
  });
  it('passes branchMode straight through from create() on the per-repo result', () => {
    const create = vi.fn(() => ({ created: true, worktreePath: '/x', branch: 'radorch/p', baseBranch: 'main', pushed: true, remoteUrl: 'u', compareUrl: 'c', error: null, errorType: null, branchMode: 'attached-remote' as const }));
    const r = provisionWorktrees({ project: 'P', ...deps({ create }) });
    expect(r.repos.every((x) => x.branchMode === 'attached-remote')).toBe(true);
  });
});

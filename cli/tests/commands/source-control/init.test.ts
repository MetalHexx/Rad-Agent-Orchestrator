import { describe, it, expect, vi } from 'vitest';
import { sourceControlInit, resolveAutoCommit, resolveAutoPr } from '../../../src/commands/source-control/init.js';

const base = (over = {}) => ({
  readProjectRepos: () => ({ repos: ['rad-orc-source'], projectType: 'standard' as const }),
  readWorktreeFacts: () => ({ exists: true, branch: 'radorch/p', baseBranch: 'main', remoteUrl: 'https://github.com/o/r', compareUrl: 'https://github.com/o/r/compare/main...radorch/p' }),
  autoCommit: () => 'always' as const,
  autoPr: () => 'never' as const,
  readState: () => ({ pipeline: {} }),
  writeState: vi.fn(),
  resolveClonePath: (_repo: string) => `/clones/${_repo}`,
  defaultBranch: (_repo: string) => 'main',
  remoteBranchExists: vi.fn(() => 'present' as const),
  ...over,
});

describe('sourceControlInit check + record (FR-7, FR-8, FR-9, FR-10, NFR-2)', () => {
  it('reads branch from the worktree as source of truth and records the v6 shape', () => {
    const writeState = vi.fn();
    const r = sourceControlInit({ project: 'P', ...base({ writeState }) });
    expect(r.ok).toBe(true);
    const written = (writeState.mock.calls[0]?.[1] as { pipeline: { source_control: { repos: { branch: string }[] } } });
    expect(written.pipeline.source_control.repos[0]?.branch).toBe('radorch/p');
  });
  it('fails loud naming the repo and the recovery command on a missing worktree', () => {
    const r = sourceControlInit({ project: 'P', ...base({ readWorktreeFacts: () => ({ exists: false }) }) });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/rad-orc-source/);
    expect(r.error).toMatch(/worktree create --repo/);
  });
  it('records a non-main base_branch and matching compare_url for a repo whose registered default branch is master', () => {
    const writeState = vi.fn();
    const readWorktreeFacts = vi.fn((_worktreePath: string, baseBranch: string) => ({
      exists: true,
      branch: 'radorch/p',
      baseBranch,
      remoteUrl: 'https://github.com/o/r',
      compareUrl: `https://github.com/o/r/compare/${baseBranch}...radorch/p`,
    }));
    const r = sourceControlInit({ project: 'P', ...base({ writeState, readWorktreeFacts, defaultBranch: () => 'master' }) });
    expect(r.ok).toBe(true);
    const sc = (writeState.mock.calls[0]?.[1] as { pipeline: { source_control: { repos: Array<{ base_branch: string; compare_url: string | null }> } } }).pipeline.source_control;
    expect(sc.repos[0]?.base_branch).toBe('master');
    expect(sc.repos[0]?.compare_url).toBe('https://github.com/o/r/compare/master...radorch/p');
  });
  it('re-derives identical state as an idempotent no-op', () => {
    const w1 = vi.fn(); sourceControlInit({ project: 'P', ...base({ writeState: w1 }) });
    const w2 = vi.fn(); sourceControlInit({ project: 'P', ...base({ writeState: w2 }) });
    expect(w1.mock.calls[0]?.[1]).toEqual(w2.mock.calls[0]?.[1]);
  });
  it('records the fixed side-project binding', () => {
    const writeState = vi.fn();
    sourceControlInit({ project: 'P', ...base({ readProjectRepos: () => ({ repos: ['P'], projectType: 'side-project' as const }), writeState }) });
    const sc = (writeState.mock.calls[0]?.[1] as { pipeline: { source_control: { auto_commit: string; auto_pr: string; repos: { branch: string; remote_url: string | null }[] } } }).pipeline.source_control;
    expect(sc.auto_commit).toBe('always');
    expect(sc.auto_pr).toBe('never');
    expect(sc.repos[0]?.branch).toBe('main');
    expect(sc.repos[0]?.remote_url).toBeNull();
  });
  it('rejects an in-place request against a multi-repo target as ambiguous', () => {
    const r = sourceControlInit({ project: 'P', inPlace: true, ...base({ readProjectRepos: () => ({ repos: ['a', 'b'], projectType: 'standard' as const }) }) });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/in-place/i);
  });
  it('in-place mode reads branch from registry-resolved clone path and stamps in_place: true (FR-10, NFR-1)', () => {
    const writeState = vi.fn();
    const resolveClonePath = vi.fn((_repo: string) => `/clones/${_repo}`);
    const readWorktreeFacts = vi.fn(() => ({ exists: true, branch: 'feature-x', baseBranch: 'main' }));
    const r = sourceControlInit({
      project: 'P',
      inPlace: true,
      ...base({ writeState, resolveClonePath, readWorktreeFacts }),
    });
    expect(r.ok).toBe(true);
    // resolveClonePath must be called with the repo name
    expect(resolveClonePath).toHaveBeenCalledWith('rad-orc-source');
    // readWorktreeFacts must be called with the registry-resolved clone path (not a worktree-convention path) and the resolved default branch
    expect(readWorktreeFacts).toHaveBeenCalledWith('/clones/rad-orc-source', 'main');
    const sc = (writeState.mock.calls[0]?.[1] as { pipeline: { source_control: { repos: Array<{ name: string; branch: string; in_place?: boolean }> } } }).pipeline.source_control;
    expect(sc.repos[0]?.name).toBe('rad-orc-source');
    expect(sc.repos[0]?.branch).toBe('feature-x');
    expect(sc.repos[0]?.in_place).toBe(true);
    // path-free invariant: no 'path' key on the repo entry
    expect('path' in (sc.repos[0] as object)).toBe(false);
  });

  it('fails naming the repo and clone path when the in-place clone is missing', () => {
    const resolveClonePath = vi.fn(() => '/clones/rad-orc-source');
    const r = sourceControlInit({
      project: 'P',
      inPlace: true,
      ...base({ resolveClonePath, readWorktreeFacts: () => ({ exists: false }) }),
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/rad-orc-source/);
    expect(r.error).toMatch(/\/clones\/rad-orc-source/);
  });

  it('fails naming the repo and clone path when the in-place clone has no readable branch', () => {
    const r = sourceControlInit({
      project: 'P',
      inPlace: true,
      ...base({ readWorktreeFacts: () => ({ exists: true, branch: '' }) }),
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/rad-orc-source/);
    expect(r.error).toMatch(/\/clones\/rad-orc-source/);
  });

  it('rejects an in-place seal when the clone has moved off the branch confirmed at offer time', () => {
    const writeState = vi.fn();
    const r = sourceControlInit({
      project: 'P',
      inPlace: true,
      branch: 'feature-x',
      ...base({ writeState, readWorktreeFacts: () => ({ exists: true, branch: 'main', baseBranch: 'main' }) }),
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/feature-x/);
    expect(r.error).toMatch(/main/);
    expect(writeState).not.toHaveBeenCalled();
  });

  it('seals an in-place binding when the live branch still matches the one confirmed at offer time', () => {
    const writeState = vi.fn();
    const r = sourceControlInit({
      project: 'P',
      inPlace: true,
      branch: 'feature-x',
      ...base({ writeState, readWorktreeFacts: () => ({ exists: true, branch: 'feature-x', baseBranch: 'main' }) }),
    });
    expect(r.ok).toBe(true);
    expect(writeState).toHaveBeenCalledTimes(1);
  });

  it('records a supplied base branch equal to the registered default without probing the remote', () => {
    const writeState = vi.fn();
    const remoteBranchExists = vi.fn(() => 'present' as const);
    const r = sourceControlInit({
      project: 'P',
      inPlace: true,
      baseBranch: 'main',
      ...base({ writeState, remoteBranchExists, defaultBranch: () => 'main' }),
    });
    expect(r.ok).toBe(true);
    expect(remoteBranchExists).not.toHaveBeenCalled();
    const sc = (writeState.mock.calls[0]?.[1] as { pipeline: { source_control: { repos: Array<{ base_branch: string }> } } }).pipeline.source_control;
    expect(sc.repos[0]?.base_branch).toBe('main');
  });

  it('probes the remote and records a supplied base branch that differs from the default when present', () => {
    const writeState = vi.fn();
    const remoteBranchExists = vi.fn(() => 'present' as const);
    const r = sourceControlInit({
      project: 'P',
      inPlace: true,
      baseBranch: 'release',
      ...base({ writeState, remoteBranchExists, defaultBranch: () => 'main' }),
    });
    expect(r.ok).toBe(true);
    expect(remoteBranchExists).toHaveBeenCalledWith('rad-orc-source', 'release');
    const sc = (writeState.mock.calls[0]?.[1] as { pipeline: { source_control: { repos: Array<{ base_branch: string; compare_url: string | null }> } } }).pipeline.source_control;
    expect(sc.repos[0]?.base_branch).toBe('release');
    expect(sc.repos[0]?.compare_url).toMatch(/compare\/release\.\.\./);
  });

  it('rejects a supplied base branch confirmed absent on the remote, naming the branch and repo, without writing state', () => {
    const writeState = vi.fn();
    const remoteBranchExists = vi.fn(() => 'absent' as const);
    const r = sourceControlInit({
      project: 'P',
      inPlace: true,
      baseBranch: 'release',
      ...base({ writeState, remoteBranchExists, defaultBranch: () => 'main' }),
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/release/);
    expect(r.error).toMatch(/rad-orc-source/);
    expect(writeState).not.toHaveBeenCalled();
  });

  it('rejects a supplied base branch whose remote probe could not run — distinct from confirmed-absent — without writing state', () => {
    const writeState = vi.fn();
    const remoteBranchExists = vi.fn(() => 'unknown' as const);
    const r = sourceControlInit({
      project: 'P',
      inPlace: true,
      baseBranch: 'release',
      ...base({ writeState, remoteBranchExists, defaultBranch: () => 'main' }),
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/release/);
    expect(r.error).not.toMatch(/not found|missing|absent/i);
    expect(writeState).not.toHaveBeenCalled();
  });
});

describe('sourceControlInit honors resolved commit/PR preference (FR-21, NFR-5, AD-7)', () => {
  it('persists a resolved auto_pr: always so the PR gate would open the PR', () => {
    const writeState = vi.fn();
    const r = sourceControlInit({
      project: 'P',
      ...base({ writeState, autoCommit: () => 'always' as const, autoPr: () => 'always' as const }),
    });
    expect(r.ok).toBe(true);
    const sc = (writeState.mock.calls[0]?.[1] as { pipeline: { source_control: { auto_commit: string; auto_pr: string } } }).pipeline.source_control;
    // The operator chose "open PRs" → resolved to always → must NOT be the silent never (the S-2 defect).
    expect(sc.auto_pr).toBe('always');
    expect(sc.auto_commit).toBe('always');
  });

  it('persists a resolved auto_commit: never without altering auto_pr', () => {
    const writeState = vi.fn();
    const r = sourceControlInit({
      project: 'P',
      ...base({ writeState, autoCommit: () => 'never' as const, autoPr: () => 'never' as const }),
    });
    expect(r.ok).toBe(true);
    const sc = (writeState.mock.calls[0]?.[1] as { pipeline: { source_control: { auto_commit: string; auto_pr: string } } }).pipeline.source_control;
    expect(sc.auto_commit).toBe('never');
    expect(sc.auto_pr).toBe('never');
  });
});

describe('flag-absent fallback preserves today\'s defaults (FR-21)', () => {
  it('auto_commit defaults to always when no flag is supplied', () => {
    expect(resolveAutoCommit(undefined)).toBe('always');
  });
  it('auto_pr defaults to never when no flag is supplied', () => {
    expect(resolveAutoPr(undefined)).toBe('never');
  });
  it('a supplied flag value wins over the default', () => {
    expect(resolveAutoCommit('never')).toBe('never');
    expect(resolveAutoPr('always')).toBe('always');
  });
});

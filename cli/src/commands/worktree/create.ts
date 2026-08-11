import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { defineCommand } from '../../framework/command.js';
import { UserError } from '../../framework/errors.js';
import type { CommandContext } from '../../framework/context.js';
import { readRegistry, resolveRepoPath } from '@rad-orchestration/repo-registry';
import { userDataPaths } from '../../lib/paths.js';
import { readProjectReposDefault } from '../../lib/project-repos.js';
import { deriveWorktreeConvention } from '../../lib/worktree-convention.js';

export type WorktreeCreateErrorType =
  | 'already_exists_path' | 'already_exists_branch' | 'invalid_reference' | 'missing_args' | 'remote_probe_failed' | 'unknown' | null;

export type BranchMode = 'created' | 'attached-local' | 'attached-remote';

export interface WorktreeCreateResult {
  created: boolean;
  worktreePath: string | null;
  branch: string | null;
  baseBranch: string | null;
  pushed: boolean;
  remoteUrl: string;
  compareUrl: string;
  error: string | null;
  errorType: WorktreeCreateErrorType;
  branchMode: BranchMode | null;
}

type Exec = (file: string, args: string[], opts: { cwd: string; encoding: 'utf8' }) => string;

export interface WorktreeCreateOptions {
  repoRoot: string; branch: string; worktreePath: string; baseBranch: string; exec?: Exec;
}

function deriveRemoteUrl(raw: string): string {
  if (!raw) return '';
  const ssh = raw.match(/^git@github\.com:(.+?)(?:\.git)?$/);
  if (ssh) return `https://github.com/${ssh[1]}`;
  if (raw.startsWith('https://')) return raw.replace(/\.git$/, '');
  return '';
}

function classify(stderr: string): WorktreeCreateErrorType {
  const m = (stderr || '').toLowerCase();
  if (m.includes('already exists') && m.includes('branch')) return 'already_exists_branch';
  if (m.includes('already exists')) return 'already_exists_path';
  if (m.includes('invalid reference') || m.includes('not a valid')) return 'invalid_reference';
  return 'unknown';
}

// Non-throwing: exit 0 means the local ref exists; any throw means it does not.
// Offline and reliable — needs no network.
function branchExistsLocally(exec: Exec, repoRoot: string, branch: string): boolean {
  try {
    exec('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], { cwd: repoRoot, encoding: 'utf8' });
    return true;
  } catch {
    return false;
  }
}

type RemoteBranchProbe = 'present' | 'absent' | 'unknown';

// Non-throwing: `ls-remote` exits 0 with empty stdout when the branch is absent,
// so the output is what's tested, not the exit code. When the probe itself
// fails to run (network unreachable, `origin` misconfigured, auth failure,
// transient git error) this reports 'unknown' rather than silently degrading
// to 'absent' — the caller must not treat "couldn't check" the same as
// "confirmed absent", or it risks creating a fresh local branch over one that
// already exists on the remote.
function probeBranchOnRemote(exec: Exec, repoRoot: string, branch: string): RemoteBranchProbe {
  let out: string;
  try {
    out = exec('git', ['ls-remote', '--heads', 'origin', branch], { cwd: repoRoot, encoding: 'utf8' });
  } catch {
    return 'unknown';
  }
  return String(out || '').trim().length > 0 ? 'present' : 'absent';
}

export function worktreeCreate(opts: WorktreeCreateOptions): WorktreeCreateResult {
  const exec = opts.exec ?? ((f, a, o) => execFileSync(f, a, { ...o, stdio: ['ignore', 'pipe', 'pipe'] }) as unknown as string);

  let branchMode: BranchMode;
  if (branchExistsLocally(exec, opts.repoRoot, opts.branch)) {
    branchMode = 'attached-local';
  } else {
    const remoteState = probeBranchOnRemote(exec, opts.repoRoot, opts.branch);
    if (remoteState === 'unknown') {
      return {
        created: false, worktreePath: opts.worktreePath, branch: opts.branch, baseBranch: opts.baseBranch,
        pushed: false, remoteUrl: '', compareUrl: '',
        error: `could not verify whether "${opts.branch}" exists on origin; not proceeding to avoid overwriting it`,
        errorType: 'remote_probe_failed', branchMode: null,
      };
    }
    branchMode = remoteState === 'present' ? 'attached-remote' : 'created';
  }

  try {
    if (branchMode === 'attached-remote') {
      exec('git', ['fetch', 'origin', `${opts.branch}:refs/heads/${opts.branch}`], { cwd: opts.repoRoot, encoding: 'utf8' });
    }
    if (branchMode === 'created') {
      exec('git', ['worktree', 'add', '-b', opts.branch, opts.worktreePath, opts.baseBranch],
        { cwd: opts.repoRoot, encoding: 'utf8' });
    } else {
      exec('git', ['worktree', 'add', opts.worktreePath, opts.branch],
        { cwd: opts.repoRoot, encoding: 'utf8' });
    }
  } catch (e) {
    const err = e as { stderr?: string; message: string };
    const stderr = (err.stderr || err.message || '').trim();
    return {
      created: false, worktreePath: opts.worktreePath, branch: opts.branch, baseBranch: opts.baseBranch,
      pushed: false, remoteUrl: '', compareUrl: '', error: stderr, errorType: classify(stderr), branchMode: null,
    };
  }

  let pushed = false;
  try {
    exec('git', ['push', '-u', 'origin', opts.branch], { cwd: opts.worktreePath, encoding: 'utf8' });
    pushed = true;
  } catch { /* non-blocking */ }

  let raw = '';
  try { raw = String(exec('git', ['remote', 'get-url', 'origin'], { cwd: opts.worktreePath, encoding: 'utf8' })).trim(); }
  catch { /* none */ }
  const remoteUrl = deriveRemoteUrl(raw);
  const baseShort = opts.baseBranch.replace(/^origin\//, '');
  const compareUrl = remoteUrl ? `${remoteUrl}/compare/${baseShort}...${opts.branch}` : '';

  return {
    created: true, worktreePath: path.resolve(opts.worktreePath), branch: opts.branch, baseBranch: opts.baseBranch,
    pushed, remoteUrl, compareUrl, error: null, errorType: null, branchMode,
  };
}

// ── provisionWorktrees ─────────────────────────────────────────────────────────

export interface ProvisionRepoResult {
  name: string;
  created: boolean;
  pushed: boolean;
  path: string | null;
  branch: string | null;
  error: string | null;
  errorType: WorktreeCreateErrorType;
  branchMode: BranchMode | null;
}

export function aggregateExitCode(repos: ReadonlyArray<{ created: boolean; pushed: boolean; error?: string | null }>): 0 | 1 | 2 {
  if (repos.some(r => r.error != null)) return 2;
  if (repos.some(r => r.created === true && r.pushed === false)) return 1;
  return 0;
}

export interface ProvisionWorktreesResult {
  repos: ProvisionRepoResult[];
}

export interface ProvisionWorktreesDeps {
  worktreesDir: string;
  readProjectRepos: (project: string) => { repos: string[]; projectType: 'standard' | 'side-project' };
  resolveClonePath: (repo: string) => string;
  defaultBranch: (repo: string) => string;
  exists: (p: string) => boolean;
  create: (opts: WorktreeCreateOptions) => WorktreeCreateResult;
}

export interface ProvisionWorktreesOptions extends ProvisionWorktreesDeps {
  project: string;
  worktreeName?: string;
  /** Optional repo scope — when provided, only this repo is provisioned. */
  repo?: string;
}

// Wraps the shared master-plan reader with a worktree-create-specific guard:
// provisioning worktrees is a standard-project operation, so reject
// side-projects here (remove/init paths legitimately accept side-projects).
function readStandardProjectReposDefault(project: string): { repos: string[]; projectType: 'standard' | 'side-project' } {
  const result = readProjectReposDefault(project);
  if (result.projectType === 'side-project') {
    throw new UserError(
      `Project "${project}" is a side-project. Use \`side-project init\` to set it up.`,
    );
  }
  return result;
}

function resolveClonePathDefault(repo: string): string {
  const reg = readRegistry({ root: userDataPaths().root });
  const resolved = resolveRepoPath(reg, repo);
  if (!resolved.path) {
    throw new UserError(`Repo "${repo}" is not bound. ${resolved.hint ?? 'Run `radorch repo bind`.'}`);
  }
  return resolved.path;
}

// Base branch is the repo's registered default_branch — never a hardcoded 'main'.
// Older repos use 'master'; some use something else. A repo with no registered
// default branch cannot be provisioned correctly, so this throws rather than
// guess. Exported for a focused registry-backed unit test.
export function defaultBranchDefault(repo: string): string {
  const reg = readRegistry({ root: userDataPaths().root });
  const b = reg.repos[repo]?.default_branch;
  if (!b) throw new UserError(`Repo "${repo}" has no registered default branch. Run \`radorch repo add\` or \`radorch repo edit\`.`);
  return b;
}

export function provisionWorktrees(opts: ProvisionWorktreesOptions): ProvisionWorktreesResult {
  const { project, worktreesDir, readProjectRepos, resolveClonePath, defaultBranch, exists, create } = opts;
  const worktreeName = opts.worktreeName ?? project;

  const { repos: allRepos } = readProjectRepos(project);
  // Fail fast on an unknown --repo: a scope outside the project set would
  // otherwise produce an empty target list and silently exit 0.
  if (opts.repo !== undefined && !allRepos.includes(opts.repo)) {
    throw new UserError(
      `Repo "${opts.repo}" is not in project "${project}" repo set: ${allRepos.join(', ')}`,
    );
  }
  const targetRepos = opts.repo ? allRepos.filter(r => r === opts.repo) : allRepos;

  // Branch + per-repo base/path come from the single shared worktree convention
  // (AD-4) — create() receives the same branch name for all repos, and each
  // repo's base branch is its registry default (no hardcoded 'main').
  const convention = deriveWorktreeConvention({ worktreeName, repos: targetRepos, worktreesDir, defaultBranch });
  const branch = convention.branch;

  const results: ProvisionRepoResult[] = [];
  for (const { repo, base, worktreePath } of convention.repos) {
    try {
      if (exists(worktreePath)) {
        results.push({ name: repo, created: false, pushed: true, path: worktreePath, branch, error: null, errorType: null, branchMode: null });
        continue;
      }
      const r = create({
        repoRoot: resolveClonePath(repo),
        branch,
        worktreePath,
        baseBranch: base,
      });
      results.push({
        name: repo,
        created: r.created,
        pushed: r.pushed,
        path: r.worktreePath,
        branch: r.branch,
        error: r.error,
        errorType: r.errorType,
        branchMode: r.branchMode,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      results.push({ name: repo, created: false, pushed: false, path: worktreePath, branch, error: msg, errorType: 'unknown', branchMode: null });
    }
  }

  return { repos: results };
}

/**
 * Default-wired provisioning entry: the exact dependency bundle the
 * `worktree create` handler uses. Exposed so `execute prepare` can compose
 * provisioning without re-declaring the production deps.
 */
export function provisionWorktreesWithDefaults(
  args: { project: string; worktreeName?: string; repo?: string },
): ProvisionWorktreesResult {
  return provisionWorktrees({
    project: args.project,
    worktreeName: args.worktreeName,
    repo: args.repo,
    worktreesDir: userDataPaths().worktrees,
    readProjectRepos: readStandardProjectReposDefault,
    resolveClonePath: resolveClonePathDefault,
    defaultBranch: defaultBranchDefault,
    exists: (p) => fs.existsSync(p),
    create: worktreeCreate,
  });
}

// ── Command ───────────────────────────────────────────────────────────────────

interface Args { project?: string; 'worktree-name'?: string; repo?: string }

export const worktreeCreateCommand = defineCommand({
  name: 'worktree-create',
  description: 'Provision worktrees for every repo in a project from the master-plan registry',
  args: {
    project: { description: 'Project name; selects the master plan whose repos: list is provisioned', required: true },
    'worktree-name': { description: 'Override the worktree folder name (defaults to the project name)' },
    repo: { description: 'Scope provisioning to a single repo within the project set' },
  },
  flags: {},
  handler: async ({ args }: { args: Args; ctx: CommandContext }) => {
    if (!args.project) throw new UserError('--project is required');
    return provisionWorktreesWithDefaults({
      project: args.project,
      worktreeName: args['worktree-name'],
      repo: args.repo,
    });
  },
  mapResult: (r: ProvisionWorktreesResult) => {
    return { ok: true, data: r, exit_code: aggregateExitCode(r.repos) };
  },
});

/**
 * source-control init command (FR-6, FR-7, FR-8, FR-9, FR-10, NFR-2, AD-1, AD-11, DD-4).
 *
 * Validates the target project's own `repos:` set against the worktrees on disk,
 * reads each present worktree's branch as the source of truth, fails loud on a
 * missing worktree pointing at `worktree create`, handles side-project and
 * in-place modes, mutates `state.json` directly, and is idempotent.
 */

import { defineCommand } from '../../framework/command.js';
import { UserError } from '../../framework/errors.js';
import type { CommandContext } from '../../framework/context.js';
import { buildSourceControlState } from './state-shape.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WorktreeFacts {
  exists: boolean;
  branch?: string;
  baseBranch?: string;
  remoteUrl?: string;
  compareUrl?: string;
}

export interface SourceControlInitDeps {
  /** Reads project repos and type from the master plan or registry. */
  readProjectRepos: (project: string) => { repos: string[]; projectType: 'standard' | 'side-project' };
  /** Reads worktree facts (existence, branch, etc.) from disk against the given base branch. */
  readWorktreeFacts: (worktreePath: string, baseBranch: string) => WorktreeFacts;
  /** Returns the auto_commit setting for the project. */
  autoCommit: (project: string) => 'always' | 'never';
  /** Returns the auto_pr setting for the project. */
  autoPr: (project: string) => 'always' | 'never';
  /** Reads the current pipeline state from disk. */
  readState: (projectDir: string) => { pipeline: Record<string, unknown> };
  /** Writes the mutated pipeline state to disk. */
  writeState: (projectDir: string, state: { pipeline: Record<string, unknown> }) => void;
  /** Resolves the main-clone path for a repo from the registry (used in in-place mode). */
  resolveClonePath: (repo: string) => string;
  /** The repo's registered default branch. Throws when the repo has no registry entry. */
  defaultBranch: (repo: string) => string;
  /** Three-state remote probe: the branch is there, it is not, or the probe could not run. */
  remoteBranchExists: (repo: string, branch: string) => 'present' | 'absent' | 'unknown';
}

export interface SourceControlInitOptions extends SourceControlInitDeps {
  /** Project name — resolves the master plan + repos: list. */
  project: string;
  /** Worktree name override (defaults to project name). */
  worktreeName?: string;
  /** In-place mode: record a main-clone binding for a single-repo project. */
  inPlace?: boolean;
  /** Pull-request base branch (in-place mode); defaults to the repo's registered default. */
  baseBranch?: string;
  /**
   * The branch the operator confirmed when the binding was offered (in-place
   * mode). The clone is live and outside this system's control between the
   * offer and this seal — the operator (or another session) can check out a
   * different branch in the gap. When supplied, the clone's live branch must
   * still match this exact value, or nothing is recorded.
   */
  branch?: string;
  /** Worktrees root dir override (defaults to runtime path). */
  worktreesDir?: string;
  /** Side-projects root dir override (defaults to runtime path). */
  sideProjectsDir?: string;
  /** Project data dir override (defaults to runtime path). */
  projectDir?: string;
}

export type SourceControlInitResult =
  | { ok: true; projectDir: string }
  | { ok: false; error: string };

// ── Core logic ────────────────────────────────────────────────────────────────

/**
 * Validate & record source-control state for a project.
 *
 * - Standard mode: reads branch from each on-disk worktree (never invents).
 * - Side-project: records fixed binding (branch: 'main', no remote, auto_commit: always, auto_pr: never).
 * - In-place: records a single main-clone binding; rejects multi-repo projects as ambiguous.
 * - Idempotent: re-running re-derives identical state (NFR-2).
 */
export function sourceControlInit(opts: SourceControlInitOptions): SourceControlInitResult {
  const {
    project,
    worktreeName = project,
    inPlace = false,
    worktreesDir = '',
    projectDir = project,
  } = opts;

  const { repos, projectType } = opts.readProjectRepos(project);

  // FR-10: in-place with multi-repo is ambiguous
  if (inPlace && repos.length > 1) {
    return {
      ok: false,
      error: `--in-place is ambiguous for a project with ${repos.length} repos; it only applies to single-repo projects`,
    };
  }

  const autoCommit = opts.autoCommit(project);
  const autoPr = opts.autoPr(project);

  let repoEntries: Array<{
    name: string;
    branch: string;
    base_branch: string;
    remote_url: string | null;
    compare_url: string | null;
    pr_url: string | null;
    in_place?: boolean;
  }>;

  if (projectType === 'side-project') {
    // FR-9: fixed side-project binding
    repoEntries = repos.map((name) => ({
      name,
      branch: 'main',
      base_branch: 'main',
      remote_url: null,
      compare_url: null,
      pr_url: null,
    }));
  } else if (inPlace) {
    // Single-repo in-place binding — read branch from the registry-resolved main-clone path
    const repo = repos[0]!;
    const clonePath = opts.resolveClonePath(repo);
    const registeredDefault = opts.defaultBranch(repo);
    const facts = opts.readWorktreeFacts(clonePath, registeredDefault);

    if (!facts.exists || !facts.branch) {
      return {
        ok: false,
        error: `Repo "${repo}" has no readable clone at ${clonePath}; run \`radorch repo bind\` or check out a branch there first.`,
      };
    }

    if (opts.branch !== undefined && facts.branch !== opts.branch) {
      return {
        ok: false,
        error: `Repo "${repo}" was confirmed on branch "${opts.branch}", but its clone now has "${facts.branch}" checked out; check out "${opts.branch}" there, or run \`/rad-execute ${project}\` again to re-confirm.`,
      };
    }

    let baseBranch = registeredDefault;
    if (opts.baseBranch !== undefined && opts.baseBranch !== registeredDefault) {
      const probe = opts.remoteBranchExists(repo, opts.baseBranch);
      if (probe === 'absent') {
        return {
          ok: false,
          error: `Base branch "${opts.baseBranch}" was not found on origin for repo "${repo}"; nothing was recorded`,
        };
      }
      if (probe === 'unknown') {
        return {
          ok: false,
          error: `Could not verify whether base branch "${opts.baseBranch}" exists on origin for repo "${repo}"; nothing was recorded`,
        };
      }
      baseBranch = opts.baseBranch;
    } else if (opts.baseBranch !== undefined) {
      baseBranch = opts.baseBranch;
    }

    const compareUrl = facts.remoteUrl ? `${facts.remoteUrl}/compare/${baseBranch}...${facts.branch}` : null;

    repoEntries = [{
      name: repo,
      branch: facts.branch,
      base_branch: baseBranch,
      remote_url: facts.remoteUrl ?? null,
      compare_url: compareUrl,
      pr_url: null,
      in_place: true,
    }];
  } else {
    // Standard mode: FR-7 — read branch from each on-disk worktree
    repoEntries = [];
    for (const repo of repos) {
      const wtPath = worktreesDir
        ? path.join(worktreesDir, worktreeName, repo)
        : path.join(worktreeName, repo);
      const baseBranch = opts.defaultBranch(repo);
      const facts = opts.readWorktreeFacts(wtPath, baseBranch);

      // FR-8: fail loud naming the repo and pointing at recovery command (DD-4)
      if (!facts.exists) {
        return {
          ok: false,
          error: `Worktree for repo "${repo}" does not exist. Run: radorch worktree create --repo ${repo}`,
        };
      }

      repoEntries.push({
        name: repo,
        branch: facts.branch ?? '',
        base_branch: facts.baseBranch ?? baseBranch,
        remote_url: facts.remoteUrl ?? null,
        compare_url: facts.compareUrl ?? null,
        pr_url: null,
      });
    }
  }

  // Build v6 source-control state (AD-1)
  const sc = buildSourceControlState({
    worktreeName,
    autoCommit,
    autoPr,
    repos: repoEntries,
  });

  // AD-2: mutate state.json directly, no event round-trip
  const existingState = opts.readState(projectDir);
  const newState = {
    ...existingState,
    pipeline: {
      ...existingState.pipeline,
      source_control: sc,
    },
  };

  opts.writeState(projectDir, newState);

  return { ok: true, projectDir };
}

// ── Command definition ────────────────────────────────────────────────────────

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { userDataPaths } from '../../lib/paths.js';
import { readProjectReposDefault } from '../../lib/project-repos.js';
import { readState, writeState as writeStateIO } from '../../lib/pipeline-engine/state-io.js';
import type { PipelineState } from '../../lib/pipeline-engine/types.js';
import { readRegistry, resolveRepoPath } from '@rad-orchestration/repo-registry';
import { getRemotes, selectRemote } from '../../lib/repo-identity.js';

function readWorktreeFactsDefault(worktreePath: string, baseBranch: string): WorktreeFacts {
  if (!fs.existsSync(worktreePath)) {
    return { exists: false };
  }
  let branch = '';
  let remoteUrl: string | null = null;
  let compareUrl: string | null = null;

  const exec = (file: string, args: string[], cwd: string): string => {
    try {
      return String(execFileSync(file, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })).trim();
    } catch {
      return '';
    }
  };

  // `symbolic-ref` (not `rev-parse --abbrev-ref`) so a detached HEAD degrades
  // to '' (caught below) instead of the literal string `HEAD` being recorded
  // as the branch.
  branch = exec('git', ['symbolic-ref', '--short', 'HEAD'], worktreePath);
  const raw = exec('git', ['remote', 'get-url', 'origin'], worktreePath);
  if (raw) {
    const ssh = raw.match(/^git@github\.com:(.+?)(?:\.git)?$/);
    remoteUrl = ssh ? `https://github.com/${ssh[1]}` : (raw.startsWith('https://') ? raw.replace(/\.git$/, '') : null);
    if (remoteUrl && branch) {
      compareUrl = `${remoteUrl}/compare/${baseBranch}...${branch}`;
    }
  }

  return { exists: true, branch, baseBranch, remoteUrl: remoteUrl ?? undefined, compareUrl: compareUrl ?? undefined };
}

function resolveClonePathDefault(repo: string): string {
  const reg = readRegistry({ root: userDataPaths().root });
  const resolved = resolveRepoPath(reg, repo);
  if (!resolved.path) {
    throw new UserError(`Repo "${repo}" is not bound. ${resolved.hint ?? 'Run `radorch repo bind`.'}`);
  }
  return resolved.path;
}

function defaultBranchDefault(repo: string): string {
  const reg = readRegistry({ root: userDataPaths().root });
  const b = reg.repos[repo]?.default_branch;
  if (!b) throw new UserError(`Repo "${repo}" has no registered default branch. Run \`radorch repo add\` or \`radorch repo edit\`.`);
  return b;
}

// Non-throwing: `ls-remote` exits 0 with empty stdout when the branch is absent,
// so the output is what's tested, not the exit code. Any throw (missing clone,
// unreachable network, unbound repo) reports 'unknown' rather than 'absent' —
// "couldn't check" must not collapse into "confirmed missing".
//
// The remote is resolved per-clone rather than hardcoded to `origin`: repo
// registration explicitly allows a sole remote under any name (repo-identity's
// `selectRemote`), so a clone whose only remote is named e.g. `upstream` must
// still be probed against its real remote, not one that doesn't exist there.
function remoteBranchExistsDefault(repo: string, branch: string): 'present' | 'absent' | 'unknown' {
  try {
    const clonePath = resolveClonePathDefault(repo);
    const exec = (file: string, args: string[]): string =>
      execFileSync(file, args, { cwd: clonePath, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) as unknown as string;
    const remoteName = selectRemote(getRemotes(exec)).name;
    const out = execFileSync('git', ['ls-remote', '--heads', remoteName, branch], { cwd: clonePath, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return String(out || '').trim().length > 0 ? 'present' : 'absent';
  } catch {
    return 'unknown';
  }
}

export function resolveAutoCommit(flag: string | undefined): 'always' | 'never' {
  return flag === 'never' ? 'never' : flag === 'always' ? 'always' : 'always';
}

export function resolveAutoPr(flag: string | undefined): 'always' | 'never' {
  return flag === 'always' ? 'always' : flag === 'never' ? 'never' : 'never';
}

/**
 * Default-wired seal entry: the exact dependency bundle the `source-control init`
 * handler uses, with auto-commit/auto-pr already resolved to `always|never`.
 * Exposed so `execute prepare` can compose sealing without re-declaring deps.
 */
export function sourceControlInitWithDefaults(args: {
  project: string;
  worktreeName?: string;
  inPlace?: boolean;
  baseBranch?: string;
  branch?: string;
  autoCommit: 'always' | 'never';
  autoPr: 'always' | 'never';
}): SourceControlInitResult {
  const projectDir = path.join(userDataPaths().projects, args.project);
  return sourceControlInit({
    project: args.project,
    worktreeName: args.worktreeName,
    inPlace: args.inPlace ?? false,
    baseBranch: args.baseBranch,
    branch: args.branch,
    worktreesDir: userDataPaths().worktrees,
    sideProjectsDir: userDataPaths().sideProjects,
    projectDir,
    readProjectRepos: readProjectReposDefault,
    readWorktreeFacts: readWorktreeFactsDefault,
    autoCommit: () => args.autoCommit,
    autoPr: () => args.autoPr,
    resolveClonePath: resolveClonePathDefault,
    defaultBranch: defaultBranchDefault,
    remoteBranchExists: remoteBranchExistsDefault,
    readState: (dir) => {
      const s = readState(dir);
      if (!s) throw new UserError(`No state.json found at ${dir}`);
      return s as unknown as { pipeline: Record<string, unknown> };
    },
    writeState: (dir, state) => {
      writeStateIO(dir, state as unknown as PipelineState);
    },
  });
}

interface Args {
  project?: string;
  'worktree-name'?: string;
}
interface Flags {
  'in-place'?: boolean;
  'base-branch'?: string;
  branch?: string;
  'auto-commit'?: string;
  'auto-pr'?: string;
}

export const sourceControlInitCommand = defineCommand({
  name: 'source-control-init',
  description: 'Validate worktrees and record source-control state for a project (idempotent)',
  args: {
    project: { description: 'Project name; selects the master plan whose repos: list is validated', required: true },
    'worktree-name': { description: 'Override the worktree folder name (defaults to the project name)' },
  },
  flags: {
    'in-place': { description: 'Record a single in-place (main clone) binding for a single-repo project' },
    'base-branch': { description: 'Branch the project\'s pull request targets; defaults to the repo\'s registered default', type: 'string' },
    branch: { description: 'The branch confirmed at offer time (in-place mode); the clone\'s live branch must still match, or nothing is recorded', type: 'string' },
    'auto-commit': { description: 'Resolved auto-commit preference (always|never)', type: 'string' },
    'auto-pr': { description: 'Resolved auto-PR preference (always|never)', type: 'string' },
  },
  handler: async ({ args, flags }: { args: Args; flags: Flags; ctx: CommandContext }) => {
    if (!args.project) throw new UserError('--project is required');
    return sourceControlInitWithDefaults({
      project: args.project,
      worktreeName: args['worktree-name'],
      inPlace: flags['in-place'] ?? false,
      baseBranch: flags['base-branch'],
      branch: flags.branch,
      autoCommit: resolveAutoCommit(flags['auto-commit']),
      autoPr: resolveAutoPr(flags['auto-pr']),
    });
  },
  mapResult: (r: SourceControlInitResult) => {
    if (!r.ok) {
      return { ok: false as const, error: { type: 'user_error' as const, message: r.error }, exit_code: 1 };
    }
    return { ok: true as const, data: r, exit_code: 0 };
  },
});

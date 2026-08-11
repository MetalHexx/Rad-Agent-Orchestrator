import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { defineCommand } from '../../framework/command.js';
import { UserError } from '../../framework/errors.js';
import { userDataPaths } from '../../lib/paths.js';
import { addRepo, readRegistry, isSlug } from '@rad-orchestration/repo-registry';
import {
  type Exec,
  slugify,
  deriveSlugFromRemote,
  getToplevel,
  getMainWorktreePath,
  getRemotes,
  selectRemote,
  getDefaultBranch,
  samePath,
} from '../../lib/repo-identity.js';
import type { CommandContext } from '../../framework/context.js';

export interface RepoAddOptions {
  root: string;
  repoPath: string;
  /** Explicit slug override; wins over the remote-derived default. */
  name?: string;
  /** Human description — the "reason to explore" stored on the repo identity. */
  description?: string;
  /** Report what would be registered without writing anything. */
  dryRun?: boolean;
  exec?: Exec;
}

export interface RepoAddResult {
  name: string;
  remote: string;
  default_branch: string;
  /** The canonical path actually registered (the main clone). */
  path: string;
  /** Present when the registered path differs from the one supplied. */
  resolvedFrom?: string;
}

export interface RepoAddDetection {
  providedPath: string;
  currentToplevel: string | null;
  mainWorktreePath: string | null;
  isWorktree: boolean;
  isSubdir: boolean;
  remoteName: string;
  otherRemotes: string[];
  remoteAlreadyRegisteredAs: string | null;
  nameAvailable: boolean;
}

export interface RepoAddDryRunResult {
  dryRun: true;
  wouldRegister: { path: string; name: string; remote: string; default_branch: string };
  detection: RepoAddDetection;
}

function makeDefaultExec(cwd: string): Exec {
  return (file: string, args: string[]): string =>
    execFileSync(file, args, { encoding: 'utf8', cwd }) as unknown as string;
}

/**
 * Register a local git repository — resolving to its *canonical main clone*
 * regardless of whether `repoPath` points at a linked worktree, a subdirectory,
 * or the clone itself, and deriving a meaningful slug from the remote.
 *
 * Mechanical and fail-loud (no prompting): ambiguity (no remote, multiple
 * remotes, a remote already registered under another slug) surfaces as a
 * UserError. The `/rad-repo` skill calls this with `--dry-run` first to inspect
 * the situation and interviews the user before committing.
 */
export function repoAdd(opts: RepoAddOptions): RepoAddResult | RepoAddDryRunResult {
  const { root, repoPath, name: nameOverride, description, dryRun } = opts;
  const exec = opts.exec ?? makeDefaultExec(repoPath);

  // A non-empty description is required for a real registration — it is the
  // "reason to explore" that makes the registry a usable map. Dry-run is exempt
  // (the skill inspects first, then interviews the user for the description).
  if (!dryRun && !description?.trim()) {
    throw new UserError('a non-empty --description is required to register a repo');
  }

  // 1. Confirm this is a git repository.
  try {
    exec('git', ['rev-parse', '--git-dir']);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new UserError(`path is not a git repository: ${msg}`);
  }

  // 2. Identity from git (fail-loud on no/ambiguous remote).
  const remote = selectRemote(getRemotes(exec));

  // 3. Resolve the canonical home — the MAIN worktree toplevel — even when run
  //    from a linked worktree or a subdirectory. Deterministic git facts, with a
  //    graceful fall back to the supplied path when git can't answer.
  const currentToplevel = getToplevel(exec);
  const mainWorktreePath = getMainWorktreePath(exec);
  const canonicalPath = mainWorktreePath ?? currentToplevel ?? repoPath;
  const isWorktree = Boolean(mainWorktreePath && currentToplevel && !samePath(mainWorktreePath, currentToplevel));
  const isSubdir = Boolean(currentToplevel && !samePath(currentToplevel, repoPath));

  // 4. Slug: --name override > remote-derived > folder basename (last resort).
  let proposedName = nameOverride?.trim() || deriveSlugFromRemote(remote.url);
  if (!proposedName) proposedName = slugify(path.basename(canonicalPath));

  // 4b. Default branch — read from the remote's HEAD symref; fail loud rather
  // than fabricate one. Registration is an interactive, operator-present
  // moment, so stopping here is cheap and correct; nothing is written yet.
  const defaultBranch = getDefaultBranch(exec, remote.name);
  if (defaultBranch == null) {
    throw new UserError(`could not determine the default branch for repo "${proposedName}" from remote "${remote.name}" (${remote.url})`);
  }

  // 5. Registry awareness for the rail + the dry-run report.
  const reg = readRegistry({ root });
  let remoteAlreadyRegisteredAs: string | null = null;
  for (const [slug, identity] of Object.entries(reg.repos)) {
    if (identity.remote === remote.url) { remoteAlreadyRegisteredAs = slug; break; }
  }
  const nameAvailable = isSlug(proposedName)
    && !(proposedName in reg.repos)
    && !(proposedName in reg.repoGroups);

  if (dryRun) {
    return {
      dryRun: true,
      wouldRegister: { path: canonicalPath, name: proposedName, remote: remote.url, default_branch: defaultBranch },
      detection: {
        providedPath: repoPath,
        currentToplevel,
        mainWorktreePath,
        isWorktree,
        isSubdir,
        remoteName: remote.name,
        otherRemotes: remote.others,
        remoteAlreadyRegisteredAs,
        nameAvailable,
      },
    };
  }

  // 6. Rail: never silently duplicate a repo already registered under another slug.
  if (remoteAlreadyRegisteredAs && remoteAlreadyRegisteredAs !== proposedName) {
    throw new UserError(
      `this remote is already registered as '${remoteAlreadyRegisteredAs}' (${remote.url}); ` +
      'use that repo, or remove it before re-registering',
    );
  }

  // 7. Write (addRepo validates slug format and name uniqueness).
  try {
    addRepo({
      root,
      name: proposedName,
      identity: { remote: remote.url, default_branch: defaultBranch, description: (description as string).trim() },
      localPath: canonicalPath,
    });
  } catch (e) {
    throw new UserError(e instanceof Error ? e.message : String(e));
  }

  const result: RepoAddResult = { name: proposedName, remote: remote.url, default_branch: defaultBranch, path: canonicalPath };
  if (!samePath(canonicalPath, repoPath)) result.resolvedFrom = repoPath;
  return result;
}

interface Args { path?: string }
interface Flags { name?: string; description?: string; 'dry-run'?: boolean }

export const repoAddCommand = defineCommand({
  name: 'repo-add',
  description: 'Register a local git repository, resolving to its canonical main clone',
  args: {
    path: { description: 'Absolute path to a local git repository (worktree or subdirectory is resolved to the main clone)', required: true },
  },
  flags: {
    name: { description: 'Override the auto-derived repo slug (lowercase-kebab; defaults to the remote repo name)', type: 'string' },
    description: { description: 'What this repo is and why an agent would look here (required unless --dry-run)', type: 'string' },
    'dry-run': { description: 'Report the resolved path, slug, and detection without writing to the registry' },
  },
  handler: async ({ args, flags }: { args: Args; flags: Flags; ctx: CommandContext }) => {
    const repoPath = args.path;
    if (!repoPath) throw new UserError('--path is required');
    const root = userDataPaths().root;
    return repoAdd({ root, repoPath, name: flags.name, description: flags.description, dryRun: Boolean(flags['dry-run']) });
  },
});

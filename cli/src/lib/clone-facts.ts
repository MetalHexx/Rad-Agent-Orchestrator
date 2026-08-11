// clone-facts.ts — live git facts for a registered repo's main clone.
//
// `execute resolve` needs to know what is actually true of an operator's clone
// right now (does it still exist, what is checked out there, is anything
// uncommitted) before it can offer to bind a project to it or resume a binding
// already made. Every git subcommand here is a READ: the resolution step must
// stay free of anything that changes disk state.
//
// Nothing throws. A clone that has been deleted, a directory that is not a git
// repository, a git that fails for any other reason — all degrade to
// `branch: null` / `dirty: []` so the caller can classify rather than crash.

import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

/**
 * Sync git exec scoped to a directory.
 *
 * Declared here rather than imported: `repo-identity`'s `Exec` takes no `cwd`,
 * and every call in this module runs *inside* the clone; `worktree/create`'s
 * demands `encoding: 'utf8'` on every call, which is noise for a module that
 * only ever reads text.
 */
export type CloneExec = (file: string, args: string[], opts: { cwd: string }) => string;

/** What is true of a repo's main clone at the moment of resolution. */
export interface CloneFacts {
  path: string;
  exists: boolean;
  branch: string | null;
  /** Porcelain entries, uncapped. */
  dirty: string[];
}

export interface ReadCloneFactsDeps {
  /** Registry repo name → bound local clone path. */
  registryLocalPaths: Record<string, string>;
  exec?: CloneExec;
}

const defaultExec: CloneExec = (file, args, opts) =>
  execFileSync(file, args, { cwd: opts.cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }) as unknown as string;

function isDirectory(target: string): boolean {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Read live git facts for a registered repo's main clone.
 *
 * Returns null when the repo has no bound local path — the caller cannot look
 * at a clone that was never bound.
 */
export function readCloneFacts(repo: string, deps: ReadCloneFactsDeps): CloneFacts | null {
  const clonePath = deps.registryLocalPaths[repo];
  if (!clonePath) return null;
  if (!isDirectory(clonePath)) return { path: clonePath, exists: false, branch: null, dirty: [] };

  const exec = deps.exec ?? defaultExec;

  // `symbolic-ref` (not `rev-parse --abbrev-ref`) so a detached HEAD throws
  // instead of yielding the literal string `HEAD` — which would otherwise look
  // like a real, non-default branch name and make a detached clone eligible
  // for binding.
  let branch: string | null = null;
  try {
    branch = exec('git', ['symbolic-ref', '--short', 'HEAD'], { cwd: clonePath }).trim() || null;
  } catch {
    branch = null;
  }

  let dirty: string[] = [];
  try {
    // `--porcelain` covers modified, staged, and untracked in one call.
    dirty = exec('git', ['status', '--porcelain'], { cwd: clonePath })
      .split(/\r?\n/)
      .filter((line) => line.trim() !== '');
  } catch {
    dirty = [];
  }

  return { path: clonePath, exists: true, branch, dirty };
}

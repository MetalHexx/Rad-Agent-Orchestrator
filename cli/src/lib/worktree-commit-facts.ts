// worktree-commit-facts.ts — read-only last-commit facts for one repo worktree.
//
// `execute resolve` ranks other projects' workspaces by how recently they were
// touched, so it needs to know what is actually true of a repo worktree right
// now: when its newest commit landed and what branch it is on. Every git
// subcommand here is a READ.
//
// Nothing throws. A path that is not a directory, a git that fails for any
// reason — all degrade to `null` (the whole result, or just `branch`) so the
// caller can rank around missing facts rather than crash.

import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import type { CloneExec } from './clone-facts.js';

/** Last-commit facts for one repo worktree. */
export interface WorktreeCommitFacts {
  lastCommitAt: number;
  /** Git's own relative date for the commit (e.g. "3 hours ago"), used verbatim. */
  lastCommitRelative: string;
  branch: string | null;
}

const defaultExec: CloneExec = (file, args, opts) =>
  execFileSync(file, args, { cwd: opts.cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }) as unknown as string;

// A raw unit-separator byte between the two `git log` fields: `%cr` ("3 hours
// ago") contains spaces, so a plain space or comma could not be split back
// apart unambiguously.
const FIELD_SEPARATOR = '\x1f';

function isDirectory(target: string): boolean {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Read live last-commit facts for one repo worktree.
 *
 * Returns null when the path is not a directory or the commit log cannot be
 * read — the caller has nothing to rank without a commit time.
 */
export function readWorktreeCommitFacts(worktreePath: string, deps: { exec?: CloneExec } = {}): WorktreeCommitFacts | null {
  if (!isDirectory(worktreePath)) return null;

  const exec = deps.exec ?? defaultExec;

  let lastCommitAt: number;
  let lastCommitRelative: string;
  try {
    const line = exec('git', ['log', '-1', `--format=%ct${FIELD_SEPARATOR}%cr`], { cwd: worktreePath }).trim();
    const sep = line.indexOf(FIELD_SEPARATOR);
    if (sep < 0) return null;
    const epoch = Number(line.slice(0, sep));
    const relative = line.slice(sep + 1);
    if (!Number.isFinite(epoch) || relative === '') return null;
    lastCommitAt = epoch;
    lastCommitRelative = relative;
  } catch {
    return null;
  }

  // `symbolic-ref` (not `rev-parse --abbrev-ref`) so a detached HEAD throws
  // instead of yielding the literal string `HEAD` as a fake branch name.
  let branch: string | null = null;
  try {
    branch = exec('git', ['symbolic-ref', '--short', 'HEAD'], { cwd: worktreePath }).trim() || null;
  } catch {
    branch = null;
  }

  return { lastCommitAt, lastCommitRelative, branch };
}

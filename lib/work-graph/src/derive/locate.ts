import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { GitExec } from './worktrees.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LocateKind = 'worktree' | 'main-clone' | 'side-project' | 'none';

export interface LocateResult {
  kind: LocateKind;
  /** Set when kind is 'worktree' or 'side-project' */
  worktree_name?: string;
  /** Set when kind is 'worktree' or 'main-clone' */
  repo?: string;
  /** Set when kind is 'worktree' — project folder names whose resolved worktree_name matches */
  projects?: string[];
  /** Set when kind is 'worktree' or 'main-clone' — branch of that dir from git worktree list */
  branch?: string | null;
}

export interface LocateDeps {
  projectsDir: string;
  worktreesDir: string;
  sideProjectsDir: string;
  /** Map of repo name → absolute local path (from the registry) */
  registryLocalPaths: Record<string, string>;
  /** Optional git executor, defaults to execFileSync */
  exec?: GitExec;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns true when `child` is the same as or nested under `parent`.
 * Moved here from cli/src/commands/session-context/resolve.ts to share with
 * the locate classifier (AD-7).
 */
export function within(parent: string, child: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

const defaultExec: GitExec = (file, args, opts) =>
  execFileSync(file, args, { cwd: opts.cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }) as unknown as string;

/**
 * Parse `git worktree list --porcelain` output and return a map of
 * resolved-path → branch (or null if detached/bare).
 */
function listWorktrees(exec: GitExec, cwd: string): Map<string, string | null> {
  const out = new Map<string, string | null>();
  let text = '';
  try { text = exec('git', ['worktree', 'list', '--porcelain'], { cwd }); } catch { return out; }
  let cur: string | null = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('worktree ')) {
      cur = path.resolve(line.slice('worktree '.length).trim());
      out.set(cur, null);
    } else if (line.startsWith('branch ') && cur) {
      out.set(cur, line.slice('branch '.length).trim().replace('refs/heads/', ''));
    } else if (line.trim() === '') {
      cur = null;
    }
  }
  return out;
}

/**
 * Read the worktree_name for a project from its state.json.
 * Mirrors the defaulting rule in resolveWorktrees: if no worktree_name is
 * set in state, the project folder name is the worktree_name.
 */
function resolvedWorktreeName(projectsDir: string, projectName: string): string {
  const statePath = path.join(projectsDir, projectName, 'state.json');
  if (!fs.existsSync(statePath)) return projectName;
  try {
    const sc = JSON.parse(fs.readFileSync(statePath, 'utf8'))?.pipeline?.source_control;
    const shared = typeof sc?.worktree_name === 'string' && sc.worktree_name !== '' ? sc.worktree_name : null;
    return shared ?? projectName;
  } catch {
    return projectName;
  }
}

/**
 * List project folder names under projectsDir (same logic as listProjectNames).
 */
function listProjectNames(projectsDir: string): string[] {
  if (!fs.existsSync(projectsDir)) return [];
  return fs.readdirSync(projectsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('_'))
    .map((d) => d.name);
}

// ---------------------------------------------------------------------------
// Classifier
// ---------------------------------------------------------------------------

/**
 * Classify a cwd path against the known directory conventions and registry.
 *
 * Classification order (first match wins):
 *   1. cwd is within worktreesDir → kind=worktree
 *   2. cwd is within sideProjectsDir → kind=side-project
 *   3. cwd matches or nests under a registryLocalPaths entry → kind=main-clone
 *   4. → kind=none
 *
 * Read-only: never writes state, never reads a stored absolute path (NFR-1, NFR-4).
 */
export function locate(cwd: string, deps: LocateDeps): LocateResult {
  const exec = deps.exec ?? defaultExec;

  // 1. Worktree check --------------------------------------------------------
  if (within(deps.worktreesDir, cwd)) {
    const rel = path.relative(path.resolve(deps.worktreesDir), path.resolve(cwd));
    const segments = rel.split(path.sep).filter(Boolean);
    // segments[0] = worktree_name, segments[1] = repo (optional)
    // Only classify as a worktree when there is at least a worktree_name
    // segment; the worktrees root itself (segments.length === 0) is not a
    // worktree and falls through to `none`.
    if (segments.length > 0) {
      const worktree_name = segments[0] ?? '';
      const repo = segments[1] ?? undefined;

      // Find projects whose resolved worktree_name matches
      const projectNames = listProjectNames(deps.projectsDir);
      const projects = projectNames.filter(
        (name) => resolvedWorktreeName(deps.projectsDir, name) === worktree_name,
      );

      // Read branch from git worktree metadata (best-effort)
      let branch: string | null = null;
      if (repo !== undefined) {
        const wtDir = path.join(deps.worktreesDir, worktree_name, repo);
        const live = listWorktrees(exec, wtDir);
        const key = path.resolve(wtDir);
        branch = live.get(key) ?? null;
      }

      return {
        kind: 'worktree',
        worktree_name,
        ...(repo !== undefined ? { repo } : {}),
        projects,
        branch,
      };
    }
  }

  // 2. Side-project check ----------------------------------------------------
  if (within(deps.sideProjectsDir, cwd)) {
    const rel = path.relative(path.resolve(deps.sideProjectsDir), path.resolve(cwd));
    const segments = rel.split(path.sep).filter(Boolean);
    // The side-projects root itself (segments.length === 0) is not a
    // side-project; only classify when a name segment is present.
    if (segments.length > 0) {
      const worktree_name = segments[0] ?? '';
      return { kind: 'side-project', worktree_name };
    }
  }

  // 3. Main-clone check (registry) ------------------------------------------
  for (const [repoName, localPath] of Object.entries(deps.registryLocalPaths)) {
    if (localPath && within(localPath, cwd)) {
      const live = listWorktrees(exec, localPath);
      return { kind: 'main-clone', repo: repoName, branch: live.get(path.resolve(localPath)) ?? null };
    }
  }

  // 4. None -----------------------------------------------------------------
  return { kind: 'none' };
}

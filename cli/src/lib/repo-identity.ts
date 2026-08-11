// repo-identity.ts — deterministic git facts for repo registration.
//
// These helpers let `repo add` / `repo bind` resolve a repository's *canonical*
// identity and home from any vantage point (a linked worktree, a subdirectory,
// or the main clone) instead of trusting whatever path it was handed. They are
// the mechanical, fail-loud half of the registration story; the conversational
// half (interviewing the user on genuine ambiguity) lives in the `/rad-repo`
// skill, which reads the `--dry-run` detection these produce.
//
// Every function takes an injectable `exec` (sync, returns stdout) so commands
// stay test-injectable per cli/AGENTS.md — unit tests never shell out to git.

import { UserError } from '../framework/errors.js';

export type Exec = (file: string, args: string[]) => string;

/** Normalize a raw remote URL to https form, stripping a trailing `.git`. */
export function normalizeRemote(raw: string): string {
  let r = raw.trim().replace(/\.git$/, '');
  // git@github.com:org/repo → https://github.com/org/repo
  const sshMatch = r.match(/^git@([^:]+):(.+)$/);
  if (sshMatch) r = `https://${sshMatch[1]}/${sshMatch[2]}`;
  return r;
}

/**
 * Slugify to the registry's lowercase-kebab convention, splitting camelCase /
 * PascalCase boundaries so `RadOrchestration` → `rad-orchestration` (rather than
 * `radorchestration`). Returns '' when nothing alphanumeric survives.
 */
export function slugify(segment: string): string {
  return segment
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')      // fooBar  → foo-Bar
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')   // HTTPServer → HTTP-Server
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Derive a repo slug from a (normalized) remote URL's last path segment. */
export function deriveSlugFromRemote(remoteUrl: string): string {
  const seg = remoteUrl.split('/').filter(Boolean).pop() ?? '';
  return slugify(seg);
}

/** True when the exec's cwd is inside a git working tree. */
export function isInsideWorkTree(exec: Exec): boolean {
  try {
    return exec('git', ['rev-parse', '--is-inside-work-tree']).trim() === 'true';
  } catch {
    return false;
  }
}

/** Absolute toplevel of the current working tree (git path style), or null. */
export function getToplevel(exec: Exec): string | null {
  try {
    const out = exec('git', ['rev-parse', '--show-toplevel']).trim();
    return out || null;
  } catch {
    return null;
  }
}

/**
 * The MAIN worktree's toplevel — the durable clone, even when run from a linked
 * worktree. `git worktree list --porcelain` always lists the main worktree
 * first, so the first `worktree <path>` line is the canonical home.
 */
export function getMainWorktreePath(exec: Exec): string | null {
  try {
    const out = exec('git', ['worktree', 'list', '--porcelain']);
    for (const line of out.split('\n')) {
      const m = line.match(/^worktree\s+(.+)$/);
      if (m) return m[1].trim();
    }
    return null;
  } catch {
    return null;
  }
}

/** Map of remote name → normalized fetch URL. */
export function getRemotes(exec: Exec): Map<string, string> {
  let out = '';
  try {
    out = exec('git', ['remote', '-v']);
  } catch {
    out = '';
  }
  const map = new Map<string, string>();
  for (const line of out.split('\n').filter(l => l.includes('(fetch)'))) {
    const parts = line.split('\t');
    if (parts.length < 2) continue;
    const name = parts[0].trim();
    const url = parts[1].replace(/\s*\(fetch\)\s*$/, '').trim();
    if (name) map.set(name, normalizeRemote(url));
  }
  return map;
}

export interface SelectedRemote { name: string; url: string; others: string[] }

/**
 * Pick the repo's remote: the sole remote, or `origin` when several exist.
 * Fail-loud (UserError) on no remote or an ambiguous multi-remote choice — the
 * skill interviews the user on these rather than the CLI guessing.
 */
export function selectRemote(remotes: Map<string, string>): SelectedRemote {
  if (remotes.size === 0) throw new UserError('no remote configured for this repository');
  if (remotes.size === 1) {
    const [name, url] = remotes.entries().next().value as [string, string];
    return { name, url, others: [] };
  }
  if (remotes.has('origin')) {
    const others = [...remotes.keys()].filter(n => n !== 'origin');
    return { name: 'origin', url: remotes.get('origin') as string, others };
  }
  throw new UserError('more than one remote found and none is named "origin" — cannot infer remote');
}

/** Resolve the default branch from the selected remote's HEAD symref; null when it cannot be read. */
export function getDefaultBranch(exec: Exec, remoteName: string): string | null {
  try {
    const symref = exec('git', ['symbolic-ref', `refs/remotes/${remoteName}/HEAD`]);
    const m = symref.trim().match(new RegExp(`refs/remotes/${remoteName}/(.+)$`));
    if (m) return m[1];
  } catch {
    // fall through to null
  }
  return null;
}

/**
 * Compare two filesystem paths for equality, normalizing slash direction and
 * trailing slashes. Case-insensitive — paths here come from git (forward-slash)
 * and the OS (Windows is case-insensitive); the comparison is advisory
 * (worktree/subdir detection), so erring toward "same" is safe.
 */
export function samePath(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  return norm(a) === norm(b);
}

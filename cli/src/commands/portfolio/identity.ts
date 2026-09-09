/**
 * `identity.ts` — the CLI-only naming rules that never left this module: the
 * five document filenames inside a portfolio's root directory, resolving a
 * group by name/id/slug, create-only name validation, and case-insensitive
 * directory lookup. Root-directory detection and lifecycle frontmatter
 * parsing now live in `@rad-orchestration/work-graph`
 * (`lib/work-graph/src/derive/portfolio.ts`), which this module imports.
 */
import path from 'node:path';
import type { NodeId } from '@rad-orchestration/work-graph';
import { isPortfolioRootDir, portfolioRootDirName } from '@rad-orchestration/work-graph';
import type { PortfolioFsReads } from '@rad-orchestration/work-graph';

/** The CLI's local alias for the library's injected-reads shape — one type, two names,
 *  so no call site in this module changes. */
export type FsReads = PortfolioFsReads;

export const PORTFOLIO_DOC_ROLES = ['root', 'iterations', 'decisions', 'technical', 'groundTruth'] as const;
export type PortfolioDocRole = typeof PORTFOLIO_DOC_ROLES[number];

const DOC_SUFFIX: Record<PortfolioDocRole, string> = {
  root: 'ROOT',
  iterations: 'ITERATIONS',
  decisions: 'DECISIONS',
  technical: 'TECHNICAL',
  groundTruth: 'GROUND-TRUTH',
};

/** Absolute paths for all five documents inside `{projectsDir}/{base}-ROOT/`. */
export function docPaths(projectsDir: string, base: string): Record<PortfolioDocRole, string> {
  const dir = path.join(projectsDir, portfolioRootDirName(base));
  const result = {} as Record<PortfolioDocRole, string>;
  for (const role of PORTFOLIO_DOC_ROLES) {
    result[role] = path.join(dir, `${base}-${DOC_SUFFIX[role]}.md`);
  }
  return result;
}

/** An exact id/slug match — immutable, always correct regardless of what a group is
 *  currently named. */
function matchesGroupId(g: { id: NodeId }, value: string): boolean {
  const v = value.toLowerCase();
  const id = g.id.toLowerCase();
  return id === v || id === `group:${v}`;
}

/** A display-name match — mutable, since a name can be edited independently of the
 *  id/slug it was minted from. Never authoritative on its own; only a fallback. */
function matchesGroupName(g: { name: string }, value: string): boolean {
  return g.name.toLowerCase() === value.toLowerCase();
}

/** The one group-matching predicate, used wherever the caller only needs to know
 *  whether `value` matches this group *at all* (e.g. rendering, filtering) — not to
 *  pick a single winner out of a list. Case-insensitive, and matches THREE ways
 *  because callers hold different shapes: a bare base (`PORTFOLIO`), a group name
 *  (`portfolio`), or a full group id (`group:portfolio`). Comparing a bare value
 *  against `g.id` alone never hits.
 *
 *  Resolving ONE group out of a full list must never call this directly — use
 *  `resolveGroupByValue`, which orders id/slug over display name so a stale or
 *  colliding name can never outrank the exact id/slug match it belongs to. */
export function matchesGroup(g: { id: NodeId; name: string }, value: string): boolean {
  return matchesGroupId(g, value) || matchesGroupName(g, value);
}

/**
 * Resolve a single group out of a full list for `value`. An id/slug match is
 * immutable and always wins, checked across the WHOLE list first; a display-name
 * match is only used as a fallback when no id/slug match exists anywhere in the
 * list. This makes resolution independent of list order: a group's display name
 * can coincidentally equal another, unrelated group's id/slug, and without this
 * ordering whichever group happened to come first in `groups` would win.
 */
export function resolveGroupByValue<G extends { id: NodeId; name: string }>(
  groups: readonly G[],
  value: string,
): G | null {
  return groups.find((g) => matchesGroupId(g, value))
    ?? groups.find((g) => matchesGroupName(g, value))
    ?? null;
}

/** Case-insensitive directory match for a base name, against the real listing.
 *  Returns the directory ONLY when `isPortfolioRootDir` also holds for it — a bare
 *  directory is not a portfolio, and both read verbs must agree on that. */
export function findRootDir(projectsDir: string, base: string, fs: FsReads): string | null {
  const target = portfolioRootDirName(base).toLowerCase();
  const match = fs.readDirNames(projectsDir).find((name) => name.toLowerCase() === target);
  if (!match) return null;
  return isPortfolioRootDir(projectsDir, match, fs) ? match : null;
}

/** Create-only. Stricter than isProjectDirName: a name matching this round-trips
 *  through a group id losslessly, so no transform is ever needed to recover it. */
export const PORTFOLIO_CREATE_NAME_RE = /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/;

/** Validates a create-only base name against `PORTFOLIO_CREATE_NAME_RE`. `show` and
 *  `list` never call this — they resolve a pre-existing directory structurally, dots
 *  and repeated hyphens included, so only `create` needs the stricter round-trip rule. */
export function validatePortfolioName(base: string): { ok: true } | { ok: false; message: string } {
  if (PORTFOLIO_CREATE_NAME_RE.test(base)) return { ok: true };
  return {
    ok: false,
    message: `--portfolio must match ${PORTFOLIO_CREATE_NAME_RE.source} — uppercase letters and digits in hyphen-separated groups, no dots, no leading/trailing hyphen, no repeated hyphens (got "${base}").`,
  };
}

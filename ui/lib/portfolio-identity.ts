// Verbatim transplant of lib/work-graph/src/derive/portfolio.ts (canonical source —
// update both if the naming rules or lifecycle parsing change). Adapted: uses
// ui/lib/yaml-parser.ts#parseYaml in place of the library's direct js-yaml import;
// drops validatePortfolioName and matchesGroup (both create-only, unused here — the
// CLI's `portfolio create` name-collision check is not part of this module's surface).
// `rootDocPath` mirrors the library's `portfolioRootDocPath`, exported here so
// fs-reader.ts can resolve a project's kind without an `FsReads` adapter.
//
// Owns every portfolio naming rule so nothing else in the UI restates one: the
// `{base}-ROOT` directory convention, the five document filenames inside it,
// root-document detection, and lifecycle frontmatter parsing.
import path from 'node:path';
import type { NodeId } from '@rad-orchestration/work-graph';
import { parseYaml } from '@/lib/yaml-parser';

export const PORTFOLIO_DOC_ROLES = ['root', 'iterations', 'decisions', 'technical', 'groundTruth'] as const;
export type PortfolioDocRole = typeof PORTFOLIO_DOC_ROLES[number];

/** Injected filesystem reads. Every one degrades rather than throwing. */
export interface FsReads {
  exists: (p: string) => boolean;
  readFile: (p: string) => string;      // '' when unreadable
  readDirNames: (p: string) => string[]; // [] when absent or unreadable
  isDirectory: (p: string) => boolean;
}

const ROOT_SUFFIX = '-ROOT';

/** `PORTFOLIO` → `PORTFOLIO-ROOT`. */
export function rootDirName(base: string): string {
  return `${base}${ROOT_SUFFIX}`;
}

/** A trailing `-ROOT` stripped; null when the name has no `-ROOT` suffix. */
export function baseFromRootDir(dir: string): string | null {
  return dir.endsWith(ROOT_SUFFIX) ? dir.slice(0, -ROOT_SUFFIX.length) : null;
}

const DOC_SUFFIX: Record<PortfolioDocRole, string> = {
  root: 'ROOT',
  iterations: 'ITERATIONS',
  decisions: 'DECISIONS',
  technical: 'TECHNICAL',
  groundTruth: 'GROUND-TRUTH',
};

/** Absolute paths for all five documents inside `{projectsDir}/{base}-ROOT/`. */
export function docPaths(projectsDir: string, base: string): Record<PortfolioDocRole, string> {
  const dir = path.join(projectsDir, rootDirName(base));
  const result = {} as Record<PortfolioDocRole, string>;
  for (const role of PORTFOLIO_DOC_ROLES) {
    result[role] = path.join(dir, `${base}-${DOC_SUFFIX[role]}.md`);
  }
  return result;
}

/** Absolute path to `{projectsDir}/{dir}/{dir}.md` — the root document a directory
 *  needs to hold in order to be a portfolio. */
export function rootDocPath(projectsDir: string, dir: string): string {
  return path.join(projectsDir, dir, `${dir}.md`);
}

/** True when `{projectsDir}/{dir}/{dir}.md` exists — the structural root-project test. */
export function isPortfolioRootDir(projectsDir: string, dir: string, fs: FsReads): boolean {
  return fs.exists(rootDocPath(projectsDir, dir));
}

export type Lifecycle = 'active' | 'on-hold' | 'done';
export const LIFECYCLE_VALUES: readonly Lifecycle[] = ['active', 'on-hold', 'done'];

function isLifecycle(value: unknown): value is Lifecycle {
  return typeof value === 'string' && (LIFECYCLE_VALUES as readonly string[]).includes(value);
}

/** Root-document frontmatter `status`; null when absent, unreadable, or not one of the three. */
export function readLifecycle(rootDocPath: string, fs: FsReads): Lifecycle | null {
  const raw = fs.readFile(rootDocPath);
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return null;
  let fm: Record<string, unknown> | undefined;
  try {
    fm = parseYaml<Record<string, unknown>>(match[1] ?? '');
  } catch {
    return null;
  }
  const status = fm?.['status'];
  return isLifecycle(status) ? status : null;
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
  const target = rootDirName(base).toLowerCase();
  const match = fs.readDirNames(projectsDir).find((name) => name.toLowerCase() === target);
  if (!match) return null;
  return isPortfolioRootDir(projectsDir, match, fs) ? match : null;
}

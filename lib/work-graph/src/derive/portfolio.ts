import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

export type PortfolioLifecycle = 'active' | 'on-hold' | 'done';
export const PORTFOLIO_LIFECYCLE_VALUES: readonly PortfolioLifecycle[] = ['active', 'on-hold', 'done'];

function isPortfolioLifecycle(value: unknown): value is PortfolioLifecycle {
  return typeof value === 'string' && (PORTFOLIO_LIFECYCLE_VALUES as readonly string[]).includes(value);
}

/** Injected filesystem reads. Every one degrades rather than throwing. */
export interface PortfolioFsReads {
  exists: (p: string) => boolean;
  readFile: (p: string) => string;       // '' when unreadable
  readDirNames: (p: string) => string[]; // [] when absent or unreadable
  isDirectory: (p: string) => boolean;
}

/** Real-filesystem reads; the default when a caller injects nothing. */
export const nodePortfolioFs: PortfolioFsReads = {
  exists: (p) => fs.existsSync(p),
  readFile: (p) => { try { return fs.readFileSync(p, 'utf-8'); } catch { return ''; } },
  readDirNames: (p) => { try { return fs.readdirSync(p); } catch { return []; } },
  isDirectory: (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } },
};

export interface PortfolioRef {
  name: string;        // base name — the root directory with its `-ROOT` suffix stripped
  rootProject: string; // the `{BASE}-ROOT` directory name, which is also the project node id
  dir: string;         // absolute path to that directory
  rootDoc: string;     // absolute path to the root document
  status: PortfolioLifecycle | null;
}

const ROOT_SUFFIX = '-ROOT';

/** `X` → `X-ROOT`. */
export function portfolioRootDirName(base: string): string {
  return `${base}${ROOT_SUFFIX}`;
}

/** A trailing `-ROOT` stripped; null when the name has no `-ROOT` suffix. */
export function portfolioBaseFromRootDir(dir: string): string | null {
  return dir.endsWith(ROOT_SUFFIX) ? dir.slice(0, -ROOT_SUFFIX.length) : null;
}

/** Absolute path to `{projectsDir}/{dir}/{dir}.md` — the root document a directory needs to
 *  hold in order to be a portfolio. */
export function portfolioRootDocPath(projectsDir: string, dir: string): string {
  return path.join(projectsDir, dir, `${dir}.md`);
}

/** True when `{projectsDir}/{dir}/{dir}.md` exists — the structural root-project test. No
 *  marker file is introduced; a directory is a portfolio iff it holds a document of its own name. */
export function isPortfolioRootDir(projectsDir: string, dir: string, fsReads: PortfolioFsReads = nodePortfolioFs): boolean {
  return fsReads.exists(portfolioRootDocPath(projectsDir, dir));
}

/** Root-document frontmatter `status`; null when absent, unreadable, unparseable, or not one of
 *  the three lifecycle values. Never throws — an adversarial root document degrades to a null
 *  status, which suppresses the portfolio surfaces rather than failing the caller. */
export function readPortfolioLifecycle(rootDocPath: string, fsReads: PortfolioFsReads = nodePortfolioFs): PortfolioLifecycle | null {
  const raw = fsReads.readFile(rootDocPath);
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return null;
  let fm: Record<string, unknown> | undefined;
  try {
    fm = yaml.load(match[1] ?? '') as Record<string, unknown> | undefined;
  } catch {
    return null;
  }
  const status = fm?.['status'];
  return isPortfolioLifecycle(status) ? status : null;
}

/** Every portfolio directly under `projectsDir`, ascending by name. Cheap gates run before any
 *  frontmatter read: skip `_`-prefixed names, require a directory, require a `-ROOT` suffix, then
 *  `isPortfolioRootDir` — only survivors pay for a frontmatter parse. Returns `[]` rather than
 *  throwing when `projectsDir` does not exist. */
export function listPortfolios(projectsDir: string, fsReads: PortfolioFsReads = nodePortfolioFs): PortfolioRef[] {
  const refs: PortfolioRef[] = [];
  for (const dir of fsReads.readDirNames(projectsDir)) {
    if (dir.startsWith('_')) continue;
    if (!fsReads.isDirectory(path.join(projectsDir, dir))) continue;
    const base = portfolioBaseFromRootDir(dir);
    if (base === null) continue;
    if (!isPortfolioRootDir(projectsDir, dir, fsReads)) continue;
    const rootDoc = portfolioRootDocPath(projectsDir, dir);
    refs.push({
      name: base,
      rootProject: dir,
      dir: path.join(projectsDir, dir),
      rootDoc,
      status: readPortfolioLifecycle(rootDoc, fsReads),
    });
  }
  return refs.sort((a, b) => a.name.localeCompare(b.name));
}

/** The portfolio among `projectIds` — each id is a bare directory name — or null when none of
 *  them is a root project. Takes ids rather than a group so a caller that already holds the
 *  graph pays no second composition. */
export function resolvePortfolioAmong(
  projectsDir: string, projectIds: readonly string[], fsReads: PortfolioFsReads = nodePortfolioFs,
): PortfolioRef | null {
  for (const id of projectIds) {
    const base = portfolioBaseFromRootDir(id);
    if (base === null) continue;
    if (!isPortfolioRootDir(projectsDir, id, fsReads)) continue;
    const rootDoc = portfolioRootDocPath(projectsDir, id);
    return {
      name: base,
      rootProject: id,
      dir: path.join(projectsDir, id),
      rootDoc,
      status: readPortfolioLifecycle(rootDoc, fsReads),
    };
  }
  return null;
}

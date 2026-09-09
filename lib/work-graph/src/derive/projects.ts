import fs from 'node:fs';
import path from 'node:path';
import type { Project, ProjectDocs } from '../types.js';
import { rollupProjectStatus } from './status.js';
import { deriveProjectState } from './project-state.js';
import { resolveWorktrees, type GitExec } from './worktrees.js';
import { portfolioRootDocPath, portfolioBaseFromRootDir } from './portfolio.js';

export interface DeriveDeps {
  projectsDir: string;
  worktreesDir: string;
  sideProjectsDir?: string;
  /** Repo name → absolute local clone path, from the registry. Absent → clone bindings fall back to the convention path. */
  registryLocalPaths?: Record<string, string>;
  exec?: GitExec;
}

export function listProjectNames(projectsDir: string): string[] {
  if (!fs.existsSync(projectsDir)) return [];
  return fs.readdirSync(projectsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('_'))
    .map((d) => d.name)
    .sort((a, b) => a.localeCompare(b));
}

export function projectExists(projectsDir: string, name: string): boolean {
  return fs.existsSync(path.join(projectsDir, name));
}

function readState(dir: string): Record<string, any> | null {
  const file = path.join(dir, 'state.json');
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

/** Pipeline machinery — never a project document. Additions here are deliberate. */
const MACHINERY_FILES = new Set(['state.json', 'template.yml', '.project-sessions.json']);

/** `rootDocName` is the portfolio root document's filename, or null when this directory cannot be
 *  a portfolio root — the caller owns that gate, so a same-named file elsewhere stays an ordinary
 *  document in `others`. */
function scanDocs(dir: string, name: string, rootDocName: string | null): ProjectDocs {
  const docs: ProjectDocs = { others: [], subfolders: [] };
  const slots: Record<string, 'brainstorming' | 'requirements' | 'masterPlan'> = {
    [`${name}-BRAINSTORMING.md`]: 'brainstorming',
    [`${name}-REQUIREMENTS.md`]: 'requirements',
    [`${name}-MASTER-PLAN.md`]: 'masterPlan',
  };
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      docs.subfolders.push(entry.name);
      continue;
    }
    // Checked ahead of the `isFile()` filter below: a symlinked root doc reports
    // `isFile() === false` (readdir does not follow links), but the existence
    // checks the other detection paths use (`fileExists`/`fs.exists`) do follow
    // them. Matching the name here first keeps every path agreeing on a symlinked
    // root doc.
    if (rootDocName !== null && entry.name === rootDocName) {
      docs.root = entry.name;
      continue;
    }
    if (!entry.isFile() || MACHINERY_FILES.has(entry.name)) continue;
    const slot = slots[entry.name];
    if (slot) docs[slot] = entry.name;
    else docs.others.push(entry.name);
  }
  docs.others.sort((a, b) => a.localeCompare(b));
  docs.subfolders.sort((a, b) => a.localeCompare(b));
  return docs;
}

function readHaltReason(state: Record<string, any> | null): string | null {
  const reason = state?.pipeline?.halt_reason;
  return typeof reason === 'string' && reason.length > 0 ? reason : null;
}

export function deriveProject(name: string, deps: DeriveDeps): Project | null {
  const dir = path.join(deps.projectsDir, name);
  if (!fs.existsSync(dir)) return null;
  const state = readState(dir);
  const sc = state?.pipeline?.source_control;
  const derived = deriveProjectState(state);
  // Both gates, as `listPortfolios` applies them: the `-ROOT` suffix, then a document of the
  // directory's own name. The suffix test is a string test, so no read is added here — the
  // document is spotted in the listing `scanDocs` already walks.
  const rootDocName = portfolioBaseFromRootDir(name) === null
    ? null
    : path.basename(portfolioRootDocPath(deps.projectsDir, name));
  const docs = scanDocs(dir, name, rootDocName);
  return {
    id: name, kind: 'project', name,
    status: state ? rollupProjectStatus(state) : 'unknown',
    state: derived.state,
    stateLabel: derived.label,
    dir,
    tier: derived.tier,
    // A filled root-document slot wins over anything state.json says. A portfolio root has no
    // state.json in practice, so the conflict is theoretical — the precedence is written down
    // rather than left to be inferred from line order.
    projectType: docs.root !== undefined
      ? 'portfolio'
      : state?.project?.project_type === 'side-project' ? 'side-project' : 'standard',
    sourceControlInitialized: !!sc && typeof sc === 'object' && !Array.isArray(sc),
    docs,
    worktrees: resolveWorktrees(name, deps),
    haltReason: readHaltReason(state),
  };
}

import fs from 'node:fs';
import path from 'node:path';
import type { Project, ProjectDocs, Tier } from '../types.js';
import { rollupProjectStatus } from './status.js';
import { resolveWorktrees, type GitExec } from './worktrees.js';

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

function scanDocs(dir: string, name: string): ProjectDocs {
  const docs: ProjectDocs = { others: [] };
  const slots: Record<string, 'brainstorming' | 'requirements' | 'masterPlan'> = {
    [`${name}-BRAINSTORMING.md`]: 'brainstorming',
    [`${name}-REQUIREMENTS.md`]: 'requirements',
    [`${name}-MASTER-PLAN.md`]: 'masterPlan',
  };
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || entry.name === 'state.json') continue;
    const slot = slots[entry.name];
    if (slot) docs[slot] = entry.name;
    else docs.others.push(entry.name);
  }
  docs.others.sort((a, b) => a.localeCompare(b));
  return docs;
}

export function deriveProject(name: string, deps: DeriveDeps): Project | null {
  const dir = path.join(deps.projectsDir, name);
  if (!fs.existsSync(dir)) return null;
  const state = readState(dir);
  const sc = state?.pipeline?.source_control;
  return {
    id: name, kind: 'project', name,
    status: state ? rollupProjectStatus(state) : 'unknown',
    dir,
    tier: (state?.pipeline?.current_tier as Tier | undefined) ?? null,
    projectType: state?.project?.project_type === 'side-project' ? 'side-project' : 'standard',
    sourceControlInitialized: !!sc && typeof sc === 'object' && !Array.isArray(sc),
    docs: scanDocs(dir, name),
    worktrees: resolveWorktrees(name, deps),
  };
}

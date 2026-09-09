import * as path from 'node:path';
import { stringifyYaml } from './yaml.js';
import type { ParsedPhase, ParsedTask } from './explode-master-plan.js';

// ── Minimal state shapes shared by explosion and amendment ────────────────────

export interface IterationEntry {
  index: number;
  status: string;
  nodes: Record<string, unknown>;
  corrective_tasks: unknown[];
  doc_path?: string | null;
  repos: { name: string; commit_hash: string | null }[];
  complexity?: 'simple' | 'standard' | 'complex';
}

export interface ForEachTaskNodeState {
  kind: 'for_each_task';
  status: string;
  iterations: IterationEntry[];
}

export interface ForEachPhaseNodeState {
  kind: 'for_each_phase';
  status: string;
  iterations: IterationEntry[];
}

// ── Filename helpers ──────────────────────────────────────────────────────────

/**
 * Slugify a phase/task title into the filename suffix. Mirrors the existing
 * hand-authored convention (SCREAMING-KEBAB-CASE).
 */
export function titleToFilenameSlug(title: string): string {
  const cleaned = title
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || 'UNTITLED';
}

export function phaseFilename(projectName: string, phase: ParsedPhase): string {
  const idx = String(phase.index).padStart(2, '0');
  return `${projectName}-PHASE-${idx}-${titleToFilenameSlug(phase.title)}.md`;
}

export function taskFilename(projectName: string, task: ParsedTask): string {
  const pidx = String(task.phaseIndex).padStart(2, '0');
  const tidx = String(task.taskIndex).padStart(2, '0');
  return `${projectName}-TASK-P${pidx}-T${tidx}-${titleToFilenameSlug(task.title)}.md`;
}

// ── Emission ──────────────────────────────────────────────────────────────────

export function unionTaskRepos(phase: ParsedPhase): string[] {
  const repos: string[] = [];
  const seen = new Set<string>();
  for (const task of phase.tasks) {
    for (const r of task.targetRepos) {
      if (!seen.has(r)) { seen.add(r); repos.push(r); }
    }
  }
  return repos;
}

export function buildPhaseFrontmatter(opts: {
  projectName: string;
  phase: ParsedPhase;
  createdIso: string;
}): Record<string, unknown> {
  return {
    project: opts.projectName,
    phase: opts.phase.index,
    title: opts.phase.title,
    status: 'active',
    tasks: opts.phase.tasks.map(t => ({ id: `T${String(t.taskIndex).padStart(2, '0')}`, title: t.title })),
    repos: unionTaskRepos(opts.phase),
    created: opts.createdIso,
    type: 'phase_plan',
  };
}

export function buildTaskFrontmatter(opts: {
  projectName: string;
  task: ParsedTask;
  createdIso: string;
}): Record<string, unknown> {
  return {
    project: opts.projectName,
    phase: opts.task.phaseIndex,
    task: opts.task.taskIndex,
    title: opts.task.title,
    status: 'pending',
    complexity: opts.task.complexity,
    repos: opts.task.targetRepos,
    created: opts.createdIso,
    type: 'task_handoff',
  };
}

export function renderDoc(frontmatter: Record<string, unknown>, body: string): string {
  const frontmatterYaml = stringifyYaml(frontmatter).trimEnd();
  return `---\n${frontmatterYaml}\n---\n\n${body.trimEnd()}\n`;
}

export function renderPhaseBody(phase: ParsedPhase): string {
  const header = `# Phase ${phase.index}: ${phase.title}`;
  const sections: string[] = [header, ''];
  if (phase.body.trim().length > 0) {
    sections.push(phase.body.trim(), '');
  }
  sections.push('## Tasks', '');
  if (phase.tasks.length === 0) {
    sections.push('_(no tasks emitted by explosion script — phase has no task headings in the Master Plan)_');
  } else {
    sections.push('| Task | Repo | Complexity | Purpose |', '|---|---|---|---|');
    for (const t of phase.tasks) {
      const tidx = `T${String(t.taskIndex).padStart(2, '0')}`;
      const repoCell = t.targetRepos.join(', ');
      const purposeCell = t.purpose.trim().length > 0 ? t.purpose : '—';
      sections.push(`| ${tidx} | ${repoCell} | ${t.complexity} | ${purposeCell} |`);
    }
    const order = phase.tasks.map(t => `T${String(t.taskIndex).padStart(2, '0')}`).join(' → ');
    sections.push('', `**Order:** ${order}`);
  }
  return sections.join('\n');
}

export function renderTaskBody(task: ParsedTask): string {
  const pidx = String(task.phaseIndex).padStart(2, '0');
  const tidx = String(task.taskIndex).padStart(2, '0');
  const header = `# P${pidx}-T${tidx}: ${task.title}`;
  const sections: string[] = [header, ''];
  if (task.body.trim().length > 0) {
    sections.push(task.body.trim());
  } else {
    sections.push('_(empty body in Master Plan)_');
  }
  sections.push('', '## Execution Notes', '', '_(none yet — appended at runtime)_');
  return sections.join('\n');
}

export function toRelativeDocPath(absPath: string, projectDir: string): string {
  const rel = path.relative(projectDir, absPath);
  // Normalize to forward slashes — matches the legacy state.json convention
  // (phases/NAME-PHASE-NN-TITLE.md, tasks/NAME-TASK-PNN-TMM-TITLE.md) and
  // keeps state.json portable across platforms + check-in/check-out.
  return rel.split(path.sep).join('/');
}

// ── Iteration-entry builders (pure — no state mutation, no fs) ────────────────

export function buildTaskIterationEntry(opts: {
  index: number;
  task: ParsedTask;
  docPath: string | null;
}): IterationEntry {
  return {
    index: opts.index,
    status: 'not_started',
    nodes: {},
    corrective_tasks: [],
    doc_path: opts.docPath,
    repos: opts.task.targetRepos.map(name => ({ name, commit_hash: null })),
    complexity: opts.task.complexity,
  };
}

export function buildPhaseIterationEntry(opts: {
  index: number;
  phase: ParsedPhase;
  docPath: string | null;
  taskIterations: IterationEntry[];
}): IterationEntry {
  const taskLoop: ForEachTaskNodeState = {
    kind: 'for_each_task',
    status: 'not_started',
    iterations: opts.taskIterations,
  };
  return {
    index: opts.index,
    status: 'not_started',
    nodes: { task_loop: taskLoop },
    corrective_tasks: [],
    doc_path: opts.docPath,
    repos: unionTaskRepos(opts.phase).map(name => ({ name, commit_hash: null })),
  };
}

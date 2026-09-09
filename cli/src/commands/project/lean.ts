import type { GraphDTO, Project, ProjectState, WorktreeRef } from '@rad-orchestration/work-graph';

export interface LeanWorktree { repo: string; path: string; branch: string | null; exists: boolean; }
export interface LeanProject {
  name: string; state: ProjectState; stateLabel: string; status: string;
  /** Diagnostic pipeline-stage detail, subordinate to `state`/`stateLabel` — never the
   *  canonical answer to "what state is this project in". Carried through for tooling
   *  that still keys off the tier; prefer `state`/`stateLabel`. */
  tier: string | null;
  sourceControlInitialized: boolean;
  dir: string; projectType?: 'side-project'; group?: string;
  worktrees: LeanWorktree[]; docs: Project['docs'];
  related: { follows?: string; spawned?: string[]; [k: string]: string | string[] | undefined };
}

export function toLeanProject(p: Project, graph: GraphDTO): LeanProject {
  const group = graph.edges.find((e) => e.type === 'contains' && e.to === p.id)?.from;
  const related: LeanProject['related'] = {};
  for (const e of graph.edges) {
    if (e.type === 'contains') continue;
    if (e.from === p.id) related[e.type] = e.to;            // outgoing: a single target
    else if (e.to === p.id) {
      const bucket = e.type === 'spawned-from' ? 'spawned' : `${e.type}-by`;
      if (!related[bucket]) related[bucket] = [];
      (related[bucket] as string[]).push(e.from);           // incoming: a list
    }
  }
  const lean: LeanProject = {
    name: p.name, state: p.state, stateLabel: p.stateLabel, status: p.status, tier: p.tier, sourceControlInitialized: p.sourceControlInitialized,
    dir: p.dir, docs: p.docs,
    worktrees: p.worktrees.map((w: WorktreeRef) => ({ repo: w.repo, path: w.path, branch: w.branch, exists: w.exists })),
    related,
  };
  if (p.projectType === 'side-project') lean.projectType = 'side-project';
  if (group) lean.group = group.replace(/^group:/, '');
  return lean;
}

export function renderProjectTable(projects: Project[]): string {
  const rows = projects.map((p) => `${p.name}\t${p.stateLabel}\t${p.status}\t${p.tier ?? '-'}`);
  return ['NAME\tSTATE\tstatus\ttier', ...rows].join('\n');
}
export function renderProjectCard(p: LeanProject): string {
  const lines = [`${p.name}  [${p.stateLabel}]  (status=${p.status} tier=${p.tier ?? '-'})`, `dir: ${p.dir}`];
  if (p.group) lines.push(`group: ${p.group}`);
  for (const w of p.worktrees) lines.push(`worktree ${w.repo}: ${w.path} (${w.branch ?? 'detached'}) exists=${w.exists}`);
  return lines.join('\n');
}

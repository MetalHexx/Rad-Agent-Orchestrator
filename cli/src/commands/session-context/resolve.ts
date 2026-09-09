import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { WorkGraphService, within } from '@rad-orchestration/work-graph';
import type {
  GraphDTO, LocateResult, PortfolioLifecycle, PortfolioRef, Project, ServiceOpts, WorktreeRef,
} from '@rad-orchestration/work-graph';
import { userDataPaths } from '../../lib/paths.js';

export interface StandingProject {
  name: string;
  stateLabel: string;
  dir: string;
  /** True when joined to the PREVIOUS entry by a real `follows` edge; always false on the first entry. */
  followsPrevious: boolean;
  /** True on exactly one entry — the end of the `follows` chain, not the last array element. */
  isTip: boolean;
}

export interface StandingNeighbour { name: string; stateLabel: string; dir: string }
export interface StandingRepo { name: string; path: string; here: boolean }

export interface Standing {
  /** Series-ordered, then unlinked co-tenants. Exactly one entry carries `isTip`. Never empty. */
  projects: StandingProject[];
  tip: {
    name: string;
    stateLabel: string;
    dir: string;
    docs: string[];
    subfolders: string[];
    group?: string;
    haltReason?: string;
    predecessor?: StandingNeighbour;
    successor?: StandingNeighbour;
  };
  /** Absent for a side-project — there is no managed workspace. */
  worktree?: { path: string; branch: string | null; repos: StandingRepo[] };
  /** Co-tenants other than the tip, minus any already reported as a series neighbour. */
  alsoHere: StandingNeighbour[];
  /** The tip's portfolio when its containing group is one; absent otherwise. */
  portfolio?: { name: string; status: PortfolioLifecycle | null; rootDoc: string };
}

/** The library's git executor shape, taken from the facade rather than restated. */
export type StandingGitExec = NonNullable<ServiceOpts['exec']>;

/** The slice of `WorkGraphService` a standing is resolved from. */
export interface StandingService {
  locate(cwd: string): LocateResult;
  listProjects(): Project[];
  getGraph(): GraphDTO;
  resolveWorktrees(projectId: string): WorktreeRef[];
  resolvePortfolioAmong(projectIds: readonly string[]): PortfolioRef | null;
}

/**
 * Builds a work-graph service. Called with no executor for path-only resolution (the
 * service must then carry a no-op git exec) and once with a real executor for the single
 * branch probe.
 */
export type StandingServiceFactory = (exec?: StandingGitExec) => StandingService;

export interface ResolveStandingOpts {
  cwd: string;
  /** Root of the managed workspaces; only used to name a workspace whose repos did not resolve. */
  worktreesDir?: string;
  serviceFactory?: StandingServiceFactory;
  /** Real git executor for the one permitted invocation. */
  exec?: StandingGitExec;
}

const defaultGitExec: StandingGitExec = (file, args, execOpts) =>
  execFileSync(file, args, { cwd: execOpts.cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }) as unknown as string;

const defaultServiceFactory: StandingServiceFactory = (exec) => {
  const paths = userDataPaths();
  // Worktree *paths* come from state.json plus the worktree-name convention; only the branch
  // needs git. Without an executor the service gets a no-op one so path resolution never fans
  // out one `git worktree list` per repo at session start.
  return new WorkGraphService({
    root: paths.root,
    worktreesDir: paths.worktrees,
    sideProjectsDir: paths.sideProjects,
    exec: exec ?? (() => ''),
  });
};

/**
 * Classifies `cwd` and resolves everything a session preamble needs to state where it stands:
 * the co-tenant projects in series order, full detail for the series tip, and the managed
 * workspace when there is one.
 *
 * Returns null when the directory says nothing — a main clone, an unclassified directory, or a
 * workspace matching no project. Never throws: session start cannot be blocked by this function.
 */
export function resolveStanding(opts: ResolveStandingOpts): Standing | null {
  try {
    const factory = opts.serviceFactory ?? defaultServiceFactory;
    const svc = factory();
    const located = svc.locate(opts.cwd);
    if (located.kind !== 'worktree' && located.kind !== 'side-project') return null;

    const all = svc.listProjects();
    const byName = new Map(all.map((p) => [p.name, p]));
    const byId = new Map(all.map((p) => [p.id, p]));
    const cotenants = coTenants(located, byName);
    if (cotenants.length === 0) return null;

    const graph = svc.getGraph();
    const ordered = orderBySeries(cotenants, graph);
    const tipIndex = endOfFirstChain(ordered);
    const tipProject = ordered[tipIndex].project;

    const predecessor = oneHop(tipProject.id, graph, byId, 'outgoing');
    const successor = oneHop(tipProject.id, graph, byId, 'incoming');

    const tip: Standing['tip'] = {
      name: tipProject.name,
      stateLabel: tipProject.stateLabel,
      dir: tipProject.dir,
      docs: flattenDocs(tipProject.docs),
      subfolders: tipProject.docs.subfolders ?? [],
    };
    const groupId = graph.edges.find((e) => e.type === 'contains' && e.to === tipProject.id)?.from;
    if (groupId) tip.group = groupId.replace(/^group:/, '');
    const portfolio = groupId
      ? svc.resolvePortfolioAmong(
          graph.edges.filter((e) => e.type === 'contains' && e.from === groupId).map((e) => e.to),
        )
      : null;
    if (tipProject.haltReason) tip.haltReason = tipProject.haltReason;
    if (predecessor) tip.predecessor = predecessor;
    if (successor) tip.successor = successor;

    const reported = new Set([tipProject.name, predecessor?.name, successor?.name].filter(isName));
    const standing: Standing = {
      projects: ordered.map((entry, i) => ({
        name: entry.project.name,
        stateLabel: entry.project.stateLabel,
        dir: entry.project.dir,
        followsPrevious: entry.followsPrevious,
        isTip: i === tipIndex,
      })),
      tip,
      alsoHere: ordered.filter((e) => !reported.has(e.project.name)).map((e) => toNeighbour(e.project)),
    };
    if (portfolio) {
      standing.portfolio = { name: portfolio.name, status: portfolio.status, rootDoc: portfolio.rootDoc };
    }
    if (located.kind === 'worktree') standing.worktree = resolveWorkspace(opts, located, tipProject, svc, factory);
    return standing;
  } catch {
    return null;
  }
}

/**
 * The two classified paths resolve their projects differently. A worktree carries a `projects`
 * list of co-tenants; a side-project carries none at all — its `worktree_name` *is* the single
 * project's folder name, so reading `projects` there would yield undefined for every side-project.
 */
function coTenants(located: LocateResult, byName: Map<string, Project>): Project[] {
  if (located.kind === 'side-project') {
    const only = located.worktree_name ? byName.get(located.worktree_name) : undefined;
    return only ? [only] : [];
  }
  return (located.projects ?? []).map((n) => byName.get(n)).filter(isProject);
}

interface OrderedEntry { project: Project; followsPrevious: boolean }

/**
 * Orders co-tenants along their `follows` chains — each chain walked from the entry with no
 * in-chain predecessor — then appends unlinked co-tenants, name-ordered for determinism.
 * `followsPrevious` is set only where a real edge joins adjacent entries.
 */
function orderBySeries(projects: Project[], graph: GraphDTO): OrderedEntry[] {
  const present = new Set(projects.map((p) => p.id));
  const byId = new Map(projects.map((p) => [p.id, p]));
  const predecessorOf = new Map<string, string>();
  const successorOf = new Map<string, string>();
  for (const e of graph.edges) {
    if (e.type !== 'follows' || !present.has(e.from) || !present.has(e.to)) continue;
    predecessorOf.set(e.from, e.to);
    successorOf.set(e.to, e.from);
  }

  const isLinked = (p: Project): boolean => predecessorOf.has(p.id) || successorOf.has(p.id);
  const byNameAsc = (a: Project, b: Project): number => a.name.localeCompare(b.name);
  const linked = projects.filter(isLinked);
  const heads = linked.filter((p) => !predecessorOf.has(p.id)).sort(byNameAsc);

  const ordered: OrderedEntry[] = [];
  const placed = new Set<string>();
  for (const head of heads) {
    let cursor: Project | undefined = head;
    let first = true;
    while (cursor && !placed.has(cursor.id)) {
      placed.add(cursor.id);
      ordered.push({ project: cursor, followsPrevious: !first });
      first = false;
      const next = successorOf.get(cursor.id);
      cursor = next ? byId.get(next) : undefined;
    }
  }
  // A cycle leaves linked entries with no head to walk from; place them rather than drop them.
  for (const p of [...linked].sort(byNameAsc)) {
    if (!placed.has(p.id)) { placed.add(p.id); ordered.push({ project: p, followsPrevious: false }); }
  }
  for (const p of projects.filter((q) => !isLinked(q)).sort(byNameAsc)) {
    ordered.push({ project: p, followsPrevious: false });
  }
  return ordered;
}

/**
 * The tip is the end of the first `follows` chain — never simply the last element, which is an
 * alphabetically-placed unlinked co-tenant whenever one is present. With no chain at all the
 * first name-ordered entry is the tip, so exactly one entry always carries it.
 */
function endOfFirstChain(ordered: OrderedEntry[]): number {
  let i = 0;
  while (i + 1 < ordered.length && ordered[i + 1].followsPrevious) i++;
  return i;
}

/** Slot documents in reading order, then the rest as the projection sorted them. */
function flattenDocs(docs: Project['docs']): string[] {
  return [docs.root, docs.requirements, docs.masterPlan, docs.brainstorming, ...docs.others].filter(isName);
}

const NEIGHBOUR_EDGE_TYPES = ['follows', 'spawned-from'];

/**
 * One hop along a series edge. Outgoing points at what this project follows or was spawned from
 * (its predecessor); incoming points at a project that follows or was spawned from it.
 */
function oneHop(
  id: string,
  graph: GraphDTO,
  byId: Map<string, Project>,
  direction: 'outgoing' | 'incoming',
): StandingNeighbour | undefined {
  for (const type of NEIGHBOUR_EDGE_TYPES) {
    for (const e of graph.edges) {
      if (e.type !== type) continue;
      const other = direction === 'outgoing' ? (e.from === id ? e.to : undefined) : (e.to === id ? e.from : undefined);
      const found = other ? byId.get(other) : undefined;
      if (found) return toNeighbour(found);
    }
  }
  return undefined;
}

function resolveWorkspace(
  opts: ResolveStandingOpts,
  located: LocateResult,
  tipProject: Project,
  svc: StandingService,
  factory: StandingServiceFactory,
): NonNullable<Standing['worktree']> {
  let refs: WorktreeRef[] = [];
  try { refs = svc.resolveWorktrees(tipProject.id); } catch { refs = []; }
  // The legacy `resolvedVia: 'git'` shape (single pre-per-repo worktree) already resolves
  // `path` to the one workspace directory itself; every modern per-repo shape resolves it to
  // a repo subfolder, so only those need `dirname` to reach the shared workspace root.
  const workspacePath = refs.length > 0
    ? (refs[0].resolvedVia === 'git' ? refs[0].path : path.dirname(refs[0].path))
    : path.join(opts.worktreesDir ?? userDataPaths().worktrees, located.worktree_name ?? '');
  // All repos in a workspace are created on the same branch by construction, so one repo's
  // branch is the workspace branch; divergence is deliberately not probed. The probe itself is
  // spent only when classification did not already resolve the branch.
  const branch = located.branch ?? probeBranch(refs, factory, opts.exec);
  return {
    path: workspacePath,
    branch,
    repos: refs.map((w) => ({ name: w.repo, path: w.path, here: within(w.path, opts.cwd) })),
  };
}

/**
 * The one permitted git invocation. `locate()` reads a branch only when its cwd carries a repo
 * segment, so a second service — this one with a real executor — is pointed at the first repo
 * subdirectory of the workspace. Nothing is spent when classification already knew the branch.
 */
function probeBranch(refs: WorktreeRef[], factory: StandingServiceFactory, exec?: StandingGitExec): string | null {
  const first = refs[0];
  if (!first) return null;
  try {
    return factory(exec ?? defaultGitExec).locate(first.path).branch ?? null;
  } catch {
    return null;
  }
}

function toNeighbour(p: Project): StandingNeighbour {
  return { name: p.name, stateLabel: p.stateLabel, dir: p.dir };
}

function isProject(p: Project | undefined): p is Project { return p !== undefined; }
function isName(s: string | undefined): s is string { return typeof s === 'string' && s.length > 0; }

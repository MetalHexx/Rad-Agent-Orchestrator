// Verbatim transplant of cli/src/commands/portfolio/show.ts's pure `portfolioShow`/
// `resolvePortfolio` (not its CLI command wrapper) and cli/src/commands/portfolio/graph-port.ts's
// `workGraphAdapter` (canonical source — update both if either changes). Adapted: throws a plain
// Error instead of the CLI's UserError, which lives in cli/src/ and may never be imported here.
// The port mirrors the read side only — `listGroups`, `listMembers`, `getGraph` — and the four
// write operations: `createGroup`, `deleteGroup`, `addMember`, `removeMember`. It deliberately
// does not mirror `recordDependency`, because the dashboard never records dependencies.
import fs from 'node:fs';
import path from 'node:path';
import { WorkGraphService, within } from '@rad-orchestration/work-graph';
import type { Edge, GraphDTO, Group, NodeId, Project, ProjectState, Result } from '@rad-orchestration/work-graph';
import { isProjectDirName } from '@/lib/project-name';
import type { FsReads, Lifecycle, PortfolioDocRole } from '@/lib/portfolio-identity';
import {
  PORTFOLIO_DOC_ROLES, baseFromRootDir, docPaths, findRootDir, isPortfolioRootDir,
  readLifecycle, resolveGroupByValue, rootDirName,
} from '@/lib/portfolio-identity';

// ── Graph port ──────────────────────────────────────────────────────────────

export interface GraphPort {
  createGroup(name: string, description: string): Result<{ node: Group; rev: number }>;
  deleteGroup(id: NodeId): Result<{ rev: number }>;
  addMember(groupId: NodeId, projectId: NodeId): Result<{ edge: Edge; rev: number }>;
  removeMember(groupId: NodeId, projectId: NodeId): Result<{ rev: number }>;
  listGroups(): Group[];
  listMembers(groupId: NodeId): Project[];
  getGraph(): GraphDTO;
}

/** The narrow slice of `WorkGraphService` the adapter actually calls.
 *  `WorkGraphService` satisfies this structurally, so the default construction
 *  path below needs no cast. */
export interface GraphBackend {
  getGraph(): GraphDTO;
  createGroup(input: { name: string; description: string; parentId?: NodeId }): Result<{ node: Group; rev: number }>;
  deleteGroup(id: NodeId): Result<{ rev: number }>;
  addMember(groupId: NodeId, nodeId: NodeId): Result<{ edge: Edge; rev: number }>;
  removeMember(groupId: NodeId, nodeId: NodeId): Result<{ rev: number }>;
}

/**
 * `service` is injectable so the memoization itself is testable, and so a caller
 * can hand in a service configured to skip git worktree resolution. Production
 * callers that need neither omit it.
 *
 * `WorkGraphService` recomposes the entire graph inside each of `getGraph()`,
 * `listProjects()`, and `listGroups()` — one composition derives every project
 * under `~/.radorc/projects/` with a `readdir` per project and a `git worktree
 * list` subprocess per bound repo. The adapter instead holds one `GraphDTO` per
 * caller and serves `listGroups`/`listMembers`/`getGraph` from it, recomposing
 * only after a mutation invalidates the cache.
 *
 * The cache is staled by filesystem writes too, not only by the graph write
 * operations: `createGroup`, `deleteGroup`, `addMember`, `removeMember` —
 * composition derives project nodes by listing `projectsDir`. Any caller that
 * writes under `projectsDir` outside those operations must invalidate on its own;
 * never read through the port after such a write without doing so. The cache
 * lives for the lifetime of the returned port only.
 */
export function workGraphAdapter(
  opts: { root: string; worktreesDir?: string; service?: GraphBackend },
): GraphPort {
  const svc: GraphBackend = opts.service ?? new WorkGraphService(opts);
  let cached: GraphDTO | null = null;
  const graph = (): GraphDTO => (cached ??= svc.getGraph());
  const invalidate = (): void => { cached = null; };

  return {
    createGroup(name, description) {
      const result = svc.createGroup({ name, description });
      invalidate();
      return result;
    },
    deleteGroup(id) {
      const result = svc.deleteGroup(id);
      invalidate();
      return result;
    },
    addMember(groupId, projectId) {
      const result = svc.addMember(groupId, projectId);
      invalidate();
      return result;
    },
    removeMember(groupId, projectId) {
      const result = svc.removeMember(groupId, projectId);
      invalidate();
      return result;
    },
    listGroups() {
      return graph().nodes.filter((n): n is Group => n.kind === 'group');
    },
    listMembers(groupId) {
      const g = graph();
      const memberIds = new Set(
        g.edges.filter((e) => e.type === 'contains' && e.from === groupId).map((e) => e.to),
      );
      return g.nodes.filter((n): n is Project => n.kind === 'project' && memberIds.has(n.id));
    },
    getGraph() {
      return graph();
    },
  };
}

// ── Types ───────────────────────────────────────────────────────────────────

export interface PortfolioShowOptions {
  projectsDir: string;
  portfolio: string;        // base name, group name, or group id — validated here
  port: GraphPort;
  fs: FsReads;
}

export type IterationStatus = 'proposed' | 'planned' | 'executing' | 'shipped';

/** Resolved absolute paths, never booleans — a caller must never have to guess one. */
export interface IterationDocs {
  requirements: string | null;
  masterPlan: string | null;
  amendments: string[];     // [] when none; ascending by filename
  finalReview: string | null;
}

export interface PortfolioIteration {
  name: string;
  dir: string;
  state: ProjectState;      // from the work-graph, verbatim
  derivedStatus: IterationStatus;
  dependsOn: string[];      // project ids this iteration is recorded as depending on; [] when none
  docs: IterationDocs;
}

export interface PortfolioShowResult {
  name: string;             // base name
  group: string | null;     // 'group:portfolio'
  status: Lifecycle | null; // root-document frontmatter
  root: { project: string; dir: string; doc: string };
  docs: Record<PortfolioDocRole, { path: string; exists: boolean }>;
  iterations: PortfolioIteration[];
}

// ── Resolution ──────────────────────────────────────────────────────────────

interface Resolved {
  base: string;
  rootProjectId: NodeId;    // also the bare root directory name
  group: NodeId | null;
  members: Project[];
}

/**
 * Resolve `value` as a group (name or id) first, then as a base name. Null when
 * neither holds — the caller turns that into the thrown "no portfolio named X"
 * that callers read as "this is not a portfolio".
 * When called from `portfolioShow`, pass the graph to avoid a redundant call.
 */
function resolvePortfolio(opts: PortfolioShowOptions, graph?: GraphDTO): Resolved | null {
  const { projectsDir, portfolio: value, port } = opts;

  const group = resolveGroupByValue(port.listGroups(), value);
  if (group) {
    const members = port.listMembers(group.id);
    for (const p of members) {
      // `p.id` is the bare directory name; `p.dir` is absolute, and feeding that to
      // either naming predicate makes it false for every member.
      const base = baseFromRootDir(p.id);
      if (base !== null && isPortfolioRootDir(projectsDir, p.id, opts.fs)) {
        return { base, rootProjectId: p.id, group: group.id, members };
      }
    }
    // A group holding no root document is not a portfolio, but `value` may still be
    // a legitimate base name — fall through rather than fail here.
  }

  const rootDir = findRootDir(projectsDir, value, opts.fs);
  if (rootDir === null) return null;
  const base = baseFromRootDir(rootDir);
  if (base === null) return null;

  const resolvedGraph = graph ?? port.getGraph();
  const containing = resolvedGraph.edges.find(
    (e) => e.type === 'contains' && e.to === rootDir && e.from.startsWith('group:'),
  );
  const groupId = containing?.from ?? null;
  return {
    base,
    rootProjectId: rootDir,
    group: groupId,
    members: groupId === null ? [] : port.listMembers(groupId),
  };
}

// ── Iteration derivation ────────────────────────────────────────────────────

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** `docs.subfolders` records `reports/` by name only — the work-graph scan is
 *  non-recursive and never enumerates it, so the file is read from disk here. */
function resolveFinalReview(project: Project, reads: FsReads): string | null {
  const dir = path.join(project.dir, 'reports');
  const file = `${project.name}-FINAL-REVIEW.md`;
  return reads.readDirNames(dir).includes(file) ? path.join(dir, file) : null;
}

/** `Project['docs']` slots hold bare filenames; every one is joined to the
 *  project's absolute `dir` before it leaves this module. */
function resolveIterationDocs(project: Project, reads: FsReads): IterationDocs {
  const inDir = (file: string): string => path.join(project.dir, file);
  const amendment = new RegExp(`^${escapeRegExp(project.name)}-AMENDMENT-\\d{2,}\\.md$`);
  return {
    requirements: project.docs.requirements ? inDir(project.docs.requirements) : null,
    masterPlan: project.docs.masterPlan ? inDir(project.docs.masterPlan) : null,
    amendments: project.docs.others.filter((f) => amendment.test(f)).sort().map((f) => inDir(f)),
    finalReview: resolveFinalReview(project, reads),
  };
}

/**
 * The iteration's lifecycle, derived here so no caller has to compute it.
 * `complete` is tested first on purpose: shipping is an observed fact and dominates
 * document presence, so deleting a document cannot un-ship an iteration. `folded`
 * and `dropped` are human calls that live only in the markdown and are never derived.
 */
function deriveIterationStatus(state: ProjectState, docs: IterationDocs): IterationStatus {
  if (state === 'complete') return 'shipped';
  if (!docs.requirements) return 'proposed';
  if (!docs.masterPlan) return 'planned';
  return 'executing';
}

function toIteration(project: Project, reads: FsReads, dependsOnMap: Map<string, string[]>): PortfolioIteration {
  const docs = resolveIterationDocs(project, reads);
  return {
    name: project.name,
    dir: project.dir,
    // `state` and `status` can disagree; `state` is the canonical answer.
    state: project.state,
    derivedStatus: deriveIterationStatus(project.state, docs),
    dependsOn: dependsOnMap.get(project.id) ?? [],
    docs,
  };
}

// ── Core logic ──────────────────────────────────────────────────────────────

/**
 * Everything one portfolio is, in a single call: lifecycle status, all five document
 * paths with existence, and every iteration with a derived status and resolved
 * document paths. Throws when `portfolio` names no portfolio.
 */
export function portfolioShow(opts: PortfolioShowOptions): PortfolioShowResult {
  const value = opts.portfolio;
  // The value becomes a path segment further down — reject separators and traversal
  // before that happens, never by sanitizing the string into something else.
  if (value.includes('/') || value.includes('\\') || value.includes('..') || path.isAbsolute(value)) {
    throw new Error(`--portfolio must be a plain portfolio or group name, not a path (got "${value}")`);
  }

  const graph = opts.port.getGraph();
  const resolved = resolvePortfolio(opts, graph);
  if (resolved === null) {
    const dir = rootDirName(value);
    throw new Error(
      `No portfolio named '${value}' — no group matches '${value}' and ${dir}/${dir}.md does not exist.`,
    );
  }

  const rootDir = resolved.rootProjectId;
  if (!isProjectDirName(rootDir)) {
    throw new Error(`Portfolio '${resolved.base}' resolved to "${rootDir}", which is not a valid project directory name.`);
  }
  const rootPath = path.join(opts.projectsDir, rootDir);
  if (!within(opts.projectsDir, rootPath)) {
    throw new Error(`Portfolio '${resolved.base}' resolved to "${rootDir}", which is outside ${opts.projectsDir}.`);
  }

  const paths = docPaths(opts.projectsDir, resolved.base);
  const docs = {} as Record<PortfolioDocRole, { path: string; exists: boolean }>;
  for (const role of PORTFOLIO_DOC_ROLES) {
    docs[role] = { path: paths[role], exists: opts.fs.exists(paths[role]) };
  }

  const memberIds = new Set(resolved.members.map((m) => m.id));
  const dependsOnMap = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (edge.type === 'depends-on' && memberIds.has(edge.from)) {
      if (!dependsOnMap.has(edge.from)) {
        dependsOnMap.set(edge.from, []);
      }
      dependsOnMap.get(edge.from)!.push(edge.to);
    }
  }
  for (const deps of dependsOnMap.values()) {
    deps.sort();
  }

  const iterations = resolved.members
    // Exclude the root by identity. Any directory holding a document of its own name
    // satisfies `isPortfolioRootDir`, so re-testing members would silently drop a real
    // iteration that happens to hold one — and a dropped row is a silent skip upstream.
    .filter((p) => p.id !== resolved.rootProjectId)
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((p) => toIteration(p, opts.fs, dependsOnMap));

  return {
    name: resolved.base,
    group: resolved.group,
    status: readLifecycle(paths.root, opts.fs),
    root: { project: rootDir, dir: rootPath, doc: paths.root },
    docs,
    iterations,
  };
}

/** The real-filesystem `FsReads`, mirroring the CLI's inline wiring. Every read
 *  degrades to an empty result rather than throwing. */
export function defaultFsReads(): FsReads {
  return {
    exists: (p) => fs.existsSync(p),
    readFile: (p) => { try { return fs.readFileSync(p, 'utf-8'); } catch { return ''; } },
    readDirNames: (p) => { try { return fs.readdirSync(p); } catch { return []; } },
    isDirectory: (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } },
  };
}

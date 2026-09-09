import fs from 'node:fs';
import path from 'node:path';
import {
  isGroupId, isPortfolioRootDir, portfolioBaseFromRootDir, portfolioRootDirName,
  readPortfolioLifecycle, within,
} from '@rad-orchestration/work-graph';
import type { NodeId, PortfolioLifecycle, Project, ProjectState } from '@rad-orchestration/work-graph';
import { defineCommand } from '../../framework/command.js';
import { UserError } from '../../framework/errors.js';
import type { CommandContext } from '../../framework/context.js';
import { userDataPaths } from '../../lib/paths.js';
import { isProjectDirName } from '../../lib/project-name.js';
import type { GraphPort } from './graph-port.js';
import { workGraphAdapter } from './graph-port.js';
import type { FsReads, PortfolioDocRole } from './identity.js';
import { PORTFOLIO_DOC_ROLES, docPaths, findRootDir, resolveGroupByValue } from './identity.js';

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
  status: PortfolioLifecycle | null; // root-document frontmatter
  root: { project: string; dir: string; doc: string };
  docs: Record<PortfolioDocRole, { path: string; exists: boolean }>;
  iterations: PortfolioIteration[];
}

// ── Resolution ──────────────────────────────────────────────────────────────

export interface Resolved {
  base: string;
  rootProjectId: NodeId;    // also the bare root directory name
  group: NodeId | null;
  members: Project[];
}

/**
 * Resolve `value` as a group (name or id) first, then as a base name. Null when
 * neither holds — the caller turns that into the `user_error` that callers such as
 * the debrief skill read as "this is not a portfolio".
 *
 * Exported for the sibling verbs in this module, which resolve the same way. It
 * carries no path guard: `--portfolio` becomes a path segment in every caller, so
 * each one rejects separators and traversal in its own body before calling here.
 * When called from `portfolioShow`, pass the graph to avoid a redundant call.
 */
export function resolvePortfolio(opts: PortfolioShowOptions, graph?: ReturnType<typeof opts.port.getGraph>): Resolved | null {
  const { projectsDir, portfolio: value, port } = opts;

  const group = resolveGroupByValue(port.listGroups(), value);
  if (group) {
    const members = port.listMembers(group.id);
    for (const p of members) {
      // `p.id` is the bare directory name; `p.dir` is absolute, and feeding that to
      // either naming predicate makes it false for every member.
      const base = portfolioBaseFromRootDir(p.id);
      if (base !== null && isPortfolioRootDir(projectsDir, p.id, opts.fs)) {
        return { base, rootProjectId: p.id, group: group.id, members };
      }
    }
    // A group holding no root document is not a portfolio, but `value` may still be
    // a legitimate base name — fall through rather than fail here.
  }

  const rootDir = findRootDir(projectsDir, value, opts.fs);
  if (rootDir === null) return null;
  const base = portfolioBaseFromRootDir(rootDir);
  if (base === null) return null;

  const resolvedGraph = graph ?? port.getGraph();
  const containing = resolvedGraph.edges.find(
    (e) => e.type === 'contains' && e.to === rootDir && isGroupId(e.from),
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
 * The iteration's lifecycle, derived here so no skill has to compute it.
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
 * document paths. Throws `UserError` when `--portfolio` names no portfolio.
 */
export function portfolioShow(opts: PortfolioShowOptions): PortfolioShowResult {
  const value = opts.portfolio;
  // The value becomes a path segment further down — reject separators and traversal
  // before that happens, never by sanitizing the string into something else.
  if (value.includes('/') || value.includes('\\') || value.includes('..') || path.isAbsolute(value)) {
    throw new UserError(`--portfolio must be a plain portfolio or group name, not a path (got "${value}")`);
  }

  const graph = opts.port.getGraph();
  const resolved = resolvePortfolio(opts, graph);
  if (resolved === null) {
    const dir = portfolioRootDirName(value);
    throw new UserError(
      `No portfolio named '${value}' — no group matches '${value}' and ${dir}/${dir}.md does not exist.`,
    );
  }

  const rootDir = resolved.rootProjectId;
  if (!isProjectDirName(rootDir)) {
    throw new UserError(`Portfolio '${resolved.base}' resolved to "${rootDir}", which is not a valid project directory name.`);
  }
  const rootPath = path.join(opts.projectsDir, rootDir);
  if (!within(opts.projectsDir, rootPath)) {
    throw new UserError(`Portfolio '${resolved.base}' resolved to "${rootDir}", which is outside ${opts.projectsDir}.`);
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
    status: readPortfolioLifecycle(paths.root, opts.fs),
    root: { project: rootDir, dir: rootPath, doc: paths.root },
    docs,
    iterations,
  };
}

function renderPortfolioCard(result: PortfolioShowResult): string {
  const lines = [
    `${result.name}\t${result.status ?? '-'}\t${result.group ?? '-'}`,
    `dir\t${result.root.dir}`,
    'DOCS',
    ...PORTFOLIO_DOC_ROLES.map((role) => `  ${role}\t${result.docs[role].exists ? 'present' : 'missing'}\t${result.docs[role].path}`),
    'ITERATIONS',
  ];
  if (result.iterations.length === 0) lines.push('  (none)');
  else lines.push(...result.iterations.map((i) => `  ${i.name}\t${i.derivedStatus}\t${i.state}`));
  return lines.join('\n');
}

// ── Default-wired entry ─────────────────────────────────────────────────────

export function portfolioShowWithDefaults(args: { portfolio: string }): PortfolioShowResult {
  const paths = userDataPaths();
  return portfolioShow({
    projectsDir: paths.projects,
    portfolio: args.portfolio,
    port: workGraphAdapter({ root: paths.root, worktreesDir: paths.worktrees }),
    fs: {
      exists: (p) => fs.existsSync(p),
      readFile: (p) => { try { return fs.readFileSync(p, 'utf-8'); } catch { return ''; } },
      readDirNames: (p) => { try { return fs.readdirSync(p); } catch { return []; } },
      isDirectory: (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } },
    },
  });
}

// ── Command definition ──────────────────────────────────────────────────────

interface Args { portfolio?: string }

export const portfolioShowCommand = defineCommand({
  name: 'portfolio-show',
  description: 'Show one portfolio: status, all five document paths, and every iteration with derived status',
  args: {
    portfolio: { description: 'Portfolio base name or its group name/id; case-insensitive', required: true },
  },
  flags: {},
  handler: async ({ args, ctx }: { args: Args; flags: Record<string, never>; ctx: CommandContext }) => {
    if (!args.portfolio) throw new UserError('--portfolio is required');
    const result = portfolioShowWithDefaults({ portfolio: args.portfolio });
    if (!ctx.ux.json) ctx.stderr.write(renderPortfolioCard(result) + '\n');
    return result;
  },
});

import fs from 'node:fs';
import { isGroupId, listPortfolios, PORTFOLIO_LIFECYCLE_VALUES } from '@rad-orchestration/work-graph';
import type { Group, PortfolioLifecycle } from '@rad-orchestration/work-graph';
import { defineCommand } from '../../framework/command.js';
import { UserError } from '../../framework/errors.js';
import type { CommandContext } from '../../framework/context.js';
import { userDataPaths } from '../../lib/paths.js';
import { isProjectDirName } from '../../lib/project-name.js';
import type { GraphPort } from './graph-port.js';
import { workGraphAdapter } from './graph-port.js';
import type { FsReads } from './identity.js';

// ── Types ───────────────────────────────────────────────────────────────────

export interface PortfolioListOptions {
  projectsDir: string;
  status?: string;          // raw flag value, validated here
  port: GraphPort;
  fs: FsReads;
}

export interface PortfolioListEntry {
  name: string;             // base name
  group: string | null;     // 'group:portfolio'; null when no contains edge points at the root dir
  dir: string;              // absolute path to {base}-ROOT
  root: string;             // absolute path to the root document
  status: PortfolioLifecycle | null;
  description: string | null;
}

export interface PortfolioListResult {
  portfolios: PortfolioListEntry[];
}

// ── Core logic ────────────────────────────────────────────────────────────────

/**
 * List every portfolio under `projectsDir` with its group, lifecycle status, and
 * description. Exactly one `port.getGraph()` composition serves the whole call —
 * the group↔project mapping lives in the graph, so that scan is unavoidable, but
 * it is never multiplied per candidate directory.
 */
export function portfolioList(opts: PortfolioListOptions): PortfolioListResult {
  if (opts.status !== undefined && !(PORTFOLIO_LIFECYCLE_VALUES as readonly string[]).includes(opts.status)) {
    throw new UserError(`--status must be one of: ${PORTFOLIO_LIFECYCLE_VALUES.join(', ')} (got "${opts.status}")`);
  }

  const candidates = listPortfolios(opts.projectsDir, opts.fs).filter((p) => isProjectDirName(p.rootProject));

  const graph = opts.port.getGraph();
  const groupByProjectId = new Map<string, string>();
  for (const e of graph.edges) {
    if (e.type === 'contains' && isGroupId(e.from)) groupByProjectId.set(e.to, e.from);
  }
  const descriptionByGroupId = new Map<string, string>();
  for (const n of graph.nodes.filter((n): n is Group => n.kind === 'group')) {
    descriptionByGroupId.set(n.id, n.description);
  }

  const portfolios: PortfolioListEntry[] = candidates.map((ref) => {
    const group = groupByProjectId.get(ref.rootProject) ?? null;
    return {
      name: ref.name,
      group,
      dir: ref.dir,
      root: ref.rootDoc,
      status: ref.status,
      description: group ? (descriptionByGroupId.get(group) ?? null) : null,
    };
  });

  return {
    portfolios: opts.status === undefined ? portfolios : portfolios.filter((p) => p.status === opts.status),
  };
}

function renderPortfolioTable(portfolios: PortfolioListEntry[]): string {
  const rows = portfolios.map((p) => `${p.name}\t${p.status ?? '-'}\t${p.group ?? '-'}\t${p.description ?? '-'}`);
  return ['NAME\tSTATUS\tGROUP\tDESCRIPTION', ...rows].join('\n');
}

// ── Default-wired entry ──────────────────────────────────────────────────────

export function portfolioListWithDefaults(args: { status?: string }): PortfolioListResult {
  const paths = userDataPaths();
  return portfolioList({
    projectsDir: paths.projects,
    status: args.status,
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

interface Flags { status?: string }

export const portfolioListCommand = defineCommand({
  name: 'portfolio-list',
  description: 'List portfolios with their group, lifecycle status, and description',
  args: {},
  flags: {
    status: { description: 'Filter by lifecycle status: active, on-hold, or done', type: 'string' as const },
  },
  handler: async ({ flags, ctx }: { args: Record<string, never>; flags: Flags; ctx: CommandContext }) => {
    const result = portfolioListWithDefaults({ status: flags.status });
    if (!ctx.ux.json) ctx.stderr.write(renderPortfolioTable(result.portfolios) + '\n');
    return result;
  },
});

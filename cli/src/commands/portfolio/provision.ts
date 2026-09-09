import fs from 'node:fs';
import path from 'node:path';
import { portfolioRootDirName, within } from '@rad-orchestration/work-graph';
import { defineCommand } from '../../framework/command.js';
import { SystemError, UserError } from '../../framework/errors.js';
import type { CommandContext } from '../../framework/context.js';
import { userDataPaths } from '../../lib/paths.js';
import { isProjectDirName } from '../../lib/project-name.js';
import { describeRollback, errorMessage } from './create.js';
import type { RollbackStep } from './create.js';
import type { GraphPort } from './graph-port.js';
import { workGraphAdapter } from './graph-port.js';
import type { FsReads } from './identity.js';
import { resolvePortfolio } from './show.js';

// ── Types ───────────────────────────────────────────────────────────────────

export interface PortfolioProvisionOptions {
  portfolio: string;              // base name, group name, or group id — case-insensitive
  iteration: string;              // a plain project name; becomes a directory
  dependsOn: string[];            // already split and trimmed; [] when none
  projectsDir: string;
  port: GraphPort;
  fs: FsReads;                    // directory existence is read through `fs.exists`
  mkdir: (p: string) => void;
  rmdir: (p: string) => void;
}

export type DependencyStatus = 'recorded' | 'already-present' | 'unresolved' | 'self';

export interface DependencyOutcome {
  target: string;
  status: DependencyStatus;
  detail: string | null;          // why it did not record; null when status is 'recorded'
}

export interface PortfolioProvisionResult {
  portfolio: string;              // resolved base name
  group: string;                  // 'group:portfolio'
  iteration: string;              // the project id, which is also the bare directory name
  dir: string;                    // absolute path
  dirCreated: boolean;            // false when the directory already existed
  membership: { status: 'recorded' | 'already-present'; rev: number | null };
  dependencies: DependencyOutcome[];
  // A revision is only ever observed as a write's return value — the port exposes no
  // reader — so a fully idempotent re-run has none to report. `null` says "nothing
  // changed" instead of inventing a number.
  rev: number | null;
  unresolved: string[];           // the targets to re-run for later; [] when none
}

// ── Core logic ──────────────────────────────────────────────────────────────

/** `--depends-on` is one comma-separated value: `FlagSpec` has no array type. */
export function splitDependsOn(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(',').map((entry) => entry.trim()).filter((entry) => entry.length > 0);
}

function rejectPathLike(label: string, value: string): void {
  if (value.includes('/') || value.includes('\\') || value.includes('..') || path.isAbsolute(value)) {
    throw new UserError(`${label} must be a plain name, not a path (got "${value}").`);
  }
}

/** Rollback that undid nothing must say so — `describeRollback([])` would read as a clean unwind. */
function describeUndo(steps: RollbackStep[]): string {
  if (steps.length === 0) return 'nothing to roll back — this call created neither the directory nor the membership';
  return describeRollback(steps);
}

/**
 * Provision one iteration of a portfolio: its directory, its membership of the
 * portfolio's group, and a `depends-on` edge per named target that resolves.
 *
 * Everything is validated and every dependency classified against a single graph
 * snapshot before the first write, so each remaining write failure is a genuine one
 * and no code path has to read an outcome out of a rejection message. A target that
 * names no project yet is reported in `unresolved` and is **not** a failure —
 * iterations are named in one order and provisioned in another.
 *
 * Rollback undoes only what this call performed: a re-run that fails leaves the
 * pre-existing directory and membership exactly where it found them.
 */
export function portfolioProvision(opts: PortfolioProvisionOptions): PortfolioProvisionResult {
  const { portfolio, iteration, dependsOn, projectsDir, port, mkdir, rmdir } = opts;

  if (!portfolio.trim()) {
    throw new UserError('--portfolio is required and must be non-empty.');
  }
  if (!iteration.trim()) {
    throw new UserError('--iteration is required and must be non-empty.');
  }

  // Both values become path segments further down. `--portfolio` inherits no guard
  // from the shared resolver — the sibling verbs each carry their own copy.
  rejectPathLike('--portfolio', portfolio);
  rejectPathLike('--iteration', iteration);

  if (!isProjectDirName(iteration)) {
    throw new UserError(`--iteration "${iteration}" is not a valid project directory name — use A-Z, 0-9, '.' and '-', starting with a letter or digit.`);
  }

  const dirPath = path.join(projectsDir, iteration);
  if (!within(projectsDir, dirPath)) {
    throw new UserError(`--iteration "${iteration}" resolves outside ${projectsDir}.`);
  }

  // Step 1 — one snapshot, taken before any write. Every decision below is made
  // from it, so no write failure has to be told apart from a duplicate or a
  // missing node by string-matching a rejection message.
  const graph = port.getGraph();
  const resolved = resolvePortfolio({ projectsDir, portfolio, port, fs: opts.fs }, graph);
  if (resolved === null) {
    const rootDir = portfolioRootDirName(portfolio);
    throw new UserError(
      `No portfolio named '${portfolio}' — no group matches '${portfolio}' and ${rootDir}/${rootDir}.md does not exist.`,
    );
  }
  if (resolved.group === null) {
    throw new UserError(
      `Portfolio '${resolved.base}' has no group, so '${iteration}' cannot be registered as a member — create the group first.`,
    );
  }
  const groupId = resolved.group;

  const alreadyMember = resolved.members.some((m) => m.id === iteration);
  const hasDependsOn = (target: string): boolean => graph.edges.some(
    (e) => e.type === 'depends-on' && e.from === iteration && e.to === target,
  );
  const isProject = (target: string): boolean => graph.nodes.some(
    (n) => n.kind === 'project' && n.id === target,
  );

  const classify = (target: string): DependencyOutcome => {
    if (target === iteration) return { target, status: 'self', detail: 'an iteration cannot depend on itself' };
    if (hasDependsOn(target)) return { target, status: 'already-present', detail: `${iteration} already depends on ${target}` };
    if (!isProject(target)) {
      return { target, status: 'unresolved', detail: `no project '${target}' exists yet — provision it, then re-run to record this edge` };
    }
    return { target, status: 'recorded', detail: null };
  };
  // A target named twice in one call is one edge, and classifying it twice would
  // send the second write into the graph as a duplicate — a rejection that rolls
  // back the whole provision over a repeated name.
  const targets = [...new Set(dependsOn)];
  const plan = targets.map(classify);

  // Step 2 — mkdir. Forced ahead of every graph write: a project node exists only
  // because its directory does.
  const dirCreated = !opts.fs.exists(dirPath);
  if (dirCreated) {
    try {
      mkdir(dirPath);
    } catch (e) {
      throw new SystemError(`Failed to create ${iteration}/: ${errorMessage(e)}`);
    }
  }

  const rollbackDir = (): RollbackStep => {
    try {
      rmdir(dirPath);
      return { label: `${iteration}/`, ok: true };
    } catch (e) {
      return { label: `${iteration}/`, ok: false, reason: errorMessage(e) };
    }
  };

  const rollbackMembership = (): RollbackStep => {
    const label = `${iteration} from ${groupId}`;
    try {
      const result = port.removeMember(groupId, iteration);
      return result.ok ? { label, ok: true } : { label, ok: false, reason: result.error.message };
    } catch (e) {
      return { label, ok: false, reason: errorMessage(e) };
    }
  };

  let membershipRecorded = false;
  // The undo list is built from what this call actually performed, never from what
  // the happy path would have performed — on a re-run both artifacts predate the
  // call and removing either would destroy a live iteration.
  const undo = (): RollbackStep[] => {
    const steps: RollbackStep[] = [];
    if (membershipRecorded) steps.push(rollbackMembership());
    if (dirCreated) steps.push(rollbackDir());
    return steps;
  };

  // Step 3 — addMember, skipped entirely when step 1 already saw the membership.
  let membershipRev: number | null = null;
  if (!alreadyMember) {
    let result: ReturnType<GraphPort['addMember']>;
    try {
      result = port.addMember(groupId, iteration);
    } catch (e) {
      throw new SystemError(`Failed to add ${iteration} to ${groupId}; ${describeUndo(undo())}. ${errorMessage(e)}`);
    }
    if (!result.ok) {
      const message = `Failed to add ${iteration} to ${groupId}; ${describeUndo(undo())}. ${result.error.message}`;
      throw result.error.code === 'validation' ? new UserError(message) : new SystemError(message);
    }
    membershipRecorded = true;
    membershipRev = result.data.rev;
  }

  // Step 4 — one edge per target step 1 classified as recordable.
  let rev: number | null = membershipRev;
  for (const outcome of plan) {
    if (outcome.status !== 'recorded') continue;
    let result: ReturnType<GraphPort['recordDependency']>;
    try {
      result = port.recordDependency(iteration, outcome.target);
    } catch (e) {
      throw new SystemError(
        `Failed to record ${iteration} depends-on ${outcome.target}; ${describeUndo(undo())}. ${errorMessage(e)}`,
      );
    }
    if (!result.ok) {
      const message = `Failed to record ${iteration} depends-on ${outcome.target}; ${describeUndo(undo())}. ${result.error.message}`;
      throw result.error.code === 'validation' ? new UserError(message) : new SystemError(message);
    }
    rev = result.data.rev;
  }

  return {
    portfolio: resolved.base,
    group: groupId,
    iteration,
    dir: dirPath,
    dirCreated,
    membership: { status: alreadyMember ? 'already-present' : 'recorded', rev: membershipRev },
    dependencies: plan,
    rev,
    unresolved: plan.filter((d) => d.status === 'unresolved').map((d) => d.target),
  };
}

// ── Default-wired entry ─────────────────────────────────────────────────────

export function portfolioProvisionWithDefaults(
  args: { portfolio: string; iteration: string; dependsOn: string[] },
): PortfolioProvisionResult {
  const paths = userDataPaths();
  return portfolioProvision({
    portfolio: args.portfolio,
    iteration: args.iteration,
    dependsOn: args.dependsOn,
    projectsDir: paths.projects,
    port: workGraphAdapter({ root: paths.root, worktreesDir: paths.worktrees }),
    fs: {
      exists: (p) => fs.existsSync(p),
      readFile: (p) => { try { return fs.readFileSync(p, 'utf-8'); } catch { return ''; } },
      readDirNames: (p) => { try { return fs.readdirSync(p); } catch { return []; } },
      isDirectory: (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } },
    },
    mkdir: (p) => fs.mkdirSync(p),
    rmdir: (p) => fs.rmSync(p, { recursive: true, force: true }),
  });
}

// ── Command definition ──────────────────────────────────────────────────────

interface Args { portfolio?: string; iteration?: string }
interface Flags { 'depends-on'?: string }

function renderSummary(result: PortfolioProvisionResult): string {
  const recorded = result.dependencies.filter((d) => d.status === 'recorded').length;
  const parts = [
    `✓ provisioned ${result.iteration} in ${result.portfolio} (rev ${result.rev ?? 'unchanged'})`,
    `${result.dirCreated ? 'created' : 'kept'} ${result.dir}`,
    `membership ${result.membership.status}`,
    `${recorded} of ${result.dependencies.length} dependencies recorded`,
  ];
  if (result.unresolved.length > 0) parts.push(`unresolved: ${result.unresolved.join(', ')}`);
  return parts.join(', ');
}

export const portfolioProvisionCommand = defineCommand({
  name: 'portfolio-provision',
  description: 'Provision a portfolio iteration: its directory, group membership, and dependencies',
  args: {
    portfolio: { description: 'Portfolio base name or its group name/id; case-insensitive (required)', required: true },
    iteration: { description: "The iteration's project id, not its human-readable name in the timeline; SCREAMING-CASE, becomes a directory under projects (required)", required: true },
  },
  flags: {
    'depends-on': { description: 'Comma-separated project ids this one depends on, not their human-readable iteration names; defaults to none', type: 'string' as const },
  },
  handler: async ({ args, flags, ctx }: { args: Args; flags: Flags; ctx: CommandContext }) => {
    if (!args.portfolio) throw new UserError('--portfolio is required');
    if (!args.iteration) throw new UserError('--iteration is required');
    const result = portfolioProvisionWithDefaults({
      portfolio: args.portfolio,
      iteration: args.iteration,
      dependsOn: splitDependsOn(flags['depends-on']),
    });
    if (!ctx.ux.json) ctx.stderr.write(renderSummary(result) + '\n');
    return result;
  },
});

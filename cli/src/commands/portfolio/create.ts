import fs from 'node:fs';
import path from 'node:path';
import { portfolioRootDirName, within } from '@rad-orchestration/work-graph';
import { defineCommand } from '../../framework/command.js';
import { SystemError, UserError } from '../../framework/errors.js';
import type { CommandContext } from '../../framework/context.js';
import { userDataPaths } from '../../lib/paths.js';
import type { GraphPort } from './graph-port.js';
import { workGraphAdapter } from './graph-port.js';
import { docPaths, resolveGroupByValue, validatePortfolioName } from './identity.js';
import type { PortfolioDocRole } from './identity.js';

// ── Types ───────────────────────────────────────────────────────────────────

export interface PortfolioCreateOptions {
  base: string;
  description: string;
  projectsDir: string;
  port: GraphPort;
  exists: (p: string) => boolean;
  mkdir: (p: string) => void;
  rmdir: (p: string) => void;
}

export interface PortfolioCreateResult {
  name: string;                                   // 'PORTFOLIO'
  group: string;                                  // 'group:portfolio'
  rev: number;                                    // revision after the FINAL graph write (addMember)
  dir: string;                                    // absolute path to PORTFOLIO-ROOT
  docs: Record<PortfolioDocRole, string>;         // all five absolute paths
  write: PortfolioDocRole[];                      // exactly ['root', 'decisions']
}

// ── Core logic ────────────────────────────────────────────────────────────────

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** One rollback step's real outcome — an artifact removed, or one that wasn't. */
export type RollbackStep = { label: string; ok: true } | { label: string; ok: false; reason: string };

/**
 * Renders what rollback actually did, so the thrown message never claims a clean
 * rollback it didn't perform. Every step is named either way — "removed X" or
 * "FAILED to remove X (reason)" — so the operator knows exactly what to clean up
 * by hand when a step didn't undo.
 *
 * Shared with the sibling verbs in this module, which unwind their own writes the
 * same way. Never called with an empty step list — a caller with nothing to undo
 * says so in its own words rather than claiming a rollback it never performed.
 */
export function describeRollback(steps: RollbackStep[]): string {
  const parts = steps.map((s) => (s.ok ? `removed ${s.label}` : `FAILED to remove ${s.label} (${s.reason})`));
  const verdict = steps.every((s) => s.ok) ? 'rolled back' : 'rollback incomplete';
  return `${verdict} — ${parts.join(', ')}`;
}

/**
 * Provision a portfolio's directory, group, and membership edge in one call.
 * Everything is validated before the first write; on any failure the completed
 * writes are undone in reverse before throwing. Rollback happens either way —
 * `error.code` alone decides whether the throw is a `UserError` (the operator's
 * input is at fault) or a `SystemError` (nothing they supplied is wrong).
 * Writes no document files; the five paths are returned for the caller to author.
 */
export function portfolioCreate(opts: PortfolioCreateOptions): PortfolioCreateResult {
  const { base, description, projectsDir, port, exists, mkdir, rmdir } = opts;

  if (!description.trim()) {
    throw new UserError('--description is required and must be non-empty.');
  }

  const nameCheck = validatePortfolioName(base);
  if (!nameCheck.ok) {
    throw new UserError(nameCheck.message);
  }

  if (base.includes('/') || base.includes('\\') || base.includes('..') || path.isAbsolute(base)) {
    throw new UserError(`--portfolio must be a plain name, not a path (got "${base}").`);
  }

  const dirName = portfolioRootDirName(base);
  const dirPath = path.join(projectsDir, dirName);
  if (!within(projectsDir, dirPath)) {
    throw new UserError(`--portfolio "${base}" resolves outside ${projectsDir}.`);
  }

  if (exists(dirPath)) {
    throw new UserError(`${dirName}/ already exists at ${dirPath} — a portfolio named '${base}' already has a directory.`);
  }

  const collidingGroup = resolveGroupByValue(port.listGroups(), base);
  if (collidingGroup) {
    throw new UserError(`A group matching '${base}' already exists (${collidingGroup.id}) — choose a different --portfolio name.`);
  }

  const rollbackDir = (): RollbackStep => {
    try {
      rmdir(dirPath);
      return { label: `${dirName}/`, ok: true };
    } catch (e) {
      return { label: `${dirName}/`, ok: false, reason: errorMessage(e) };
    }
  };

  // Step 1 — mkdir. Forced first: a project node exists only because its directory
  // does, so it must exist before addMember's projectExists check can pass.
  try {
    mkdir(dirPath);
  } catch (e) {
    throw new SystemError(`Failed to create ${dirName}/: ${errorMessage(e)}`);
  }

  // Step 2 — createGroup.
  let groupResult: ReturnType<GraphPort['createGroup']>;
  try {
    groupResult = port.createGroup(base, description);
  } catch (e) {
    const rollback = describeRollback([rollbackDir()]);
    throw new SystemError(
      `Failed to create group:${base.toLowerCase()} after creating ${dirName}/; ${rollback}. Portfolio was not created. ${errorMessage(e)}`,
    );
  }
  if (!groupResult.ok) {
    const rollback = describeRollback([rollbackDir()]);
    const message = `Failed to create group:${base.toLowerCase()} after creating ${dirName}/; ${rollback}. Portfolio was not created. ${groupResult.error.message}`;
    throw groupResult.error.code === 'validation' ? new UserError(message) : new SystemError(message);
  }

  const groupId = groupResult.data.node.id;

  const rollbackGroupAndDir = (): RollbackStep[] => {
    const steps: RollbackStep[] = [];
    try {
      const result = port.removeMember(groupId, dirName);
      steps.push(result.ok ? { label: 'the edge', ok: true } : { label: 'the edge', ok: false, reason: result.error.message });
    } catch (e) {
      steps.push({ label: 'the edge', ok: false, reason: errorMessage(e) });
    }
    try {
      const result = port.deleteGroup(groupId);
      steps.push(result.ok ? { label: groupId, ok: true } : { label: groupId, ok: false, reason: result.error.message });
    } catch (e) {
      steps.push({ label: groupId, ok: false, reason: errorMessage(e) });
    }
    steps.push(rollbackDir());
    return steps;
  };

  // Step 3 — addMember. Only reachable once the directory (step 1) and group
  // (step 2) both exist, matching the forced write order.
  let memberResult: ReturnType<GraphPort['addMember']>;
  try {
    memberResult = port.addMember(groupId, dirName);
  } catch (e) {
    const rollback = describeRollback(rollbackGroupAndDir());
    throw new SystemError(
      `Failed to add ${dirName} to ${groupId} after creating ${dirName}/ and ${groupId}; ${rollback}. Portfolio was not created. ${errorMessage(e)}`,
    );
  }
  if (!memberResult.ok) {
    const rollback = describeRollback(rollbackGroupAndDir());
    const message = `Failed to add ${dirName} to ${groupId} after creating ${dirName}/ and ${groupId}; ${rollback}. Portfolio was not created. ${memberResult.error.message}`;
    throw memberResult.error.code === 'validation' ? new UserError(message) : new SystemError(message);
  }

  return {
    name: base,
    group: groupId,
    rev: memberResult.data.rev,
    dir: dirPath,
    docs: docPaths(projectsDir, base),
    write: ['root', 'decisions'],
  };
}

// ── Default-wired entry ──────────────────────────────────────────────────────

export function portfolioCreateWithDefaults(args: { base: string; description: string }): PortfolioCreateResult {
  const paths = userDataPaths();
  return portfolioCreate({
    base: args.base,
    description: args.description,
    projectsDir: paths.projects,
    port: workGraphAdapter({ root: paths.root, worktreesDir: paths.worktrees }),
    exists: (p) => fs.existsSync(p),
    mkdir: (p) => fs.mkdirSync(p),
    rmdir: (p) => fs.rmSync(p, { recursive: true, force: true }),
  });
}

// ── Command definition ──────────────────────────────────────────────────────

interface Args { portfolio?: string }
interface Flags { description?: string }

export const portfolioCreateCommand = defineCommand({
  name: 'portfolio-create',
  description: 'Create a portfolio: its root project directory, its group, and the edge between them',
  args: {
    portfolio: { description: 'Portfolio base name, SCREAMING-CASE, no -ROOT suffix (the CLI adds it)', required: true },
  },
  flags: {
    description: { description: 'One sentence on what this initiative is for (required)', type: 'string' as const },
  },
  handler: async ({ args, flags, ctx }: { args: Args; flags: Flags; ctx: CommandContext }) => {
    if (!args.portfolio) throw new UserError('--portfolio is required');
    const result = portfolioCreateWithDefaults({ base: args.portfolio, description: flags.description ?? '' });
    if (!ctx.ux.json) ctx.stderr.write(`✓ created ${result.group} (rev ${result.rev})\n`);
    return result;
  },
});

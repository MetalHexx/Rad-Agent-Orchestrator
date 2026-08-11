/**
 * execute prepare — idempotent provision + seal + plan approval.
 *
 * Composes the exported `provisionWorktrees` and `sourceControlInit` library
 * functions (via their default-wired entries) into the single "settle" step the
 * `/rad-execute` skill runs before driving the pipeline. Idempotent: an existing
 * worktree is a no-op for provisioning, and re-running re-derives identical
 * source-control state — so it unifies the launch path (creates worktrees) and
 * the in-place path (worktrees already exist, just seal).
 *
 * It also confers plan approval: invoking `/rad-execute` IS the human approval
 * act, so prepare marks the Master Plan approved on every path (launch and
 * in-place alike) — the skill no longer carries a separate `gate approve plan`
 * beat. Approval is best-effort and idempotent (an already-approved gate is a
 * no-op; a hiccup degrades to the pipeline's normal plan gate). It never invokes
 * another CLI command; it calls the underlying lib functions directly.
 */

import fs from 'node:fs';
import path from 'node:path';
import { defineCommand } from '../../framework/command.js';
import { UserError } from '../../framework/errors.js';
import type { CommandContext } from '../../framework/context.js';
import { userDataPaths } from '../../lib/paths.js';
import { readProjectReposDefault } from '../../lib/project-repos.js';
import { provisionWorktreesWithDefaults } from '../worktree/create.js';
import type { ProvisionWorktreesResult } from '../worktree/create.js';
import { sourceControlInitWithDefaults, resolveAutoCommit, resolveAutoPr } from '../source-control/index.js';
import type { SourceControlInitResult } from '../source-control/init.js';
import { sideProjectInit as sideProjectInitFn } from '../side-project/index.js';
import type { SideProjectInitResult } from '../side-project/init.js';
import { runApprovePlan } from '../gate/approve-plan.js';
import type { PipelineResult } from '../../lib/pipeline-engine/types.js';

// ── Types ───────────────────────────────────────────────────────────────────

export interface ExecutePrepareOptions {
  project: string;
  worktreeName?: string;
  repo?: string;
  /** Bind to the operator's existing clone instead of provisioning a workspace. */
  inPlace?: boolean;
  /** Branch the project's pull request targets; defaults to the repo's registered default. */
  baseBranch?: string;
  /** The branch the operator confirmed at offer time (in-place mode); re-verified live at seal. */
  branch?: string;
  autoCommit: 'always' | 'never';
  autoPr: 'always' | 'never';
  readProjectRepos: (project: string) => { repos: string[]; projectType: 'standard' | 'side-project' };
  provision: (args: { project: string; worktreeName?: string; repo?: string }) => ProvisionWorktreesResult;
  /** Does the side-project's local repo already exist on disk? */
  sideProjectExists: (project: string) => boolean;
  /** Provision a side-project's isolated local repo (git init + seed). Not idempotent. */
  sideProjectInit: (project: string) => SideProjectInitResult;
  seal: (args: {
    project: string;
    worktreeName?: string;
    inPlace?: boolean;
    baseBranch?: string;
    branch?: string;
    autoCommit: 'always' | 'never';
    autoPr: 'always' | 'never';
  }) => SourceControlInitResult;
  /** Confer plan approval (running /rad-execute IS the approval). Idempotent. */
  approvePlan: () => Promise<PipelineResult>;
}

export interface ExecutePrepareResult {
  /** null for a side-project (worktrees never provisioned). */
  provisioned: ProvisionWorktreesResult | null;
  /** Side-project provisioning result; null for a standard project, or when the side-project repo already existed. */
  sideProjectInit?: SideProjectInitResult | null;
  /** null when a hard provisioning failure stopped the run before sealing. */
  sealed: SourceControlInitResult | null;
  /** Plan-approval result; null when approval was not attempted (the seal failed). */
  planApproved?: PipelineResult | null;
}

// ── Core logic ────────────────────────────────────────────────────────────────

export async function executePrepare(opts: ExecutePrepareOptions): Promise<ExecutePrepareResult> {
  const { projectType } = opts.readProjectRepos(opts.project);

  let provisioned: ProvisionWorktreesResult | null = null;
  let sideInit: SideProjectInitResult | null = null;

  if (projectType === 'side-project') {
    // Side-projects live in an isolated local repo under the side-projects dir.
    // Provision it once (git init + seed) — guarded, because side-project init
    // is NOT idempotent (git init fails on an existing repo). A re-run skips it
    // and just re-seals, keeping prepare idempotent.
    if (!opts.sideProjectExists(opts.project)) {
      sideInit = opts.sideProjectInit(opts.project);
      if (!sideInit.created) {
        return { provisioned: null, sideProjectInit: sideInit, sealed: null };
      }
    }
  } else if (opts.inPlace) {
    // In-place: the clone already exists on disk — no provisioning at all, just seal.
  } else {
    provisioned = opts.provision({ project: opts.project, worktreeName: opts.worktreeName, repo: opts.repo });
    // A hard provisioning failure must stop before sealing — the seal reads each
    // worktree's branch from disk and would fail loud on a missing worktree.
    if (provisioned.repos.some((r) => r.error != null)) {
      return { provisioned, sealed: null };
    }
  }

  const sealed = opts.seal({
    project: opts.project,
    worktreeName: opts.worktreeName,
    inPlace: opts.inPlace,
    baseBranch: opts.baseBranch,
    branch: opts.branch,
    autoCommit: opts.autoCommit,
    autoPr: opts.autoPr,
  });

  // Running /rad-execute confers plan approval. Seal must land first — approval
  // reads the same state.json the seal just wrote — and we skip it when the seal
  // failed. Best-effort: an approval hiccup degrades to the pipeline's normal
  // plan gate, so it never fails prepare.
  let planApproved: PipelineResult | null = null;
  if (sealed.ok) {
    planApproved = await opts.approvePlan();
  }

  return { provisioned, sideProjectInit: sideInit, sealed, planApproved };
}

// ── Command definition ──────────────────────────────────────────────────────

interface PrepareArgs { project?: string; 'worktree-name'?: string; repo?: string }
interface PrepareFlags { 'auto-commit'?: string; 'auto-pr'?: string; 'in-place'?: boolean; 'base-branch'?: string; branch?: string }

export const executePrepareCommand = defineCommand({
  name: 'execute-prepare',
  description: 'Provision worktrees and seal source-control state for a project (idempotent)',
  args: {
    project: { description: 'Project name; selects the master plan whose repos: list is provisioned and sealed', required: true },
    'worktree-name': { description: 'Override the worktree folder name (defaults to the project name)' },
    repo: { description: 'Scope provisioning to a single repo within the project set' },
  },
  flags: {
    'auto-commit': { description: 'Resolved auto-commit preference (always|never)', type: 'string' },
    'auto-pr': { description: 'Resolved auto-PR preference (always|never)', type: 'string' },
    'in-place': { description: 'Bind the project to the operator\'s existing clone instead of provisioning a workspace' },
    'base-branch': { description: 'Branch the project\'s pull request targets; defaults to the repo\'s registered default', type: 'string' },
    branch: { description: 'The branch confirmed at offer time (in-place mode); the clone\'s live branch must still match, or nothing is sealed', type: 'string' },
  },
  handler: async ({ args, flags }: { args: PrepareArgs; flags: PrepareFlags; ctx: CommandContext }) => {
    if (!args.project) throw new UserError('--project is required');
    // Planning docs + state.json always live under projects/<P> (even for a
    // side-project, whose code repo lives elsewhere) — so this is the dir the
    // plan-approval engine reads, independent of any worktree.
    const projectDir = path.join(userDataPaths().projects, args.project);
    return executePrepare({
      project: args.project,
      worktreeName: args['worktree-name'],
      repo: args.repo,
      inPlace: flags['in-place'],
      baseBranch: flags['base-branch'],
      branch: flags.branch,
      autoCommit: resolveAutoCommit(flags['auto-commit']),
      autoPr: resolveAutoPr(flags['auto-pr']),
      readProjectRepos: readProjectReposDefault,
      provision: provisionWorktreesWithDefaults,
      sideProjectExists: (project) => fs.existsSync(path.join(userDataPaths().sideProjects, project, '.git')),
      sideProjectInit: (project) => sideProjectInitFn({ project, root: userDataPaths().root }),
      seal: sourceControlInitWithDefaults,
      approvePlan: () => runApprovePlan({ projectDir }),
    });
  },
  // Precedence: side-project init / provision hard error (exit 2, system_error)
  // → seal failure (exit 1, user_error) → success (exit 0, or 1 when a worktree
  // could not push).
  mapResult: (r: ExecutePrepareResult) => {
    if (r.sideProjectInit && !r.sideProjectInit.created) {
      return { ok: false as const, error: { type: 'system_error' as const, message: `Side-project init failed: ${r.sideProjectInit.error ?? 'unknown error'}` } };
    }
    if (r.provisioned && r.provisioned.repos.some((x) => x.error != null)) {
      const firstErr = r.provisioned.repos.find((x) => x.error != null)?.error ?? 'worktree provisioning failed';
      return { ok: false as const, error: { type: 'system_error' as const, message: `Worktree provisioning failed: ${firstErr}` } };
    }
    if (!r.sealed || !r.sealed.ok) {
      const message = r.sealed && !r.sealed.ok ? r.sealed.error : 'source-control seal did not run';
      return { ok: false as const, error: { type: 'user_error' as const, message } };
    }
    const warnings: string[] = [];
    const notPushed = r.provisioned ? r.provisioned.repos.some((x) => x.created && !x.pushed) : false;
    if (notPushed) warnings.push('One or more worktrees were created but could not be pushed to origin.');
    // Approval is best-effort: a failure is a soft degradation (the pipeline will
    // request approval normally), so it warns but does not change the exit code.
    if (r.planApproved?.error) warnings.push(`Plan auto-approval did not apply (${r.planApproved.error.message}); the pipeline will request approval normally.`);
    return {
      ok: true as const,
      data: r,
      exit_code: notPushed ? 1 : 0,
      ...(warnings.length ? { warnings } : {}),
    };
  },
});

/**
 * execute resolve — read-only run-mode classifier and advisor.
 *
 * Classifies where the operator is standing (main clone, worktree, side-project,
 * nowhere), resolves the target project, and emits a DATA envelope the thin
 * `/rad-execute` skill relays: the run mode, which questions are genuine forks,
 * the derived worktree convention, and the ordered `next` commands to run. It
 * never writes state and never invokes another command.
 *
 * Decision order:
 *   1. every repo a standard project targets must be registered AND bound to a
 *      local path — an unregistered repo cannot be recognized from any location,
 *      so this stop is checked before anything location-dependent.
 *   2. project TYPE — a side-project is isolated (`~/.radorc/side-projects/<name>`)
 *      with a fixed layout, and follows the same location-vs-started shape as any
 *      other project: in place when standing inside it, a launch into it otherwise.
 *   3. a recorded CLONE BINDING — a project bound to the operator's own clone has
 *      no workspace at all, so it resumes or launches into that clone (re-verified
 *      on every resumption) and none of the workspace logic applies.
 *   4. then, for a standard project, LOCATION vs SETTLED-NESS:
 *      - standing in the project's own worktree (the workspace folder itself, or a
 *        repo worktree beneath it) always runs in place — resume when settled (no
 *        prepare), an in-place confirm otherwise;
 *      - a SETTLED project named from anywhere else launches a fresh session into
 *        its recorded workspace folder, asking no recorded-answer question;
 *      - an UNSETTLED single-repo project named from inside that repo's clone, on a
 *        non-default branch, is offered a binding to the clone (a multi-repo project
 *        in the same spot stops — the model has to be explained, not worked around);
 *      - an UNSETTLED project named from anywhere else either launches fully
 *        questioned (no worktree at all) or offers to reuse a DIFFERENT project's
 *        worktree it is standing in (the follow-up / correction path).
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { defineCommand } from '../../framework/command.js';
import { UserError } from '../../framework/errors.js';
import type { CommandContext } from '../../framework/context.js';
import { userDataPaths } from '../../lib/paths.js';
import { readConfig } from '../config/index.js';
import { readProjectReposDefault } from '../../lib/project-repos.js';
import { resolveAutoCommit, resolveAutoPr } from '../source-control/index.js';
import type { SourceControlState } from '../source-control/state-shape.js';
import { deriveWorktreeConvention } from '../../lib/worktree-convention.js';
import { readCloneFacts, type CloneFacts } from '../../lib/clone-facts.js';
import { WorkGraphService } from '@rad-orchestration/work-graph';
import { readRegistry } from '@rad-orchestration/repo-registry';
import type { Project, Tier, NodeStatus, LocateResult } from '@rad-orchestration/work-graph';

// ── Types ───────────────────────────────────────────────────────────────────

export type RunMode = 'launch' | 'in-place' | 'resume' | 'unknown';

export interface ResolveCandidate {
  name: string;
  tier: Tier | null;
  status: NodeStatus;
}
export interface ResolveDerivedRepo {
  repo: string;
  base: string;
  worktreePath: string;
}
export interface ResolveDerived {
  branch: string;
  /** Parent dir an agent launches into (above the per-repo worktrees). */
  launchDir: string;
  repos: ResolveDerivedRepo[];
  /**
   * The worktree set's folder name: the reused project's name on the reuse
   * path, or the recorded name read back from state on a settled (resume or
   * launch) path.
   */
  worktreeName?: string;
  /**
   * Repos missing from disk: the reused set's gaps on the reuse path, or the
   * repos a settled path found missing and rebuilt.
   */
  missingRepos?: string[];
}
/** A question is asked ONLY when its key is present — i.e. a genuine fork. */
export interface ResolveAsk {
  launchFlavor?: boolean;
  autoCommit?: boolean;
  autoPr?: boolean;
  /** "you're in <other>'s worktree — reuse it for <this>?" (cross-project reuse). */
  reuseWorktree?: boolean;
  /** "you're in <this>'s worktree — run here?" (standard, own worktree, unsettled). */
  confirmHere?: boolean;
  /** "<project> is already marked done — run again?" */
  confirmDone?: boolean;
  /** "you're on <branch> in <repo>'s clone — bind <project> here and run on it?" */
  bindClone?: boolean;
}
/**
 * The clone a project is being offered a binding to. A sibling of `derived`
 * rather than a field inside it: `derived` describes layout, this describes
 * the offer the operator is answering.
 */
export interface ResolveCloneBinding {
  repo: string;
  clonePath: string;
  /** The branch checked out in that clone right now. */
  branch: string;
  /** The repo's registered default branch, proposed as the pull-request target; the operator may correct it. */
  proposedBase: string;
  /** Uncommitted + untracked entries, capped at 10 for display. */
  dirtyPaths: string[];
  /** True total, so the skill can render "…and N more". */
  dirtyCount: number;
}
export interface ExecuteResolveResult {
  runMode: RunMode;
  project: string | null;
  /** Project data dir (`~/.radorc/projects/<project>`); null when no project is resolved. */
  projectDir: string | null;
  /** Set on `unknown` — a human-readable explanation the skill relays verbatim. */
  reason?: string;
  /** Set when no project could be resolved — the skill picks one and re-resolves. */
  needsProject?: boolean;
  candidates?: ResolveCandidate[];
  ask: ResolveAsk;
  derived: ResolveDerived | null;
  /** Set only on the clone-binding offer — the facts the operator confirms against. */
  cloneBinding?: ResolveCloneBinding;
  /** Ordered bare radorch subcommands; the skill prepends the call-form. */
  next: string[];
  /** Operator-facing lines the skill relays verbatim before running `next`. */
  notices?: string[];
}

/**
 * Recorded `pipeline.source_control` facts read back from a settled project's
 * `state.json`. Deliberately narrower than the on-disk `SourceControlState`:
 * settled paths never emit an `execute prepare` command, so `auto_commit` /
 * `auto_pr` have no consumer here and are left off this projection.
 */
export interface RecordedSourceControl {
  worktreeName: string;
  /** `inPlace` marks a repo bound to the operator's own clone rather than a provisioned worktree. */
  repos: { name: string; branch: string; inPlace: boolean }[];
}

export interface ExecuteResolveDeps {
  cwd: string;
  project?: string;
  locate: (cwd: string) => LocateResult;
  listProjects: () => Project[];
  readProjectRepos: (project: string) => { repos: string[]; projectType: 'standard' | 'side-project' };
  readConfig: () => { autoCommit: string; autoPr: string };
  defaultBranch: (repo: string) => string;
  /** Read-only check: does `<worktreesDir>/<worktreeName>/<repo>` exist on disk? */
  worktreeExists: (worktreeName: string, repo: string) => boolean;
  /** Read-only check: is the project's plan_approval_gate already completed? */
  planApproved: (projectDir: string) => boolean;
  worktreesDir: string;
  sideProjectsDir: string;
  /** Is the process that invoked this resolution running under Claude Code? */
  isClaudeHarness: () => boolean;
  /** Recorded `pipeline.source_control` facts; null when unreadable or absent. */
  recordedSourceControl: (projectDir: string) => RecordedSourceControl | null;
  /** Live git facts for a registered repo's main clone; null when the repo has no bound local path. */
  cloneFacts: (repo: string) => CloneFacts | null;
  /** Registry standing for a repo — drives the two distinct unregistered-repo messages. */
  repoStanding: (repo: string) => 'unknown' | 'unbound' | 'bound';
}

// ── Harness detection ────────────────────────────────────────────────────────

/**
 * True when the current process is running under Claude Code: `CLAUDECODE` is a
 * non-empty string, or any env key matches `CLAUDE_CODE_*`. `CLAUDE_PLUGIN_ROOT`
 * is deliberately NOT a marker — Copilot in VS Code injects that same variable
 * for plugins authored in Claude format, and Copilot CLI injects
 * `COPILOT_PLUGIN_ROOT`. These are the exact markers `worktree/launch.ts` strips
 * from a spawned agent's env, which is the evidence they mark a Claude Code
 * process. No marker present → false, a safe degradation to asking the operator.
 */
export function isClaudeCodeHarness(env: NodeJS.ProcessEnv): boolean {
  if (typeof env.CLAUDECODE === 'string' && env.CLAUDECODE !== '') return true;
  return Object.keys(env).some((key) => /^CLAUDE_CODE_/.test(key));
}

// ── Core logic ────────────────────────────────────────────────────────────────

function unknown(project: string | null, reason: string): ExecuteResolveResult {
  return { runMode: 'unknown', project, projectDir: null, reason, ask: {}, derived: null, next: [] };
}

/**
 * Rebuild-and-tell: checks each repo the project needs against disk under the
 * recorded worktree name. When any is missing, returns the unscoped rebuild
 * command (provisioning skips repos already present, so it heals only the
 * gap) and a notice naming the affected repos. A folder present on disk but
 * pruned from git's worktree metadata is out of scope and is not detected.
 */
function rebuildIfMissing(
  deps: Pick<ExecuteResolveDeps, 'worktreeExists'>,
  projectName: string,
  worktreeName: string,
  repos: string[],
): { rebuild: { command: string; notice: string } | null; missingRepos: string[] } {
  const missingRepos = repos.filter((r) => !deps.worktreeExists(worktreeName, r));
  if (missingRepos.length === 0) return { rebuild: null, missingRepos };
  return {
    rebuild: {
      command: `worktree create --project ${projectName} --worktree-name ${worktreeName}`,
      notice:
        `The repo worktree(s) for ${missingRepos.join(', ')} are missing from the workspace folder and will be recreated rather than resumed. ` +
        'Any uncommitted work that lived only there is unrecoverable; committed work on the branch will remain intact.',
    },
    missingRepos,
  };
}

export function executeResolve(deps: ExecuteResolveDeps): ExecuteResolveResult {
  const locate = deps.locate(deps.cwd);
  const allProjects = deps.listProjects();

  // Eligibility = has a Master Plan AND not done. Approval is deliberately
  // ignored here — running this skill CONFERS approval (prepare on launch/in-place,
  // a `gate approve plan` step on resume), so an unapproved plan is still eligible.
  const candidates: ResolveCandidate[] = allProjects
    .filter((p) => p.docs.masterPlan != null && p.status !== 'done')
    .map((p) => ({ name: p.name, tier: p.tier, status: p.status }));

  const inWorktree = locate.kind === 'worktree';
  const inSideProject = locate.kind === 'side-project';
  const cwdProjects: string[] = inWorktree
    ? (locate.projects ?? [])
    : (inSideProject && locate.worktree_name ? [locate.worktree_name] : []);

  // 1. Resolve the target project: --project → single cwd match → unresolved.
  let projectName: string | null = null;
  if (deps.project) {
    projectName = deps.project;
  } else if (cwdProjects.length === 1) {
    projectName = cwdProjects[0] ?? null;
  }

  // 2. No project resolved.
  if (!projectName) {
    if (inWorktree && cwdProjects.length === 0) {
      return unknown(null, 'This worktree directory does not correspond to any known project under ~/.radorc/projects.');
    }
    const runMode: RunMode = locate.kind === 'main-clone' || locate.kind === 'none' ? 'launch' : 'in-place';
    return { runMode, project: null, projectDir: null, needsProject: true, candidates, ask: {}, derived: null, next: [] };
  }

  // 3. The resolved project must exist on disk.
  const node = allProjects.find((p) => p.name === projectName) ?? null;
  if (!node) {
    return unknown(
      projectName,
      `Project "${projectName}" was not found under ~/.radorc/projects. Run /rad-brainstorm or /rad-plan ${projectName} to create it.`,
    );
  }

  // 4. Eligibility gate: a Master Plan is required to execute.
  if (node.docs.masterPlan == null) {
    return unknown(projectName, `Project "${projectName}" has no Master Plan yet. Run /rad-plan ${projectName} before executing.`);
  }

  // 5. Read repos + project type (drive the derived layout and the type-first fork).
  let repos: string[];
  let projectType: 'standard' | 'side-project';
  try {
    const r = deps.readProjectRepos(projectName);
    repos = r.repos;
    projectType = r.projectType;
  } catch (e) {
    return unknown(projectName, e instanceof Error ? e.message : String(e));
  }

  // 5b. EVERY TARGETED REPO MUST BE KNOWN AND BOUND. Checked here, ahead of any
  //     location-dependent branch, because recognizing a directory as a repo's
  //     clone WORKS BY matching it against the registry — an unregistered repo is
  //     therefore invisible to every location check below, exactly where it
  //     matters most. It also wins over the multi-repo clone stop: a repo the
  //     system cannot see makes that stop's explanation unactionable. A
  //     side-project's single pseudo-repo is its own name and unregistered by
  //     design, so it is exempt.
  if (projectType === 'standard') {
    for (const repo of repos) {
      const standing = deps.repoStanding(repo);
      if (standing === 'unknown') {
        return unknown(
          projectName,
          `Project "${projectName}" targets repo "${repo}", which is not in the repo registry. Run /rad-repo to register "${repo}", then run this again.`,
        );
      }
      if (standing === 'unbound') {
        return unknown(
          projectName,
          `Project "${projectName}" targets repo "${repo}", which is registered but has no local clone bound on this machine. Run /rad-repo to bind "${repo}" to a local path, then run this again.`,
        );
      }
    }
  }

  const config = deps.readConfig();
  const isSettled = node.sourceControlInitialized;
  const projectDir = node.dir;
  const ask: ResolveAsk = {};

  // A re-run of an already-completed project is usually a slip — warn once.
  if (node.status === 'done') ask.confirmDone = true;

  // 6. TYPE — a side-project is isolated under the side-projects dir on a fixed
  //    'main' branch and is never provisioned as a worktree, so its layout is
  //    the same from everywhere. WHERE the session runs still follows the same
  //    location-vs-started shape every other project uses. Its binding is fixed,
  //    so it never asks the commit/PR questions.
  if (projectType === 'side-project') {
    const launchDir = path.join(deps.sideProjectsDir, projectName);
    const derived: ResolveDerived = {
      branch: 'main',
      launchDir,
      repos: [{ repo: repos[0] ?? projectName, base: 'main', worktreePath: launchDir }],
    };
    const next: string[] = [];

    // Standing inside it → run here, mirroring 7a: silent resume when settled,
    // a "run here?" confirm otherwise.
    if (locate.kind === 'side-project' && locate.worktree_name === projectName) {
      const runMode: RunMode = isSettled ? 'resume' : 'in-place';
      if (runMode === 'in-place') {
        ask.confirmHere = true;
        next.push(`execute prepare --project ${projectName}`);
      } else if (!deps.planApproved(projectDir)) {
        // Resume skips prepare (already settled), so it must carry approval itself —
        // but only when the gate isn't already completed (re-firing would regress tier).
        next.push(`gate approve plan --project-dir "${projectDir}"`);
      }
      next.push(`pipeline signal --event start --project-dir "${projectDir}"`);
      return { runMode, project: projectName, projectDir, ask, derived, next };
    }

    // Named from anywhere else → open a session in the side-project's own dir.
    // Unsettled must prepare FIRST: the side-project's repository does not exist
    // until prepare creates it, so the terminal cannot open there first.
    // Neither arm goes through rebuildIfMissing — that helper probes the worktree
    // convention, which a side-project never has, and would emit a spurious
    // rebuild command plus a lost-work notice about a project that lost nothing.
    if (!isSettled) next.push(`execute prepare --project ${projectName}`);
    if (!deps.isClaudeHarness()) ask.launchFlavor = true;
    const agent = deps.isClaudeHarness() ? 'claude' : '{flavor}';
    next.push(`worktree launch --agent ${agent} --worktree-path "${launchDir}" --prompt "/rad-execute ${projectName}"`);
    return { runMode: 'launch', project: projectName, projectDir, ask, derived, next };
  }

  // 7. STANDARD — classify by location vs settled-ness. Commit/PR strings are
  //    pre-substituted once here; whether they are genuine forks (config ask)
  //    is decided per-branch, exactly where a prepare command consumes them.
  const ac = config.autoCommit === 'ask' ? '{ac}' : resolveAutoCommit(config.autoCommit);
  const ap = config.autoPr === 'ask' ? '{ap}' : resolveAutoPr(config.autoPr);
  const sameProject = inWorktree && (locate.projects ?? []).includes(projectName);

  // 7-pre. A RECORDED CLONE BINDING OUTRANKS EVERY WORKSPACE BRANCH. The project
  //        runs in the operator's own clone; there is no workspace folder, so
  //        nothing below applies — and nothing here may reach rebuildIfMissing,
  //        which would probe a workspace that never existed and warn about
  //        uncommitted work that was never lost.
  //
  //        The clone is outside the system's control between sessions: it can be
  //        deleted, or switched to another branch, or moved back onto the repo's
  //        default branch. Re-verify all three before continuing, and say plainly
  //        what changed when one fails.
  const boundRepo = isSettled ? (deps.recordedSourceControl(projectDir)?.repos.find((r) => r.inPlace) ?? null) : null;
  if (boundRepo) {
    const facts = deps.cloneFacts(boundRepo.name);
    const repoDefault = deps.defaultBranch(boundRepo.name);
    if (!facts || !facts.exists) {
      return unknown(
        projectName,
        `Project "${projectName}" runs in repo "${boundRepo.name}"'s local clone, but that clone is no longer there${facts ? ` (${facts.path})` : ''}. Re-bind the repo with /rad-repo, then run this again.`,
      );
    }
    if (facts.branch !== boundRepo.branch) {
      return unknown(
        projectName,
        `Project "${projectName}" is recorded on branch "${boundRepo.branch}" in repo "${boundRepo.name}"'s clone, but that clone now has "${facts.branch ?? '(unknown)'}" checked out. Check out "${boundRepo.branch}" there, then run this again.`,
      );
    }
    if (facts.branch === repoDefault) {
      return unknown(
        projectName,
        `Project "${projectName}" is recorded on branch "${boundRepo.branch}" in repo "${boundRepo.name}"'s clone, which is now the repo's default branch. A project cannot run on "${repoDefault}".`,
      );
    }

    const derived: ResolveDerived = {
      branch: boundRepo.branch,
      launchDir: facts.path,
      repos: [{ repo: boundRepo.name, base: repoDefault, worktreePath: facts.path }],
    };
    // Standing in that clone → resume right here.
    if (locate.kind === 'main-clone' && locate.repo === boundRepo.name) {
      const next: string[] = [];
      if (!deps.planApproved(projectDir)) next.push(`gate approve plan --project-dir "${projectDir}"`);
      next.push(`pipeline signal --event start --project-dir "${projectDir}"`);
      return { runMode: 'resume', project: projectName, projectDir, ask, derived, next };
    }
    // Anywhere else → launch into the clone. A project runs where it is bound;
    // the operator confirmed that location when the binding was made, so opening
    // a session there is not a new adoption and asks nothing beyond the flavor.
    if (!deps.isClaudeHarness()) ask.launchFlavor = true;
    const agent = deps.isClaudeHarness() ? 'claude' : '{flavor}';
    return {
      runMode: 'launch',
      project: projectName,
      projectDir,
      ask,
      derived,
      next: [`worktree launch --agent ${agent} --worktree-path "${facts.path}" --prompt "/rad-execute ${projectName}"`],
    };
  }

  // 7a. LOCATION WINS — standing in this project's own worktree (the workspace
  //     folder itself, or a repo worktree beneath it) always runs in place:
  //     silent resume (rebuilding any repo missing from disk) when settled, a
  //     "run here?" confirm otherwise.
  if (sameProject) {
    const runMode: RunMode = isSettled ? 'resume' : 'in-place';
    const next: string[] = [];
    let derived: ResolveDerived;
    let notices: string[] | undefined;

    if (runMode === 'resume') {
      const rec = deps.recordedSourceControl(projectDir);
      const wtName = rec?.worktreeName ?? projectName;
      const base = deriveWorktreeConvention({ worktreeName: wtName, repos, worktreesDir: deps.worktreesDir, defaultBranch: deps.defaultBranch });
      const { rebuild, missingRepos } = rebuildIfMissing(deps, projectName, wtName, repos);
      derived = { ...base, branch: rec?.repos[0]?.branch ?? base.branch, worktreeName: wtName, missingRepos };
      if (rebuild) {
        next.push(rebuild.command);
        notices = [rebuild.notice];
      }
      // Resume carries approval itself (no prepare here), unless already approved.
      if (!deps.planApproved(projectDir)) next.push(`gate approve plan --project-dir "${projectDir}"`);
    } else {
      const wtName = locate.worktree_name ?? projectName;
      const base = deriveWorktreeConvention({ worktreeName: wtName, repos, worktreesDir: deps.worktreesDir, defaultBranch: deps.defaultBranch });
      derived = { ...base, branch: locate.branch ?? base.branch };
      ask.confirmHere = true;
      if (config.autoCommit === 'ask') ask.autoCommit = true;
      if (config.autoPr === 'ask') ask.autoPr = true;
      next.push(`execute prepare --project ${projectName} --auto-commit ${ac} --auto-pr ${ap}`);
    }
    next.push(`pipeline signal --event start --project-dir "${projectDir}"`);
    return { runMode, project: projectName, projectDir, ask, derived, next, ...(notices ? { notices } : {}) };
  }

  // 7b. A SETTLED project named from anywhere else launches without
  //     interrogation: no autoCommit/autoPr/reuseWorktree question, no prepare
  //     step, no permission-mode flag (the CLI's own default applies). The
  //     fresh session re-enters the skill inside the workspace folder, lands
  //     in 7a, and confers approval there.
  if (isSettled) {
    const rec = deps.recordedSourceControl(projectDir);
    const wtName = rec?.worktreeName ?? projectName;
    const base = deriveWorktreeConvention({ worktreeName: wtName, repos, worktreesDir: deps.worktreesDir, defaultBranch: deps.defaultBranch });
    const { rebuild, missingRepos } = rebuildIfMissing(deps, projectName, wtName, repos);
    const derived: ResolveDerived = { ...base, branch: rec?.repos[0]?.branch ?? base.branch, worktreeName: wtName, missingRepos };
    const next: string[] = [];
    let notices: string[] | undefined;
    if (rebuild) {
      next.push(rebuild.command);
      notices = [rebuild.notice];
    }
    if (!deps.isClaudeHarness()) ask.launchFlavor = true;
    const agent = deps.isClaudeHarness() ? 'claude' : '{flavor}';
    next.push(`worktree launch --agent ${agent} --worktree-path "${derived.launchDir}" --prompt "/rad-execute ${projectName}"`);
    return { runMode: 'launch', project: projectName, projectDir, ask, derived, next, ...(notices ? { notices } : {}) };
  }

  // 7c. UNSETTLED, and not in this project's own worktree — keep today's paths.

  // Standing in a repo's main clone, on a branch that is not that repo's
  // default, naming a project this clone is part of. The offer and the stop fire
  // on the same situation and differ only in how many repos the project spans.
  //
  // The carve-outs fall out of these conditions rather than needing their own
  // code, and each one widened breaks working behavior: an already-started
  // project never reaches here (7a/7b claimed it); a clone the project does not
  // target fails the membership test and stays an ordinary launch; a clone on
  // the repo's default branch fails `onNonDefault` and still gets its own
  // separate workspace on its own branch.
  const cloneRepo = locate.kind === 'main-clone' ? (locate.repo ?? null) : null;
  const standingFacts = cloneRepo != null ? deps.cloneFacts(cloneRepo) : null;
  const cloneBranch = standingFacts?.branch ?? null;
  const onNonDefault = cloneRepo != null && cloneBranch != null && cloneBranch !== deps.defaultBranch(cloneRepo);

  if (cloneRepo != null && standingFacts != null && cloneBranch != null && onNonDefault) {
    if (repos.length === 1 && repos[0] === cloneRepo) {
      const proposedBase = deps.defaultBranch(cloneRepo);
      ask.bindClone = true;
      if (config.autoCommit === 'ask') ask.autoCommit = true;
      if (config.autoPr === 'ask') ask.autoPr = true;
      const derived: ResolveDerived = {
        branch: cloneBranch,
        launchDir: standingFacts.path,
        repos: [{ repo: cloneRepo, base: proposedBase, worktreePath: standingFacts.path }],
      };
      const cloneBinding: ResolveCloneBinding = {
        repo: cloneRepo,
        clonePath: standingFacts.path,
        branch: cloneBranch,
        proposedBase,
        dirtyPaths: standingFacts.dirty.slice(0, 10),
        dirtyCount: standingFacts.dirty.length,
      };
      // `{base}` stays a literal placeholder: the pull-request target is always
      // part of the confirmation the operator is answering, so the skill
      // substitutes it inside the quotes it finds. `--branch` carries the
      // branch already read here, verbatim — the clone is live and outside
      // this system's control between this offer and the seal that follows
      // it, so the seal step re-checks it still matches rather than trusting
      // whatever happens to be checked out by the time it runs.
      const next = [
        `execute prepare --project ${projectName} --in-place --base-branch "{base}" --branch "${cloneBranch}" --auto-commit ${ac} --auto-pr ${ap}`,
        `pipeline signal --event start --project-dir "${projectDir}"`,
      ];
      return { runMode: 'in-place', project: projectName, projectDir, ask, derived, cloneBinding, next };
    }
    if (repos.length > 1 && repos.includes(cloneRepo)) {
      return unknown(
        projectName,
        `Project "${projectName}" spans ${repos.join(', ')}, and you are standing in "${cloneRepo}"'s clone on "${cloneBranch}" — not its default branch, which is what triggered this stop instead of an ordinary launch. A project that spans more than one repo cannot be bound to a single clone — it runs in a workspace that holds a worktree per repo. See the multi-repo explanation in /rad-repo, then run this again on "${cloneRepo}"'s default branch, from outside "${cloneRepo}", or name a single-repo project.`,
      );
    }
  }

  // Not in a real worktree at all (main clone / nowhere / standing in some
  // side-project dir) → launch a fresh worktree + session, fully questioned.
  if (!inWorktree) {
    if (!deps.isClaudeHarness()) ask.launchFlavor = true;
    if (config.autoCommit === 'ask') ask.autoCommit = true;
    if (config.autoPr === 'ask') ask.autoPr = true;
    const derived = deriveWorktreeConvention({ worktreeName: projectName, repos, worktreesDir: deps.worktreesDir, defaultBranch: deps.defaultBranch });
    const agent = deps.isClaudeHarness() ? 'claude' : '{flavor}';
    const next = [
      `execute prepare --project ${projectName} --auto-commit ${ac} --auto-pr ${ap}`,
      `worktree launch --agent ${agent} --worktree-path "${derived.launchDir}" --prompt "/rad-execute ${projectName}"`,
    ];
    return { runMode: 'launch', project: projectName, projectDir, ask, derived, next };
  }

  // In a DIFFERENT project's worktree → offer to reuse it for this project
  // (the follow-up / correction path). Inherit the worktree's name + branch;
  // surface any repos this project needs that the reused set lacks.
  const reusedName = locate.worktree_name ?? projectName;
  const base = deriveWorktreeConvention({ worktreeName: reusedName, repos, worktreesDir: deps.worktreesDir, defaultBranch: deps.defaultBranch });
  const missingRepos = repos.filter((r) => !deps.worktreeExists(reusedName, r));
  const derived: ResolveDerived = {
    ...base,
    branch: locate.branch ?? base.branch,
    worktreeName: reusedName,
    missingRepos,
  };
  ask.reuseWorktree = true;
  if (config.autoCommit === 'ask') ask.autoCommit = true;
  if (config.autoPr === 'ask') ask.autoPr = true;
  const next = [
    `execute prepare --project ${projectName} --worktree-name ${reusedName} --auto-commit ${ac} --auto-pr ${ap}`,
    `pipeline signal --event start --project-dir "${projectDir}"`,
  ];
  return { runMode: 'in-place', project: projectName, projectDir, ask, derived, next };
}

// ── Command definition ──────────────────────────────────────────────────────

interface ResolveArgs { project?: string }

export const executeResolveCommand = defineCommand({
  name: 'execute-resolve',
  description: 'Classify the run mode for executing a project and advise the next steps (read-only)',
  args: {
    project: { description: 'Project to execute; omit to resolve from the current directory or list eligible projects' },
  },
  flags: {},
  handler: async ({ args }: { args: ResolveArgs; ctx: CommandContext }) => {
    const paths = userDataPaths();
    // A REAL git exec — locate() needs `git worktree list` to read the branch and
    // confirm existence (unlike session-context's no-op exec).
    const exec = (file: string, execArgs: string[], opts: { cwd?: string }): string =>
      execFileSync(file, execArgs, { cwd: opts.cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }) as unknown as string;
    const svc = new WorkGraphService({ root: paths.root, worktreesDir: paths.worktrees, sideProjectsDir: paths.sideProjects, exec });
    const registry = readRegistry({ root: paths.root });
    return executeResolve({
      cwd: process.cwd(),
      project: args.project,
      locate: (cwd) => svc.locate(cwd),
      listProjects: () => svc.listProjects(),
      readProjectRepos: readProjectReposDefault,
      // RAW config strings — preserves 'ask' so the skill knows to ask.
      readConfig: () => readConfig({ root: paths.root }),
      defaultBranch: (repo) => {
        const b = registry.repos[repo]?.default_branch;
        if (!b) throw new UserError(`Repo "${repo}" has no registered default branch. Run \`radorch repo add\` or \`radorch repo edit\`.`);
        return b;
      },
      worktreeExists: (worktreeName, repo) => fs.existsSync(path.join(paths.worktrees, worktreeName, repo)),
      planApproved: (projectDir) => {
        try {
          const s = JSON.parse(fs.readFileSync(path.join(projectDir, 'state.json'), 'utf8')) as { graph?: { nodes?: { plan_approval_gate?: { status?: string } } } };
          return s.graph?.nodes?.plan_approval_gate?.status === 'completed';
        } catch { return false; }
      },
      worktreesDir: paths.worktrees,
      sideProjectsDir: paths.sideProjects,
      isClaudeHarness: () => isClaudeCodeHarness(process.env),
      recordedSourceControl: (projectDir) => {
        try {
          const s = JSON.parse(fs.readFileSync(path.join(projectDir, 'state.json'), 'utf8')) as { pipeline?: { source_control?: SourceControlState } };
          const sc = s.pipeline?.source_control;
          if (!sc) return null;
          const worktreeName = typeof sc.worktree_name === 'string' && sc.worktree_name !== '' ? sc.worktree_name : path.basename(projectDir);
          return {
            worktreeName,
            repos: sc.repos.map((r) => ({ name: r.name, branch: r.branch, inPlace: r.in_place === true })),
          };
        } catch { return null; }
      },
      cloneFacts: (repo) => readCloneFacts(repo, { registryLocalPaths: registry.localPaths }),
      repoStanding: (repo) => (!registry.repos[repo] ? 'unknown' : registry.localPaths[repo] ? 'bound' : 'unbound'),
    });
  },
  mapResult: (r: ExecuteResolveResult) => ({ ok: true as const, data: r }),
});

/**
 * `radorch amendment validate` — the check that runs before anything is written.
 *
 * An amendment can add, revise, or drop phases and tasks — it is not merely
 * additive — and has no regeneration to fall back on, so validation is the
 * safety property rather than a convenience, and its report is the operator's
 * review surface before `apply` commits. The verb is a thin wrapper: read state
 * and the Master Plan, parse both documents, compute the frontier, call
 * `buildMergePlan`, and map the outcome onto the envelope. It writes nothing,
 * ever — `apply` calls the same core, which is what keeps "validate first" from
 * becoming a second implementation of validation.
 *
 * No parse state is persisted. Planning writes its last parse error to state
 * because explosion runs as a pipeline action whose author may be a fresh
 * context; amendment validation runs inside the skill session and hands the
 * error straight back to the main agent, who authored the document and now
 * fixes it inline, with `amendment status`'s frontier snapshot already in
 * hand, and re-runs against the fixed file only when a fault still surfaces
 * here.
 */

import fs from 'node:fs';
import path from 'node:path';
import { defineCommand } from '../../framework/command.js';
import { UserError } from '../../framework/errors.js';
import type { CommandContext } from '../../framework/context.js';
import { parseMasterPlan, ParseError } from '../../lib/explode-master-plan.js';
import type { ParsedMasterPlan } from '../../lib/explode-master-plan.js';
import { guardAmendmentPath, parseAmendment } from '../../lib/amendment/parse.js';
import { resolveProjectName } from '../../lib/amendment/apply.js';
import { computeFrontier } from '../../lib/amendment/frontier.js';
import type { PipelineState } from '../../lib/amendment/frontier.js';
import { buildMergePlan } from '../../lib/amendment/merge-check.js';
import type { AmendmentMergePlan, MergeError } from '../../lib/amendment/merge-check.js';
import { resolveInstallRoot } from '../../lib/paths.js';
import { toRelativeDocPath } from '../../lib/plan-emitters.js';
import { projectDocUrl } from '../../lib/ui-address.js';

export type AmendmentValidateResult =
  | { type: 'report'; plan: AmendmentMergePlan; document: { path: string; url: string } }
  | { type: 'invalid'; error: MergeError }
  | { type: 'blocked'; blocked: { haltedNode: string; reason: string; message: string } }
  | { type: 'real_error'; message: string };

export interface AmendmentValidateOptions {
  projectDir: string;
  amendmentPath: string;
}

/**
 * Reject an obviously-malformed trailing path segment on `--project-dir`
 * (a traversal token, a separator, or an absolute override) — nothing more.
 * Unlike `plan resolve`'s `--project <name>`, which this command's flag shape
 * deliberately mirrors in spirit, `--project-dir` here is a full path supplied
 * directly by the caller and is never joined against a canonical projects root,
 * so this check cannot by itself contain where the path points.
 */
export function guardProjectDir(projectDir: string): void {
  const name = path.basename(projectDir);
  if (name.includes('/') || name.includes('\\') || name === '..' || path.isAbsolute(name)) {
    throw new UserError(
      `--project-dir must end in a plain project name, not a traversal segment (got "${projectDir}")`,
    );
  }
}

export function amendmentValidate(opts: AmendmentValidateOptions): AmendmentValidateResult {
  guardProjectDir(opts.projectDir);

  let state: PipelineState;
  try {
    state = readState(opts.projectDir);
  } catch (err) {
    return { type: 'real_error', message: messageOf(err) };
  }

  // The project name comes off state, so the guard cannot run before this read —
  // but it does run before the amendment document is opened.
  const projectName = resolveProjectName(opts.projectDir, state);
  guardAmendmentPath(opts.amendmentPath, opts.projectDir, projectName);

  const masterPlanPath = resolveMasterPlanPath(opts.projectDir, state);
  if (masterPlanPath === null) {
    return {
      type: 'real_error',
      message: `No Master Plan recorded at graph.nodes.master_plan.doc_path in ${path.join(opts.projectDir, 'state.json')} — there is nothing to amend`,
    };
  }

  let existing: ParsedMasterPlan;
  try {
    existing = parseMasterPlan(masterPlanPath);
  } catch (err) {
    // A ParseError raised here carries a line against the MASTER PLAN. Handing it
    // back as `invalid` would send the amendment's author to a line of a file they
    // did not write, so an unreadable plan surfaces as the fault it is.
    return {
      type: 'real_error',
      message: `Could not read the project's Master Plan at ${masterPlanPath}: ${messageOf(err)}`,
    };
  }

  try {
    const amendment = parseAmendment(opts.amendmentPath);
    const outcome = buildMergePlan({ existing, amendment, frontier: computeFrontier(state, existing), state });
    if (outcome.type === 'ok') {
      const docPath = toRelativeDocPath(opts.amendmentPath, opts.projectDir);
      const docUrl = projectDocUrl(resolveInstallRoot(), projectName, docPath);
      return { type: 'report', plan: outcome.plan, document: { path: docPath, url: docUrl } };
    }
    if (outcome.type === 'invalid') return { type: 'invalid', error: outcome.error };
    return { type: 'blocked', blocked: outcome.blocked };
  } catch (err) {
    if (err instanceof ParseError) return { type: 'invalid', error: err.toDetail() };
    return { type: 'real_error', message: messageOf(err) };
  }
}

function readState(projectDir: string): PipelineState {
  const statePath = path.join(projectDir, 'state.json');
  return JSON.parse(fs.readFileSync(statePath, 'utf-8')) as PipelineState;
}

function resolveMasterPlanPath(projectDir: string, state: PipelineState): string | null {
  const docPath = state.graph?.nodes?.['master_plan']?.doc_path;
  if (typeof docPath !== 'string' || docPath.length === 0) return null;
  return path.isAbsolute(docPath) ? docPath : path.join(projectDir, docPath);
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * The merge plan's `numbering` is a pair of `Map`s — the shape the writers that
 * consume it in-process want, but `JSON.stringify` renders a Map as `{}`. Widen
 * them to plain objects on the way onto the wire so the report the operator reads
 * is not silently empty.
 */
function toWireReport(plan: AmendmentMergePlan): Record<string, unknown> {
  return {
    ...plan,
    numbering: {
      phases: Object.fromEntries(plan.numbering.phases),
      tasks: Object.fromEntries(plan.numbering.tasks),
    },
  };
}

interface Args { 'project-dir'?: string; 'amendment'?: string }

export const amendmentValidateCommand = defineCommand({
  name: 'amendment-validate',
  description: 'Validate an amendment against the running plan and report the merge it would make',
  args: {
    'project-dir': {
      description: 'Absolute path to the project directory holding state.json and the Master Plan',
      required: true,
    },
    'amendment': {
      description: 'Absolute path to the amendment markdown document to validate',
      required: true,
    },
  },
  flags: {},
  handler: async ({ args }: { args: Args; ctx: CommandContext }) => {
    const projectDir = args['project-dir'];
    const amendmentPath = args['amendment'];
    if (!projectDir || !amendmentPath) throw new UserError('--project-dir and --amendment are both required');
    return amendmentValidate({ projectDir, amendmentPath });
  },
  mapResult: (r: AmendmentValidateResult) => {
    if (r.type === 'report') {
      return { ok: true, data: { report: toWireReport(r.plan), document: r.document }, exit_code: 0 };
    }
    if (r.type === 'invalid') {
      // An authoring problem is corrected and retried, so it stays on the ok side
      // with a structured line the author can jump to.
      return { ok: true, data: { error: r.error }, exit_code: 2 };
    }
    if (r.type === 'blocked') {
      // Neither a fault nor an authoring problem: the command did its job and the
      // answer is "this cannot be applied here". The caller relays the message and stops.
      return { ok: true, data: { blocked: r.blocked }, exit_code: 2 };
    }
    // exit_code is only honored when envelope.ok === true (see framework/command.ts);
    // system_error envelopes already resolve to ExitCode.SystemError (2).
    return { ok: false, error: { type: 'system_error' as const, message: r.message } };
  },
});

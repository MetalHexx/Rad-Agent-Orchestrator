/**
 * plan resolve — read-only planning classifier and advisor.
 *
 * Confirms a project has a Requirements doc to plan from, tells the skill which
 * questions are genuine forks (template tier, task size, audit depth), and emits
 * the ordered `next` commands to run. It never writes state and never invokes
 * another command — the direct analogue of `execute resolve`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { defineCommand } from '../../framework/command.js';
import { UserError } from '../../framework/errors.js';
import type { CommandContext } from '../../framework/context.js';
import { userDataPaths } from '../../lib/paths.js';

// ── Types ───────────────────────────────────────────────────────────────────

/** A question is asked ONLY when its key is present — i.e. a genuine fork. */
export interface PlanResolveAsk {
  /** No --template was supplied, so the tier is the operator's call. */
  template?: boolean;
  /** Always set on the success path — size is always the operator's call. */
  taskSize?: boolean;
  /** Always set on the success path — audit depth is always the operator's call. */
  audit?: boolean;
}

export interface PlanResolveResult {
  project: string;
  /** null when the project is not plannable. */
  projectDir: string | null;
  requirementsPath: string | null;
  /** Set when planning cannot proceed — the skill relays this verbatim and stops. */
  reason?: string;
  ask: PlanResolveAsk;
  /** Ordered bare radorch subcommands; the skill prepends the call-form. */
  next: string[];
}

export interface PlanResolveDeps {
  project: string;
  template?: string;
  projectsDir: string;
  fileExists: (p: string) => boolean;
}

// ── Template validation ──────────────────────────────────────────────────────

/**
 * Shipped template tiers. Custom templates under `~/.radorc/templates/` are
 * out of scope for this validator — it only guards the four shipped names.
 */
export const SHIPPED_TIERS = ['low', 'medium', 'high', 'extra-high'] as const;

export function validateTemplate(t: string | undefined): { ok: true; template?: string } | { ok: false; error: string } {
  if (t === undefined || t === '') return { ok: true };
  if (!(SHIPPED_TIERS as readonly string[]).includes(t)) {
    return { ok: false, error: `--template "${t}" is not a valid tier. Valid values: ${SHIPPED_TIERS.join(', ')}` };
  }
  return { ok: true, template: t };
}

// ── Core logic ────────────────────────────────────────────────────────────────

function halt(project: string, reason: string): PlanResolveResult {
  return { project, projectDir: null, requirementsPath: null, reason, ask: {}, next: [] };
}

export function planResolve(deps: PlanResolveDeps): PlanResolveResult {
  // --project is used to build a filesystem path — guard it before joining, or
  // path.join happily resolves outside ~/.radorc/projects/.
  if (
    deps.project.includes('/')
    || deps.project.includes('\\')
    || deps.project === '..'
    || path.isAbsolute(deps.project)
  ) {
    throw new UserError(`--project must be a plain project name, not a path (got "${deps.project}")`);
  }

  const projectDir = path.join(deps.projectsDir, deps.project);
  const requirementsPath = path.join(projectDir, `${deps.project}-REQUIREMENTS.md`);

  if (!deps.fileExists(requirementsPath)) {
    return halt(
      deps.project,
      `No requirements document at ${requirementsPath}. Run /rad-brainstorm ${deps.project} first to collaborate on goals and scribe the Requirements doc, then re-run /rad-plan ${deps.project}.`,
    );
  }

  const ask: PlanResolveAsk = { taskSize: true, audit: true };
  if (!deps.template) ask.template = true;

  // {size} is always left as a token — a custom sizing criterion arrives as
  // free-form multi-word prose, so it must stay double-quoted here or
  // runCommand's commander instance (no allowExcessArguments) will parse the
  // unquoted prose as excess arguments and die before the handler ever runs.
  const template = deps.template || '{template}';
  const next: string[] = [
    `plan prepare --project ${deps.project} --template ${template} --task-size "{size}"`,
    `pipeline signal --event start --project-dir "${projectDir}" --template ${template}`,
  ];

  return { project: deps.project, projectDir, requirementsPath, ask, next };
}

// ── Command definition ──────────────────────────────────────────────────────

interface PlanResolveArgs { project?: string; template?: string }

export const planResolveCommand = defineCommand({
  name: 'plan-resolve',
  description: 'Classify planning readiness for a project and advise the next steps',
  args: {
    project: { description: 'Project to plan', required: true },
    template: { description: 'Template tier to pre-select: low, medium, high, or extra-high; omit to let the operator choose' },
  },
  flags: {},
  handler: async ({ args }: { args: PlanResolveArgs; ctx: CommandContext }) => {
    if (!args.project) throw new UserError('--project is required');
    const validated = validateTemplate(args.template);
    if (!validated.ok) throw new UserError(validated.error);
    const paths = userDataPaths();
    return planResolve({
      project: args.project,
      template: validated.template,
      projectsDir: paths.projects,
      fileExists: (p) => fs.existsSync(p),
    });
  },
  mapResult: (r: PlanResolveResult) => ({ ok: true as const, data: r }),
});

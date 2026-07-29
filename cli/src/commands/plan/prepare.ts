/**
 * plan prepare — stamp approval and seal the planning parameters.
 *
 * Records that planning was approved and freezes the two parameters the plan
 * was built under — template tier and task size — into the Requirements
 * doc's frontmatter, in a single write. Idempotent: re-running with the same
 * `--template` / `--task-size` against an already-approved doc is a no-op
 * (returns `changed: false`, never touches the file) — the direct analogue
 * of `execute prepare`'s idempotency framing.
 */

import fs from 'node:fs';
import path from 'node:path';
import { defineCommand } from '../../framework/command.js';
import { UserError } from '../../framework/errors.js';
import type { CommandContext } from '../../framework/context.js';
import { userDataPaths } from '../../lib/paths.js';
import { parseYaml, stringifyYaml } from '../../lib/yaml.js';

// ── Types ───────────────────────────────────────────────────────────────────

export interface PlanPrepareOptions {
  project: string;
  template: string;
  /** Verbatim operator answer — a size name, or free-form prose for a custom criterion. */
  taskSize: string;
  requirementsPath: string;
  fileExists: (p: string) => boolean;
  readDoc: (p: string) => string;
  writeDoc: (p: string, content: string) => void;
}

export interface PlanPrepareResult {
  requirementsPath: string;
  status: 'approved';
  template: string;
  taskSize: string;
  /** false when the frontmatter already held these exact values (idempotent re-run). */
  changed: boolean;
}

// ── Core logic ────────────────────────────────────────────────────────────────

export function planPrepare(opts: PlanPrepareOptions): PlanPrepareResult {
  if (!opts.fileExists(opts.requirementsPath)) {
    throw new UserError(`No requirements document at ${opts.requirementsPath}. Run \`plan resolve --project ${opts.project}\` first.`);
  }
  const raw = opts.readDoc(opts.requirementsPath);
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) {
    throw new UserError(`${opts.requirementsPath} has no YAML frontmatter`);
  }
  const fm = parseYaml<Record<string, unknown>>(match[1] ?? '') ?? {};
  // Capture the body by index off the frontmatter match — never re-split and
  // re-join lines — so it comes back byte-for-byte, line endings included.
  const body = raw.slice(match[0].length);

  const alreadySet = fm['status'] === 'approved' && fm['template'] === opts.template && fm['task-size'] === opts.taskSize;
  const result: PlanPrepareResult = {
    requirementsPath: opts.requirementsPath,
    status: 'approved',
    template: opts.template,
    taskSize: opts.taskSize,
    changed: !alreadySet,
  };
  if (alreadySet) return result;

  fm['status'] = 'approved';
  fm['template'] = opts.template;
  fm['task-size'] = opts.taskSize;

  const newFrontmatter = `---\n${stringifyYaml(fm)}---\n`;
  opts.writeDoc(opts.requirementsPath, newFrontmatter + body);

  return result;
}

// ── Command definition ──────────────────────────────────────────────────────

interface PlanPrepareArgs { project?: string; template?: string; 'task-size'?: string }

export const planPrepareCommand = defineCommand({
  name: 'plan-prepare',
  description: 'Stamp planning approval and freeze the template tier and task size in the Requirements frontmatter',
  args: {
    project: { description: 'Project whose Requirements doc is being approved', required: true },
    template: { description: 'Template tier the plan was built under (e.g. medium)' },
    'task-size': { description: 'Verbatim task-size answer — a shipped size name, or free-form custom-criterion prose' },
  },
  flags: {},
  handler: async ({ args }: { args: PlanPrepareArgs; ctx: CommandContext }) => {
    if (!args.project) throw new UserError('--project is required');
    // --project is used to build a filesystem path — guard it before joining, or
    // path.join happily resolves outside ~/.radorc/projects/.
    if (
      args.project.includes('/')
      || args.project.includes('\\')
      || args.project === '..'
      || path.isAbsolute(args.project)
    ) {
      throw new UserError(`--project must be a plain project name, not a path (got "${args.project}")`);
    }
    if (!args.template) throw new UserError('--template is required');
    if (!args['task-size']) throw new UserError('--task-size is required');

    const projectDir = path.join(userDataPaths().projects, args.project);
    const requirementsPath = path.join(projectDir, `${args.project}-REQUIREMENTS.md`);

    return planPrepare({
      project: args.project,
      template: args.template,
      taskSize: args['task-size'],
      requirementsPath,
      fileExists: (p) => fs.existsSync(p),
      readDoc: (p) => fs.readFileSync(p, 'utf-8'),
      writeDoc: (p, content) => fs.writeFileSync(p, content, 'utf-8'),
    });
  },
  mapResult: (r: PlanPrepareResult) => ({ ok: true as const, data: r }),
});

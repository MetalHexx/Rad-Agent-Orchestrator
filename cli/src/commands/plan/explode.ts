import { defineCommand } from '../../framework/command.js';
import { UserError } from '../../framework/errors.js';
import { explodeMasterPlan, ParseError } from '../../lib/explode-master-plan.js';
import type { CommandContext } from '../../framework/context.js';

export type PlanExplodeResult =
  | { type: 'success'; emittedPhases: number; emittedTasks: number }
  | { type: 'parse_error'; error: { line: number; expected: string; found: string; message: string } }
  | { type: 'real_error'; message: string };

export interface PlanExplodeOptions {
  projectDir: string;
  masterPlanPath: string;
  projectName: string;
}

export function planExplode(opts: PlanExplodeOptions): PlanExplodeResult {
  try {
    const r = explodeMasterPlan({
      projectDir: opts.projectDir,
      masterPlanPath: opts.masterPlanPath,
      projectName: opts.projectName,
    });
    return {
      type: 'success',
      emittedPhases: r.emittedPhaseFiles.length,
      emittedTasks: r.emittedTaskFiles.length,
    };
  } catch (err) {
    if (err instanceof ParseError) {
      return { type: 'parse_error', error: err.toDetail() };
    }
    return { type: 'real_error', message: err instanceof Error ? err.message : String(err) };
  }
}

interface Args { 'project-dir'?: string; 'master-plan'?: string; 'project-name'?: string }

export const planExplodeCommand = defineCommand({
  name: 'plan-explode',
  description: 'Explode the Master Plan into phase and task files',
  args: {
    'project-dir': { description: 'Absolute path to the project directory', required: true },
    'master-plan': { description: 'Absolute path to the approved Master Plan markdown', required: true },
    'project-name': { description: 'Project name used as the filename prefix on emitted phase and task files', required: true },
  },
  flags: {},
  handler: async ({ args }: { args: Args; ctx: CommandContext }) => {
    const pd = args['project-dir']; const mp = args['master-plan']; const pn = args['project-name'];
    if (!pd || !mp || !pn) throw new UserError('--project-dir, --master-plan, and --project-name are all required');
    return planExplode({ projectDir: pd, masterPlanPath: mp, projectName: pn });
  },
  mapResult: (r: PlanExplodeResult) => {
    if (r.type === 'success') {
      return {
        ok: true,
        data: { emittedPhases: r.emittedPhases, emittedTasks: r.emittedTasks },
        exit_code: 0,
      };
    }
    if (r.type === 'parse_error') {
      return { ok: true, data: { error: r.error }, exit_code: 2 };
    }
    // exit_code is only honored when envelope.ok === true (see framework/command.ts:145);
    // system_error envelopes already resolve to ExitCode.SystemError (2), so no override needed.
    return { ok: false, error: { type: 'system_error' as const, message: r.message } };
  },
});

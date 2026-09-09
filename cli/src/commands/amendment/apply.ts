/**
 * `radorch amendment apply` — the verb that lands an amendment.
 *
 * A thin wrapper over the transaction in `lib/amendment/apply.ts`: guard the
 * project directory, call the core, map its outcome onto the envelope. The core
 * validates through the same `buildMergePlan` the `validate` verb calls and
 * refuses before touching the disk, so running `validate` first is a courtesy to
 * the operator rather than a safety measure this verb depends on.
 */

import { defineCommand } from '../../framework/command.js';
import { UserError } from '../../framework/errors.js';
import type { CommandContext } from '../../framework/context.js';
import { applyAmendment } from '../../lib/amendment/apply.js';
import type { AmendmentApplyOutcome } from '../../lib/amendment/apply.js';
import { guardProjectDir } from './validate.js';

interface Args { 'project-dir'?: string; 'amendment'?: string }

export const amendmentApplyCommand = defineCommand({
  name: 'amendment-apply',
  description: 'Apply an amendment to a running project as one all-or-nothing transaction',
  args: {
    'project-dir': {
      description: 'Absolute path to the project directory holding state.json and the Master Plan',
      required: true,
    },
    'amendment': {
      description: 'Absolute path to the amendment markdown document to apply',
      required: true,
    },
  },
  flags: {},
  handler: async ({ args }: { args: Args; ctx: CommandContext }) => {
    const projectDir = args['project-dir'];
    const amendmentPath = args['amendment'];
    if (!projectDir || !amendmentPath) throw new UserError('--project-dir and --amendment are both required');
    guardProjectDir(projectDir);
    return applyAmendment({ projectDir, amendmentPath });
  },
  mapResult: (r: AmendmentApplyOutcome) => {
    if (r.type === 'applied') {
      return { ok: true, data: { applied: r.applied }, exit_code: 0 };
    }
    if (r.type === 'invalid') {
      // An authoring problem is corrected and retried, so it stays on the ok side
      // with a structured line the author can jump to.
      return { ok: true, data: { error: r.error }, exit_code: 2 };
    }
    // Neither a fault nor an authoring problem: the amendment cannot land here
    // until the halt it names is cleared. The caller relays the message and stops.
    return { ok: true, data: { blocked: r.blocked }, exit_code: 2 };
  },
});

import { defineCommand } from '../../framework/command.js';
import { UserError } from '../../framework/errors.js';
import { userDataPaths } from '../../lib/paths.js';
import { WorkGraphService } from '@rad-orchestration/work-graph';
import type { Project } from '@rad-orchestration/work-graph';
import type { CommandContext } from '../../framework/context.js';
import { toLeanProject, renderProjectCard } from './lean.js';

interface Args { id?: string }
export const projectShowCommand = defineCommand({
  name: 'project-show',
  description: 'Show one project: state (the canonical answer), status, tier (diagnostic pipeline-stage detail), dir, worktrees, docs, and relationships',
  args: { id: { description: 'Project id (folder name) to show', required: true } },
  flags: {},
  handler: async ({ args, ctx }: { args: Args; flags: Record<string, never>; ctx: CommandContext }) => {
    if (!args.id) throw new UserError('--id is required');
    const paths = userDataPaths();
    const svc = new WorkGraphService({ root: paths.root, worktreesDir: paths.worktrees });
    const node = svc.getNode(args.id);
    if (!node || node.kind !== 'project') throw new UserError(`project '${args.id}' was not found`);
    const lean = toLeanProject(node as Project, svc.getGraph());
    if (!ctx.ux.json) ctx.stderr.write(renderProjectCard(lean) + '\n');
    return lean;
  },
});

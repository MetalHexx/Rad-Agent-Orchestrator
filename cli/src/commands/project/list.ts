import { defineCommand } from '../../framework/command.js';
import { userDataPaths } from '../../lib/paths.js';
import { WorkGraphService } from '@rad-orchestration/work-graph';
import type { NodeStatus } from '@rad-orchestration/work-graph';
import type { CommandContext } from '../../framework/context.js';
import { renderProjectTable } from './lean.js';

interface Flags { status?: string; group?: string }
export const projectListCommand = defineCommand({
  name: 'project-list',
  description: 'List projects; --status in_progress returns the active set',
  args: {},
  flags: {
    status: { description: 'Filter by rolled-up status (e.g. in_progress for the active set)', type: 'string' as const },
    group: { description: 'Filter to members of a group id', type: 'string' as const },
  },
  handler: async ({ flags, ctx }: { args: Record<string, never>; flags: Flags; ctx: CommandContext }) => {
    const svc = new WorkGraphService({ root: userDataPaths().root });
    const projects = svc.listProjects({ status: flags.status as NodeStatus | undefined, groupId: flags.group });
    if (!ctx.ux.json) ctx.stderr.write(renderProjectTable(projects) + '\n');
    return { projects: projects.map((p) => ({ name: p.name, state: p.state, stateLabel: p.stateLabel, status: p.status, tier: p.tier, sourceControlInitialized: p.sourceControlInitialized })) };
  },
});

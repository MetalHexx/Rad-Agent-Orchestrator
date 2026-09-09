import { defineCommand } from '../../framework/command.js';
import { UserError } from '../../framework/errors.js';
import { userDataPaths } from '../../lib/paths.js';
import { WorkGraphService } from '@rad-orchestration/work-graph';
import type { DeletionPlan, DeletionReport } from '@rad-orchestration/work-graph';
import { removeProjectIndexEntries } from '@rad-orchestration/telemetry';
import type { CommandContext } from '../../framework/context.js';

type PreviewItem = DeletionPlan['items'][number];
type ReportItem = DeletionReport['items'][number];

export type ProjectDeleteResult =
  | { project: string; preview: true; items: PreviewItem[] }
  | { project: string; preview: false; items: ReportItem[]; complete: boolean };

function writePreviewSummary(ctx: CommandContext, plan: DeletionPlan): void {
  const lines = plan.items.map((item) => {
    const reason = item.protectedReason ? ` — ${item.protectedReason}` : '';
    return `${item.kind}\t${item.label}\t${item.path ?? '-'}\t${item.disposition}${reason}`;
  });
  ctx.stderr.write(lines.join('\n') + '\n');
}

function writeReportSummary(ctx: CommandContext, report: DeletionReport): void {
  const lines = report.items.map((item) => {
    const reason = item.error ? ` — ${item.error}` : '';
    return `${item.kind}\t${item.label}\t${item.path ?? '-'}\t${item.outcome}${reason}`;
  });
  if (!report.complete) {
    lines.push(`Delete incomplete — fix the issue above and re-run "project delete --id ${report.project}" to finish.`);
  }
  ctx.stderr.write(lines.join('\n') + '\n');
}

interface Args { id?: string }
interface Flags { preview?: boolean }

export const projectDeleteCommand = defineCommand({
  name: 'project-delete',
  description: 'Delete a project and its workspaces (use --preview to see what would be removed)',
  args: {
    id: { description: 'Project id (folder name) to delete', required: true },
  },
  flags: {
    preview: { description: 'Show what would be removed without deleting anything' },
  },
  handler: async ({ args, flags, ctx }: { args: Args; flags: Flags; ctx: CommandContext }): Promise<ProjectDeleteResult> => {
    if (!args.id) throw new UserError('--id is required');
    const paths = userDataPaths();
    const svc = new WorkGraphService({ root: paths.root, worktreesDir: paths.worktrees, sideProjectsDir: paths.sideProjects });

    if (flags.preview) {
      const r = svc.planProjectDeletion(args.id);
      if (!r.ok) throw new UserError(r.error.message);
      if (!ctx.ux.json) writePreviewSummary(ctx, r.data);
      return { project: r.data.project, preview: true, items: r.data.items };
    }

    const r = svc.deleteProject(args.id);
    if (!r.ok) throw new UserError(r.error.message);
    // deleteProject has no existence gate — an already-fully-deleted project is
    // a legitimate resumable target, not an error, and a partial delete whose
    // project directory is already gone (e.g. graph-edges left over) must still
    // be free to finish the remaining work. But when every item comes back
    // already-absent, nothing was ever found for this id — that is what an
    // unknown project looks like — so surface it as a clean error instead of a
    // silent no-op "success".
    if (r.data.items.every((item) => item.outcome === 'already-absent')) {
      throw new UserError(`project '${args.id}' does not exist`);
    }
    // Only a project-dir that actually came back removed had its claims orphaned;
    // a held-back or failed project-dir means the project still exists, so its
    // recorded sessions must keep their attribution.
    if (r.data.items.some((item) => item.kind === 'project-dir' && item.outcome === 'removed')) {
      removeProjectIndexEntries(userDataPaths().telemetry, args.id);
    }
    if (!ctx.ux.json) writeReportSummary(ctx, r.data);
    return { project: r.data.project, preview: false, items: r.data.items, complete: r.data.complete };
  },
  mapResult: (r: ProjectDeleteResult) => ({
    ok: true,
    data: r,
    exit_code: r.preview || r.complete ? 0 : 1,
  }),
});

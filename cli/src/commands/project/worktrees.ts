import { defineCommand } from '../../framework/command.js';
import { UserError } from '../../framework/errors.js';
import { userDataPaths } from '../../lib/paths.js';
import { WorkGraphService } from '@rad-orchestration/work-graph';
import type { Node, NodeId, Project, ProjectKind, WorktreeRef } from '@rad-orchestration/work-graph';
import type { CommandContext } from '../../framework/context.js';

export type WorkspaceState = 'present' | 'absent' | 'in-place' | 'side-project';

function computeWorkspaceState(refs: WorktreeRef[], projectType: ProjectKind): WorkspaceState {
  if (projectType === 'side-project') return 'side-project';
  if (refs.some((r) => r.resolvedVia === 'registry-clone')) return 'in-place';
  if (refs.some((r) => r.resolvedVia !== 'registry-clone' && r.exists)) return 'present';
  return 'absent';
}

export function buildWorktreesResult(name: string, refs: WorktreeRef[], worktreeName: string, projectType: ProjectKind) {
  return {
    name,
    worktree_name: worktreeName,
    workspace: computeWorkspaceState(refs, projectType),
    worktrees: refs.map((w) => ({ repo: w.repo, path: w.path, branch: w.branch, exists: w.exists })),
  };
}

/**
 * Guards against reporting a workspace name for a project that does not
 * exist. `resolveWorktreeName` degrades a missing `state.json` to the
 * project's own name, which would otherwise make a typo'd `--id` look like a
 * legitimate project with its own workspace. Also rejects a `Group` id:
 * `getNode` resolves both kinds from the same id space, and a group must not
 * be substitutable for a project's workspace.
 */
export function assertProjectExists(id: NodeId, getNode: (id: NodeId) => Node | null): void {
  const node = getNode(id);
  if (node == null || node.kind !== 'project') {
    throw new UserError(`Project "${id}" was not found under ~/.radorc/projects.`);
  }
}

interface Args { id?: string }
export const projectWorktreesCommand = defineCommand({
  name: 'project-worktrees',
  description: "Show a project's resolved worktrees (repo, path, branch, exists)",
  args: { id: { description: 'Project id (folder name) whose worktrees to resolve', required: true } },
  flags: {},
  handler: async ({ args, ctx }: { args: Args; flags: Record<string, never>; ctx: CommandContext }) => {
    if (!args.id) throw new UserError('--id is required');
    const paths = userDataPaths();
    const svc = new WorkGraphService({ root: paths.root, worktreesDir: paths.worktrees, sideProjectsDir: paths.sideProjects });
    const node = svc.getNode(args.id);
    assertProjectExists(args.id, () => node);
    const project = node as Project; // assertProjectExists guarantees node != null && node.kind === 'project'
    const refs = svc.resolveWorktrees(args.id);
    const worktreeName = svc.resolveWorktreeName(args.id);
    const result = buildWorktreesResult(args.id, refs, worktreeName, project.projectType);
    if (!ctx.ux.json) {
      ctx.stderr.write(result.worktrees.map((w) => `${w.repo}\t${w.path}\t${w.branch ?? '-'}\texists=${w.exists}`).join('\n') + '\n');
    }
    return result;
  },
});

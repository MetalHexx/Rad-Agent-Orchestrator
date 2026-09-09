/**
 * `graph-port.ts` — the migration seam between `cli/src/commands/portfolio/` and
 * `@rad-orchestration/work-graph`. This is the only file in the module permitted
 * to name `WorkGraphService`; everything else in `portfolio/` talks to `GraphPort`.
 */
import { WorkGraphService } from '@rad-orchestration/work-graph';
import type { Edge, EdgeType, GraphDTO, Group, NodeId, Project, Result } from '@rad-orchestration/work-graph';

export interface GraphPort {
  createGroup(name: string, description: string): Result<{ node: Group; rev: number }>;
  deleteGroup(id: NodeId): Result<{ rev: number }>;
  addMember(groupId: NodeId, projectId: NodeId): Result<{ edge: Edge; rev: number }>;
  removeMember(groupId: NodeId, projectId: NodeId): Result<{ rev: number }>;
  recordDependency(from: NodeId, to: NodeId): Result<{ edge: Edge; rev: number }>;
  listGroups(): Group[];
  listMembers(groupId: NodeId): Project[];
  getGraph(): GraphDTO;
}

/** The narrow slice of `WorkGraphService` the adapter actually calls.
 *  `WorkGraphService` satisfies this structurally, so the default construction
 *  path below needs no cast. */
export interface GraphBackend {
  getGraph(): GraphDTO;
  createGroup(input: { name: string; description: string; parentId?: NodeId }): Result<{ node: Group; rev: number }>;
  deleteGroup(id: NodeId): Result<{ rev: number }>;
  addMember(groupId: NodeId, nodeId: NodeId): Result<{ edge: Edge; rev: number }>;
  removeMember(groupId: NodeId, nodeId: NodeId): Result<{ rev: number }>;
  link(from: NodeId, to: NodeId, type: EdgeType): Result<{ edge: Edge; rev: number }>;
}

/**
 * `service` is injectable so the memoization itself is testable — the exit
 * criterion that names it is otherwise unverifiable. Production callers omit it.
 *
 * `WorkGraphService` recomposes the entire graph inside each of `getGraph()`,
 * `listProjects()`, and `listGroups()` — one composition derives every project
 * under `~/.radorc/projects/` with a `readdir` per project and a `git worktree
 * list` subprocess per bound repo. The adapter instead holds one `GraphDTO` per
 * CLI invocation and serves `listGroups`/`listMembers`/`getGraph` from it,
 * recomposing only after a mutation invalidates the cache.
 *
 * The cache is staled by filesystem writes too, not only by the graph writes
 * below — `createGroup`, `deleteGroup`, `addMember`, `removeMember`, and
 * `recordDependency` — because composition derives project nodes by listing
 * `projectsDir`. Any caller that writes under `projectsDir` outside those
 * operations must invalidate on its own; never read through the port after such
 * a write without doing so. The cache lives for one CLI invocation only.
 */
export function workGraphAdapter(
  opts: { root: string; worktreesDir?: string; service?: GraphBackend },
): GraphPort {
  const svc: GraphBackend = opts.service ?? new WorkGraphService(opts);
  let cached: GraphDTO | null = null;
  const graph = (): GraphDTO => (cached ??= svc.getGraph());
  const invalidate = (): void => { cached = null; };

  return {
    createGroup(name, description) {
      const result = svc.createGroup({ name, description });
      invalidate();
      return result;
    },
    deleteGroup(id) {
      const result = svc.deleteGroup(id);
      invalidate();
      return result;
    },
    addMember(groupId, projectId) {
      const result = svc.addMember(groupId, projectId);
      invalidate();
      return result;
    },
    removeMember(groupId, projectId) {
      const result = svc.removeMember(groupId, projectId);
      invalidate();
      return result;
    },
    recordDependency(from, to) {
      const result = svc.link(from, to, 'depends-on');
      invalidate();
      return result;
    },
    listGroups() {
      return graph().nodes.filter((n): n is Group => n.kind === 'group');
    },
    listMembers(groupId) {
      const g = graph();
      const memberIds = new Set(
        g.edges.filter((e) => e.type === 'contains' && e.from === groupId).map((e) => e.to),
      );
      return g.nodes.filter((n): n is Project => n.kind === 'project' && memberIds.has(n.id));
    },
    getGraph() {
      return graph();
    },
  };
}

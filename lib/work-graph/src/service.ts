import path from 'node:path';
import type { Edge, EdgeType, GraphDTO, Group, Node, NodeId, NodeStatus, Project, Result, StoredGraph, WorktreeRef } from './types.js';
import { PROJECTION_SCHEMA } from './types.js';
import { GraphIndex } from './store.js';
import { WorkGraph } from './graph.js';
import { listProjectNames, projectExists, deriveProject } from './derive/projects.js';
import { resolveWorktrees as deriveWorktrees, type GitExec } from './derive/worktrees.js';
import { locate as deriveLocate, type LocateResult } from './derive/locate.js';
import { groupId } from './ids.js';
import { validateNewEdge, validateNewGroupId } from './validate.js';
import { pruneEdges } from './reconcile.js';
import { readRegistry } from '@rad-orchestration/repo-registry';

export interface ServiceOpts { root: string; exec?: GitExec; worktreesDir?: string; sideProjectsDir?: string; }

/**
 * WorkGraphService
 *
 * The library keeps its own default (`<root>/worktrees`) for package independence,
 * but accepts the CLI's `userDataPaths().worktrees` as the authoritative override (NFR-7).
 * The `resolveWorktrees` legacy single-`worktree_path` branch stays as the bridge
 * for existing projects (AD-9).
 */
export class WorkGraphService {
  private readonly index: GraphIndex;
  constructor(private readonly opts: ServiceOpts) { this.index = new GraphIndex(opts.root); }
  private projectsDir(): string { return path.join(this.opts.root, 'projects'); }
  private worktreesDir(): string { return this.opts.worktreesDir ?? path.join(this.opts.root, 'worktrees'); }
  private sideProjectsDir(): string { return this.opts.sideProjectsDir ?? path.join(this.opts.root, 'side-projects'); }
  private registryLocalPaths(): Record<string, string> { return readRegistry({ root: this.opts.root }).localPaths; }

  private compose(): { graph: WorkGraph } {
    const stored = this.index.read();
    const deps = { projectsDir: this.projectsDir(), worktreesDir: this.worktreesDir(), sideProjectsDir: this.sideProjectsDir(), registryLocalPaths: this.registryLocalPaths(), exec: this.opts.exec };
    const projects = listProjectNames(this.projectsDir())
      .map((n) => deriveProject(n, deps)).filter((p): p is Project => !!p);
    const groups: Group[] = Object.entries(stored.groups)
      .map(([id, g]) => ({ id, kind: 'group', name: g.name, description: g.description, status: 'unknown' }));
    return { graph: new WorkGraph([...groups, ...projects], stored.edges) };
  }

  getGraph(scope?: { rootId?: NodeId; depth?: number }): GraphDTO {
    const { graph } = this.compose();
    let nodes = graph.allNodes();
    let edges = graph.edges;
    if (scope?.rootId) {
      const keep = this.descendants(graph, scope.rootId, scope.depth ?? Infinity);
      nodes = nodes.filter((n) => keep.has(n.id));
      edges = edges.filter((e) => keep.has(e.from) && keep.has(e.to));
    }
    return { schema: PROJECTION_SCHEMA, nodes, edges, danglingEdges: graph.danglingEdges };
  }
  private descendants(graph: WorkGraph, rootId: NodeId, depth: number): Set<NodeId> {
    const keep = new Set<NodeId>([rootId]);
    const walk = (id: NodeId, d: number) => {
      if (d <= 0) return;
      for (const c of graph.children(id)) { keep.add(c.id); walk(c.id, d - 1); }
    };
    walk(rootId, depth);
    return keep;
  }
  getNode(id: NodeId): Node | null { return this.compose().graph.node(id); }
  listProjects(filter?: { groupId?: NodeId; status?: NodeStatus }): Project[] {
    const { graph } = this.compose();
    let projects = graph.allNodes().filter((n): n is Project => n.kind === 'project');
    if (filter?.status) projects = projects.filter((p) => p.status === filter.status);
    if (filter?.groupId) {
      const members = new Set(graph.children(filter.groupId).map((c) => c.id));
      projects = projects.filter((p) => members.has(p.id));
    }
    return projects;
  }
  listGroups(): Group[] {
    return this.compose().graph.allNodes().filter((n): n is Group => n.kind === 'group');
  }
  resolveWorktrees(projectId: NodeId): WorktreeRef[] {
    return deriveWorktrees(projectId, { projectsDir: this.projectsDir(), worktreesDir: this.worktreesDir(), sideProjectsDir: this.sideProjectsDir(), registryLocalPaths: this.registryLocalPaths(), exec: this.opts.exec });
  }

  locate(cwd: string): LocateResult {
    const registry = readRegistry({ root: this.opts.root });
    return deriveLocate(cwd, {
      projectsDir: this.projectsDir(),
      worktreesDir: this.worktreesDir(),
      sideProjectsDir: this.sideProjectsDir(),
      registryLocalPaths: registry.localPaths,
      exec: this.opts.exec,
    });
  }

  private nodeExists(id: NodeId): boolean {
    return this.index.read().groups[id] !== undefined || projectExists(this.projectsDir(), id);
  }

  private validationCtx(stored: StoredGraph) {
    return { groups: stored.groups, edges: stored.edges, nodeExists: (id: NodeId) => this.nodeExists(id) };
  }

  createGroup(input: { name: string; description: string; parentId?: NodeId }): Result<{ node: Group; rev: number }> {
    if (!input.description?.trim()) return { ok: false, error: { code: 'validation', message: 'a non-empty description is required' } };
    const stored = this.index.read();
    const id = groupId(input.name);
    const idError = validateNewGroupId(this.validationCtx(stored), id);
    if (idError) return { ok: false, error: idError };
    stored.groups[id] = { name: input.name, description: input.description.trim() };
    if (input.parentId) {
      const edge: Edge = { type: 'contains', from: input.parentId, to: id };
      const edgeError = validateNewEdge({ groups: stored.groups, edges: stored.edges, nodeExists: (x) => x === id || this.nodeExists(x) }, edge);
      if (edgeError) return { ok: false, error: edgeError };
      stored.edges.push(edge);
    }
    const written = this.index.write(stored, stored.rev);
    if (!written.ok) return written;
    return { ok: true, data: { node: { id, kind: 'group', name: input.name, description: input.description.trim(), status: 'unknown' }, rev: written.data.rev } };
  }

  updateGroup(id: NodeId, patch: { name?: string; description?: string }): Result<{ node: Group; rev: number }> {
    const stored = this.index.read();
    const g = stored.groups[id];
    if (!g) return { ok: false, error: { code: 'validation', message: `group '${id}' does not exist` } };
    if (patch.description !== undefined && !patch.description.trim()) return { ok: false, error: { code: 'validation', message: 'a non-empty description is required' } };
    if (patch.name !== undefined) g.name = patch.name;
    if (patch.description !== undefined) g.description = patch.description.trim();
    const written = this.index.write(stored, stored.rev);
    if (!written.ok) return written;
    return { ok: true, data: { node: { id, kind: 'group', name: g.name, description: g.description, status: 'unknown' }, rev: written.data.rev } };
  }

  deleteGroup(id: NodeId): Result<{ rev: number }> {
    const stored = this.index.read();
    if (!stored.groups[id]) return { ok: false, error: { code: 'validation', message: `group '${id}' does not exist` } };
    // Cascade the group's own contains edges (and any edge touching it); projects are never deleted.
    delete stored.groups[id];
    stored.edges = stored.edges.filter((e) => e.from !== id && e.to !== id);
    const written = this.index.write(stored, stored.rev);
    if (!written.ok) return written;
    return { ok: true, data: { rev: written.data.rev } };
  }

  addMember(groupId_: NodeId, nodeId: NodeId): Result<{ edge: Edge; rev: number }> {
    return this.addEdge({ type: 'contains', from: groupId_, to: nodeId });
  }

  removeMember(groupId_: NodeId, nodeId: NodeId): Result<{ rev: number }> {
    return this.removeEdge({ type: 'contains', from: groupId_, to: nodeId });
  }

  private addEdge(edge: Edge): Result<{ edge: Edge; rev: number }> {
    const stored = this.index.read();
    const error = validateNewEdge(this.validationCtx(stored), edge);
    if (error) return { ok: false, error };
    stored.edges.push(edge);
    const written = this.index.write(stored, stored.rev);
    if (!written.ok) return written;
    return { ok: true, data: { edge, rev: written.data.rev } };
  }

  private removeEdge(edge: Edge): Result<{ rev: number }> {
    const stored = this.index.read();
    stored.edges = stored.edges.filter((e) => !(e.type === edge.type && e.from === edge.from && e.to === edge.to));
    const written = this.index.write(stored, stored.rev);
    if (!written.ok) return written;
    return { ok: true, data: { rev: written.data.rev } };
  }

  link(from: NodeId, to: NodeId, type: EdgeType): Result<{ edge: Edge; rev: number }> {
    return this.addEdge({ type, from, to });
  }

  unlink(from: NodeId, to: NodeId, type: EdgeType): Result<{ rev: number }> {
    return this.removeEdge({ type, from, to });
  }

  prune(): Result<{ removed: Edge[]; rev: number }> {
    const stored = this.index.read();
    const { kept, removed } = pruneEdges(stored.edges, (id) => this.nodeExists(id));
    if (removed.length === 0) return { ok: true, data: { removed: [], rev: stored.rev } };
    stored.edges = kept;
    const written = this.index.write(stored, stored.rev);
    if (!written.ok) return written;
    return { ok: true, data: { removed, rev: written.data.rev } };
  }
}

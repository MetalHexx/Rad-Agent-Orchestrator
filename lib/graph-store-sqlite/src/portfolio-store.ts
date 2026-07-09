import path from 'node:path';
import type Database from 'better-sqlite3';
import type { Result } from '@rad-orchestration/graph-engine';
import type {
  EdgeType,
  GroupChildren,
  GroupCreateInput,
  GroupRecord,
  GroupUpdateInput,
  PortfolioStore,
  PortfolioTargetType,
  ProjectCreateInput,
  ProjectEdgeRecord,
  ProjectRecord,
  ProjectStatus,
  ProjectUpdateInput,
  WorktreeInput,
  WorktreeRecord,
} from './portfolio-types.js';

/** Shared read projection for `projects`' portfolio-enrichment columns, in `ProjectRow` order. */
const PROJECT_COLUMNS =
  'id, project_type, status, group_id, auto_commit, auto_pr, source_control_initialized, created_at, updated_at';
/** Shared read projection for `worktrees`, in `WorktreeRow` order. */
const WORKTREE_COLUMNS = 'project_id, repo, path, branch, base_branch, pr_url';
/** Shared read projection for `project_groups`, in `GroupRow` order. */
const GROUP_COLUMNS = 'id, name, description, parent_group_id, created_at, updated_at';
/** Shared read projection for `project_edges`, in `EdgeRow` order. */
const EDGE_COLUMNS = 'from_project_id, to_project_id, type';

interface ProjectRow {
  id: string;
  project_type: string | null;
  status: string | null;
  group_id: string | null;
  auto_commit: string | null;
  auto_pr: string | null;
  source_control_initialized: number | null;
  created_at: string | null;
  updated_at: string | null;
}

interface WorktreeRow {
  project_id: string;
  repo: string;
  path: string | null;
  branch: string | null;
  base_branch: string | null;
  pr_url: string | null;
}

interface GroupRow {
  id: string;
  name: string | null;
  description: string;
  parent_group_id: string | null;
  created_at: string | null;
  updated_at: string | null;
}

interface EdgeRow {
  from_project_id: string;
  to_project_id: string;
  type: string;
}

function invalidDelta(message: string): Result<never> {
  return { ok: false, error: { code: 'invalid_delta', message } };
}

/**
 * `projects.created_at` is set (once, in `createProject`) only for rows this store itself
 * originated. `dag_nodes.project_id`'s FK means `SqliteStateStore` seeds a bare `projects(id)` row
 * on a scope's first touch (see `sqlite-state-store.ts#ensureSeeded`) with every enrichment column
 * NULL — `created_at IS NOT NULL` is how reads and `createProject`'s existence check tell a real
 * portfolio project apart from that engine-only scaffold row.
 */
function rowToProject(row: ProjectRow): ProjectRecord {
  return {
    id: row.id,
    projectType: row.project_type,
    status: row.status as ProjectStatus,
    groupId: row.group_id,
    autoCommit: row.auto_commit as ProjectRecord['autoCommit'],
    autoPr: row.auto_pr as ProjectRecord['autoPr'],
    sourceControlInitialized: row.source_control_initialized === 1,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function rowToWorktree(row: WorktreeRow): WorktreeRecord {
  return {
    projectId: row.project_id,
    repo: row.repo,
    path: row.path,
    branch: row.branch,
    baseBranch: row.base_branch,
    prUrl: row.pr_url,
  };
}

function rowToGroup(row: GroupRow): GroupRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    parentGroupId: row.parent_group_id,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function rowToEdge(row: EdgeRow): ProjectEdgeRecord {
  return {
    fromProjectId: row.from_project_id,
    toProjectId: row.to_project_id,
    type: row.type as EdgeType,
  };
}

/** Named bind values for the project insert/update statements — keys match their `@name` params. */
function projectParams(record: ProjectRecord): Record<string, string | number | null> {
  return {
    id: record.id,
    project_type: record.projectType,
    status: record.status,
    group_id: record.groupId,
    auto_commit: record.autoCommit,
    auto_pr: record.autoPr,
    source_control_initialized: record.sourceControlInitialized ? 1 : 0,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
  };
}

/** Named bind values for the worktree insert statement — keys match its `@name` params. */
function worktreeParams(record: WorktreeRecord): Record<string, string | null> {
  return {
    project_id: record.projectId,
    repo: record.repo,
    path: record.path,
    branch: record.branch,
    base_branch: record.baseBranch,
    pr_url: record.prUrl,
  };
}

/** The `portfolio_change_log.target_id` for a worktree, whose real key is the composite
 * `(project_id, repo)`. */
function worktreeTargetId(projectId: string, repo: string): string {
  return `${projectId}:${repo}`;
}

/** Named bind values for the group insert/update statements — keys match their `@name` params. */
function groupParams(record: GroupRecord): Record<string, string | null> {
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    parent_group_id: record.parentGroupId,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
  };
}

/** Named bind values for the edge insert statement — keys match its `@name` params. */
function edgeParams(record: ProjectEdgeRecord): Record<string, string> {
  return {
    from_project_id: record.fromProjectId,
    to_project_id: record.toProjectId,
    type: record.type,
  };
}

/** The `portfolio_change_log.target_id` for an edge, whose real key is the composite
 * `(from_project_id, to_project_id, type)`. */
function edgeTargetId(from: string, to: string, type: EdgeType): string {
  return `${from}->${to}:${type}`;
}

/**
 * Rejects a `worktrees.path` that is absolute under either path convention, regardless of the host
 * OS this process happens to run on — `path.isAbsolute` alone only recognizes the current
 * platform's convention, and a portable POSIX ref must be rejected as absolute on every host.
 */
function isAbsoluteWorktreePath(candidate: string): boolean {
  return path.win32.isAbsolute(candidate) || path.posix.isAbsolute(candidate);
}

/**
 * The durable `PortfolioStore` over the v2 portfolio schema (`lib/graph-store-sqlite/src/schema/
 * migrations.ts`'s `V2_UP`). Every mutation funnels through the private `mutate` helper, which runs
 * the caller's write and one `portfolio_change_log` insert inside a single `better-sqlite3`
 * transaction — a failed write rolls back the audit row too, so the row count only ever advances by
 * exactly one per successful public mutation.
 *
 * This is a distinct CRUD interface from the engine's `StateStore`: projects and worktrees are
 * host-managed portfolio metadata, not execution-DAG state, so there is no `ChangeDelta`/`apply`
 * shape here — each entity gets its own explicit create/read/update/delete methods instead.
 */
export class SqlitePortfolioStore implements PortfolioStore {
  private readonly insertProjectStmt: Database.Statement;
  private readonly selectProjectStmt: Database.Statement;
  private readonly selectProjectsStmt: Database.Statement;
  private readonly updateProjectStmt: Database.Statement;
  private readonly deleteProjectStmt: Database.Statement;
  private readonly insertWorktreeStmt: Database.Statement;
  private readonly selectWorktreeStmt: Database.Statement;
  private readonly selectWorktreesStmt: Database.Statement;
  private readonly deleteWorktreeStmt: Database.Statement;
  private readonly insertGroupStmt: Database.Statement;
  private readonly selectGroupStmt: Database.Statement;
  private readonly updateGroupStmt: Database.Statement;
  private readonly deleteGroupStmt: Database.Statement;
  private readonly setProjectGroupStmt: Database.Statement;
  private readonly setParentGroupStmt: Database.Statement;
  private readonly selectChildProjectsStmt: Database.Statement;
  private readonly selectChildGroupsStmt: Database.Statement;
  private readonly insertEdgeStmt: Database.Statement;
  private readonly selectEdgeStmt: Database.Statement;
  private readonly deleteEdgeStmt: Database.Statement;
  private readonly selectEdgesFromStmt: Database.Statement;
  private readonly selectEdgesToStmt: Database.Statement;
  private readonly selectOutgoingByTypeStmt: Database.Statement;
  private readonly insertChangeLogStmt: Database.Statement;

  constructor(private readonly db: Database.Database) {
    // ON CONFLICT DO UPDATE: `id` may already exist as a bare engine-seeded scaffold row (see
    // `rowToProject`'s comment) — that row is adopted and enriched rather than rejected as a
    // conflict, since `createProject`'s own pre-check already blocks a genuine duplicate.
    this.insertProjectStmt = this.db.prepare(
      `INSERT INTO projects (${PROJECT_COLUMNS})
       VALUES (@id, @project_type, @status, @group_id, @auto_commit, @auto_pr, @source_control_initialized, @created_at, @updated_at)
       ON CONFLICT(id) DO UPDATE SET
         project_type = excluded.project_type,
         status = excluded.status,
         group_id = excluded.group_id,
         auto_commit = excluded.auto_commit,
         auto_pr = excluded.auto_pr,
         source_control_initialized = excluded.source_control_initialized,
         created_at = excluded.created_at,
         updated_at = excluded.updated_at`,
    );
    this.selectProjectStmt = this.db.prepare(
      `SELECT ${PROJECT_COLUMNS} FROM projects WHERE id = ? AND created_at IS NOT NULL`,
    );
    this.selectProjectsStmt = this.db.prepare(
      `SELECT ${PROJECT_COLUMNS} FROM projects WHERE created_at IS NOT NULL ORDER BY rowid`,
    );
    this.updateProjectStmt = this.db.prepare(
      `UPDATE projects
       SET status = @status, auto_commit = @auto_commit, auto_pr = @auto_pr, updated_at = @updated_at
       WHERE id = @id`,
    );
    this.deleteProjectStmt = this.db.prepare('DELETE FROM projects WHERE id = ?');

    this.insertWorktreeStmt = this.db.prepare(
      `INSERT INTO worktrees (${WORKTREE_COLUMNS})
       VALUES (@project_id, @repo, @path, @branch, @base_branch, @pr_url)`,
    );
    this.selectWorktreeStmt = this.db.prepare(
      `SELECT ${WORKTREE_COLUMNS} FROM worktrees WHERE project_id = ? AND repo = ?`,
    );
    this.selectWorktreesStmt = this.db.prepare(
      `SELECT ${WORKTREE_COLUMNS} FROM worktrees WHERE project_id = ? ORDER BY rowid`,
    );
    this.deleteWorktreeStmt = this.db.prepare(
      'DELETE FROM worktrees WHERE project_id = ? AND repo = ?',
    );

    this.insertGroupStmt = this.db.prepare(
      `INSERT INTO project_groups (${GROUP_COLUMNS})
       VALUES (@id, @name, @description, @parent_group_id, @created_at, @updated_at)`,
    );
    this.selectGroupStmt = this.db.prepare(
      `SELECT ${GROUP_COLUMNS} FROM project_groups WHERE id = ?`,
    );
    this.updateGroupStmt = this.db.prepare(
      `UPDATE project_groups SET name = @name, description = @description, updated_at = @updated_at
       WHERE id = @id`,
    );
    this.deleteGroupStmt = this.db.prepare('DELETE FROM project_groups WHERE id = ?');
    this.setProjectGroupStmt = this.db.prepare(
      'UPDATE projects SET group_id = @group_id, updated_at = @updated_at WHERE id = @id',
    );
    this.setParentGroupStmt = this.db.prepare(
      `UPDATE project_groups SET parent_group_id = @parent_group_id, updated_at = @updated_at
       WHERE id = @id`,
    );
    this.selectChildProjectsStmt = this.db.prepare(
      `SELECT ${PROJECT_COLUMNS} FROM projects
       WHERE group_id = ? AND created_at IS NOT NULL ORDER BY rowid`,
    );
    this.selectChildGroupsStmt = this.db.prepare(
      `SELECT ${GROUP_COLUMNS} FROM project_groups WHERE parent_group_id = ? ORDER BY rowid`,
    );

    this.insertEdgeStmt = this.db.prepare(
      `INSERT INTO project_edges (${EDGE_COLUMNS}) VALUES (@from_project_id, @to_project_id, @type)`,
    );
    this.selectEdgeStmt = this.db.prepare(
      `SELECT ${EDGE_COLUMNS} FROM project_edges
       WHERE from_project_id = ? AND to_project_id = ? AND type = ?`,
    );
    this.deleteEdgeStmt = this.db.prepare(
      'DELETE FROM project_edges WHERE from_project_id = ? AND to_project_id = ? AND type = ?',
    );
    this.selectEdgesFromStmt = this.db.prepare(
      `SELECT ${EDGE_COLUMNS} FROM project_edges WHERE from_project_id = ? ORDER BY rowid`,
    );
    this.selectEdgesToStmt = this.db.prepare(
      `SELECT ${EDGE_COLUMNS} FROM project_edges WHERE to_project_id = ? ORDER BY rowid`,
    );
    // Backs `canReach`'s bounded reachability walk: the outgoing neighbors of one node, scoped to a
    // single edge `type` so the `follows` and `spawned-from` graphs are checked as independent DAGs.
    this.selectOutgoingByTypeStmt = this.db.prepare(
      'SELECT to_project_id FROM project_edges WHERE from_project_id = ? AND type = ?',
    );

    this.insertChangeLogStmt = this.db.prepare(
      `INSERT INTO portfolio_change_log (ts, actor, operation, target_type, target_id, before, after)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
  }

  /**
   * Records one audit row in the same transaction as the data change `entry.write` performs. `ts`
   * is host-stamped here (it is not the deterministic engine — D12 applies to the engine core, not
   * this host store); `actor` is passed through from the caller. A thrown error — a business-rule
   * pre-check that slipped through, or a SQLite constraint violation such as the FK guard on
   * `deleteProject` — rolls back both the write and the audit row, and surfaces as a failed
   * `Result` instead of propagating.
   */
  private mutate<T>(entry: {
    readonly operation: string;
    readonly targetType: PortfolioTargetType;
    readonly targetId: string;
    readonly actor: string | null;
    readonly before: unknown | null;
    readonly after: unknown | null;
    readonly write: () => void;
  }): Result<T> {
    try {
      this.db.transaction(() => {
        entry.write();
        this.insertChangeLogStmt.run(
          new Date().toISOString(),
          entry.actor,
          entry.operation,
          entry.targetType,
          entry.targetId,
          entry.before === null ? null : JSON.stringify(entry.before),
          entry.after === null ? null : JSON.stringify(entry.after),
        );
      })();
      return { ok: true, data: entry.after as T };
    } catch (err) {
      return invalidDelta(err instanceof Error ? err.message : String(err));
    }
  }

  createProject(input: ProjectCreateInput, actor: string | null): Result<ProjectRecord> {
    if (this.getProject(input.id)) {
      return invalidDelta(`project '${input.id}' already exists`);
    }
    const now = new Date().toISOString();
    const record: ProjectRecord = {
      id: input.id,
      projectType: input.projectType ?? null,
      status: input.status ?? 'planning',
      groupId: input.groupId ?? null,
      autoCommit: input.autoCommit ?? 'ask',
      autoPr: input.autoPr ?? 'ask',
      sourceControlInitialized: input.sourceControlInitialized ?? false,
      createdAt: now,
      updatedAt: now,
    };
    return this.mutate<ProjectRecord>({
      operation: 'project.created',
      targetType: 'project',
      targetId: record.id,
      actor,
      before: null,
      after: record,
      write: () => this.insertProjectStmt.run(projectParams(record)),
    });
  }

  getProject(id: string): ProjectRecord | null {
    const row = this.selectProjectStmt.get(id) as ProjectRow | undefined;
    return row ? rowToProject(row) : null;
  }

  listProjects(): ProjectRecord[] {
    return (this.selectProjectsStmt.all() as ProjectRow[]).map(rowToProject);
  }

  updateProject(
    id: string,
    patch: ProjectUpdateInput,
    actor: string | null,
  ): Result<ProjectRecord> {
    const before = this.getProject(id);
    if (!before) return invalidDelta(`project '${id}' does not exist`);
    const after: ProjectRecord = {
      ...before,
      status: patch.status ?? before.status,
      autoCommit: patch.autoCommit ?? before.autoCommit,
      autoPr: patch.autoPr ?? before.autoPr,
      updatedAt: new Date().toISOString(),
    };
    return this.mutate<ProjectRecord>({
      operation: 'project.updated',
      targetType: 'project',
      targetId: id,
      actor,
      before,
      after,
      write: () => this.updateProjectStmt.run(projectParams(after)),
    });
  }

  deleteProject(id: string, actor: string | null): Result<void> {
    const before = this.getProject(id);
    if (!before) return invalidDelta(`project '${id}' does not exist`);
    // Guarded by the schema, not this method: `dag_nodes.project_id` (no cascade) and
    // `docs.project_id` (ON DELETE RESTRICT) reject the DELETE below when live execution nodes or
    // owned docs still reference this project, and `mutate` turns that thrown constraint failure
    // into a failed Result instead of force-cascading.
    return this.mutate<void>({
      operation: 'project.deleted',
      targetType: 'project',
      targetId: id,
      actor,
      before,
      after: null,
      write: () => this.deleteProjectStmt.run(id),
    });
  }

  addWorktree(input: WorktreeInput, actor: string | null): Result<WorktreeRecord> {
    if (input.path != null && isAbsoluteWorktreePath(input.path)) {
      return invalidDelta(
        `worktree path '${input.path}' must be relative to ~/.radorc/worktrees, not absolute`,
      );
    }
    if (!this.getProject(input.projectId)) {
      return invalidDelta(`project '${input.projectId}' does not exist`);
    }
    if (this.getWorktree(input.projectId, input.repo)) {
      return invalidDelta(
        `worktree '${input.repo}' already exists on project '${input.projectId}'`,
      );
    }
    const record: WorktreeRecord = {
      projectId: input.projectId,
      repo: input.repo,
      path: input.path ?? null,
      branch: input.branch ?? null,
      baseBranch: input.baseBranch ?? null,
      prUrl: input.prUrl ?? null,
    };
    return this.mutate<WorktreeRecord>({
      operation: 'worktree.added',
      targetType: 'worktree',
      targetId: worktreeTargetId(record.projectId, record.repo),
      actor,
      before: null,
      after: record,
      write: () => this.insertWorktreeStmt.run(worktreeParams(record)),
    });
  }

  listWorktrees(projectId: string): WorktreeRecord[] {
    return (this.selectWorktreesStmt.all(projectId) as WorktreeRow[]).map(rowToWorktree);
  }

  removeWorktree(projectId: string, repo: string, actor: string | null): Result<void> {
    const before = this.getWorktree(projectId, repo);
    if (!before) return invalidDelta(`worktree '${repo}' does not exist on project '${projectId}'`);
    return this.mutate<void>({
      operation: 'worktree.removed',
      targetType: 'worktree',
      targetId: worktreeTargetId(projectId, repo),
      actor,
      before,
      after: null,
      write: () => this.deleteWorktreeStmt.run(projectId, repo),
    });
  }

  private getWorktree(projectId: string, repo: string): WorktreeRecord | null {
    const row = this.selectWorktreeStmt.get(projectId, repo) as WorktreeRow | undefined;
    return row ? rowToWorktree(row) : null;
  }

  createGroup(input: GroupCreateInput, actor: string | null): Result<GroupRecord> {
    if (input.description.trim().length === 0) {
      return invalidDelta('group description must not be empty');
    }
    if (this.getGroup(input.id)) {
      return invalidDelta(`group '${input.id}' already exists`);
    }
    if (input.parentGroupId != null && !this.getGroup(input.parentGroupId)) {
      return invalidDelta(`parent group '${input.parentGroupId}' does not exist`);
    }
    const now = new Date().toISOString();
    const record: GroupRecord = {
      id: input.id,
      name: input.name ?? null,
      description: input.description,
      parentGroupId: input.parentGroupId ?? null,
      createdAt: now,
      updatedAt: now,
    };
    return this.mutate<GroupRecord>({
      operation: 'group.created',
      targetType: 'group',
      targetId: record.id,
      actor,
      before: null,
      after: record,
      write: () => this.insertGroupStmt.run(groupParams(record)),
    });
  }

  getGroup(id: string): GroupRecord | null {
    const row = this.selectGroupStmt.get(id) as GroupRow | undefined;
    return row ? rowToGroup(row) : null;
  }

  updateGroup(id: string, patch: GroupUpdateInput, actor: string | null): Result<GroupRecord> {
    const before = this.getGroup(id);
    if (!before) return invalidDelta(`group '${id}' does not exist`);
    if (patch.description !== undefined && patch.description.trim().length === 0) {
      return invalidDelta('group description must not be empty');
    }
    const after: GroupRecord = {
      ...before,
      name: patch.name === undefined ? before.name : patch.name,
      description: patch.description ?? before.description,
      updatedAt: new Date().toISOString(),
    };
    return this.mutate<GroupRecord>({
      operation: 'group.updated',
      targetType: 'group',
      targetId: id,
      actor,
      before,
      after,
      write: () => this.updateGroupStmt.run(groupParams(after)),
    });
  }

  deleteGroup(id: string, actor: string | null): Result<void> {
    const before = this.getGroup(id);
    if (!before) return invalidDelta(`group '${id}' does not exist`);
    // Guarded by the schema, not this method: `projects.group_id` and `project_groups.
    // parent_group_id` are both `ON DELETE SET NULL`, so child projects and sub-groups are orphaned
    // to the top level rather than cascading — no manual cascade here.
    return this.mutate<void>({
      operation: 'group.deleted',
      targetType: 'group',
      targetId: id,
      actor,
      before,
      after: null,
      write: () => this.deleteGroupStmt.run(id),
    });
  }

  setProjectGroup(
    projectId: string,
    groupId: string | null,
    actor: string | null,
  ): Result<ProjectRecord> {
    const before = this.getProject(projectId);
    if (!before) return invalidDelta(`project '${projectId}' does not exist`);
    if (groupId != null && !this.getGroup(groupId)) {
      return invalidDelta(`group '${groupId}' does not exist`);
    }
    const after: ProjectRecord = { ...before, groupId, updatedAt: new Date().toISOString() };
    return this.mutate<ProjectRecord>({
      operation: 'project.group_set',
      targetType: 'project',
      targetId: projectId,
      actor,
      before,
      after,
      write: () =>
        this.setProjectGroupStmt.run({ id: projectId, group_id: groupId, updated_at: after.updatedAt }),
    });
  }

  setParentGroup(
    groupId: string,
    parentGroupId: string | null,
    actor: string | null,
  ): Result<GroupRecord> {
    const before = this.getGroup(groupId);
    if (!before) return invalidDelta(`group '${groupId}' does not exist`);
    if (parentGroupId != null) {
      if (parentGroupId === groupId) {
        return invalidDelta(`group '${groupId}' cannot be its own parent`);
      }
      if (!this.getGroup(parentGroupId)) {
        return invalidDelta(`parent group '${parentGroupId}' does not exist`);
      }
    }
    const after: GroupRecord = { ...before, parentGroupId, updatedAt: new Date().toISOString() };
    return this.mutate<GroupRecord>({
      operation: 'group.parent_set',
      targetType: 'group',
      targetId: groupId,
      actor,
      before,
      after,
      write: () =>
        this.setParentGroupStmt.run({
          id: groupId,
          parent_group_id: parentGroupId,
          updated_at: after.updatedAt,
        }),
    });
  }

  listGroupChildren(groupId: string): GroupChildren {
    const projects = (this.selectChildProjectsStmt.all(groupId) as ProjectRow[]).map(rowToProject);
    const subGroups = (this.selectChildGroupsStmt.all(groupId) as GroupRow[]).map(rowToGroup);
    return { projects, subGroups };
  }

  addEdge(
    from: string,
    to: string,
    type: EdgeType,
    actor: string | null,
  ): Result<ProjectEdgeRecord> {
    if (from === to) {
      return invalidDelta(`edge cannot connect '${from}' to itself`);
    }
    if (!this.getProject(from)) return invalidDelta(`project '${from}' does not exist`);
    if (!this.getProject(to)) return invalidDelta(`project '${to}' does not exist`);
    if (this.getEdge(from, to, type)) {
      return invalidDelta(`edge '${from}' -> '${to}' (${type}) already exists`);
    }
    const record: ProjectEdgeRecord = { fromProjectId: from, toProjectId: to, type };
    return this.mutate<ProjectEdgeRecord>({
      operation: 'edge.added',
      targetType: 'edge',
      targetId: edgeTargetId(from, to, type),
      actor,
      before: null,
      after: record,
      // The acyclicity check runs inside the same transaction as the insert (see `mutate`): if `to`
      // can already reach `from` through same-`type` edges, adding `from -> to` would close a cycle,
      // so the check throws to roll back the transaction and surface as a failed Result with no row
      // written — never a pre-check that could race a later insert within this same call.
      write: () => {
        if (this.canReach(to, from, type)) {
          throw new Error(`edge '${from}' -> '${to}' (${type}) would create a cycle`);
        }
        this.insertEdgeStmt.run(edgeParams(record));
      },
    });
  }

  removeEdge(from: string, to: string, type: EdgeType, actor: string | null): Result<void> {
    const before = this.getEdge(from, to, type);
    if (!before) return invalidDelta(`edge '${from}' -> '${to}' (${type}) does not exist`);
    return this.mutate<void>({
      operation: 'edge.removed',
      targetType: 'edge',
      targetId: edgeTargetId(from, to, type),
      actor,
      before,
      after: null,
      write: () => this.deleteEdgeStmt.run(from, to, type),
    });
  }

  listEdgesFrom(projectId: string): ProjectEdgeRecord[] {
    return (this.selectEdgesFromStmt.all(projectId) as EdgeRow[]).map(rowToEdge);
  }

  listEdgesTo(projectId: string): ProjectEdgeRecord[] {
    return (this.selectEdgesToStmt.all(projectId) as EdgeRow[]).map(rowToEdge);
  }

  private getEdge(from: string, to: string, type: EdgeType): ProjectEdgeRecord | null {
    const row = this.selectEdgeStmt.get(from, to, type) as EdgeRow | undefined;
    return row ? rowToEdge(row) : null;
  }

  /**
   * Bounded BFS from `start`, scoped to a single edge `type`, answering whether `target` is
   * reachable — `addEdge`'s cycle guard calls this as `canReach(to, from, type)` to ask "does `to`
   * already reach `from`", since a `from -> to` edge would close that path into a cycle. Scoping the
   * walk to one `type` is what keeps the `follows` and `spawned-from` graphs independent DAGs — a
   * cycle in one type never blocks a legal edge of the other type between the same pair. Each step
   * is a single indexed lookup (the `project_edges` primary key leads with `from_project_id`), and
   * the portfolio graph is small enough that this per-call walk needs no separate closure table.
   */
  private canReach(start: string, target: string, type: EdgeType): boolean {
    const visited = new Set<string>([start]);
    const queue: string[] = [start];
    while (queue.length > 0) {
      const current = queue.shift() as string;
      const neighbors = this.selectOutgoingByTypeStmt.all(current, type) as {
        to_project_id: string;
      }[];
      for (const { to_project_id: next } of neighbors) {
        if (next === target) return true;
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      }
    }
    return false;
  }
}

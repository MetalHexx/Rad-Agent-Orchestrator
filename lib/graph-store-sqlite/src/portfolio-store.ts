import path from 'node:path';
import type Database from 'better-sqlite3';
import type { Result } from '@rad-orchestration/graph-engine';
import type {
  PortfolioStore,
  PortfolioTargetType,
  ProjectCreateInput,
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
}

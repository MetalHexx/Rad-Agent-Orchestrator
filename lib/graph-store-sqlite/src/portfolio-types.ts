import type { Result } from '@rad-orchestration/graph-engine';

/** Lifecycle status of a project (`projects.status`). */
export type ProjectStatus = 'planning' | 'in_progress' | 'done' | 'archived';

/** Source-control automation policy for a project's `auto_commit` / `auto_pr` columns. */
export type AutoPolicy = 'ask' | 'always' | 'never';

/**
 * The entity kinds `SqlitePortfolioStore`'s private mutate-and-audit helper accepts as
 * `portfolio_change_log.target_type`. `project` and `worktree` are implemented by this task;
 * `group`/`edge`/`doc`/`external_ref` are reserved for the portfolio entities later tasks add
 * against this same store and audit spine.
 */
export type PortfolioTargetType = 'project' | 'group' | 'edge' | 'doc' | 'worktree' | 'external_ref';

/** A `projects` row, camelCased for the store's public surface. */
export interface ProjectRecord {
  readonly id: string;
  readonly projectType: string | null;
  readonly status: ProjectStatus;
  readonly groupId: string | null;
  readonly autoCommit: AutoPolicy;
  readonly autoPr: AutoPolicy;
  readonly sourceControlInitialized: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Caller-supplied fields for `createProject`. An omitted field takes the store's default:
 * `status: 'planning'`, `autoCommit`/`autoPr: 'ask'`, `sourceControlInitialized: false`.
 */
export interface ProjectCreateInput {
  readonly id: string;
  readonly projectType?: string | null;
  readonly status?: ProjectStatus;
  readonly groupId?: string | null;
  readonly autoCommit?: AutoPolicy;
  readonly autoPr?: AutoPolicy;
  readonly sourceControlInitialized?: boolean;
}

/**
 * Caller-supplied fields for `updateProject` — status and the source-control policy pair only, per
 * the task's scope for this entity. An omitted field leaves that column unchanged.
 */
export interface ProjectUpdateInput {
  readonly status?: ProjectStatus;
  readonly autoCommit?: AutoPolicy;
  readonly autoPr?: AutoPolicy;
}

/**
 * A `worktrees` row, camelCased for the store's public surface. `path`, when present, is always a
 * relative, POSIX-separated ref under `~/.radorc/worktrees` — the store never derives or stores an
 * absolute path.
 */
export interface WorktreeRecord {
  readonly projectId: string;
  readonly repo: string;
  readonly path: string | null;
  readonly branch: string | null;
  readonly baseBranch: string | null;
  readonly prUrl: string | null;
}

/** Caller-supplied fields for `addWorktree`. */
export interface WorktreeInput {
  readonly projectId: string;
  readonly repo: string;
  readonly path?: string | null;
  readonly branch?: string | null;
  readonly baseBranch?: string | null;
  readonly prUrl?: string | null;
}

/**
 * The portfolio graph's CRUD surface — distinct from the engine's `StateStore`, since projects,
 * worktrees, and the rest of the portfolio graph are host-managed metadata, not execution-DAG
 * state. Every mutation returns a `Result` and writes exactly one `portfolio_change_log` row in the
 * same transaction as its data change; every read is a plain, non-transactional query.
 */
export interface PortfolioStore {
  createProject(input: ProjectCreateInput, actor: string | null): Result<ProjectRecord>;
  getProject(id: string): ProjectRecord | null;
  listProjects(): ProjectRecord[];
  updateProject(
    id: string,
    patch: ProjectUpdateInput,
    actor: string | null,
  ): Result<ProjectRecord>;
  deleteProject(id: string, actor: string | null): Result<void>;

  addWorktree(input: WorktreeInput, actor: string | null): Result<WorktreeRecord>;
  listWorktrees(projectId: string): WorktreeRecord[];
  removeWorktree(projectId: string, repo: string, actor: string | null): Result<void>;
}

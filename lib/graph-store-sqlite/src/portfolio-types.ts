import type { Result } from '@rad-orchestration/graph-engine';

/** Lifecycle status of a project (`projects.status`). */
export type ProjectStatus = 'planning' | 'in_progress' | 'done' | 'archived';

/** Source-control automation policy for a project's `auto_commit` / `auto_pr` columns. */
export type AutoPolicy = 'ask' | 'always' | 'never';

/**
 * The entity kinds `SqlitePortfolioStore`'s private mutate-and-audit helper accepts as
 * `portfolio_change_log.target_type`. `project`, `worktree`, `group`, and `edge` are implemented;
 * `doc`/`external_ref` are reserved for the portfolio entities later tasks add against this same
 * store and audit spine.
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

/** A `project_groups` row, camelCased for the store's public surface. */
export interface GroupRecord {
  readonly id: string;
  readonly name: string | null;
  readonly description: string;
  readonly parentGroupId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Caller-supplied fields for `createGroup`. `description` is required and rejected when empty. */
export interface GroupCreateInput {
  readonly id: string;
  readonly description: string;
  readonly name?: string | null;
  readonly parentGroupId?: string | null;
}

/**
 * Caller-supplied fields for `updateGroup` — name and description only; containment
 * (`parentGroupId`) moves through `setParentGroup` instead. An omitted field leaves that column
 * unchanged.
 */
export interface GroupUpdateInput {
  readonly name?: string | null;
  readonly description?: string;
}

/** `listGroupChildren`'s result: a group's direct project members and direct sub-groups. */
export interface GroupChildren {
  readonly projects: readonly ProjectRecord[];
  readonly subGroups: readonly GroupRecord[];
}

/**
 * The relation a `project_edges` row expresses between two projects. Acyclicity is enforced by
 * `SqlitePortfolioStore#addEdge` independently per `type` — a `follows` cycle and a `spawned-from`
 * cycle are unrelated checks, so an edge of one type never blocks a legal edge of the other type
 * between the same pair.
 */
export type EdgeType = 'follows' | 'spawned-from';

/** A `project_edges` row, camelCased for the store's public surface. */
export interface ProjectEdgeRecord {
  readonly fromProjectId: string;
  readonly toProjectId: string;
  readonly type: EdgeType;
}

/**
 * An `external_refs` row, camelCased for the store's public surface. `system` + `externalId` is the
 * deduplication key (`UNIQUE (system, external_id)`); `parentRefId` is self-referential and captures
 * the external hierarchy (e.g. a subtask row points at its story row). `data` is an opaque JSON
 * string — the store never parses or interprets it, it is the reserved sync bag for later tasks.
 */
export interface ExternalRefRecord {
  readonly id: string;
  readonly system: string;
  readonly externalId: string;
  readonly url: string | null;
  readonly refType: string | null;
  readonly parentRefId: string | null;
  readonly data: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Caller-supplied fields for `upsertExternalRef`. `system` + `externalId` locate an existing row
 * (dedup key); `parentRefId` is only honored on first insert — an existing row's hierarchy position
 * is not moved by a later upsert.
 */
export interface ExternalRefUpsertInput {
  readonly system: string;
  readonly externalId: string;
  readonly url: string | null;
  readonly refType?: string | null;
  readonly parentRefId?: string | null;
  readonly data?: string | null;
}

/** The relation a `project_external_refs` row expresses between a project and an external ticket. */
export type RefRelation = 'implements' | 'fixes' | 'references';

/** A `project_external_refs` row, camelCased for the store's public surface. */
export interface ProjectExternalRefRecord {
  readonly projectId: string;
  readonly externalRefId: string;
  readonly relation: RefRelation | null;
  readonly isPrimary: boolean;
}

/** Caller-supplied fields for `linkProjectToRef`. An omitted field takes the store's default:
 * `relation: null`, `isPrimary: false`. */
export interface LinkProjectToRefInput {
  readonly relation?: RefRelation | null;
  readonly isPrimary?: boolean;
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

  createGroup(input: GroupCreateInput, actor: string | null): Result<GroupRecord>;
  getGroup(id: string): GroupRecord | null;
  updateGroup(id: string, patch: GroupUpdateInput, actor: string | null): Result<GroupRecord>;
  deleteGroup(id: string, actor: string | null): Result<void>;
  setProjectGroup(
    projectId: string,
    groupId: string | null,
    actor: string | null,
  ): Result<ProjectRecord>;
  setParentGroup(
    groupId: string,
    parentGroupId: string | null,
    actor: string | null,
  ): Result<GroupRecord>;
  listGroupChildren(groupId: string): GroupChildren;

  addEdge(
    fromProjectId: string,
    toProjectId: string,
    type: EdgeType,
    actor: string | null,
  ): Result<ProjectEdgeRecord>;
  removeEdge(
    fromProjectId: string,
    toProjectId: string,
    type: EdgeType,
    actor: string | null,
  ): Result<void>;
  listEdgesFrom(projectId: string): ProjectEdgeRecord[];
  listEdgesTo(projectId: string): ProjectEdgeRecord[];

  upsertExternalRef(input: ExternalRefUpsertInput, actor: string | null): Result<ExternalRefRecord>;
  getExternalRef(id: string): ExternalRefRecord | null;
  listChildRefs(parentRefId: string): ExternalRefRecord[];

  linkProjectToRef(
    projectId: string,
    externalRefId: string,
    input: LinkProjectToRefInput,
    actor: string | null,
  ): Result<ProjectExternalRefRecord>;
  unlinkProjectFromRef(
    projectId: string,
    externalRefId: string,
    actor: string | null,
  ): Result<void>;
  listRefsForProject(projectId: string): ProjectExternalRefRecord[];
  listProjectsForRef(externalRefId: string): ProjectExternalRefRecord[];
}

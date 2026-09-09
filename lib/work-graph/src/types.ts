import type { ProjectState } from './derive/project-state.js';

export type NodeId = string;
export type NodeKind = 'group' | 'project';
export type NodeStatus =
  | 'not_started' | 'in_progress' | 'blocked' | 'done' | 'skipped' | 'unknown';
export type Tier = 'planning' | 'execution' | 'review' | 'halted' | 'complete';

export interface Node {
  id: NodeId; kind: NodeKind; name: string; status: NodeStatus;
  /** The canonical answer to "what state is this node in" — see `deriveProjectState`. */
  state: ProjectState;
  /** Display label for `state`; always `PROJECT_STATE_LABELS[state]`. */
  stateLabel: string;
}
export interface Group extends Node { kind: 'group'; description: string; }

/** The closed vocabulary for "what kind of project directory is this?". Exported as a value so a
 *  consumer can iterate it rather than re-listing the literals. */
export const PROJECT_KINDS = ['standard', 'side-project', 'portfolio'] as const;
export type ProjectKind = typeof PROJECT_KINDS[number];

export interface ProjectDocs {
  brainstorming?: string;
  requirements?: string;
  masterPlan?: string;
  /** The portfolio root document — present only for a portfolio root. */
  root?: string;
  others: string[];
  /** Sorted names of subdirectories in the project folder (e.g. ['phases', 'reports', 'reviews', 'tasks']).
   *  Names only — the scan stays non-recursive and never enumerates their contents. */
  subfolders: string[];
}
export interface WorktreeRef {
  repo: string;
  path: string;
  branch: string | null;
  exists: boolean;
  resolvedVia: 'convention' | 'shared-worktree-name' | 'git' | 'registry-clone';
}
export interface Project extends Node {
  kind: 'project';
  dir: string;
  /** Diagnostic pipeline-stage detail, subordinate to the inherited `state`/`stateLabel` —
   *  never the canonical answer to "what state is this project in". See `DerivedProjectState.tier`. */
  tier: Tier | null;
  projectType: ProjectKind;
  sourceControlInitialized: boolean;
  docs: ProjectDocs;
  worktrees: WorktreeRef[];
  /** `pipeline.halt_reason` when a non-empty string is recorded, else null. A project can be
   *  halted with no reason; null and "halted" are independent facts. */
  haltReason: string | null;
}

/** Vocabulary: `contains`, `follows`, `depends-on`, `spawned-from`. Open-ended for forward compatibility. */
export type EdgeType = 'contains' | 'follows' | 'depends-on' | 'spawned-from' | (string & {});
export interface Edge { type: EdgeType; from: NodeId; to: NodeId; }

export interface StoredGroup { name: string; description: string; }
export interface StoredGraph {
  version: number;
  rev: number;
  groups: Record<string, StoredGroup>;
  edges: Edge[];
}

export type WorkGraphErrorCode = 'validation' | 'stale_revision';
export interface WorkGraphError { code: WorkGraphErrorCode; message: string; }
export type Result<T> = { ok: true; data: T } | { ok: false; error: WorkGraphError };

export const PROJECTION_SCHEMA = 'work-graph/v1' as const;
export interface GraphDTO {
  schema: typeof PROJECTION_SCHEMA;
  nodes: Node[];
  edges: Edge[];
  danglingEdges: Edge[];
}

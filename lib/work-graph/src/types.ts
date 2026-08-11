export type NodeId = string;
export type NodeKind = 'group' | 'project';
export type NodeStatus =
  | 'not_started' | 'in_progress' | 'blocked' | 'done' | 'skipped' | 'unknown';
export type Tier = 'planning' | 'execution' | 'review' | 'halted';

export interface Node { id: NodeId; kind: NodeKind; name: string; status: NodeStatus; }
export interface Group extends Node { kind: 'group'; description: string; }

export interface ProjectDocs {
  brainstorming?: string;
  requirements?: string;
  masterPlan?: string;
  others: string[];
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
  tier: Tier | null;
  projectType: 'standard' | 'side-project';
  sourceControlInitialized: boolean;
  docs: ProjectDocs;
  worktrees: WorktreeRef[];
}

export type EdgeType = 'contains' | 'spawned-from' | 'follows' | (string & {});
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

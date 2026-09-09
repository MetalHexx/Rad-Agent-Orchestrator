// ui/types/work-graph.ts
// Response shape for GET /api/work-graph. Pure type declarations — no runtime code.

import type { CSSProperties } from 'react';
import type { ProjectKind, ProjectState } from '@rad-orchestration/work-graph';

export type WorkGraphTier = 'planning' | 'execution' | 'review' | 'halted' | 'complete';

export type StartFrom = 'oldest' | 'newest';

/** The four rows the edge-visibility control always renders. `'other'` covers
 *  any relationship edge type outside the three named ones. `contains` is
 *  never a member — it is the containment frame, not a drawn relationship. */
export type EdgeTypeKey = 'follows' | 'depends-on' | 'spawned-from' | 'other';

export interface WorkGraphGroupDTO {
  id: string;
  kind: 'group';
  name: string;
}

export interface WorkGraphProjectDTO {
  id: string;
  kind: 'project';
  name: string;
  tier: WorkGraphTier | null;
  /** The one canonical answer to "what state is this project in?" — see `@rad-orchestration/work-graph#deriveProjectState`. */
  state: ProjectState;
  /** Always `PROJECT_STATE_LABELS[state]` — the only user-visible state word every badge renders. */
  stateLabel: string;
  /** The project's kind, from the library's derivation — see `@rad-orchestration/work-graph`. */
  projectType: ProjectKind;
}

export type WorkGraphNodeDTO = WorkGraphGroupDTO | WorkGraphProjectDTO;

export interface WorkGraphEdgeDTO {
  type: string;
  from: string;
  to: string;
  /** true when this edge type asserts an ordering — see @rad-orchestration/work-graph */
  ranking: boolean;
}

export interface WorkGraphGroupRef {
  id: string;
  name: string;
}

export interface WorkGraphResponse {
  schema: 'work-graph/v1';
  nodes: WorkGraphNodeDTO[];
  edges: WorkGraphEdgeDTO[];
  /** EVERY group in the graph, independent of the requested scope — this is what
   *  populates the Group select, which must list all groups even while scoped. */
  groups: WorkGraphGroupRef[];
  danglingEdgeCount: number;
}

/** React Flow v12 requires node data to be an index-signature record. */
export interface WorkGraphProjectData {
  id: string;
  label: string;
  tier: WorkGraphTier | 'not_initialized';
  /** The one canonical answer to "what state is this project in?" — see `@rad-orchestration/work-graph#deriveProjectState`. */
  state: ProjectState;
  /** Always `PROJECT_STATE_LABELS[state]` — the only user-visible state word every badge renders. */
  stateLabel: string;
  /** The project's kind, from the library's derivation — see `@rad-orchestration/work-graph`. */
  projectType: ProjectKind;
  [key: string]: unknown;
}

export interface WorkGraphContainerData {
  id: string;
  label: string;
  /** projects CURRENTLY DRAWN inside this container — under a filter it is the visible count */
  count: number;
  /** true only for the synthetic Ungrouped container */
  synthetic: boolean;
  [key: string]: unknown;
}

export interface WorkGraphFlowNode {
  id: string;
  type: 'workGraphProject' | 'workGraphContainer';
  position: { x: number; y: number };
  data: WorkGraphProjectData | WorkGraphContainerData;
  parentId?: string;
  extent?: 'parent';
  style?: CSSProperties;
}

export interface WorkGraphFlowEdge {
  id: string;
  source: string;
  target: string;
  type: 'smoothstep';
  markerEnd: { type: 'arrowclosed' };
  label: string;
  animated: false;
  ranking: boolean;
  style?: CSSProperties;
  sourceHandle?: string;   // assigned by the layout module, not here
  targetHandle?: string;
}

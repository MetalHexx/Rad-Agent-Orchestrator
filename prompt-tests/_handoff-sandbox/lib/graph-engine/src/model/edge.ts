import type { NodeId } from './node.js';

/**
 * Dependency edge kinds. Kept a union (not a single literal field) even though `'depends_on'`
 * is the only member this iteration ships, so a later iteration can add edge kinds without
 * reshaping `DagEdge`.
 */
export type EdgeKind = 'depends_on';

/**
 * A typed dependency edge between two nodes. Readiness reads these; steering edits these.
 */
export interface DagEdge {
  from: NodeId;
  to: NodeId;
  kind: EdgeKind;
}

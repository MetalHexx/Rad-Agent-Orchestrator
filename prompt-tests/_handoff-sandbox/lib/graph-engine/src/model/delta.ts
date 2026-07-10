import type { DagNode } from './node.js';
import type { DagEdge } from './edge.js';
import type { PrimitiveName } from './vocab.js';

/** The three shapes a structural change to a node or edge can take. */
export type ChangeOp = 'created' | 'updated' | 'removed';

export interface NodeChange {
  op: ChangeOp;
  before: DagNode | null;
  after: DagNode | null;
}

export interface EdgeChange {
  op: ChangeOp;
  before: DagEdge | null;
  after: DagEdge | null;
}

/**
 * The structural diff every mutation primitive returns. Deliberately stamps no time/actor —
 * the engine stays deterministic; a host stamps sequence/time/actor when it persists the delta.
 */
export interface ChangeDelta {
  primitive: PrimitiveName;
  params: Readonly<Record<string, unknown>>;
  nodeChanges: NodeChange[];
  edgeChanges: EdgeChange[];
}

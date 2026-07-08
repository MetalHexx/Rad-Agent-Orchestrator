import type { NodeStatus, NodeTypeName } from './vocab.js';

/** Stable, opaque node identifier. Never positional — never an array index or sibling order. */
export type NodeId = string;

/**
 * The single envelope shape every node in the DAG shares, regardless of node type. `type` is a
 * namespaced string resolved later through the node-type registry — core never hardcodes a kind
 * switch over it. `depends_on` is deliberately not a field here: dependency edges are the edge
 * set (`DagEdge`), not node-local state, so readiness and steering both operate on the edge set
 * rather than on per-node dependency lists.
 */
export interface DagNode {
  id: NodeId;
  type: NodeTypeName;
  status: NodeStatus;
  /** Containment parent; `null` only for the project-scoped root. */
  parent: NodeId | null;
  /** Authored sibling display/pick order — advisory only, never read by the frontier. */
  order: number;
  /** Provenance: corrective chain / expansion child / offshoot. `null` for an authored node. */
  derivedFrom: NodeId | null;
  /** Node-type-owned payload; opaque to the core engine. */
  data: Readonly<Record<string, unknown>>;
}

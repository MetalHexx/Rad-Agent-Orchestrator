import type { NodeId, DagNode } from '../model/node.js';
import type { DagEdge } from '../model/edge.js';
import type { ChangeDelta } from '../model/delta.js';
import type { Result } from '../result.js';

/**
 * An opaque handle scoping every `StateStore` operation to one project's graph — never a session
 * id. A single store backs many scopes side-by-side (no single-global-graph assumption); a
 * concrete store is free to back this however suits it (e.g. a `project_id`-partitioned SQLite
 * table for a later store), and the engine never inspects or branches on its shape.
 */
export interface ProjectScope {
  readonly projectId: string;
}

/**
 * The persistence seam the engine reads and writes through — storage-agnostic and scope-aware, so
 * a later store (e.g. SQLite) can replace the in-memory one without the engine noticing.
 *
 * `apply` is the sole write path: there is no `setNode`/`addEdge` back door. The mutation
 * primitives are the only producers of a `ChangeDelta`; the store only ever applies one, so it is
 * never a second author of graph shape.
 */
export interface StateStore {
  getNode(scope: ProjectScope, id: NodeId): DagNode | null;
  listNodes(scope: ProjectScope): DagNode[];
  listEdges(scope: ProjectScope): DagEdge[];
  apply(scope: ProjectScope, delta: ChangeDelta): Result<void>;
}

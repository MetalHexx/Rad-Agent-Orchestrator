import type { DagNode, NodeId } from './node.js';
import type { Trait } from './vocab.js';

/**
 * Reserved, stable id for the project-scoped root anchor. `add_node` (a later task) requires a
 * registry-resolved type and can never produce this id — it is reserved for the one system-minted
 * node every scope is seeded with.
 */
export const ROOT_NODE_ID: NodeId = 'root';

/**
 * The trait the root anchor carries directly, bypassing any node-type-registry lookup. An
 * ordinary node earns a trait by having a `type` the (not-yet-built) registry resolves to that
 * trait; the root has no registered type to resolve against, so its trait membership is asserted
 * here instead of derived — the never-null-context invariant rides on this trait, never on a type
 * name.
 */
export const ROOT_TRAITS: readonly Trait[] = ['contains'];

/**
 * Mints the system-owned singleton root `DagNode`, outside the node-type registry. `parent` is
 * `null` (it is the one node with no container) and `status` starts `in_progress` — entered
 * vacuously, never transitioned into via the ordinary node lifecycle. Every scope a `StateStore`
 * backs is seeded with exactly one of these on first touch, so working-context is never null and
 * the top-level spine is frontier-eligible on tick one. Returns a fresh object per call so
 * independent scopes never share (and mutate) the same node instance.
 */
export function createRootNode(): DagNode {
  return {
    id: ROOT_NODE_ID,
    type: 'system:root',
    status: 'in_progress',
    parent: null,
    order: 0,
    derivedFrom: null,
    data: {},
  };
}

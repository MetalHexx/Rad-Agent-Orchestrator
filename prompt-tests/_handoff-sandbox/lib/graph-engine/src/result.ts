// The `Result<T>` + `EngineError` idiom every fallible engine operation returns instead of
// throwing for expected failures — mirrors `lib/work-graph`'s
// `Result<T> = { ok: true; data: T } | { ok: false; error }` discriminated union.

/**
 * The closed vocabulary of engine failure reasons. `invalid_delta` is the one this package's own
 * `StateStore.apply` produces today (a structurally malformed delta — e.g. removing a node that
 * doesn't exist). The rest are reserved for the mutation primitives shipped in a later task against
 * this same idiom: `unknown_node_type` (`add_node` against a type the registry can't resolve),
 * `cycle` (a `depends_on` edge that would cycle, or a re-parent that would create a containment
 * cycle), `cross_axis_cycle` (an `add_dependency`/`move_node` that would relate two nodes by both
 * containment and `depends_on` — each axis is acyclic on its own, but the combination drives
 * `derive/readiness.ts`'s frontier resolution into unbounded mutual recursion), `not_in_frontier`
 * (an execution guard), and `root_guarded` (the project-scoped root's `remove_node`/`move_node`
 * guard).
 */
export type EngineErrorCode =
  | 'invalid_delta'
  | 'unknown_node_type'
  | 'cycle'
  | 'cross_axis_cycle'
  | 'not_in_frontier'
  | 'root_guarded';

/** A structured engine failure: a closed-vocabulary `code` plus a human-readable `message`. */
export interface EngineError {
  code: EngineErrorCode;
  message: string;
}

/** The outcome of a fallible engine operation — never a thrown exception for expected failures. */
export type Result<T> = { ok: true; data: T } | { ok: false; error: EngineError };

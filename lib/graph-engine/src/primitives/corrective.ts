import type { NodeId, DagNode } from '../model/node.js';
import type { DagEdge } from '../model/edge.js';
import type { NodeTypeName } from '../model/vocab.js';
import type { ChangeDelta, NodeChange } from '../model/delta.js';
import type { Result } from '../result.js';
import type { GraphSnapshot } from '../derive/invariants.js';
import { validate } from '../derive/dry-run.js';
import type { PrimitiveContext } from './primitive.js';
import { fail, findNode, runPrimitive } from './primitive.js';

/** The host-config retry budget's built-in fallback when a caller doesn't supply one. */
const DEFAULT_MAX_RETRIES = 5;

export interface AddCorrectiveOptions {
  readonly order?: number;
  readonly data?: Readonly<Record<string, unknown>>;
  /**
   * Max correctives allowed behind one `review` before `add_corrective` halts instead of minting
   * another. Host config (`orchestration.yml`'s `max_retries_per_task`); defaults to `5`.
   */
  readonly maxRetries?: number;
}

/**
 * The tip of the corrective chain currently gating `review` — the original attempt on the first
 * cycle, the most recently minted corrective thereafter — plus how many correctives already sit
 * behind it. Found by walking `review`'s existing `depends_on` predecessors: the tip is whichever
 * predecessor no sibling predecessor names as its own `derivedFrom` (the chain's newest link); depth
 * is how many `derivedFrom` hops separate it from the first predecessor outside that predecessor
 * set (the original attempt, whose own `derivedFrom` — if any — points at something unrelated, e.g.
 * the expansion that seeded it). `null` when `review` has no predecessor at all — nothing to derive
 * a corrective's container or provenance from.
 */
function resolveChainTip(graph: GraphSnapshot, review: NodeId): { tip: DagNode; depth: number } | null {
  const predecessorIds = graph.edges
    .filter((edge) => edge.kind === 'depends_on' && edge.to === review)
    .map((edge) => edge.from);
  if (predecessorIds.length === 0) return null;

  const predecessors = predecessorIds
    .map((id) => findNode(graph, id))
    .filter((n): n is DagNode => n !== undefined);
  const predecessorIdSet = new Set(predecessors.map((n) => n.id));

  const referencedAsDerivedFrom = new Set(
    predecessors
      .map((n) => n.derivedFrom)
      .filter((id): id is NodeId => id !== null && predecessorIdSet.has(id)),
  );
  const tip = predecessors.find((n) => !referencedAsDerivedFrom.has(n.id)) ?? predecessors[predecessors.length - 1];

  let depth = 0;
  let current: DagNode | undefined = tip;
  while (current && current.derivedFrom !== null && predecessorIdSet.has(current.derivedFrom)) {
    depth++;
    current = findNode(graph, current.derivedFrom);
  }

  return { tip, depth };
}

/**
 * The additive-iteration compound primitive: births a fresh corrective attempt for `review` and
 * re-arms `review` behind it, all in one delta. `id`/`type` name the new corrective node exactly
 * like `add_node` would; `review` is the `code_review` (or `phase_review`/final-review) node the
 * corrective answers.
 *
 * Within budget, this: creates the corrective — `derivedFrom` the chain's current tip (the original
 * attempt on the first cycle, the prior corrective thereafter), parented in that same tip's own
 * container (the phase container at task/phase level, the project-scoped root for a spine-level
 * final review — read straight off the tip, never special-cased per level), entering with no new
 * `depends_on` of its own so it is frontier-eligible as soon as its container is `in_progress`; adds
 * a `depends_on` edge gating `review` on the new corrective; and flips `review` back to
 * `not_started`. This is deliberately additive, never removing an earlier attempt's own gate edge
 * into `review`: `resolveChainTip` (above) walks that exact stack of surviving predecessor edges to
 * find both the chain's current tip and how deep it runs, so the stack itself *is* the chain's
 * provenance record, not incidental leftovers. It is harmless to readiness — every stale predecessor
 * is already `done` and stays that way outside an explicit `reset`, so `review` still only actually
 * re-enters the frontier once the newest corrective reaches `done` (frontier requires *every*
 * predecessor done, and the older ones already are). Every attempt is a distinct node — this only
 * ever adds a forward edge onto the newest node, never rewrites or removes an earlier one, so the
 * chain (and the wider graph) stays acyclic; `validate` still runs the P02 cycle check over the new
 * edge as a defence-in-depth assertion of that.
 *
 * At the retry budget (`options.maxRetries`, default `5`): counts the corrective chain depth already
 * behind `review` and, once it is met or exceeded, halts instead of minting another — a
 * frontier-exclusion (`review.disabled = true`) rather than a rejection, since the budget running
 * out is an expected, successful outcome of the policy, not a structural error.
 */
export function add_corrective(
  ctx: PrimitiveContext,
  id: NodeId,
  type: NodeTypeName,
  review: NodeId,
  options: AddCorrectiveOptions = {},
): Result<ChangeDelta> {
  return runPrimitive(ctx, (graph) => {
    const reviewNode = findNode(graph, review);
    if (!reviewNode) return fail('invalid_delta', `review node '${review}' does not exist`);
    if (reviewNode.status !== 'done' && reviewNode.status !== 'in_progress') {
      return fail(
        'invalid_delta',
        `review '${review}' has status '${reviewNode.status}'; add_corrective only re-arms a 'done'/'in_progress' review`,
      );
    }

    const chain = resolveChainTip(graph, review);
    if (!chain) return fail('invalid_delta', `review '${review}' has no predecessor to derive a corrective from`);

    const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;

    if (chain.depth >= maxRetries) {
      const haltedReview: DagNode = { ...reviewNode, disabled: true };
      return {
        ok: true,
        data: {
          primitive: 'add_corrective',
          params: { id, type, review, maxRetries, chainDepth: chain.depth, halted: true },
          nodeChanges: [{ op: 'updated', before: reviewNode, after: haltedReview }],
          edgeChanges: [],
        },
      };
    }

    if (findNode(graph, id)) return fail('invalid_delta', `node '${id}' already exists`);
    if (chain.tip.parent === null) {
      return fail('invalid_delta', `'${chain.tip.id}' has no container to parent a corrective under`);
    }

    const corrective: DagNode = {
      id,
      type,
      status: 'not_started',
      parent: chain.tip.parent,
      order: options.order ?? 0,
      derivedFrom: chain.tip.id,
      data: options.data ?? {},
    };

    const edge: DagEdge = { from: id, to: review, kind: 'depends_on' };
    const validated = validate(graph, { kind: 'add_dependency', from: id, to: review });
    if (!validated.ok) return validated;

    const resetReview: DagNode = { ...reviewNode, status: 'not_started' };

    const nodeChanges: NodeChange[] = [
      { op: 'created', before: null, after: corrective },
      { op: 'updated', before: reviewNode, after: resetReview },
    ];

    return {
      ok: true,
      data: {
        primitive: 'add_corrective',
        params: { id, type, review, maxRetries, chainDepth: chain.depth, halted: false },
        nodeChanges,
        edgeChanges: [{ op: 'created', before: null, after: edge }],
      },
    };
  });
}

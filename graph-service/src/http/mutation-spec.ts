// graph-service/src/http/mutation-spec.ts — the one pinned request shape `/engine-graph/steer` and
// `/engine-graph/dry-run` both parse through for the six primitive kinds the engine's own
// `MutationSpec` union covers (steer commits it, dry-run reads it) — the shape the Phase Plan's
// Integration Seams section calls out. Field names mirror the engine primitives' own argument lists
// (`nodeId`/`newParent`/`strategy`), never a route-local rename, so a client's dry-run body for one
// of these six kinds is byte-for-byte reusable as its steer body. `steer`'s five primitives outside
// this union (`add_node`, `remove_dependency`, `set_order`, `toggle`, `resume`) have no dry-run
// equivalent to share and stay parsed locally in `steer.ts`.
import type {
  AddCorrectiveOptions,
  Expansion,
  MutationSpec,
  NodeId,
  NodeTypeName,
  NodeTypeRegistry,
  RemoveNodeStrategy,
} from '@rad-orchestration/graph-engine';
import type { Envelope } from './respond.js';
import { err, ok } from './respond.js';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * The one request shape shared by `steer` and `dry-run` for the six primitive kinds the engine's
 * `MutationSpec` union covers. `remove_node` carries the full `RemoveNodeStrategy` the primitive
 * itself takes — never the two-boolean `cascade`/`dependentsCascade` projection `MutationSpec`
 * derives internally — {@link toEngineMutationSpec} does that translation for the read-only route.
 */
export type SharedMutationRequest =
  | { readonly kind: 'add_dependency'; readonly from: NodeId; readonly to: NodeId }
  | { readonly kind: 'remove_node'; readonly nodeId: NodeId; readonly strategy: RemoveNodeStrategy }
  | { readonly kind: 'move_node'; readonly nodeId: NodeId; readonly newParent: NodeId }
  | { readonly kind: 'expand'; readonly node: NodeId; readonly expansion: Expansion }
  | {
      readonly kind: 'add_corrective';
      readonly review: NodeId;
      readonly id: NodeId;
      readonly type: NodeTypeName;
      readonly options?: AddCorrectiveOptions;
    }
  | { readonly kind: 'reset'; readonly node: NodeId; readonly cascade: boolean };

/** The six primitive kinds `SharedMutationRequest` covers — every `MutationSpec.kind`. */
export const SHARED_MUTATION_KINDS = [
  'add_dependency',
  'remove_node',
  'move_node',
  'expand',
  'add_corrective',
  'reset',
] as const;

export type SharedMutationKind = (typeof SHARED_MUTATION_KINDS)[number];

export function isSharedMutationKind(value: unknown): value is SharedMutationKind {
  return typeof value === 'string' && (SHARED_MUTATION_KINDS as readonly string[]).includes(value);
}

/**
 * Parses `raw`'s fields against `kind` into the one shared shape both routes commit/read through.
 * `kind` is a separate argument rather than read off `raw.kind` so the same parser serves a dry-run
 * body (`{ mutation: { kind, ...fields } }`, `kind` inlined into the same object) and a steer body
 * (`{ primitive, params: { ...fields } }`, `kind` carried by `primitive` instead, `params` holding
 * only the fields). Always fails with the generic `invalid_request` shape-validation code; each
 * caller maps a failure into whatever return type its own route needs (`dry-run` hands it straight
 * to `c.json`, `steer` re-wraps the message through its own `invalid_delta`-coded `Result`).
 */
export function parseSharedMutation(
  kind: 'add_dependency',
  raw: unknown,
): Envelope<Extract<SharedMutationRequest, { kind: 'add_dependency' }>>;
export function parseSharedMutation(
  kind: 'remove_node',
  raw: unknown,
): Envelope<Extract<SharedMutationRequest, { kind: 'remove_node' }>>;
export function parseSharedMutation(
  kind: 'move_node',
  raw: unknown,
): Envelope<Extract<SharedMutationRequest, { kind: 'move_node' }>>;
export function parseSharedMutation(
  kind: 'expand',
  raw: unknown,
): Envelope<Extract<SharedMutationRequest, { kind: 'expand' }>>;
export function parseSharedMutation(
  kind: 'add_corrective',
  raw: unknown,
): Envelope<Extract<SharedMutationRequest, { kind: 'add_corrective' }>>;
export function parseSharedMutation(
  kind: 'reset',
  raw: unknown,
): Envelope<Extract<SharedMutationRequest, { kind: 'reset' }>>;
export function parseSharedMutation(kind: SharedMutationKind, raw: unknown): Envelope<SharedMutationRequest>;
export function parseSharedMutation(kind: SharedMutationKind, raw: unknown): Envelope<SharedMutationRequest> {
  if (!isPlainObject(raw)) return err('invalid_request', `'${kind}' requires an object of fields`);

  switch (kind) {
    case 'add_dependency': {
      const { from, to } = raw;
      if (!isNonEmptyString(from) || !isNonEmptyString(to)) {
        return err('invalid_request', "'add_dependency' requires string 'from' and 'to'");
      }
      return ok({ kind, from, to });
    }
    case 'remove_node': {
      const { nodeId, strategy } = raw;
      if (!isNonEmptyString(nodeId)) return err('invalid_request', "'remove_node' requires string 'nodeId'");
      if (!isPlainObject(strategy) || !['heal', 'cascade', 'detach'].includes(strategy.dependents as string)) {
        return err(
          'invalid_request',
          "'remove_node' requires a 'strategy' object with dependents 'heal'|'cascade'|'detach'",
        );
      }
      return ok({ kind, nodeId, strategy: strategy as unknown as RemoveNodeStrategy });
    }
    case 'move_node': {
      const { nodeId, newParent } = raw;
      if (!isNonEmptyString(nodeId) || !isNonEmptyString(newParent)) {
        return err('invalid_request', "'move_node' requires string 'nodeId' and 'newParent'");
      }
      return ok({ kind, nodeId, newParent });
    }
    case 'expand': {
      const { node, expansion } = raw;
      if (!isNonEmptyString(node) || !isPlainObject(expansion) || !Array.isArray(expansion.specs)) {
        return err('invalid_request', "'expand' requires string 'node' and an 'expansion' with a 'specs' array");
      }
      return ok({ kind, node, expansion: expansion as unknown as Expansion });
    }
    case 'add_corrective': {
      const { review, id, type, options } = raw;
      if (!isNonEmptyString(review) || !isNonEmptyString(id) || !isNonEmptyString(type)) {
        return err('invalid_request', "'add_corrective' requires string 'review', 'id', and 'type'");
      }
      if (options !== undefined && !isPlainObject(options)) {
        return err('invalid_request', "'add_corrective' 'options' must be an object when present");
      }
      return ok({
        kind,
        review,
        id,
        type: type as NodeTypeName,
        options: options as AddCorrectiveOptions | undefined,
      });
    }
    case 'reset': {
      const { node, cascade } = raw;
      if (!isNonEmptyString(node) || typeof cascade !== 'boolean') {
        return err('invalid_request', "'reset' requires string 'node' and boolean 'cascade'");
      }
      return ok({ kind, node, cascade });
    }
    default:
      return err('invalid_request', `unsupported mutation kind '${kind as string}'`);
  }
}

/**
 * Translates the shared shape into the engine's own `MutationSpec` — `validate`/`preview`'s actual
 * argument type. `remove_node` is the one lossy step: `MutationSpec`'s `cascade`/`dependentsCascade`
 * pair cannot distinguish `strategy.dependents`'s `'heal'` from `'detach'` (both read as "not
 * cascading" for blast-radius purposes) — never a discrepancy in what a dry-run preview reports gets
 * swept, since heal/detach differ only in whether dangling edges are reconnected or dropped, not in
 * which nodes/edges the removal itself touches. `expand`'s `registry` is never client-suppliable —
 * this always injects the server's own.
 */
export function toEngineMutationSpec(request: SharedMutationRequest, registry: NodeTypeRegistry): MutationSpec {
  switch (request.kind) {
    case 'remove_node':
      return {
        kind: 'remove_node',
        nodeId: request.nodeId,
        cascade: (request.strategy.children ?? 'cascade') === 'cascade',
        dependentsCascade: request.strategy.dependents === 'cascade',
      };
    case 'expand':
      return { kind: 'expand', node: request.node, expansion: request.expansion, registry };
    default:
      return request;
  }
}

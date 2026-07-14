// graph-service/src/http/steer.ts — the steer-envelope validator + primitive dispatch: the
// 11-member allowlist a client may invoke over `/engine-graph/steer`, each with its own `params`
// shape. Deliberately narrower than the engine's own 13-member `PRIMITIVE_NAMES`: `apply_event` and
// `engage` are driver-contract primitives (`applyOutcome`/`advance`), never dispatched from a
// client-supplied envelope here.
import type {
  AddNodeOptions,
  ChangeDelta,
  NodeTypeName,
  NodeTypeRegistry,
  PrimitiveContext,
  Result,
} from '@rad-orchestration/graph-engine';
import {
  add_corrective,
  add_dependency,
  add_node,
  assertNever,
  expand,
  move_node,
  remove_dependency,
  remove_node,
  reset,
  resume,
  set_order,
  toggle,
} from '@rad-orchestration/graph-engine';
import { parseSharedMutation } from './mutation-spec.js';
import type { FailureEnvelope, SuccessEnvelope } from './respond.js';
import { err, ok } from './respond.js';

/** The 11 client-invocable steering primitives. */
export const STEER_PRIMITIVES = [
  'add_node',
  'remove_node',
  'add_dependency',
  'remove_dependency',
  'move_node',
  'set_order',
  'toggle',
  'resume',
  'expand',
  'add_corrective',
  'reset',
] as const;

export type SteerPrimitive = (typeof STEER_PRIMITIVES)[number];

export function isSteerPrimitive(value: unknown): value is SteerPrimitive {
  return typeof value === 'string' && (STEER_PRIMITIVES as readonly string[]).includes(value);
}

export interface SteerRequest {
  readonly primitive: SteerPrimitive;
  readonly params: Readonly<Record<string, unknown>>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** A structurally malformed `params` shape for the given (already-known) primitive — reuses the
 * engine's own `invalid_delta` code, since a param shape too broken to build a delta from is
 * exactly what that code means. Never used for the envelope-structure check ({@link
 * parseSteerRequest}), which is plain HTTP request validation instead. */
function malformedParams(message: string): Result<never> {
  return { ok: false, error: { code: 'invalid_delta', message } };
}

/**
 * Structural-only validation of the steer envelope: `primitive` must be one of the 11 allowlisted
 * names and `params` must be a plain object. Never inspects `params.data` (core-opacity) or any
 * other primitive-specific field — that is {@link dispatchSteerPrimitive}'s own job, one arm at a
 * time. Returns the HTTP response envelope directly (this is request validation, not an engine
 * operation outcome), so a route hands a rejection straight to `c.json`.
 */
export function parseSteerRequest(body: unknown): SuccessEnvelope<SteerRequest> | FailureEnvelope {
  if (!isPlainObject(body)) {
    return err('invalid_request', 'request body must be a JSON object');
  }
  const { primitive, params } = body;
  if (!isSteerPrimitive(primitive)) {
    return err('invalid_request', `'primitive' must be one of: ${STEER_PRIMITIVES.join(', ')}`);
  }
  if (!isPlainObject(params)) {
    return err('invalid_request', "'params' must be an object");
  }
  return ok({ primitive, params });
}

/**
 * Dispatches one validated {@link SteerRequest} against the injected `ctx`/`registry`. Dispatch is
 * not uniform: each primitive reads its own `params` shape here, one arm at a time; `add_node`/
 * `expand` are the only two that also need `registry`. The six kinds the engine's `MutationSpec`
 * union also covers (`add_dependency`, `remove_node`, `move_node`, `expand`, `add_corrective`,
 * `reset`) parse `params` through the same {@link parseSharedMutation} `dry-run` reads through — the
 * one pinned shape the Phase Plan's Integration Seams section calls for, so a client's dry-run body
 * for one of these kinds is reusable verbatim as its steer body. The remaining five (`add_node`,
 * `remove_dependency`, `set_order`, `toggle`, `resume`) have no dry-run equivalent and stay parsed
 * locally. Never reads inside `params.data` — an opaque blob is passed through verbatim to the
 * primitive, never inspected by this dispatcher (core-opacity). A malformed `params` shape surfaces
 * as a structured `invalid_delta` rejection, the same code a malformed delta would itself carry;
 * everything else — cycle/unknown-type/not-in-frontier legality — is the primitive's own `Result` to
 * return.
 */
export function dispatchSteerPrimitive(
  ctx: PrimitiveContext,
  registry: NodeTypeRegistry,
  request: SteerRequest,
): Result<ChangeDelta> {
  const { primitive, params } = request;
  switch (primitive) {
    case 'add_node': {
      const { id, type, parent, options } = params;
      if (!isNonEmptyString(id) || !isNonEmptyString(type) || !isNonEmptyString(parent)) {
        return malformedParams("add_node params requires string 'id', 'type', and 'parent'");
      }
      if (options !== undefined && !isPlainObject(options)) {
        return malformedParams("add_node params 'options' must be an object when present");
      }
      return add_node(ctx, registry, id, type as NodeTypeName, parent, options as AddNodeOptions | undefined);
    }
    case 'remove_node': {
      const parsed = parseSharedMutation('remove_node', params);
      if (!parsed.ok) return malformedParams(parsed.error.message);
      return remove_node(ctx, parsed.data.nodeId, parsed.data.strategy);
    }
    case 'add_dependency': {
      const parsed = parseSharedMutation('add_dependency', params);
      if (!parsed.ok) return malformedParams(parsed.error.message);
      return add_dependency(ctx, parsed.data.from, parsed.data.to);
    }
    case 'remove_dependency': {
      const { from, to } = params;
      if (!isNonEmptyString(from) || !isNonEmptyString(to)) {
        return malformedParams("remove_dependency params requires string 'from' and 'to'");
      }
      return remove_dependency(ctx, from, to);
    }
    case 'move_node': {
      const parsed = parseSharedMutation('move_node', params);
      if (!parsed.ok) return malformedParams(parsed.error.message);
      return move_node(ctx, parsed.data.nodeId, parsed.data.newParent);
    }
    case 'set_order': {
      const { node, order } = params;
      if (!isNonEmptyString(node) || typeof order !== 'number') {
        return malformedParams("set_order params requires string 'node' and numeric 'order'");
      }
      return set_order(ctx, node, order);
    }
    case 'toggle': {
      const { node } = params;
      if (!isNonEmptyString(node)) return malformedParams("toggle params requires string 'node'");
      return toggle(ctx, node);
    }
    case 'resume': {
      const { node } = params;
      if (!isNonEmptyString(node)) return malformedParams("resume params requires string 'node'");
      return resume(ctx, node);
    }
    case 'expand': {
      const parsed = parseSharedMutation('expand', params);
      if (!parsed.ok) return malformedParams(parsed.error.message);
      return expand(ctx, registry, parsed.data.node, parsed.data.expansion);
    }
    case 'add_corrective': {
      const parsed = parseSharedMutation('add_corrective', params);
      if (!parsed.ok) return malformedParams(parsed.error.message);
      return add_corrective(ctx, parsed.data.id, parsed.data.type, parsed.data.review, parsed.data.options);
    }
    case 'reset': {
      const parsed = parseSharedMutation('reset', params);
      if (!parsed.ok) return malformedParams(parsed.error.message);
      return reset(ctx, parsed.data.node, parsed.data.cascade);
    }
    default:
      return assertNever(primitive);
  }
}

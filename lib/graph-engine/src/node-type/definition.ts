import type { NodeId } from '../model/node.js';
import type { CapabilityName, EventToken, Executor, NodeStatus, NodeTypeName, PrimitiveName, Trait } from '../model/vocab.js';
import type { Expansion } from '../primitives/expand.js';

// ── Data schema ──────────────────────────────────────────────────────────────────
// The declared shape of a node type's own `data`: every field a template may seed and every
// field the node type itself tracks as it runs, so a host (template author, presentation layer)
// can introspect a node type's data surface without reading its `act`/`handle` implementation.

/** The primitive value shapes a `DataFieldSpec` can declare — structural typing only, no validator. */
export const DATA_FIELD_KINDS = ['string', 'number', 'boolean', 'object', 'array'] as const;
export type DataFieldKind = (typeof DATA_FIELD_KINDS)[number];

/**
 * Who owns writing a field and when: `required`/`optional` are template-authored at seed time
 * (opt-in — a template may omit an `optional` field entirely); `computed` is never
 * template-set — the node type's own `handle`/`act` populates it as the node runs.
 */
export const DATA_FIELD_LEVELS = ['required', 'optional', 'computed'] as const;
export type DataFieldLevel = (typeof DATA_FIELD_LEVELS)[number];

export interface DataFieldSpec {
  readonly kind: DataFieldKind;
  readonly level: DataFieldLevel;
  readonly description?: string;
}

/** A node type's full data surface, keyed by field name. */
export type DataSchema = Readonly<Record<string, DataFieldSpec>>;

// ── Presentation ─────────────────────────────────────────────────────────────────
/** View-only display metadata. Never consulted by engine logic — the UI's own concern. */
export interface Presentation {
  readonly label: string;
  readonly description?: string;
  readonly icon?: string;
  readonly color?: string;
}

// ── Output envelope ──────────────────────────────────────────────────────────────
/** The closed outcome spine every `Envelope` carries — the only part of it the engine reads. */
export const ENVELOPE_OUTCOMES = ['ok', 'error'] as const;
export type EnvelopeOutcome = (typeof ENVELOPE_OUTCOMES)[number];

/**
 * The uniform result shape returned by every capability port call (including the code-behind
 * port) and, wrapped in a `NodeEvent`, fed back into `handle`. The engine reads only the spine —
 * `outcome` and `route` — and folds `route` into the next `NodeEvent.token`; `route` is a hint,
 * never a mutation request (only `HandleResult.routing` can request one). Everything else lives
 * in `data`, which is entirely node-type-owned and opaque to the engine.
 */
export interface Envelope<TData = Readonly<Record<string, unknown>>> {
  readonly outcome: EnvelopeOutcome;
  readonly data: TData;
  readonly route?: EventToken;
}

// ── Act ──────────────────────────────────────────────────────────────────────────
export interface ActContext {
  readonly nodeId: NodeId;
  readonly data: Readonly<Record<string, unknown>>;
}

/**
 * The typed dispatch payload `ActResult.payload` carries when `executor` is `'spawn-sub-agent'`:
 * either the coder's own spawn request or a reviewer's. Neither carries the idempotency context
 * itself — that is stamped onto the actual `SpawnAgentPort` call, not onto this dispatch intent.
 */
export interface AgentSpawnRequest {
  readonly kind: 'coder';
  readonly handoffDoc: string;
  readonly complexity: 'simple' | 'standard' | 'complex';
  readonly repos: readonly { readonly name: string; readonly path: string; readonly branch: string }[];
  readonly shouldCommit: boolean;
  readonly correctiveIndex?: number;
  readonly reviewReportPath?: string;
}

export interface ReviewSpawnRequest {
  readonly kind: 'reviewer';
  readonly handoffDoc: string;
  readonly repos: readonly { readonly name: string; readonly path: string; readonly branch: string }[];
  readonly commitHash?: string;
}

/** A plan-audit spawn — a general-purpose auditor over the two planning docs. Additive: the
 *  engine still never names a node type; `plan_audit` is the sole current producer. D18/D19: additive
 *  spawn shape, no built-in name hardcoded in the engine. */
export interface AuditSpawnRequest {
  readonly kind: 'auditor';
  readonly requirementsDoc: string;
  readonly masterPlanDoc: string;
  readonly reviewReportPath: string;
}

/** `executor` names how the work is carried out; `payload` is required only for `'spawn-sub-agent'`. */
export interface ActResult {
  readonly instructions: string;
  readonly executor: Executor;
  readonly payload?: AgentSpawnRequest | ReviewSpawnRequest | AuditSpawnRequest;
}

// ── Handle ───────────────────────────────────────────────────────────────────────
export interface NodeEvent {
  readonly token: EventToken;
  readonly nodeId: NodeId;
  readonly envelope: Envelope;
}

/** A patch merged into the node's own `data` — never a replacement of the whole object. */
export type DataChange = Readonly<Record<string, unknown>>;

/**
 * A core mutation `handle` asks the engine to perform, named by `primitive` (e.g.
 * `add_corrective`, `reset`) plus that primitive's own params — never a raw node/edge edit, so
 * the engine remains the sole author of graph structure.
 */
export interface RoutingRequest {
  readonly primitive: PrimitiveName;
  readonly params: Readonly<Record<string, unknown>>;
}

/** `handle`'s reaction to one `NodeEvent`: a data patch, a routing request, and/or a subgraph to expand — every field optional, all three independent. */
export interface HandleResult {
  readonly dataChange?: DataChange;
  readonly routing?: RoutingRequest;
  readonly expansion?: Expansion;
}

// ── Node type definition ───────────────────────────────────────────────────────────
/**
 * The extension seam every built-in and custom node type implements: static declarations
 * (`name`/`dataSchema`/`traits`/`capabilities`/`presentation`/`instructions`) plus three narrow
 * behavior hooks. Each hook is a pure function over values — none receives a store, a scope, or a
 * graph snapshot — so a node type can never mutate the graph directly; `handle`'s `routing`/
 * `expansion` are requests the engine alone carries out.
 */
export interface NodeTypeDefinition {
  /** Namespaced type identifier, e.g. `'rad-orc:task'`. */
  readonly name: NodeTypeName;
  readonly dataSchema: DataSchema;
  readonly traits: readonly Trait[];
  /** The capability ports this node type requests by name; a host binds the matching port instances. */
  readonly capabilities: readonly CapabilityName[];
  readonly presentation: Presentation;
  /** This node type's own action-events markdown, shipped in the bundle. */
  readonly instructions: string;
  act(ctx: ActContext): ActResult;
  handle(ev: NodeEvent): HandleResult;
  /** Projects this node type's own `data` onto the core-legible status spine. */
  projectStatus(data: Readonly<Record<string, unknown>>): NodeStatus;
}

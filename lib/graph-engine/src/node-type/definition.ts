import type { DagNode, NodeId } from '../model/node.js';
import type { DagEdge } from '../model/edge.js';
import type { CapabilityName, EventToken, Executor, NodeStatus, NodeTypeName, PrimitiveName, Trait } from '../model/vocab.js';
import type { Expansion } from '../primitives/expand.js';
import type { CapabilityPortSet } from './capabilities.js';

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

/**
 * What a host must do to a field before `act` reads it: a `worktree-repo-set` field holds an
 * array of `{ name, path, branch, ... }` entries whose `path` the host fills per repo; a
 * `project-doc-path` field holds a project-relative doc path — as a string, or an array of them —
 * the host makes absolute. A separate axis from `kind`, which stays the value's data type.
 */
export const DATA_FIELD_RESOLUTIONS = ['worktree-repo-set', 'project-doc-path'] as const;
export type DataFieldResolution = (typeof DATA_FIELD_RESOLUTIONS)[number];

export interface DataFieldSpec {
  readonly kind: DataFieldKind;
  readonly level: DataFieldLevel;
  /** Declares that a host must fill this field with fresh, resolved absolute paths before `act` reads it. */
  readonly resolve?: DataFieldResolution;
  readonly description?: string;
}

/** A node type's full data surface, keyed by field name. */
export type DataSchema = Readonly<Record<string, DataFieldSpec>>;

/**
 * A host-supplied, node-blind resolution of a node's own `data`: reads the type's `dataSchema`
 * declarations and fills every field carrying a `resolve` hint with fresh absolute paths. Generic
 * over declarations — never over a concrete type's field names (D24). Throws when a declared,
 * required field cannot be resolved; the caller must not swallow it.
 */
export type DataResolver = (
  schema: DataSchema,
  data: Readonly<Record<string, unknown>>,
) => Readonly<Record<string, unknown>>;

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
  /** READ-ONLY view of this node's scope, for locating a sibling. No store, no scope, no mutation. */
  readonly nodes: readonly DagNode[];
  readonly edges: readonly DagEdge[];
}

/**
 * The closed set of sub-agents a `spawn-sub-agent` node can dispatch to — the name already
 * carries the category (coder vs reviewer, and seniority), so no separate `kind`/`tier`/`role`
 * field rides alongside it.
 */
export type AgentName = 'coder-junior' | 'coder' | 'coder-senior' | 'reviewer-junior' | 'reviewer';

/**
 * The single resolved dispatch payload `ActResult.payload` carries when `executor` is
 * `'spawn-sub-agent'` — one emitted shape for both a coder's and a reviewer's spawn, discriminated
 * by `agent` rather than a `kind` field. `repos` stays open-shaped: the per-level SHA fields differ
 * by scope and must never be collapsed onto one shared name. The open index signature carries the
 * level-specific doc refs and scalars the node emits. Neither carries the idempotency context
 * itself — that is stamped onto the actual `SpawnAgentPort` call, not onto this dispatch intent.
 */
export interface SpawnPayload {
  readonly agent: AgentName;
  readonly repos: readonly Readonly<Record<string, unknown>>[];
  readonly [field: string]: unknown;
}

/** `executor` names how the work is carried out; `payload` is required only for `'spawn-sub-agent'`. */
export interface ActResult {
  readonly executor: Executor;
  readonly payload?: SpawnPayload;
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

// ── Resolve ────────────────────────────────────────────────────────────────────────
/**
 * The uniform host-side outcome a node's own `resolve` hands back — the engine now owns this
 * shape (the service's `DriverOutcome` becomes an alias). `token` lets a node pick among its own
 * outcomes (e.g. explosion's parsed vs parse_failed); the payload variation rides in `envelope`.
 */
export interface ResolveOutcome {
  readonly token: EventToken;
  readonly envelope: Envelope;
}

/**
 * What `resolve` is handed: the node's own identity + data, a READ-ONLY view of its scope so it
 * can locate siblings (a typed sibling, a corrective chain) without the host naming its type, and
 * the capability ports it declared. Carries no store, no scope, no mutable snapshot — structurally
 * incapable of mutating the graph, exactly like `CodeBehindPort`.
 */
export interface ResolveContext {
  readonly nodeId: NodeId;
  readonly data: Readonly<Record<string, unknown>>;
  readonly nodes: readonly DagNode[];
  readonly edges: readonly DagEdge[];
  readonly ports: CapabilityPortSet;
}

// ── Completion payload schema ───────────────────────────────────────────────────────
/**
 * One field's rendering hint for a downstream CLI relaying a completion event: `true` → the CLI
 * renders a scalar flag (`--branch <v>`); `false` → the field rides in the flat `--data` array.
 */
export interface CompletionPayloadField {
  readonly name: string;
  /** `true` → the CLI renders a scalar flag (`--branch <v>`); `false` → the field rides in the flat `--data` array. */
  readonly flag: boolean;
}
export type CompletionPayloadSchema = readonly CompletionPayloadField[];

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
  /** The agent-facing instruction the host relays verbatim at an external-actor stop. Absent when this type never stops at one. */
  readonly instructions?: string;
  act(ctx: ActContext): ActResult;
  handle(ev: NodeEvent): HandleResult;
  /** Projects this node type's own `data` onto the core-legible status spine. */
  projectStatus(data: Readonly<Record<string, unknown>>): NodeStatus;
  /**
   * The node's own host-side outcome derivation, invoked polymorphically by the host for any node
   * that declares it (a `noop`-executor node the driver auto-resolves, or an actor node whose
   * outcome the host must re-derive rather than trust from a relayed envelope).
   */
  resolve?(ctx: ResolveContext): Promise<ResolveOutcome>;
  /**
   * The single `<type>.<outcome>` token the host surfaces for this type at an external-actor stop,
   * so a client knows what to signal back — replaces the service's hardcoded node-type→token map.
   */
  readonly completionToken?: EventToken;
  /** The completion-event payload's per-field rendering schema, for a downstream CLI. */
  readonly completionPayloadSchema?: CompletionPayloadSchema;
}

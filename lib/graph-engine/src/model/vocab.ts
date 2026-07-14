// The closed vocabularies the engine is programmed against. Every fixed set below is an
// `as const` array with a derived union type (never a TypeScript `enum` — see the package
// AGENTS.md), so a switch over any of them can be made exhaustive and machine-checked via
// `assertNever` at the bottom of this file.
//
// This module is the model's dependency base: it imports nothing from `node.ts`/`edge.ts`/
// `delta.ts`, which import from here instead — a one-directional graph, never a cycle.

// ── Node type identity ─────────────────────────────────────────────────────────
// Not a closed vocabulary: node types are namespaced identifiers resolved at runtime through
// the (not-yet-built) node-type registry — e.g. `rad-orc:task`, `acme-qa:security-scan`. The
// template-literal shape constrains the format without hardcoding a member list.
export type NodeTypeName = `${string}:${string}`;

// ── Node status ─────────────────────────────────────────────────────────────────
// The whole core-owned status enum every `DagNode.status` is drawn from.
export const NODE_STATUSES = ['not_started', 'in_progress', 'done', 'blocked', 'failed'] as const;
export type NodeStatus = (typeof NODE_STATUSES)[number];

// ── Trait ────────────────────────────────────────────────────────────────────────
// The generic behaviors a node type opts into (containment, routing, expansion).
export const TRAITS = ['contains', 'routes', 'expands'] as const;
export type Trait = (typeof TRAITS)[number];

// ── Executor ─────────────────────────────────────────────────────────────────────
// How a node's work is actually carried out.
export const EXECUTORS = ['spawn-sub-agent', 'orchestrator-inline', 'request-human', 'noop'] as const;
export type Executor = (typeof EXECUTORS)[number];

// ── Capability name ──────────────────────────────────────────────────────────────
// The well-known, engine-recognized capabilities, kept open via the `(string & {})` escape
// hatch (mirrors `lib/work-graph`'s `EdgeType`) so a custom node type can name a capability the
// engine has never heard of without an engine edit.
export const CAPABILITY_NAMES = [
  'doc-read',
  'doc-write',
  'git-facts',
  'spawn-agent',
  'run-command',
  'request-human',
] as const;
export type CapabilityName = (typeof CAPABILITY_NAMES)[number] | (string & {});

// ── Primitive name ───────────────────────────────────────────────────────────────
// The closed set of mutation primitive names — the CRUD/lifecycle/batch/iteration primitives
// shipped in `src/primitives/` (`crud.ts`, `lifecycle.ts`, `expand.ts`, `apply-event.ts`,
// `corrective.ts`, `reset.ts`) plus `engage`, the driver contract's `not_started -> in_progress`
// writer in `src/driver/contract.ts`. `ChangeDelta.primitive` is drawn from this union, so every
// delta names the exact primitive that produced it.
export const PRIMITIVE_NAMES = [
  'add_node',
  'remove_node',
  'add_dependency',
  'remove_dependency',
  'move_node',
  'set_order',
  'toggle',
  'resume',
  'expand',
  'apply_event',
  'add_corrective',
  'reset',
  'engage',
] as const;
export type PrimitiveName = (typeof PRIMITIVE_NAMES)[number];

/** The one primitive a node type routes to by name directly (approval's plan-denial, explosion's
 *  parse-failure reset) — a named singleton so a node references the kernel constant, not '"reset"'. */
export const PRIMITIVE_RESET: PrimitiveName = 'reset';

// ── Event / action token ─────────────────────────────────────────────────────────
// A `<node-type>.<outcome>` token, where outcome is a past-tense verb by convention. The
// exhaustive built-in token list is produced in P04-T02, not here.
export type EventToken = `${NodeTypeName}.${string}`;

// ── Exhaustiveness helper ────────────────────────────────────────────────────────
// Every `switch` over a closed vocabulary across the engine ends in a
// `default: return assertNever(x)` arm: adding a vocabulary member without updating every switch
// is a compile error, not a silent runtime fallthrough. If this line ever executes, a value
// outside its declared union reached the switch at runtime — a bug, not a reachable state.
export function assertNever(x: never): never {
  throw new Error(`assertNever: unreachable vocabulary member: ${JSON.stringify(x)}`);
}

---
project: "ENGINE-GRAPH-BENCH"
type: requirements
status: approved
created: "2026-07-10"
project-type: standard
repos: [graph-service]
repo-group: rad-orc
---

# ENGINE-GRAPH-BENCH — Requirements

The **graph-service** already composes the engine, both stores, and a node-type registry into
one Hono host, and already serves `/work-graph/*` and `/health`. This slice adds the
**`/engine-graph/*` RPC surface** — a thin, faithful HTTP transport over the engine's closed
primitive set, so a client can **seed** a graph, **inspect** it, **steer** it, and **drive** it,
all over HTTP against the real store.

> This is a **single-task** deliverable: the `/engine-graph/*` surface, in the `graph-service`
> workspace. One phase, one task.

## Context (already built — do NOT re-plan)

- The composed host exists: a `GraphService` (from `graph-service/src/compose.ts`) exposes the
  `store`, the node-type `registry`, and project-scope resolution — the same object every
  existing router closes over.
- The Hono app (`graph-service/src/http/app.ts`) already mounts `buildWorkGraphRouter(service)`;
  a uniform response helper lives in `graph-service/src/http/respond.ts`. Mirror both patterns.
- The engine is consumed **barrel-only** from `@rad-orchestration/graph-engine`; the service
  never imports engine internals under `lib/graph-engine`.
- The driver's full outcome cycle lives in `graph-service/src/driver/` (`drive.ts`, `outcome.ts`).

## Requirements

### R1: `/engine-graph/*` — the engine RPC surface

A thin, faithful transport over the engine's closed primitive set, grouped under one domain
prefix and mounted via `app.route('/engine-graph', buildEngineGraphRouter(service))`. Every route
resolves its `ProjectScope` from a `project` param and returns the uniform `{ ok, data, error }`
envelope; an illegal or stale mutation surfaces the engine's `Result` failure as a **structured
rejection**, never a 500.

- **Reads (`GET`):**
  - `/dag?project=<id>` — the project's nodes + edges + derived frontier + rolled-up status.
  - `/frontier?project=<id>&context=<nodeId>` — the ready nodes for a **working context** carried
    **per request** (never stored server-side).
  - `/node?project=<id>&node=<id>` — one node's full state.
- **Execution driver (`POST`): `/submit-event`** — body `{ project, node, event?, payload? }`.
  Both modes go through the driver's **full outcome cycle** — **never** a bare low-level
  event-apply (which patches `data` only and leaves `status` unmoved). With `event`+`payload` the
  client dictates the outcome; when omitted, the driver engages + dispatches + resolves the node.
  `event` is an **opaque `<type>.<outcome>` token** — do not validate it against a closed list.
- **Steering (`POST`): `/steer`** — a **single validated envelope** `{ project, primitive, params }`
  over the **11 steering primitives** (`add_node`, `remove_node`, `add_dependency`,
  `remove_dependency`, `move_node`, `set_order`, `toggle`, `resume`, `expand`, `add_corrective`,
  `reset`) — the engine's closed primitive vocabulary **minus** the driver-contract members. The
  exported name set has **more** members than are steerable, so define the **11-member steer
  allowlist explicitly** rather than gating on the whole exported set. Dispatch is **not
  uniform** — each primitive has its own `params` shape, and a couple additionally take the
  injected registry. Return the primitive's `Result` as an envelope; a rejected mutation
  (cycle, not-in-frontier, unknown type) is a structured `{ ok:false, error }`, not a throw.
- **Dry-run (`POST`): `/dry-run`** — body `{ project, mutation }`; return validity + preview over
  the engine's read-only dry-run reads. **Read-only:** no write, no delta emitted.
- **Seed (`POST`): `/seed`** — a **programmatic** entrypoint that replays the create primitives
  (`add_node` / `add_dependency` / `expand`) to stamp a project's initial dag; return a summary of
  what was created.
- **Envelope-structural validation only.** The validator checks the **envelope shape**; it
  **never** parses node-type-owned `data` or event-payload internals (core-opacity). Those are
  opaque pass-through blobs the node type alone interprets — which is exactly what keeps the
  surface open to unknown custom node types.

## Technical Specification

- **Thin transport.** The engine owns every invariant (acyclicity, readiness, validated
  mutations, the closed vocabularies); the store owns durability. A route's whole job is: parse a
  request → call an engine primitive / store read / dry-run read → serialize the `Result`.
- **Barrel-only imports** from `@rad-orchestration/graph-engine`; no import from engine internals.
- **Grounding note (for the planner).** The exact import surface, the primitive signatures, and
  every type they reference are the engine's **public contract** — resolve them from the barrel
  and from the existing router/driver code in the workspace so the task carries them inline; the
  coder must not have to open the engine to write compiling code.
- **Known seams to get right** (name each in the task; resolve the exact shapes by grounding):
  - The engine `Result`'s `error.code` is a **closed union** — it cannot be reused for
    request-shape rejections; use the service's own request-error path for malformed input.
  - `/dag`'s rolled-up status uses the engine's **public** container-status derivation, bottom-up
    from the root anchor — **not** any private/unexported resolver.
  - `/seed`'s cross-store anchor has an **ordering** constraint between the execution store's root
    insert and the portfolio project adoption.

## Testing Approach

Behavioral, over HTTP via the app's request helper (`app.request()`), on vitest.

- Each read returns the right shape; `steer` accepts a valid primitive and **rejects an unknown
  `primitive` with a structured error** (not a throw); `dry-run` writes nothing (assert the change
  log is untouched); `submit-event` (no event) advances a seeded node.
- Cover the **core-opacity** guard: a steer with an arbitrary opaque `data` blob is stored and
  round-tripped unread.
- **Skip** re-testing engine invariants (acyclicity, readiness) — those are the engine's own
  suites; assert the route surfaces the engine's result faithfully.

## Key Files & Modules

- `graph-service/src/http/` — `app.ts` (mount point + the existing `buildWorkGraphRouter`
  pattern), `respond.ts` (uniform envelope helper), the existing `work-graph.ts` router (the
  pattern to mirror), `compose.ts` (`GraphService` wiring: store, registry, scope).
- `graph-service/src/driver/` — `drive.ts` / `outcome.ts` (the full outcome cycle `/submit-event`
  drives).
- **Reference-only (barrel):** `@rad-orchestration/graph-engine` — the closed primitive set, the
  read-only dry-run reads, the read/derivation helpers, the driver contract, and the types they
  reference. Imported, never edited.

## Required Skills and MCPs

- **Repo skills:** none required — an internal host package, no live contract touched.
- **MCPs:** none required.

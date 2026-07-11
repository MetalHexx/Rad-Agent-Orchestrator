---
project: ENGINE-GRAPH-BENCH
phase: 1
task: 1
title: Build the /engine-graph RPC surface
status: pending
complexity: complex
repos:
  - graph-service
created: '2026-07-10T21:53:16.030Z'
type: task_handoff
---

# P01-T01: Build the /engine-graph RPC surface

Add `buildEngineGraphRouter(service)` — a Hono sub-router mirroring `work-graph.ts` — exposing the
seven engine-graph routes, and mount it at `/engine-graph` in `app.ts`. Each route parses a request,
calls one engine primitive / store read / dry-run read, and serializes the `Result` into the uniform
envelope. When it lands, a client can seed, inspect, steer, drive, and dry-run a project's graph
entirely over HTTP against the real execution store.

**Task type:** code
**Complexity:** complex
**Target repo:** graph-service

**Files**
- Create: `src/http/engine-graph.ts` — the `buildEngineGraphRouter(service: GraphService): Hono`
  sub-router with all seven routes plus its request-shape validators.
- Modify: `src/http/app.ts` — add `app.route('/engine-graph', buildEngineGraphRouter(service))`
  (place it beside the existing `/work-graph` mount; the stream router already owns
  `/engine-graph/stream` and stays as-is).
- Read for patterns (mirror, don't edit):
  - `src/http/work-graph.ts` — the router shape to mirror exactly: `readJsonBody(c)`,
    `requireField(raw, field)`, the `isPlainObject`/`isNonEmptyString` guards, the closed-set
    `isX` validators, the module-level `ACTOR = 'graph-service'` constant, and the
    `return c.json(fromResult(result), result.ok ? 200 : 400)` mapping.
  - `src/http/respond.ts` — `ok(data)`, `err(code, message)`, `fromResult(result)` and the
    `SuccessEnvelope`/`FailureEnvelope` types. Reuse these; do not invent a second envelope.
  - `src/driver/drive.ts` — `advance(ctx, registry, resolvers, node)` and
    `runToQuiescence(...)`, and the `PrimitiveContext` shape the driver takes.
  - `src/driver/outcome.ts` — `applyOutcome(ctx, registry, nodeId, { token, envelope })`, the
    host-side "apply the outcome + re-project status" step both submit-event modes end on.
  - `src/driver/frontier.ts` — `globalFrontier(ctx, root)` (whole-tree union) and how it relates
    to the engine's per-container `readFrontier`.
  - `src/compose.ts` — the `GraphService` fields this router closes over: `execStore` (the engine
    `StateStore`), `engine`, `registry`, `resolvers`, `portfolio`.
- Test: create `tests/http/engine-graph.test.ts` — a behavioral suite over the real
  `compose()` + `buildApp()` stack via `app.request()` (mirror `tests/http/work-graph.test.ts`'s
  `buildTestApp()` / `postJson` helpers). `tests/harness/drive.ts` already documents the exact wire
  contract each route must satisfy — treat it as the acceptance shape.

**Conventions to carry (this repo)**
- **Barrel-only engine imports.** Import every engine symbol from `@rad-orchestration/graph-engine`;
  never reach into `lib/graph-engine` internals. Import store types
  (`ProjectCreateInput`) from `@rad-orchestration/graph-store-sqlite` the same way `work-graph.ts` does.
- **ESM `.js` specifiers.** Relative imports carry the `.js` extension (`'../compose.js'`,
  `'./respond.js'`) — this package is `type: module`.
- **No TypeScript `enum`s** — use `as const` arrays with a derived union (the engine's own
  convention), e.g. for the steer allowlist.
- **State only through `service`.** Reach the store/engine/registry/resolvers/portfolio through the
  injected `service` object — never a module-level singleton or a second DB handle.

**The change**

Build the router closed over `service`, one handler per route. Every route resolves scope the same
way and builds a driver/primitive context from it:

```ts
// per request — GET reads `project` from the query, POST from the JSON body
const scope: ProjectScope = { projectId: project };
const ctx: PrimitiveContext = { store: service.execStore, scope };
```

Route contracts (pin these shapes; leave the bodies to implementation):

- `GET /dag?project=<id>` → `{ nodes, edges, frontier, status }`:
  `nodes = execStore.listNodes(scope)`, `edges = execStore.listEdges(scope)`,
  `frontier = readFrontier(ctx, ROOT_NODE_ID)`, and `status` = the root's rolled-up status
  (see the container-status seam below).
- `GET /frontier?project=<id>&context=<nodeId>` → the ready nodes for that **working context**,
  `readFrontier(ctx, context)`. The context is carried **per request** and never stored server-side.
- `GET /node?project=<id>&node=<id>` → the one node's full state (`execStore.getNode(scope, node)`);
  a missing node is a structured `not_found` (404), not a 500.
- `POST /submit-event` — body `{ project, node, event?, payload? }`. **Both modes go through the
  driver's full outcome cycle — never a bare `apply_event`** (which patches `data` only and leaves
  `status` unmoved):
  - No `event`: `advance(ctx, service.registry, service.resolvers, node)` — engage the node and let
    its registered resolver dispatch against the faked capability ports.
  - `event`+`payload`: engage the node, then `applyOutcome(ctx, service.registry, node,
    { token: event, envelope: payload })`. `event` is an **opaque `<type>.<outcome>` token** — do
    **not** validate it against a closed list.
  - Response shape (per `drive.ts`'s `SubmitEventResult`): `{ delta, frontier }`.
- `POST /steer` — body `{ project, primitive, params }`. A **single validated envelope** over the
  **11 steering primitives**. Validate the *envelope shape only* (`primitive` is a known allowlist
  member; `params` is an object); then dispatch. Dispatch is **not uniform** — each primitive has
  its own `params` shape, and `add_node`/`expand` additionally take `service.registry`:
  ```ts
  // the 11-member allowlist, defined explicitly — NOT `PRIMITIVE_NAMES` (which has 13,
  // including the driver-contract members `apply_event` and `engage`, which are NOT steerable):
  const STEER_PRIMITIVES = [
    'add_node', 'remove_node', 'add_dependency', 'remove_dependency', 'move_node',
    'set_order', 'toggle', 'resume', 'expand', 'add_corrective', 'reset',
  ] as const;
  ```
  Primitive signatures (all from the barrel; `ctx: PrimitiveContext`):
  `add_node(ctx, registry, id, type, parent, options?)`, `remove_node(ctx, node, strategy)`,
  `add_dependency(ctx, from, to)`, `remove_dependency(ctx, from, to)`,
  `move_node(ctx, node, newParent)`, `set_order(ctx, node, order)`, `toggle(ctx, node)`,
  `resume(ctx, node)`, `expand(ctx, registry, node, expansion)`,
  `add_corrective(ctx, id, type, review, options?)`, `reset(ctx, node, cascade?)`.
  Return the primitive's `Result` via `fromResult(...)`; a rejected mutation
  (cycle / not-in-frontier / unknown type) becomes a structured `{ ok:false, error }`, never a throw.
- `POST /dry-run` — body `{ project, mutation }`. Build a `MutationSpec` from `mutation`, then run
  the engine's **read-only** `validate(graph, spec)` and `preview(graph, spec)` over a snapshot
  (`{ nodes: execStore.listNodes(scope), edges: execStore.listEdges(scope) }`). Return validity +
  preview. **Read-only: no `store.apply`, no delta emitted.** (`expand`/`add_corrective`/`reset`
  specs each carry their own extra fields — `registry` for `expand`, `id`/`type`/`review` for
  `add_corrective`, `cascade` for `reset` — matching `MutationSpec`.)
- `POST /seed` — body `{ project, seed: { steps } }`. A **programmatic** entrypoint replaying the
  create primitives (`add_node` / `add_dependency` / `expand`) to stamp the project's initial dag,
  returning a summary `{ nodesCreated, edgesCreated }`. See the ordering seam below.

**Envelope-structural validation only (core-opacity).** The request validators check the *envelope
shape* — required strings present, `params`/`payload`/`data` is an object. They **never** parse
node-type-owned `data` or event-payload internals; those are opaque pass-through blobs the node type
alone interprets. This is what keeps the surface open to unknown custom node types.

**The seams to get right:**
- **Engine `error.code` is a closed union, not for request errors.** `Result` failures carry an
  `EngineErrorCode` (`invalid_delta | unknown_node_type | cycle | cross_axis_cycle | not_in_frontier
  | root_guarded`). You cannot reuse that union for *request-shape* rejections (missing field, bad
  JSON, unknown steer primitive). Use the service's own request-error path — `err('invalid_request',
  …)` returned as a `400`, exactly like `work-graph.ts` — for malformed input, and reserve
  `fromResult(...)` for genuine engine `Result`s.
- **`/dag` rolled-up status uses the engine's *public* container-status derivation.** Derive the
  root's status bottom-up with the exported `deriveContainerStatus(node, resolvedChildren)` — a
  leaf/work node reads its own `status`, a container rolls up its children's resolved statuses —
  **not** any private/unexported resolver from `derive/readiness.ts` (`createStatusResolver` is not
  exported and must not be reached for).
- **`/seed`'s cross-store ordering constraint.** Replay the seed steps against the **execution store
  first** — the first exec-store touch mints the project-scoped `root` node (via the store's
  `ensureSeeded`, which fires only on the `projects` row's genuine first `INSERT`) so subsequent
  `add_node` steps have a `root` to parent onto — **then** adopt the project into the portfolio store
  (`service.portfolio.createProject({ id: project }, ACTOR)`). If the portfolio adoption ran *first*,
  it would create the `projects` row up front, the exec store's `INSERT OR IGNORE` would then be a
  no-op, root would never be minted, and every seed `add_node` would fail with no parent. `ACTOR` is
  the same `'graph-service'` constant `work-graph.ts` threads through portfolio mutations.
- **Full outcome cycle, never bare event-apply.** `/submit-event` must go through
  `advance`/`applyOutcome` (which engage the node and re-project its `status` from the resolved
  `data`), never a lone `apply_event` (which touches `data` only). This is the difference between a
  seeded node actually advancing and its status silently staying put.

**Done when**
- All seven routes are reachable under `/engine-graph` and the router is mounted in `app.ts`; an
  unknown path under the prefix still yields the app's envelope-shaped 404.
- `GET /dag` returns `{ nodes, edges, frontier, status }` with a correctly rolled-up root status;
  `GET /frontier?context=` returns the ready nodes for that container; `GET /node` returns one
  node's state and a structured `not_found` for a missing id.
- `POST /seed` stamps a dag and leaves a genuine portfolio `projects` row —
  `GET /work-graph/project?id=<project>` returns 200 afterward.
- `POST /submit-event` (no `event`) advances a seeded frontier node (its status moves); the
  explicit `event`+`payload` mode applies the client-dictated outcome.
- `POST /steer` accepts a valid primitive (returns its `Result` as an envelope) and rejects an
  unknown `primitive` with a structured `{ ok:false, error }` request error (not a throw).
- `POST /dry-run` returns validity + preview and writes nothing (the `change_log` is unchanged).

**Testing**
- Behavioral, over HTTP via `app.request()` on the real `compose()` + `buildApp()` stack (vitest),
  mirroring `tests/http/work-graph.test.ts`. Inherit the unit/integration posture from the
  Requirements Testing Approach — assert behavior at the HTTP boundary, not internals.
- Cover: each read returns the right shape (`/dag`, `/frontier`, `/node`); `steer` accepts a valid
  primitive and **rejects an unknown `primitive` with a structured error, not a throw**; `dry-run`
  writes nothing (**assert the change log / persisted graph is untouched** after the call);
  `submit-event` with no `event` **advances a seeded node** (drive it from a small seeded dag and
  assert the target's status moved). Seed a graph via `POST /seed` and assert the cross-store anchor
  (`/work-graph/project?id=` returns 200).
- Cover the **core-opacity** guard: a `steer` (e.g. `add_node`) carrying an arbitrary opaque `data`
  blob is stored and round-tripped back **unread** (assert it survives a `/node` read verbatim).
- **Skip** re-testing engine invariants — acyclicity and readiness are the engine's own suites
  (`lib/graph-engine`); assert only that the route surfaces the engine's `Result` faithfully. Avoid
  asserting exact prose of error messages or snapshotting full payloads — assert the shape and the
  boundary behavior (status codes, `ok` flag, `error.code` family).

## Execution Notes

_(none yet — appended at runtime)_

---
project: HANDOFF-BENCH
phase: 2
task: 1
title: '`/engine-graph/*` — the engine RPC surface'
status: pending
complexity: standard
repos:
  - graph-service
type: task_handoff
---

# P02-T01: `/engine-graph/*` — the engine RPC surface

Mount the execution-DAG API: query reads, the `submit-event` execution driver, the single-envelope
`steer` over the closed primitive set, the read-only `dry-run`, and the programmatic `seed`. When it
lands, a client can seed a graph, inspect it, steer it, and drive it — all over HTTP against the
real store.

**Task type:** code
**Complexity:** standard
**Target repo:** graph-service

**Files**
- Create `graph-service/src/http/engine-graph.ts` — a Hono sub-router mounted at `/engine-graph`.
- Create `graph-service/src/http/steer.ts` — the steer-envelope validator + primitive dispatch.
- Read for shape: the engine barrel exports (`PRIMITIVE_NAMES`, the primitive fns `add_node`/
  `remove_node`/`add_dependency`/`remove_dependency`/`move_node`/`set_order`/`toggle`/`resume`/
  `expand`/`add_corrective`/`reset`, `apply_event`, `validate`, `preview`, `readFrontier`,
  `frontier`/`deriveContainerStatus`).
- Edit `graph-service/src/http/app.ts` — mount the sub-router.

**The change**
- **Reads:** `GET /engine-graph/dag?project=<id>` → `{ nodes, edges, frontier, status }` from
  `listNodes`/`listEdges` + `frontier`/`deriveContainerStatus`; `GET /engine-graph/frontier?project=<id>&context=<nodeId>`
  → `readFrontier(ctx, context)` (context is the working-context scope, D15 — carried per request,
  never stored); `GET /engine-graph/node?project=<id>&node=<id>` → `getNode`.
- **`POST /engine-graph/submit-event`** — body `{ project, node, event?, payload? }`. Both modes go through
  the driver's **full outcome cycle** (P01-T02 `applyOutcome`: `handle` → `apply_event` → routing →
  expansion → `syncProjectedStatus`) — **never a bare `apply_event`**, which only patches `data` and would
  leave `status` unmoved. With `event`+`payload`, the client dictates the outcome (token + envelope); when
  omitted, `advance(project, node)` engages + fake-dispatches + resolves it. Return the applied delta +
  resulting (whole-tree) frontier. `event` is an opaque `<type>.<outcome>` token — do **not** validate it
  against a closed list (custom node types own their events).
- **`POST /engine-graph/steer`** — body `{ project, primitive, params }`. Validate the **envelope structure
  only**: `primitive` ∈ the **11 steer primitives** — `add_node`, `remove_node`, `add_dependency`,
  `remove_dependency`, `move_node`, `set_order`, `toggle`, `resume`, `expand`, `add_corrective`, `reset`.
  **Do not** gate on the exported `PRIMITIVE_NAMES` wholesale — it has **13** members and includes
  `apply_event` and `engage` (driver-contract primitives, not steering ones, with different signatures);
  define the 11-member steer allowlist explicitly. Dispatch is **not uniform** — each primitive has its own
  `params` shape, and `add_node`/`expand` additionally take the injected `registry`. Return the primitive's
  `Result<ChangeDelta>` as an envelope; a rejected mutation (cycle, not-in-frontier, unknown type) is a
  structured `{ ok:false, error }`, not a 500. Do **not** read inside `params.data` (core-opacity). A
  hand-rolled discriminated check is sufficient — zod is optional.
- **`POST /engine-graph/dry-run`** — body `{ project, mutation }` (a `MutationSpec`); return
  `{ valid, reason?, preview }` from `validate` + `preview`. Read-only: no write, no delta emitted.
- **`POST /engine-graph/seed`** — body `{ project, seed }`: replay `add_node` / `add_dependency` / `expand`
  to stamp a project's initial dag (the programmatic entrypoint; the template **file** loader is 2.5).
  **The cross-store anchor:** `dag_nodes.project_id` is a `NOT NULL REFERENCES projects(id)` FK with
  `foreign_keys = ON`, and the execution `StateStore` has no projects-insert path — so the `projects(id)`
  row must exist first, created via the **portfolio store's `createProject`** (create-if-absent). Seeding
  is thus a genuine `/engine-graph` ↔ portfolio coupling. Return a summary (nodes/edges created).
- Every route resolves its `ProjectScope` from the `project` query/body param; reject a missing/blank
  `project` with a structured `400`-style envelope.

**House rules (inline):** barrel-only engine imports; envelope for every response; never interpolate
request values into anything; `// D16:` comment on the steer route (clients call primitives, never edge SQL).

**Done when**
- `seed` → `dag` round-trips a small graph; `frontier` reflects readiness; `submit-event` (no event)
  advances a ready node via the driver; `steer` with `{ primitive:'add_dependency', params }` reshapes
  the graph and an illegal one returns a structured rejection; `dry-run` returns `valid`/`preview`
  without mutating.

**Testing**
- Unit (via `app.request()`): each read returns the right shape; `steer` accepts a valid primitive and
  rejects an unknown `primitive` value with a structured error (not a throw); `dry-run` writes nothing
  (assert the change-log/stream is untouched); `submit-event` advances a seeded node.
- Cover the core-opacity guard: a `steer add_node` with an arbitrary opaque `data` blob is stored and
  round-tripped unread.
- Skip: re-testing engine invariants themselves (acyclicity, readiness) — those are the engine's suites;
  assert the route surfaces the engine's result faithfully.

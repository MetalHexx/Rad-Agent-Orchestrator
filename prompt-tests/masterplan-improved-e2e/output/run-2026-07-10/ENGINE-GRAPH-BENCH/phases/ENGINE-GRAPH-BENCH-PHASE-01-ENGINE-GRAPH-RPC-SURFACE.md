---
project: ENGINE-GRAPH-BENCH
phase: 1
title: Engine-graph RPC surface
status: active
tasks:
  - id: T01
    title: Build the engine-graph RPC router
repos:
  - graph-service
created: '2026-07-10T21:59:48.542Z'
type: phase_plan
---

# Phase 1: Engine-graph RPC surface

**Intent**
Stand up the `/engine-graph/*` HTTP surface as a thin transport over the engine's public contract:
reads that project the DAG and its derived status, an execution-driver endpoint that runs the full
outcome cycle, a single validated steering envelope over the 11 client-invocable primitives, a
read-only dry-run, and a programmatic seed that stamps a project's initial DAG. When it lands, a
client can create and drive a real graph end-to-end over HTTP with the engine owning every invariant.

**Exit criteria**
- `graph-service/src/http/app.ts` mounts the new router via `app.route('/engine-graph', buildEngineGraphRouter(service))`, and every `/engine-graph/*` route returns the uniform `{ ok, data, error }` envelope (the app's existing `notFound`/`onError` fallbacks still cover the sub-router — it defines neither of its own).
- `GET /dag`, `GET /frontier`, `GET /node`, `POST /submit-event`, `POST /steer`, `POST /dry-run`, `POST /seed` are all present and each resolves its `ProjectScope` from a required `project` param (missing `project` → `invalid_request` 400).
- `POST /steer` accepts a valid primitive from the explicit 11-member allowlist and rejects an unknown `primitive` with a structured `{ ok:false, error:{ code:'invalid_request' } }` — never a thrown 500, and never reusing an engine `Result` error code for the request-shape rejection.
- `POST /dry-run` writes nothing: no `store.apply`, no `change_log` row, no delta emitted.
- `POST /seed` replays the create primitives, returns a `{ nodesCreated, edgesCreated }` summary, and adopts the project into the portfolio — with the exec-store touch strictly before the portfolio adoption.
- A rejected engine mutation (cycle, `not_in_frontier`, `unknown_node_type`, `invalid_delta`, …) surfaces as a structured `{ ok:false, error }` body, never an unhandled 500.
- An arbitrary opaque `data` blob passed through `steer`/`seed` is stored and round-tripped unread (core-opacity holds).

**Integration seams**
- **Router ↔ app mount.** `buildEngineGraphRouter(service)` must slot into `app.ts` exactly like `buildWorkGraphRouter(service)` does; the SSE `/engine-graph/stream` route already lives in `streams.ts` (mounted at root) and is **out of scope here** — do not add or move it.
- **Router ↔ engine barrel.** Every engine call goes through `@rad-orchestration/graph-engine`'s barrel only; the route is pure transport (parse → call one primitive / read / dry-run read → serialize the `Result`). No import from `lib/graph-engine` internals.
- **Router ↔ driver.** `/submit-event` reuses the service's own driver (`src/driver/`) full outcome cycle — never a bare low-level `apply_event`.
- **Router ↔ two stores.** `/seed` spans the execution store and the portfolio store; phase review must check the ordering seam (exec-store root seed before portfolio adoption) holds, since reversing it silently suppresses root-node creation.

## Tasks

| Task | Repo | Complexity | Purpose |
|---|---|---|---|
| T01 | graph-service | complex | Add the `/engine-graph/*` sub-router — a thin, faithful HTTP transport over the engine's closed |

**Order:** T01

---
project: ENGINE-GRAPH-BENCH
phase: 1
title: Engine-graph RPC surface
status: active
tasks:
  - id: T01
    title: Build the /engine-graph RPC surface
repos:
  - graph-service
created: '2026-07-10T21:53:16.030Z'
type: phase_plan
---

# Phase 1: Engine-graph RPC surface

**Intent**
Once this phase completes, a client can drive a project's execution graph end-to-end over HTTP —
seed an initial dag, read it back (nodes/edges/frontier/rolled-up status), steer it with any of the
11 engine steering primitives, advance a node through the driver's full outcome cycle, and dry-run a
prospective mutation — all against the real SQLite-backed execution store, with every engine failure
surfaced as a structured envelope rejection rather than a 500.

**Exit criteria**
- The app answers all seven `/engine-graph/*` routes (`GET /dag`, `GET /frontier`, `GET /node`,
  `POST /submit-event`, `POST /steer`, `POST /dry-run`, `POST /seed`); an unknown method/path under
  the prefix still returns the app's envelope-shaped 404.
- Every route resolves its `ProjectScope` from a `project` param and replies with the uniform
  `{ ok, data, error }` envelope; a rejected engine mutation (cycle, `not_in_frontier`,
  `unknown_node_type`) is a structured `{ ok:false, error }` body, never a thrown 500.
- `POST /steer` accepts a valid primitive and rejects an unknown `primitive` with a structured
  request-error (not a throw, not an engine `Result` code).
- `POST /dry-run` writes nothing — the execution store's `change_log` is untouched after the call.
- `POST /submit-event` with no `event` advances a seeded frontier node through the driver's full
  outcome cycle (status moves, not just `data`); with `event`+`payload` the client-dictated outcome
  is applied.
- `POST /seed` stamps the initial dag and leaves a genuine (`created_at` non-null) portfolio
  `projects` row for the seeded project (the cross-store anchor).

**Integration seams**
- **Router → app mount.** `http/app.ts` must `app.route('/engine-graph', buildEngineGraphRouter(service))`,
  the same way it mounts `/work-graph`. The router defines no `onError`/`notFound` of its own — it
  inherits the app-level envelope fallbacks. Phase review checks the mount is wired and the prefix
  is reachable.
- **Cross-store seed anchor.** `/seed` writes the execution store (which mints the project-scoped
  root on first touch) *and* adopts the project into the portfolio store — in that order. Phase
  review checks both stores agree after a seed (the `dag_nodes.project_id` FK is satisfied and
  `GET /work-graph/project?id=<project>` returns 200).
- **Engine barrel boundary.** Every engine symbol is imported from `@rad-orchestration/graph-engine`
  (the barrel) — never from `lib/graph-engine` internals. Phase review checks no deep import slipped
  in.

## Tasks

| Task | Repo | Complexity | Purpose |
|---|---|---|---|
| T01 | graph-service | complex | Add `buildEngineGraphRouter(service)` — a Hono sub-router mirroring `work-graph.ts` — exposing the |

**Order:** T01

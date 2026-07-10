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
- Create `graph-service/src/http/engine-graph.ts` — a Hono sub-router (`buildEngineGraphRouter(service)`).
- Create `graph-service/src/http/steer.ts` — the steer-envelope validator + primitive dispatch.
- Edit `graph-service/src/http/app.ts` — mount via `app.route('/engine-graph', buildEngineGraphRouter(service))`,
  following the existing `buildWorkGraphRouter(service)` line already there.

## Engine & driver contracts — inlined; do NOT open the engine to rediscover these

Import barrel-only from `@rad-orchestration/graph-engine`. Every signature below is copied from the
engine's public surface — you have everything you need to write compiling code without reading the
engine's implementation. **Import surface — copy verbatim; every name is a real, exact barrel export
and this is the complete set this task needs, so you never open the engine to confirm a name or path:**

```ts
import {
  add_node, remove_node, add_dependency, remove_dependency, move_node, set_order,
  toggle, resume, expand, add_corrective, reset,   // the 11 steer primitives
  apply_event,                                      // low-level — never dispatch as a steer primitive
  frontier, deriveContainerStatus, readFrontier, engage, isQuiescent,   // reads / derivation
  validate, preview,                                // dry-run
  PRIMITIVE_NAMES, NODE_STATUSES, ROOT_NODE_ID,     // vocab / anchors
} from '@rad-orchestration/graph-engine';
import type {
  Result, EngineError, EngineErrorCode,
  ChangeDelta, NodeChange, EdgeChange, ChangeOp,
  DagNode, DagEdge, EdgeKind, NodeId, NodeTypeName, NodeStatus, PrimitiveName,
  StateStore, ProjectScope, PrimitiveContext, NodeTypeRegistry,
  NodeSpec, Expansion, GraphSnapshot, MutationSpec,
  PreviewCone, AddCorrectivePreview, ResetPreview,
} from '@rad-orchestration/graph-engine';
```

```ts
// Result envelope — EVERY primitive returns this. error.code is a CLOSED union (see Gotcha 1).
type Result<T> = { ok: true; data: T } | { ok: false; error: EngineError };
interface EngineError { code: EngineErrorCode; message: string }
type EngineErrorCode =
  'invalid_delta' | 'unknown_node_type' | 'cycle' | 'cross_axis_cycle' | 'not_in_frontier' | 'root_guarded';

// Success payload of every mutation primitive:
interface ChangeDelta { primitive: PrimitiveName; params: Readonly<Record<string, unknown>>;
                        nodeChanges: NodeChange[]; edgeChanges: EdgeChange[] }

// Store seam — resolve scope + read the graph through this (apply is the sole write path):
interface ProjectScope { readonly projectId: string }
interface StateStore {
  getNode(scope: ProjectScope, id: NodeId): DagNode | null
  listNodes(scope: ProjectScope): DagNode[]
  listEdges(scope: ProjectScope): DagEdge[]
  apply(scope: ProjectScope, delta: ChangeDelta): Result<void>
}
// First arg to every standalone primitive — build once per request from the injected service:
interface PrimitiveContext { readonly store: StateStore; readonly scope: ProjectScope }

// ── The 11 steer primitives — allowlist EXACTLY these (NOT the 13-member PRIMITIVE_NAMES) ──
add_node(ctx, registry, id: NodeId, type: NodeTypeName, parent: NodeId,
         options?: { order?: number; data?: object; dependsOn?: NodeId[] }): Result<ChangeDelta>
remove_node(ctx, node: NodeId,
            strategy: { children?: 'cascade'|'promote'; dependents: 'heal'|'cascade'|'detach' }): Result<ChangeDelta>
add_dependency(ctx, from: NodeId, to: NodeId): Result<ChangeDelta>
remove_dependency(ctx, from: NodeId, to: NodeId): Result<ChangeDelta>
move_node(ctx, node: NodeId, newParent: NodeId): Result<ChangeDelta>
set_order(ctx, node: NodeId, order: number): Result<ChangeDelta>
toggle(ctx, node: NodeId): Result<ChangeDelta>
resume(ctx, node: NodeId): Result<ChangeDelta>
expand(ctx, registry, node: NodeId, expansion: { specs: NodeSpec[] }): Result<ChangeDelta>
add_corrective(ctx, id: NodeId, type: NodeTypeName, review: NodeId,
               options?: { order?: number; data?: object; maxRetries?: number }): Result<ChangeDelta>
reset(ctx, node: NodeId, cascade?: boolean): Result<ChangeDelta>
// ⚠ add_node & expand are the two NON-uniform ones — they also take the injected `registry`.

// ── Reads / derivation ──
frontier(nodes: DagNode[], edges: DagEdge[], scope: NodeId): DagNode[]
deriveContainerStatus(node: DagNode, children: DagNode[]): NodeStatus     // see Gotcha 3
readFrontier(ctx, scope: NodeId): readonly DagNode[]                      // driver-facing; reads off ctx.store

// ── dry-run ──
type GraphSnapshot = { nodes: readonly DagNode[]; edges: readonly DagEdge[] }   // = { listNodes(scope), listEdges(scope) }
validate(graph: GraphSnapshot, spec: MutationSpec): Result<void>
preview(graph: GraphSnapshot, spec): PreviewCone | AddCorrectivePreview | ResetPreview   // overloaded on spec.kind
// MutationSpec is a discriminated union on `kind`:
//   { kind:'add_dependency', from, to } | { kind:'remove_node', nodeId, cascade, dependentsCascade? }
//   | { kind:'move_node', nodeId, newParent } | { kind:'expand', node, expansion, registry }
//   | { kind:'add_corrective', review, id, type, options? } | { kind:'reset', node, cascade }

// ── submit-event: drive the FULL outcome cycle — never a bare apply_event ──
applyOutcome(ctx, registry, nodeId: NodeId, outcome): void               // graph-service/src/driver/outcome.ts
advance(project, node): Promise<AdvanceResult>                           // graph-service/src/driver/drive.ts — engages+dispatches+resolves
apply_event(ctx, node, event, handler): Result<ChangeDelta>             // low-level — do NOT call directly here

// ── seed cross-store anchor ──
portfolio.createProject(input: ProjectCreateInput, actor: string | null): Result<ProjectRecord>
```

```ts
// ── Types referenced above, resolved verbatim (so the engine's model files stay closed) ──
type NodeId = string;                                  // opaque; never positional / an index
type NodeTypeName = `${string}:${string}`;             // namespaced, e.g. 'rad-orc:task'
type NodeStatus = 'not_started' | 'in_progress' | 'done' | 'blocked' | 'failed';   // === NODE_STATUSES
type ChangeOp = 'created' | 'updated' | 'removed';
type EdgeKind = 'depends_on';                          // the only member this iteration ships
interface DagNode { id: NodeId; type: NodeTypeName; status: NodeStatus; parent: NodeId | null;
  order: number; derivedFrom: NodeId | null; disabled?: boolean; budgetAnchor?: NodeId | null;
  data: Readonly<Record<string, unknown>> }
interface DagEdge { from: NodeId; to: NodeId; kind: EdgeKind }
interface NodeChange { op: ChangeOp; before: DagNode | null; after: DagNode | null }
interface EdgeChange { op: ChangeOp; before: DagEdge | null; after: DagEdge | null }
interface NodeSpec { key: string; type: NodeTypeName; parent: string | NodeId | null;
  dependsOn: readonly (string | NodeId)[]; order?: number; data?: Readonly<Record<string, unknown>> }
interface Expansion { specs: readonly NodeSpec[] }
// dry-run preview return (treat as an opaque pass-through in your response body):
//   PreviewCone          { nodeIds: NodeId[]; edges: DagEdge[] }
//   AddCorrectivePreview { wouldHalt: boolean; correctiveNode: DagNode|null; gateEdge: DagEdge|null; reviewAfter: DagNode|null }
//   ResetPreview         { resetNodeIds: NodeId[]; tornDownNodeIds: NodeId[]; removedEdges: DagEdge[] }
```

**Where to get the two shapes not inlined above:** `AdvanceResult`/the driver `outcome` argument live in
`graph-service/src/driver/drive.ts` and `graph-service/src/driver/outcome.ts` (first-party, this service).
Those two files are the *only* ones worth opening. **Do NOT read the engine's implementation under
`lib/graph-engine`, and do NOT read `node_modules`.** If a contract you need is genuinely missing here,
log an `## Execution Notes` entry and proceed on what is inlined — do not reconstruct it by reading the
package source.

## Gotchas — known up front

1. **`Result<T>`'s `error.code` is a closed `EngineErrorCode` union** — you cannot reuse it for HTTP-shape
   rejections. Use your own `err()` helper (see `graph-service/src/http/respond.ts`) with an
   `invalid_request` code for request-shape errors (missing/blank `project`/`node`, malformed JSON/envelope);
   reuse the engine's `invalid_delta` only for per-`params` guards right before a primitive call.
2. **Seed ordering:** touch `execStore.listNodes(scope)` **first** (seeds the root via the store's
   `INSERT OR IGNORE`), *then* `portfolio.createProject` (adopts the row via `ON CONFLICT DO UPDATE`).
   Reverse the order and the store's root insert becomes a no-op and the root is never created.
3. **`/dag`'s `status`:** roll up the public `deriveContainerStatus` bottom-up from `ROOT_NODE_ID`. Do
   **not** reach for the engine's private `resolve()` — it short-circuits root to `in_progress` forever (a
   bootstrap detail, not a completion signal), and it isn't exported anyway.

## Hono skeleton (from the existing `buildWorkGraphRouter` / `app.ts` pattern — do not consult hono itself)

```ts
export function buildEngineGraphRouter(service: GraphService) {
  const r = new Hono();
  r.get('/dag', (c) => { /* resolve scope from c.req.query('project'); 400-envelope if blank */ });
  r.post('/steer', async (c) => { /* validate envelope in steer.ts, dispatch, return Result as envelope */ });
  // …submit-event, frontier, node, dry-run, seed
  return r;
}
```
`service` (`GraphService`, from `graph-service/src/compose.ts`) gives you the `store`, the `registry`, and
scope resolution — the same object every existing router closes over. Read `compose.ts` and
`work-graph.ts` for the wiring pattern; that is the extent of the host code you need.

**The change**
- **Reads:** `GET /engine-graph/dag?project=<id>` → `{ nodes, edges, frontier, status }` from
  `listNodes`/`listEdges` + `frontier`/`deriveContainerStatus`; `GET /engine-graph/frontier?project=<id>&context=<nodeId>`
  → `readFrontier(ctx, context)` (context is the working-context scope, D15 — carried per request,
  never stored); `GET /engine-graph/node?project=<id>&node=<id>` → `getNode`.
- **`POST /engine-graph/submit-event`** — body `{ project, node, event?, payload? }`. Both modes go through
  the driver's **full outcome cycle** (`applyOutcome`) — **never a bare `apply_event`**, which only patches
  `data` and would leave `status` unmoved. With `event`+`payload`, the client dictates the outcome (token +
  envelope); when omitted, `advance(project, node)` engages + fake-dispatches + resolves it. Return the
  applied delta + resulting (whole-tree) frontier. `event` is an opaque `<type>.<outcome>` token — do **not**
  validate it against a closed list (custom node types own their events).
- **`POST /engine-graph/steer`** — body `{ project, primitive, params }`. Validate the **envelope structure
  only**: `primitive` ∈ the **11 steer primitives** listed in the contracts block. **Do not** gate on the
  exported `PRIMITIVE_NAMES` wholesale — it has **13** members and includes `apply_event` and `engage`
  (driver-contract primitives, not steering ones); define the 11-member steer allowlist explicitly. Dispatch
  is **not uniform** — each primitive has its own `params` shape, and `add_node`/`expand` additionally take
  the injected `registry`. Return the primitive's `Result<ChangeDelta>` as an envelope; a rejected mutation
  (cycle, not-in-frontier, unknown type) is a structured `{ ok:false, error }`, not a 500. Do **not** read
  inside `params.data` (core-opacity). A hand-rolled discriminated check is sufficient — zod is optional.
- **`POST /engine-graph/dry-run`** — body `{ project, mutation }` (a `MutationSpec`); return
  `{ valid, reason?, preview }` from `validate` + `preview`. Read-only: no write, no delta emitted.
- **`POST /engine-graph/seed`** — body `{ project, seed }`: replay `add_node` / `add_dependency` / `expand`
  to stamp a project's initial dag. Honor the cross-store anchor in Gotcha 2. Return a summary (nodes/edges
  created).
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

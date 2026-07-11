---
project: "ENGINE-GRAPH-BENCH"
type: master_plan
status: draft
created: "2026-07-10"
project-type: standard
repos: [graph-service]
repo-group: rad-orc
total_phases: 1
total_tasks: 1
---

# ENGINE-GRAPH-BENCH — Master Plan

## Introduction

The `graph-service` host already composes the engine, both stores, and the node-type registry into
one Hono app and serves `/work-graph/*` plus `/health`. This slice adds the `/engine-graph/*` RPC
surface: a thin, faithful HTTP transport over the engine's closed primitive set so a client can
**seed**, **inspect**, **steer**, and **drive** a project's execution DAG over HTTP against the real
SQLite store — every route returning the same `{ ok, data, error }` envelope, and every rejected
engine mutation surfaced as a structured failure rather than a 500.

## Execution Map

**P01 · Engine-graph RPC surface** · repos: graph-service · order: T01

| Task | Repo | Complexity | Purpose |
|---|---|---|---|
| T01 | graph-service | complex | Build the `/engine-graph/*` router (dag/frontier/node reads, submit-event, steer, dry-run, seed) and mount it on the app |

## P01: Engine-graph RPC surface

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

### P01-T01: Build the engine-graph RPC router

Add the `/engine-graph/*` sub-router — a thin, faithful HTTP transport over the engine's closed
primitive set — and mount it on the Hono app beside `/work-graph`. When it lands, a client can seed a
project's DAG, read it back with its derived frontier and rolled-up status, steer it through the 11
client-invocable primitives, dry-run a mutation without writing, and drive a node through the full
outcome cycle — all over HTTP, with the engine owning every invariant and rejections coming back as
structured envelopes.

**Task type:** code
**Complexity:** complex
**Target repo:** graph-service

**Files**
- Create: `src/http/engine-graph.ts` — exports `buildEngineGraphRouter(service: GraphService): Hono`, closed over `service`; every handler reaches state through it, never a module-level singleton.
- Modify: `src/http/app.ts` — add `app.route('/engine-graph', buildEngineGraphRouter(service))` next to the existing `app.route('/work-graph', …)`. Do **not** touch the `notFound`/`onError` fallbacks (the sub-router inherits them) and do **not** re-mount the stream router.
- Create: `tests/http/engine-graph.test.ts` — behavioral tests over `app.request()` (see Testing).
- Read for patterns:
  - `src/http/work-graph.ts` — the router-builder shape to mirror: `new Hono()`, closed over `service`; the `requireField` / `readJsonBody` / `isPlainObject` / `isNonEmptyString` request-validation helpers; `const ACTOR = 'graph-service'`; the `result.ok ? 200 : 400` mapping via `fromResult`.
  - `src/http/respond.ts` — `ok` / `err` / `fromResult` and the envelope types.
  - `src/driver/drive.ts`, `src/driver/outcome.ts`, `src/driver/frontier.ts` — the driver pieces `/submit-event` reuses.
  - `tests/harness/drive.ts` — the black-box client that already documents the exact request/response shapes this surface must serve (`seed` / `dag` / `frontier` / `node` / `submitEvent` / `steer`), including the cross-store seed-ordering note in `assertProjectAnchored`.
  - `tests/http/work-graph.test.ts` — the `compose({ dbPath: ':memory:' })` + `buildApp` + `app.request()` test pattern to mirror.

**The change**

All seven routes live in `buildEngineGraphRouter(service)`. Each resolves its scope from a required
`project` param and builds one context, then calls exactly one engine primitive / store read /
dry-run read and serializes the `Result`:

```ts
const scope: ProjectScope = { projectId: project };
const ctx: PrimitiveContext = { store: service.execStore, scope };  // NB: field is execStore, not "store"
```

- **`GET /dag?project=<id>`** → `{ nodes, edges, frontier, status }`.
  - `nodes = service.execStore.listNodes(scope)`, `edges = service.execStore.listEdges(scope)`.
  - `frontier` = the whole-tree derived frontier via `globalFrontier(ctx, ROOT_NODE_ID)` (the driver's union-over-containers read).
  - `status` = the project's rolled-up status. **The seam to get right:** roll it up bottom-up from the root anchor using the engine's **public** `deriveContainerStatus` — never a private/unexported resolver. A leaf (no children) reads its own persisted `status`; a container reads `deriveContainerStatus(node, childrenWithResolvedStatus)`. Small recursive shape:
    ```ts
    function rollUp(nodeId: NodeId): NodeStatus {
      const node = nodesById.get(nodeId)!;
      const children = nodes.filter((n) => n.parent === nodeId);
      if (children.length === 0) return node.status;
      return deriveContainerStatus(node, children.map((c) => ({ ...c, status: rollUp(c.id) })));
    }
    const status = rollUp(ROOT_NODE_ID);
    ```
- **`GET /frontier?project=<id>&context=<nodeId>`** → the ready nodes for that working context: `readFrontier(ctx, context)`. The `context` is carried **per request** and **never stored server-side** — it is just the scope-node argument to `readFrontier`. Require both `project` and `context`.
- **`GET /node?project=<id>&node=<id>`** → one node's full state: `service.execStore.getNode(scope, node)`; `null` → `err('not_found', …)` at 404 (mirror `/work-graph`'s `/project` not-found mapping).
- **`POST /submit-event`** → body `{ project, node, event?, payload? }`. Both modes go through the driver's **full outcome cycle** — never a bare `apply_event` (which patches `data` only and leaves `status` unmoved).
  - No `event`: `advance(ctx, service.registry, service.resolvers, node)` — engages, dispatches to the registered resolver, resolves. `advance` returns a `Result` (a stale/ineligible node surfaces `not_in_frontier` as a structured failure, never a throw) — serialize it.
  - With `event` + `payload`: the client dictates the outcome. Engage first (`engage(ctx, service.registry, node)`), then commit the dictated outcome through the same cycle via `applyOutcome(ctx, service.registry, node, { token: event, envelope: payload })`. `event` is an **opaque `<type>.<outcome>` token — do NOT validate it against a closed list**; `payload` is the node-type `Envelope` (`{ outcome, data }`) passed through unread.
  - Response shape the existing harness expects: `{ delta: { nodeChanges, edgeChanges }, frontier }` — `frontier` = post-drive `globalFrontier(ctx, ROOT_NODE_ID)`; `delta` = the changes committed during the drive. A clean way to capture `delta`: register a `service.execStore.subscribe(...)` listener around the drive and aggregate the emitted `ChangeLogRow`s' `node_changes` / `edge_changes`, unsubscribing after.
- **`POST /steer`** → a **single validated envelope** `{ project, primitive, params }` over the **11 steering primitives**. **Define the 11-member allowlist explicitly** — do **not** gate on the whole exported `PRIMITIVE_NAMES` set (it also contains the driver-contract members `apply_event` and `engage`, which are **not** steerable):
  ```ts
  // exactly these 11 — the engine's closed vocabulary minus the driver-contract members
  const STEER = ['add_node','remove_node','add_dependency','remove_dependency','move_node',
                 'set_order','toggle','resume','expand','add_corrective','reset'] as const;
  ```
  Dispatch is **not uniform** — each primitive has its own `params` shape, and `add_node` / `expand` additionally take the injected `service.registry` (see the signatures under External surface). Return the primitive's `Result` as an envelope via `fromResult` — a rejected mutation (cycle, not-in-frontier, unknown type) becomes a structured `{ ok:false, error }`, not a throw.
  - **The seam to get right:** an unknown `primitive` (not in `STEER`) is a **request-shape** rejection → `err('invalid_request', …)` at 400. The engine `Result`'s `error.code` is a **closed union** and cannot be minted for this — use the service's own request-error path (as `/work-graph` does for malformed input).
  - **Envelope-structural validation only:** validate that `primitive` is in `STEER` and `params` is an object, then read the fields each primitive needs. **Never** parse node-type-owned `data` inside `params` — it is an opaque pass-through blob (core-opacity), which is exactly what keeps the surface open to unknown custom node types.
- **`POST /dry-run`** → body `{ project, mutation }`; `mutation` is a `MutationSpec`. Return validity + preview over the engine's **read-only** dry-run reads: `validate(graph, mutation)` and `preview(graph, mutation)` where `graph = { nodes: service.execStore.listNodes(scope), edges: service.execStore.listEdges(scope) }`. **Read-only:** no `store.apply`, no delta emitted. For an `expand` (or other registry-dependent) `mutation`, inject `service.registry` into the spec before calling — the client body carries no registry object. Suggested response: `{ valid: boolean, error?: EngineError, preview?: … }` (the `preview` shape narrows by `mutation.kind`: `PreviewCone` | `AddCorrectivePreview` | `ResetPreview`).
- **`POST /seed`** → body `{ project, seed: { steps } }`; returns `{ nodesCreated, edgesCreated }`. A **programmatic** entrypoint that replays the create primitives (`add_node` / `add_dependency` / `expand`) to stamp the initial DAG.
  - **The seam to get right (cross-store ordering):** touch the **execution store first**, adopt the project into the **portfolio second**. `SqliteStateStore.ensureSeeded` mints the project-scoped `root` node **only** on the `projects` row's genuine first `INSERT`. If portfolio `createProject` runs first it inserts that row (with `created_at`), so the exec store's `INSERT OR IGNORE` then no-ops (`changes === 0`) and **no root node is minted** — leaving the `add_node` steps with no `root` to parent onto. So: first force the exec-store touch (e.g. `service.execStore.listNodes(scope)`), then replay `steps`, then `service.portfolio.createProject({ id: project }, ACTOR)` to adopt it (skip adoption if `service.portfolio.getProject(project)` is already non-null). Count `nodesCreated` / `edgesCreated` from the replayed deltas.

**External surface**

- How to reference it — service-local:
  ```ts
  import { Hono } from 'hono';
  import type { Context } from 'hono';
  import type { GraphService } from '../compose.js';
  import { ok, err, fromResult } from './respond.js';
  import { advance } from '../driver/drive.js';
  import { applyOutcome } from '../driver/outcome.js';
  import type { DriverOutcome } from '../driver/outcome.js';
  import { globalFrontier } from '../driver/frontier.js';
  ```
- How to reference it — the engine barrel (values + types), consumed **barrel-only**:
  ```ts
  import {
    add_node, remove_node, add_dependency, remove_dependency, move_node, set_order,
    toggle, resume, expand, add_corrective, reset,   // the 11 steer primitives
    readFrontier, deriveContainerStatus,              // reads / roll-up
    validate, preview,                                // dry-run reads
    engage,                                           // explicit submit-event path
    ROOT_NODE_ID,
  } from '@rad-orchestration/graph-engine';
  import type {
    NodeId, DagNode, DagEdge, NodeStatus, NodeTypeName,
    ProjectScope, StateStore, PrimitiveContext, NodeTypeRegistry,
    Result, EngineError, ChangeDelta,
    Expansion, AddNodeOptions, RemoveNodeStrategy, AddCorrectiveOptions,
    GraphSnapshot, MutationSpec, PreviewCone, AddCorrectivePreview, ResetPreview,
    EventToken,
    Envelope as OutcomeEnvelope,   // NB: alias — collides with respond.ts's own `Envelope`
  } from '@rad-orchestration/graph-engine';
  ```
  - **Source note:** all of the above are the engine's **public contract**, re-exported through `@rad-orchestration/graph-engine`'s barrel (their real modules live under `lib/graph-engine/src/{primitives,derive,driver,model,store,node-type,result}` — never import those paths). The `advance` / `applyOutcome` / `globalFrontier` / `GraphService` symbols are **service-local** (`graph-service/src/driver/*` and `src/compose.ts`), not the barrel.
- Resolved shapes — so nothing has to be opened to build against it:
  ```ts
  // ── composition root (src/compose.ts) — the fields this router uses ──
  interface GraphService {
    readonly execStore: SqliteStateStore;                 // implements StateStore; also .subscribe(listener)
    readonly engine: Engine;
    readonly registry: NodeTypeRegistry;
    readonly portfolio: SqlitePortfolioStore;             // .createProject / .getProject / …
    readonly resolvers: Readonly<Record<NodeTypeName, NodeOutcomeResolver>>;
    // …plus db, capabilities, version, dbPath (unused here)
  }

  // ── core seams ──
  interface ProjectScope { readonly projectId: string; }
  interface PrimitiveContext { readonly store: StateStore; readonly scope: ProjectScope; }
  interface StateStore {
    getNode(scope: ProjectScope, id: NodeId): DagNode | null;
    listNodes(scope: ProjectScope): DagNode[];
    listEdges(scope: ProjectScope): DagEdge[];
    apply(scope: ProjectScope, delta: ChangeDelta): Result<void>;   // not called directly here
  }
  type Result<T> = { ok: true; data: T } | { ok: false; error: EngineError };
  interface EngineError { code: EngineErrorCode; message: string; }   // code is a CLOSED union — see below
  type EngineErrorCode =
    | 'invalid_delta' | 'unknown_node_type' | 'cycle'
    | 'cross_axis_cycle' | 'not_in_frontier' | 'root_guarded';
  type NodeId = string;
  type NodeTypeName = `${string}:${string}`;
  type NodeStatus = 'not_started' | 'in_progress' | 'done' | 'blocked' | 'failed';
  interface DagNode {
    id: NodeId; type: NodeTypeName; status: NodeStatus;
    parent: NodeId | null; order: number; derivedFrom: NodeId | null;
    disabled?: boolean; budgetAnchor?: NodeId | null;
    data: Readonly<Record<string, unknown>>;               // opaque — never parsed by this router
  }
  interface DagEdge { from: NodeId; to: NodeId; kind: 'depends_on'; }
  const ROOT_NODE_ID = 'root';

  // ── respond.ts (service-local) ──
  interface SuccessEnvelope<T> { readonly ok: true; readonly data: T; }
  interface FailureEnvelope   { readonly ok: false; readonly error: { readonly code: string; readonly message: string }; }
  function ok<T>(data: T): SuccessEnvelope<T>;
  function err(code: string, message: string): FailureEnvelope;   // service request-error path — free-form code
  function fromResult<T>(result: Result<T>): SuccessEnvelope<T> | FailureEnvelope;

  // ── the 11 steer primitives (each returns Result<ChangeDelta>) — dispatch is NOT uniform ──
  function add_node(ctx: PrimitiveContext, registry: NodeTypeRegistry, id: NodeId, type: NodeTypeName,
                    parent: NodeId, options?: AddNodeOptions): Result<ChangeDelta>;
  function remove_node(ctx: PrimitiveContext, node: NodeId, strategy: RemoveNodeStrategy): Result<ChangeDelta>;
  function add_dependency(ctx: PrimitiveContext, from: NodeId, to: NodeId): Result<ChangeDelta>;
  function remove_dependency(ctx: PrimitiveContext, from: NodeId, to: NodeId): Result<ChangeDelta>;
  function move_node(ctx: PrimitiveContext, node: NodeId, newParent: NodeId): Result<ChangeDelta>;
  function set_order(ctx: PrimitiveContext, node: NodeId, order: number): Result<ChangeDelta>;
  function toggle(ctx: PrimitiveContext, node: NodeId): Result<ChangeDelta>;
  function resume(ctx: PrimitiveContext, node: NodeId): Result<ChangeDelta>;
  function expand(ctx: PrimitiveContext, registry: NodeTypeRegistry, node: NodeId,
                  expansion: Expansion): Result<ChangeDelta>;
  function add_corrective(ctx: PrimitiveContext, id: NodeId, type: NodeTypeName, review: NodeId,
                          options?: AddCorrectiveOptions): Result<ChangeDelta>;
  function reset(ctx: PrimitiveContext, node: NodeId, cascade?: boolean): Result<ChangeDelta>;
  interface AddNodeOptions { readonly order?: number; readonly data?: Readonly<Record<string, unknown>>;
                             readonly dependsOn?: readonly NodeId[]; }
  interface RemoveNodeStrategy { readonly children?: 'cascade' | 'promote';
                                 readonly dependents: 'heal' | 'cascade' | 'detach'; }
  interface AddCorrectiveOptions { readonly order?: number; readonly data?: Readonly<Record<string, unknown>>;
                                   readonly maxRetries?: number; }
  interface NodeSpec { readonly key: string; readonly type: NodeTypeName;
                       readonly parent: string | NodeId | null;
                       readonly dependsOn: readonly (string | NodeId)[];
                       readonly order?: number; readonly data?: Readonly<Record<string, unknown>>; }
  interface Expansion { readonly specs: readonly NodeSpec[]; }

  // ── reads / roll-up / dry-run (all pure reads, no write) ──
  function readFrontier(ctx: PrimitiveContext, scope: NodeId): readonly DagNode[];
  function deriveContainerStatus(node: DagNode, children: readonly DagNode[]): NodeStatus;
  function validate(graph: GraphSnapshot, mutationSpec: MutationSpec): Result<void>;
  function preview(graph: GraphSnapshot, spec: Extract<MutationSpec,{kind:'add_corrective'}>): AddCorrectivePreview;
  function preview(graph: GraphSnapshot, spec: Extract<MutationSpec,{kind:'reset'}>): ResetPreview;
  function preview(graph: GraphSnapshot, spec: Exclude<MutationSpec,{kind:'add_corrective'|'reset'}>): PreviewCone;
  interface GraphSnapshot { readonly nodes: readonly DagNode[]; readonly edges: readonly DagEdge[]; }
  type MutationSpec =
    | { readonly kind: 'add_dependency'; readonly from: NodeId; readonly to: NodeId }
    | { readonly kind: 'remove_node'; readonly nodeId: NodeId; readonly cascade: boolean; readonly dependentsCascade?: boolean }
    | { readonly kind: 'move_node'; readonly nodeId: NodeId; readonly newParent: NodeId }
    | { readonly kind: 'expand'; readonly node: NodeId; readonly expansion: Expansion; readonly registry: NodeTypeRegistry }
    | { readonly kind: 'add_corrective'; readonly review: NodeId; readonly id: NodeId; readonly type: NodeTypeName; readonly options?: AddCorrectiveOptions }
    | { readonly kind: 'reset'; readonly node: NodeId; readonly cascade: boolean };

  // ── driver full outcome cycle (submit-event) ──
  function engage(ctx: PrimitiveContext, registry: NodeTypeRegistry, node: NodeId): Result<ActResult>;
  function advance(ctx: PrimitiveContext, registry: NodeTypeRegistry,
                   resolvers: Readonly<Record<NodeTypeName, NodeOutcomeResolver>>,
                   node: DagNode): Promise<Result<{ nodeId: NodeId; type: NodeTypeName }>>;
  function applyOutcome(ctx: PrimitiveContext, registry: NodeTypeRegistry, nodeId: NodeId, outcome: DriverOutcome): void;
  function globalFrontier(ctx: PrimitiveContext, root: NodeId): readonly DagNode[];
  interface DriverOutcome { readonly token: EventToken; readonly envelope: OutcomeEnvelope; }
  type EventToken = `${NodeTypeName}.${string}`;                 // opaque — do NOT validate against a list
  interface OutcomeEnvelope { readonly outcome: 'ok' | 'error'; readonly data: Readonly<Record<string, unknown>>; readonly route?: EventToken; }

  // ── portfolio adoption (seed) ──
  function createProject(input: ProjectCreateInput, actor: string | null): Result<ProjectRecord>;
  function getProject(id: string): ProjectRecord | null;
  interface ProjectCreateInput { readonly id: string; readonly projectType?: string | null;
    readonly status?: 'planning'|'in_progress'|'done'|'archived'; readonly groupId?: string | null;
    readonly autoCommit?: 'ask'|'always'|'never'; readonly autoPr?: 'ask'|'always'|'never';
    readonly sourceControlInitialized?: boolean; }

  // ── change_log row (only if capturing submit-event's delta via execStore.subscribe) ──
  interface ChangeLogRow { readonly seq: number; readonly project_id: string;
    readonly primitive: string; readonly params: Readonly<Record<string, unknown>>;
    readonly node_changes: readonly unknown[]; readonly edge_changes: readonly unknown[]; /* …ts, actor */ }
  ```
- Request/response shapes the existing black-box client (`tests/harness/drive.ts`) already targets — match them:
  ```ts
  // POST /engine-graph/seed   body { project, seed: { steps } }   →  { nodesCreated, edgesCreated }
  type SeedStep =
    | { primitive: 'add_node'; id: string; type: string; parent: string; order?: number; data?: Record<string, unknown>; dependsOn?: readonly string[] }
    | { primitive: 'add_dependency'; from: string; to: string }
    | { primitive: 'expand'; node: string; expansion: { specs: readonly unknown[] } };
  // GET  /engine-graph/dag?project        →  { nodes, edges, frontier, status }
  // GET  /engine-graph/frontier?project&context  →  DagNode[]
  // GET  /engine-graph/node?project&node  →  DagNode        (404 { ok:false } when absent)
  // POST /engine-graph/submit-event  body { project, node, event?, payload? }  →  { delta:{nodeChanges,edgeChanges}, frontier }
  // POST /engine-graph/steer   body { project, primitive, params }             →  fromResult(<primitive Result>)
  // POST /engine-graph/dry-run body { project, mutation }                      →  { valid, error?, preview? }
  ```

**Done when**
- `app.ts` mounts `buildEngineGraphRouter(service)` at `/engine-graph`; all seven routes respond with the uniform `{ ok, data, error }` envelope and 400 on a missing `project`.
- `GET /dag` returns `{ nodes, edges, frontier, status }` with `status` rolled up bottom-up from `root` via `deriveContainerStatus`; `GET /frontier` returns the ready nodes for the requested `context`; `GET /node` returns the node or a 404 `not_found`.
- `POST /submit-event` with no `event` advances a seeded eligible node (its `status` moves off `not_started`); with `event` + `payload` it commits the client-dictated outcome through the full cycle (not a bare `apply_event`).
- `POST /steer` runs a valid primitive and returns its `Result` as an envelope; an unknown `primitive` returns `{ ok:false, error:{ code:'invalid_request' } }` (structured, not thrown, not an engine code).
- `POST /dry-run` returns validity + preview and leaves the store byte-for-byte unchanged (no new `change_log` row).
- `POST /seed` returns `{ nodesCreated, edgesCreated }`, and afterward `GET /work-graph/project?id=<project>` returns 200 (the project was adopted) with the exec-store touch having happened before adoption.
- Every rejected engine mutation surfaces as a structured `{ ok:false, error }` — no path returns a 500 for an expected engine rejection.

**Testing**
- Build the app the way `tests/http/work-graph.test.ts` does — `const service = compose({ dbPath: ':memory:' }); const app = buildApp(service);` — and drive every case through `app.request()` (no socket). Holding `service` lets a test subscribe to `service.execStore` to assert the dry-run emits nothing.
- Cover the behavior that carries risk:
  - Each read returns the right shape: seed a small DAG, then assert `/dag` has `nodes`/`edges`/`frontier`/`status`, `/frontier?context=root` lists the eligible nodes, `/node` returns one node.
  - `steer` accepts a valid primitive (e.g. `add_node`) and **rejects an unknown `primitive` with a structured `{ ok:false, error }`** (assert no throw / 500, and `error.code === 'invalid_request'`).
  - `dry-run` writes nothing — assert the `change_log` is untouched (no `execStore` emission during the call, or an unchanged `/dag` before/after).
  - `submit-event` with no `event` advances a seeded node (status moves).
  - **Core-opacity guard:** `steer` an `add_node` (or `seed` a step) carrying an arbitrary opaque `data` blob, then read it back via `/node` and assert the blob round-trips **unread and unchanged**.
  - The cross-store `seed` ordering: after `seed`, `/work-graph/project?id=<project>` returns 200 and `/node?node=root` exists.
- Skip: re-testing engine invariants (acyclicity, readiness, budget) — those are the engine's own suites; only assert the route **surfaces the engine's `Result` faithfully**. Skip snapshotting full payload bodies and asserting exact prose in error messages.

// graph-service/src/http/engine-graph.ts — the execution-DAG API: query reads, the `submit-event`
// execution driver, the single-envelope `steer` over the closed primitive set, the read-only
// `dry-run`, and the programmatic `seed` — a Hono sub-router mounted at `/engine-graph` by
// `http/app.ts`. Every route resolves its own `ProjectScope` from the `project` query/body param and
// reaches state exclusively through the injected `GraphService`.
import path from 'node:path';
import { Hono } from 'hono';
import type { Context } from 'hono';
import type {
  AddCorrectivePreview,
  ChangeDelta,
  CompletionPayloadSchema,
  DagEdge,
  DagNode,
  EdgeChange,
  Envelope as OutcomeEnvelope,
  EventToken,
  Executor,
  Expansion,
  GraphSnapshot,
  MutationSpec,
  NodeChange,
  NodeId,
  NodeStatus,
  NodeTypeName,
  NodeTypeRegistry,
  Presentation,
  PreviewCone,
  PrimitiveContext,
  PrimitiveName,
  ProjectScope,
  Result,
  ResetPreview,
} from '@rad-orchestration/graph-engine';
import {
  ROOT_NODE_ID,
  add_dependency,
  add_node,
  assertNever,
  deriveContainerStatus,
  expand,
  frontier,
  preview,
  readFrontier,
  validate,
} from '@rad-orchestration/graph-engine';
import type { GraphService } from '../compose.js';
import type { QuiescenceResult } from '../driver/drive.js';
import { resolveViaNodeType, runToQuiescence } from '../driver/drive.js';
import { globalFrontier } from '../driver/frontier.js';
import { applyOutcome } from '../driver/outcome.js';
import { createFieldResolver } from '../resolve/resolve-fields.js';
import type { SeedStep } from '../seed-step.js';
import { SHARED_MUTATION_KINDS, isSharedMutationKind, parseSharedMutation, toEngineMutationSpec } from './mutation-spec.js';
import type { FailureEnvelope, SuccessEnvelope } from './respond.js';
import { err, fromResult, ok } from './respond.js';
import { dispatchSteerPrimitive, parseSteerRequest } from './steer.js';

type Checked<T> = SuccessEnvelope<T> | FailureEnvelope;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** Every route's first move: a missing/blank `project` (or any other required string field) is
 * always the same structured `400`-style rejection, never a route-specific shape. */
function requireField(raw: unknown, field: string): Checked<string> {
  if (!isNonEmptyString(raw)) return err('invalid_request', `'${field}' is required`);
  return ok(raw);
}

async function readJsonBody(c: Context): Promise<Checked<Record<string, unknown>>> {
  let parsed: unknown;
  try {
    parsed = await c.req.json();
  } catch {
    return err('invalid_request', 'request body must be valid JSON');
  }
  if (!isPlainObject(parsed)) return err('invalid_request', 'request body must be a JSON object');
  return ok(parsed);
}

/**
 * Bottom-up containment rollup composed from the engine's own exported `deriveContainerStatus`,
 * rooted at the project scope's root — never a second frontier/readiness derivation of our own.
 * A leaf (no children) reads its own persisted `status`; a container's status is the roll-up over
 * its own children's *resolved* statuses. Root is treated like any other container here — unlike
 * the engine's private frontier-bootstrap resolver, which reads root's raw `status` verbatim so the
 * top-level spine is unconditionally frontier-eligible — so the whole tree's completion is
 * observable even though root's own `status` column never itself moves past its seeded
 * `in_progress` (see `createRootNode`).
 */
function resolveProjectStatus(nodes: readonly DagNode[]): NodeStatus {
  const childrenByParent = new Map<NodeId, DagNode[]>();
  for (const node of nodes) {
    if (node.parent === null) continue;
    const siblings = childrenByParent.get(node.parent);
    if (siblings) siblings.push(node);
    else childrenByParent.set(node.parent, [node]);
  }

  const resolved = new Map<NodeId, NodeStatus>();
  function resolve(node: DagNode): NodeStatus {
    const cached = resolved.get(node.id);
    if (cached) return cached;
    const children = childrenByParent.get(node.id) ?? [];
    const status: NodeStatus =
      children.length === 0
        ? node.status
        : deriveContainerStatus(node, children.map((child) => ({ ...child, status: resolve(child) })));
    resolved.set(node.id, status);
    return status;
  }

  const root = nodes.find((node) => node.id === ROOT_NODE_ID);
  return root ? resolve(root) : 'not_started';
}

function edgeKey(edge: Pick<DagEdge, 'from' | 'to' | 'kind'>): string {
  return `${edge.kind}:${edge.from}->${edge.to}`;
}

/**
 * Reconstructs a `ChangeDelta`-shaped summary of everything that changed between two graph
 * snapshots. `submit-event`'s driver step (`applyOutcome`/`advance`) itself returns nothing — it
 * may commit several primitives' worth of deltas (a data patch, a routing request, an expansion) in
 * sequence — so this diffs the observable before/after state instead of threading a delta out of
 * the driver. Never a substitute for a primitive's own exact `Result<ChangeDelta>` (`steer`/`seed`
 * return that directly).
 */
function diffToDelta(
  primitive: PrimitiveName,
  params: Readonly<Record<string, unknown>>,
  before: GraphSnapshot,
  after: GraphSnapshot,
): ChangeDelta {
  const beforeNodes = new Map(before.nodes.map((node) => [node.id, node]));
  const afterNodes = new Map(after.nodes.map((node) => [node.id, node]));
  const nodeChanges: NodeChange[] = [];
  for (const [id, node] of afterNodes) {
    const priorNode = beforeNodes.get(id);
    if (!priorNode) nodeChanges.push({ op: 'created', before: null, after: node });
    else if (JSON.stringify(priorNode) !== JSON.stringify(node)) {
      nodeChanges.push({ op: 'updated', before: priorNode, after: node });
    }
  }
  for (const [id, node] of beforeNodes) {
    if (!afterNodes.has(id)) nodeChanges.push({ op: 'removed', before: node, after: null });
  }

  const beforeEdges = new Map(before.edges.map((edge) => [edgeKey(edge), edge]));
  const afterEdges = new Map(after.edges.map((edge) => [edgeKey(edge), edge]));
  const edgeChanges: EdgeChange[] = [];
  for (const [key, edge] of afterEdges) {
    if (!beforeEdges.has(key)) edgeChanges.push({ op: 'created', before: null, after: edge });
  }
  for (const [key, edge] of beforeEdges) {
    if (!afterEdges.has(key)) edgeChanges.push({ op: 'removed', before: edge, after: null });
  }

  return { primitive, params, nodeChanges, edgeChanges };
}

/** Narrows `preview`'s three-way overload (each keyed to a `MutationSpec.kind` partition) back to
 * one call — TypeScript's overload set has no single signature spanning the whole union. */
function previewFor(
  graph: GraphSnapshot,
  mutationSpec: MutationSpec,
): PreviewCone | AddCorrectivePreview | ResetPreview {
  switch (mutationSpec.kind) {
    case 'add_corrective':
      return preview(graph, mutationSpec);
    case 'reset':
      return preview(graph, mutationSpec);
    default:
      return preview(graph, mutationSpec);
  }
}

/**
 * The one uniform, node-agnostic representation of a node every read route surfaces (`/dag`,
 * `/node`, `/frontier`, and the next-action `frontier`). It is the generic `DagNode` relayed
 * verbatim — every one of its slots (`id`/`type`/`status`/`parent`/`order`/`derivedFrom`/`data`…)
 * is generic, none is per-type — plus the one slot the service must attach: `presentation`, taken
 * from the node type's own definition and never authored here, so a custom type renders with its
 * own label/description at zero service knowledge. `data` stays opaque: the service never reads a
 * field off it to shape the response.
 *
 * (The generic structural slots — `parent`/`order`/`derivedFrom` — are retained rather than
 * dropped: `parent` is the only containment signal on the HTTP surface, since edges are
 * `depends_on` only, so a client reconstructs the tree/frontier from it; see the Execution Notes on
 * this task for why they stay despite the handoff's shorter field listing.)
 */
interface NodeView extends DagNode {
  readonly presentation: Presentation;
}

/**
 * Projects a persisted `DagNode` onto the uniform {@link NodeView} — the node relayed verbatim plus
 * its type's own `presentation`, which the service relays and never authors. The one registry-less
 * node is the system-owned root anchor (`system:root`, minted outside the node-type registry — see
 * `createRootNode`): it has no definition to relay from, so its `presentation` falls back to a
 * minimal label of its own type name rather than a fabricated per-type presentation.
 */
function toNodeView(registry: NodeTypeRegistry, node: DagNode): NodeView {
  const definition = registry.resolve(node.type);
  return { ...node, presentation: definition?.presentation ?? { label: node.type } };
}

/**
 * `submit-event`'s response shape: the stopped node's `ActResult`, reshaped into the envelope the
 * CLI already relays to the orchestrator (mirrors `cli/src/lib/pipeline-engine`'s own
 * `PipelineResult`: `action`/`context`/`completion_event`). Every field but `delta`/`frontier` is
 * `null` at global quiescence or once a self-halted node stops driving on its own — there is no
 * next action to report. Every field is generic: `action` is a type name, `completion_event` the
 * type's own declared token, `frontier` a list of uniform node views — no per-type field.
 */
interface NextActionEnvelope {
  readonly action: NodeTypeName | null;
  readonly node: NodeId | null;
  readonly executor: Executor | null;
  readonly instructions: string | null;
  readonly context: Readonly<Record<string, unknown>> | null;
  readonly completion_event: EventToken | null;
  readonly completion_payload_schema: CompletionPayloadSchema | null;
  readonly delta: ChangeDelta;
  readonly frontier: readonly NodeView[];
}

/**
 * Shapes `driven`'s stop into the next-action envelope; `null` fields throughout once there is no
 * next action (settled, or a self-halted node quiesced the driver on its own). `instructions`,
 * `completion_event`, and `completion_payload_schema` are all sourced from the stopped node's own
 * type definition (`null` for a type that declares none) — the service holds no per-type map of its
 * own, here or anywhere else; this reads the definition exactly as `toNodeView` already does for
 * `presentation`.
 */
function buildNextActionEnvelope(
  registry: NodeTypeRegistry,
  driven: QuiescenceResult,
  delta: ChangeDelta,
  frontierNow: readonly DagNode[],
): NextActionEnvelope {
  const frontierView = frontierNow.map((node) => toNodeView(registry, node));
  if (!driven.settled && driven.reason === 'external-actor') {
    const definition = registry.resolve(driven.type);
    return {
      action: driven.type,
      node: driven.nodeId,
      executor: driven.actResult.executor,
      instructions: definition?.instructions ?? null,
      context: driven.actResult.payload ? { ...driven.actResult.payload } : {},
      completion_event: definition?.completionToken ?? null,
      completion_payload_schema: definition?.completionPayloadSchema ?? null,
      delta,
      frontier: frontierView,
    };
  }
  return {
    action: null,
    node: null,
    executor: null,
    instructions: null,
    context: null,
    completion_event: null,
    completion_payload_schema: null,
    delta,
    frontier: frontierView,
  };
}

// ── seed: replay add_node / add_dependency / expand to stamp a project's initial dag ──────────
// `SeedStep` itself lives in `../seed-step.js` — shared verbatim with the template compiler
// (`templates/compile.ts`), which compiles a YAML template down to the exact same step union.

function parseSeedStep(raw: unknown, index: number): Checked<SeedStep> {
  if (!isPlainObject(raw)) return err('invalid_request', `seed step ${index} must be an object`);

  switch (raw.primitive) {
    case 'add_node': {
      const { id, type, parent, order, data, dependsOn } = raw;
      if (!isNonEmptyString(id) || !isNonEmptyString(type) || !isNonEmptyString(parent)) {
        return err('invalid_request', `seed step ${index} ('add_node') requires string 'id', 'type', and 'parent'`);
      }
      if (order !== undefined && typeof order !== 'number') {
        return err('invalid_request', `seed step ${index} ('add_node') 'order' must be a number when present`);
      }
      if (data !== undefined && !isPlainObject(data)) {
        return err('invalid_request', `seed step ${index} ('add_node') 'data' must be an object when present`);
      }
      if (dependsOn !== undefined && (!Array.isArray(dependsOn) || !dependsOn.every(isNonEmptyString))) {
        return err('invalid_request', `seed step ${index} ('add_node') 'dependsOn' must be an array of node ids when present`);
      }
      return ok({
        primitive: 'add_node',
        id,
        type: type as NodeTypeName,
        parent,
        order,
        data,
        dependsOn: dependsOn as readonly NodeId[] | undefined,
      });
    }
    case 'add_dependency': {
      const { from, to } = raw;
      if (!isNonEmptyString(from) || !isNonEmptyString(to)) {
        return err('invalid_request', `seed step ${index} ('add_dependency') requires string 'from' and 'to'`);
      }
      return ok({ primitive: 'add_dependency', from, to });
    }
    case 'expand': {
      const { node, expansion } = raw;
      if (!isNonEmptyString(node) || !isPlainObject(expansion) || !Array.isArray(expansion.specs)) {
        return err('invalid_request', `seed step ${index} ('expand') requires string 'node' and an 'expansion' with a 'specs' array`);
      }
      return ok({ primitive: 'expand', node, expansion: expansion as unknown as Expansion });
    }
    default:
      return err('invalid_request', `seed step ${index} 'primitive' must be one of: add_node, add_dependency, expand`);
  }
}

function parseSeedSteps(raw: unknown): Checked<readonly SeedStep[]> {
  if (!isPlainObject(raw) || !Array.isArray(raw.steps)) {
    return err('invalid_request', "'seed' must be an object with a 'steps' array");
  }
  const steps: SeedStep[] = [];
  for (let index = 0; index < raw.steps.length; index += 1) {
    const parsed = parseSeedStep(raw.steps[index], index);
    if (!parsed.ok) return parsed;
    steps.push(parsed.data);
  }
  return ok(steps);
}

export function applySeedStep(ctx: PrimitiveContext, registry: NodeTypeRegistry, step: SeedStep): Result<ChangeDelta> {
  switch (step.primitive) {
    case 'add_node':
      return add_node(ctx, registry, step.id, step.type, step.parent, {
        order: step.order,
        data: step.data,
        dependsOn: step.dependsOn,
      });
    case 'add_dependency':
      return add_dependency(ctx, step.from, step.to);
    case 'expand':
      return expand(ctx, registry, step.node, step.expansion);
    default:
      return assertNever(step);
  }
}

/** Builds the `/engine-graph` sub-router, closed over `service` — every handler reaches state
 * exclusively through it, never a module-level singleton. Mounted onto the main app by
 * `http/app.ts` via `app.route('/engine-graph', buildEngineGraphRouter(service))`. */
export function buildEngineGraphRouter(service: GraphService): Hono {
  const app = new Hono();

  /** Touches the execution store so `ensureSeeded`'s first-touch side effect (the bare `projects`
   * row + root node) has run for `scope` — the return value is never read; the call exists purely
   * for that side effect, ahead of `/seed`'s own portfolio-project adoption check. */
  function ensureExecStoreSeeded(scope: ProjectScope): void {
    service.execStore.listNodes(scope);
  }

  app.get('/dag', (c) => {
    const projectResult = requireField(c.req.query('project'), 'project');
    if (!projectResult.ok) return c.json(projectResult, 400);
    const scope: ProjectScope = { projectId: projectResult.data };

    const nodes = service.execStore.listNodes(scope);
    const edges = service.execStore.listEdges(scope);
    return c.json(
      ok({
        nodes: nodes.map((node) => toNodeView(service.registry, node)),
        edges,
        frontier: frontier(nodes, edges, ROOT_NODE_ID).map((node) => toNodeView(service.registry, node)),
        status: resolveProjectStatus(nodes),
      }),
    );
  });

  app.get('/frontier', (c) => {
    const projectResult = requireField(c.req.query('project'), 'project');
    if (!projectResult.ok) return c.json(projectResult, 400);
    const contextResult = requireField(c.req.query('context'), 'context');
    if (!contextResult.ok) return c.json(contextResult, 400);

    const scope: ProjectScope = { projectId: projectResult.data };
    const ctx: PrimitiveContext = { store: service.execStore, scope };
    // D15: `context` is the caller's working-context scope for this one request only — carried in
    // per request, never stored server-side.
    return c.json(ok(readFrontier(ctx, contextResult.data).map((node) => toNodeView(service.registry, node))));
  });

  app.get('/node', (c) => {
    const projectResult = requireField(c.req.query('project'), 'project');
    if (!projectResult.ok) return c.json(projectResult, 400);
    const nodeResult = requireField(c.req.query('node'), 'node');
    if (!nodeResult.ok) return c.json(nodeResult, 400);

    const scope: ProjectScope = { projectId: projectResult.data };
    const node = service.execStore.getNode(scope, nodeResult.data);
    if (!node) return c.json(err('not_found', `node '${nodeResult.data}' does not exist`), 404);
    return c.json(ok(toNodeView(service.registry, node)));
  });

  app.post('/submit-event', async (c) => {
    const bodyResult = await readJsonBody(c);
    if (!bodyResult.ok) return c.json(bodyResult, 400);
    const body = bodyResult.data;

    const projectResult = requireField(body.project, 'project');
    if (!projectResult.ok) return c.json(projectResult, 400);
    const nodeResult = requireField(body.node, 'node');
    if (!nodeResult.ok) return c.json(nodeResult, 400);

    const scope: ProjectScope = { projectId: projectResult.data };
    const nodeId = nodeResult.data;
    const ctx: PrimitiveContext = { store: service.execStore, scope };

    const existing = service.execStore.getNode(scope, nodeId);
    if (!existing) return c.json(err('not_found', `node '${nodeId}' does not exist`), 404);

    const { event, payload } = body;
    if ((event === undefined) !== (payload === undefined)) {
      return c.json(err('invalid_request', "'event' and 'payload' must be supplied together, or both omitted"), 400);
    }

    const before: GraphSnapshot = { nodes: service.execStore.listNodes(scope), edges: service.execStore.listEdges(scope) };

    if (event !== undefined) {
      // `event` is an opaque `<type>.<outcome>` token — never validated against a closed list;
      // custom node types own their own events.
      if (!isNonEmptyString(event)) return c.json(err('invalid_request', "'event' must be a non-empty string"), 400);
      if (!isPlainObject(payload) || (payload.outcome !== 'ok' && payload.outcome !== 'error')) {
        return c.json(err('invalid_request', "'payload' must be an envelope with outcome 'ok' or 'error'"), 400);
      }
      const envelope: OutcomeEnvelope = {
        outcome: payload.outcome,
        data: isPlainObject(payload.data) ? payload.data : {},
        ...(isNonEmptyString(payload.route) ? { route: payload.route as EventToken } : {}),
      };
      try {
        const definition = service.registry.resolve(existing.type);
        if (definition?.resolve) {
          // The node owns its outcome derivation — the relayed event is only an "it finished"
          // trigger, so re-derive from the node's own state (e.g. a report's own doc-read) rather
          // than trust the caller's asserted outcome. Reached for ANY node type that declares
          // `resolve`, by contract — never by type name; this is code_review's verdict path,
          // generalized, via the same bridge the drive loop's noop auto-resolution uses.
          await resolveViaNodeType(ctx, service.registry, service.capabilities, existing);
        } else {
          // The client dictates the outcome directly — still the full outcome cycle
          // (handle -> apply_event -> routing -> expansion -> syncProjectedStatus), never a bare
          // apply_event.
          applyOutcome(ctx, service.registry, nodeId, { token: event as EventToken, envelope });
        }
      } catch (error) {
        return c.json(err('invalid_delta', error instanceof Error ? error.message : String(error)), 400);
      }
    }

    // Built fresh per request, from the scope and service both in hand — never cached, so a
    // worktree added since the last call is picked up immediately. `listWorktrees` is a plain
    // synchronous, non-transactional read, so this costs one query per request, not per node.
    const resolver = createFieldResolver({
      projectDocRoot: path.join(service.root, 'projects', scope.projectId),
      worktreesRoot: path.join(service.root, 'worktrees'),
      worktrees: service.portfolio.listWorktrees(scope.projectId),
      projectId: scope.projectId,
    });

    // With or without a relayed event: drive as far as deterministic/host-side nodes allow —
    // auto-resolving every `noop` executor — then stop at the first node whose executor needs the
    // orchestrator/human, never faking that work. One call relays a result (or, with no event,
    // just kicks off driving from wherever the graph currently stands) and gets the next move.
    const driven = await runToQuiescence(ctx, service.registry, ROOT_NODE_ID, service.capabilities, undefined, resolver);
    if (!driven.settled && driven.reason === 'max-steps') {
      return c.json(err('driver_stalled', `drive loop exceeded ${driven.steps} steps without reaching quiescence or an external actor`), 400);
    }
    if (!driven.settled && driven.reason === 'engage-failed') {
      // A resolution refusal (or a frontier race) is an expected, operator-actionable outcome —
      // never a thrown 500. The node stays exactly where `engage` found it (still re-engageable).
      // `engage`'s own code/message travel through verbatim, never re-derived here.
      return c.json(err(driven.code, driven.message), 400);
    }

    const after: GraphSnapshot = { nodes: service.execStore.listNodes(scope), edges: service.execStore.listEdges(scope) };
    const delta = diffToDelta(
      event !== undefined ? 'apply_event' : 'engage',
      { node: nodeId, event: event ?? null },
      before,
      after,
    );
    return c.json(ok(buildNextActionEnvelope(service.registry, driven, delta, globalFrontier(ctx, ROOT_NODE_ID))));
  });

  app.post('/steer', async (c) => {
    const bodyResult = await readJsonBody(c);
    if (!bodyResult.ok) return c.json(bodyResult, 400);
    const body = bodyResult.data;

    const projectResult = requireField(body.project, 'project');
    if (!projectResult.ok) return c.json(projectResult, 400);
    const scope: ProjectScope = { projectId: projectResult.data };

    const parsed = parseSteerRequest({ primitive: body.primitive, params: body.params });
    if (!parsed.ok) return c.json(parsed, 400);

    // D16: clients steer the graph exclusively through named primitives — never raw edge/node SQL.
    const ctx: PrimitiveContext = { store: service.execStore, scope };
    const result = dispatchSteerPrimitive(ctx, service.registry, parsed.data);
    return c.json(fromResult(result), result.ok ? 200 : 400);
  });

  app.post('/dry-run', async (c) => {
    const bodyResult = await readJsonBody(c);
    if (!bodyResult.ok) return c.json(bodyResult, 400);
    const body = bodyResult.data;

    const projectResult = requireField(body.project, 'project');
    if (!projectResult.ok) return c.json(projectResult, 400);
    const scope: ProjectScope = { projectId: projectResult.data };

    const mutationRaw = body.mutation;
    const kind = isPlainObject(mutationRaw) ? mutationRaw.kind : undefined;
    if (!isSharedMutationKind(kind)) {
      return c.json(err('invalid_request', `'mutation.kind' must be one of: ${SHARED_MUTATION_KINDS.join(', ')}`), 400);
    }
    // The shared shape steer's dispatch parses through too (Integration Seams: `steer`/`dry-run`
    // pin one `MutationSpec` request shape) — translated to the engine's own `MutationSpec` only
    // here, since `validate`/`preview` are the read-only routes that actually take that type.
    const requestResult = parseSharedMutation(kind, mutationRaw);
    if (!requestResult.ok) return c.json(requestResult, 400);
    const mutationSpec = toEngineMutationSpec(requestResult.data, service.registry);

    // Read-only: `validate`/`preview` never write, so this never emits a delta.
    const graph: GraphSnapshot = { nodes: service.execStore.listNodes(scope), edges: service.execStore.listEdges(scope) };
    const validated = validate(graph, mutationSpec);
    if (!validated.ok) {
      return c.json(ok({ valid: false, reason: validated.error.message, preview: null }));
    }
    return c.json(ok({ valid: true, preview: previewFor(graph, mutationSpec) }));
  });

  app.post('/seed', async (c) => {
    const bodyResult = await readJsonBody(c);
    if (!bodyResult.ok) return c.json(bodyResult, 400);
    const body = bodyResult.data;

    const projectResult = requireField(body.project, 'project');
    if (!projectResult.ok) return c.json(projectResult, 400);
    const scope: ProjectScope = { projectId: projectResult.data };

    const stepsResult = parseSeedSteps(body.seed);
    if (!stepsResult.ok) return c.json(stepsResult, 400);

    // The cross-store anchor: `dag_nodes.project_id` is a `NOT NULL REFERENCES projects(id)` FK
    // with `foreign_keys = ON`. Touch the execution store first — on a fresh scope this seeds a
    // bare id-only `projects` row (no `created_at`) plus the root node via `ensureSeeded`'s own
    // first-touch check; doing this *before* the portfolio insert matters, since a portfolio-first
    // insert would make that same row already exist by the time `ensureSeeded` runs, silently
    // suppressing its "first touch" root-seeding. `seed` is the programmatic entrypoint most likely
    // to be a project's very first touch, so it then adopts that scaffold row into a genuine
    // portfolio project (create-if-absent) before replaying anything — a genuine `/engine-graph`
    // <-> portfolio coupling.
    ensureExecStoreSeeded(scope);
    if (!service.portfolio.getProject(scope.projectId)) {
      const created = service.portfolio.createProject({ id: scope.projectId }, null);
      if (!created.ok) return c.json(fromResult(created), 400);
    }

    const ctx: PrimitiveContext = { store: service.execStore, scope };
    let nodesCreated = 0;
    let edgesCreated = 0;
    for (const step of stepsResult.data) {
      const applied = applySeedStep(ctx, service.registry, step);
      if (!applied.ok) return c.json(fromResult(applied), 400);
      nodesCreated += applied.data.nodeChanges.filter((change) => change.op === 'created').length;
      edgesCreated += applied.data.edgeChanges.filter((change) => change.op === 'created').length;
    }

    return c.json(ok({ nodesCreated, edgesCreated }));
  });

  return app;
}

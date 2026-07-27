// graph-service/tests/harness/drive.ts
//
// The one HTTP client every functional scenario drives a booted daemon through: `seed` (which
// confirms the cross-store `projects` anchor `dag_nodes.project_id`'s FK requires lands, since
// `/engine-graph/seed` is the one that must create it — see `assertProjectAnchored`'s own doc
// comment for why this client never pre-creates it), the whole-tree `frontier` (reconstructed
// client-side purely from the public `/dag` + per-container `/frontier` reads — the same union
// `driver/frontier.ts`'s `globalFrontier` performs server-side, walked here over the wire instead),
// the `submit-event` driver step (auto-resolve via the daemon's own faked capability ports, or the
// caller's explicit token override), `steer`, and `driveToQuiescence` — the bounded polling loop
// scenarios use instead of hand-rolling their own. Black-box throughout: every function here
// reaches the daemon exclusively over `fetch`, never a direct store/engine import.
import type { DagEdge, DagNode, NodeStatus } from '@rad-orchestration/graph-engine';
import { ROOT_NODE_ID } from '@rad-orchestration/graph-engine';

interface Envelope<T> {
  readonly ok: boolean;
  readonly data?: T;
  readonly error?: { readonly code: string; readonly message: string };
}

export interface SeedAddNodeStep {
  readonly primitive: 'add_node';
  readonly id: string;
  readonly type: string;
  readonly parent: string;
  readonly order?: number;
  readonly data?: Readonly<Record<string, unknown>>;
  readonly dependsOn?: readonly string[];
}
export interface SeedAddDependencyStep {
  readonly primitive: 'add_dependency';
  readonly from: string;
  readonly to: string;
}
export interface SeedExpandStep {
  readonly primitive: 'expand';
  readonly node: string;
  readonly expansion: { readonly specs: readonly unknown[] };
}
export type SeedStep = SeedAddNodeStep | SeedAddDependencyStep | SeedExpandStep;

export interface DagSnapshot {
  readonly nodes: readonly DagNode[];
  readonly edges: readonly DagEdge[];
  readonly frontier: readonly DagNode[];
  readonly status: NodeStatus;
}

export interface SubmitEventResult {
  readonly action: string | null;
  readonly node: string | null;
  readonly executor: string | null;
  readonly instructions: string | null;
  readonly context: Readonly<Record<string, unknown>> | null;
  readonly completion_event: string | null;
  readonly completion_payload_schema: readonly { readonly name: string; readonly flag: boolean }[] | null;
  readonly delta: { readonly nodeChanges: readonly unknown[]; readonly edgeChanges: readonly unknown[] };
  readonly frontier: readonly DagNode[];
}

/** The client's own dictated outcome for `submit-event` — the same `{event, payload}` shape the route accepts, relaying a completion for the node this targets. */
export interface ExplicitEvent {
  readonly event: string;
  readonly payload: { readonly outcome: 'ok' | 'error'; readonly data: Readonly<Record<string, unknown>> };
}

/** The external-actor node `runToQuiescence` most recently stopped at — everything a `resolve()` callback needs to decide how to relay its completion, without a second round trip to look the node up. */
export interface StoppedActor {
  readonly id: string;
  readonly type: string;
  readonly executor: string;
}

export interface DriveOptions {
  /** Called once per node the drive loop stops at; return an explicit `{event, payload}` to relay that node's completion, or `undefined` to leave it stopped (ends the loop). */
  readonly resolve?: (actor: StoppedActor) => ExplicitEvent | undefined;
  /** Bounds the loop — the same "never spin forever" contract the server's own `runToQuiescence` enforces. */
  readonly maxSteps?: number;
  /**
   * Resumes driving from an already-stopped actor — one a prior explicit `submitEvent` call's own
   * response already surfaced (relaying that node's own completion can itself drive the graph
   * straight to the *next* external-actor node within that same call, so a fresh no-event bootstrap
   * here would find nothing left to engage). Omit to bootstrap normally off `ROOT_NODE_ID`.
   */
  readonly from?: StoppedActor;
}

export interface DriveResult {
  readonly steps: number;
}

async function readEnvelope<T>(res: Response): Promise<Envelope<T>> {
  return (await res.json()) as Envelope<T>;
}

function assertOk<T>(envelope: Envelope<T>, context: string): T {
  if (!envelope.ok || envelope.data === undefined) {
    throw new Error(`${context} failed: ${envelope.error?.code ?? 'unknown'} — ${envelope.error?.message ?? '(no message)'}`);
  }
  return envelope.data;
}

async function getJson<T>(baseUrl: string, path: string): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`);
  return assertOk(await readEnvelope<T>(res), `GET ${path}`);
}

async function postJson<T>(baseUrl: string, path: string, body: unknown): Promise<Envelope<T>> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return readEnvelope<T>(res);
}

/**
 * Confirms the cross-store anchor `dag_nodes.project_id`'s FK requires — a genuine (`created_at`
 * non-null) `projects` row — exists after `seed`. `POST /engine-graph/seed` is the one that must
 * create it (never this function calling `POST /work-graph/project` first): `SqliteStateStore`'s
 * own `ensureSeeded` only mints the project-scoped root node on the `projects` row's genuine first
 * INSERT, so a `/work-graph/project` pre-create would make that row already exist by the time
 * `seed` touches the execution store, silently suppressing root-node creation and leaving `seed`'s
 * own `add_node` calls with no `root` to parent onto. `seed` (`engine-graph.ts`) already handles
 * this ordering itself — exec-store touch first, portfolio adoption second — so this only verifies
 * the outcome rather than racing it.
 */
export async function assertProjectAnchored(baseUrl: string, project: string): Promise<void> {
  const res = await fetch(`${baseUrl}/work-graph/project?id=${encodeURIComponent(project)}`);
  if (res.status !== 200) {
    throw new Error(`project anchor '${project}' was not adopted into the portfolio by seed (HTTP ${res.status})`);
  }
}

/** Replays `steps` via `POST /engine-graph/seed`, then confirms the cross-store project anchor it must create. */
export async function seed(
  baseUrl: string,
  project: string,
  steps: readonly SeedStep[],
): Promise<{ nodesCreated: number; edgesCreated: number }> {
  const envelope = await postJson<{ nodesCreated: number; edgesCreated: number }>(baseUrl, '/engine-graph/seed', {
    project,
    seed: { steps },
  });
  const result = assertOk(envelope, `seed('${project}')`);
  await assertProjectAnchored(baseUrl, project);
  return result;
}

/**
 * `POST /work-graph/worktree` — registers `repo` against `project` so the generic field resolver
 * (`resolve/resolve-fields.ts`) has a `WorktreeRecord` to fill a `worktree-repo-set` field's `path`
 * from once a node naming that repo is engaged. Never seeds a `path` of its own — the resolver's own
 * conventional-fallback join (`<worktreesRoot>/<project>/<repo>`) is exactly what a scenario wants.
 * `project` must already exist in the portfolio (i.e. `seed()` has already run against it).
 */
export async function addWorktree(baseUrl: string, project: string, repo: string): Promise<void> {
  const envelope = await postJson<unknown>(baseUrl, '/work-graph/worktree', { projectId: project, repo });
  assertOk(envelope, `addWorktree('${project}', '${repo}')`);
}

/** `GET /engine-graph/dag` — the full persisted graph snapshot: nodes, edges, the root-scoped frontier, and the rolled-up project status. */
export async function dag(baseUrl: string, project: string): Promise<DagSnapshot> {
  return getJson<DagSnapshot>(baseUrl, `/engine-graph/dag?project=${encodeURIComponent(project)}`);
}

async function contextFrontier(baseUrl: string, project: string, context: string): Promise<readonly DagNode[]> {
  return getJson<readonly DagNode[]>(
    baseUrl,
    `/engine-graph/frontier?project=${encodeURIComponent(project)}&context=${encodeURIComponent(context)}`,
  );
}

/**
 * The whole-tree frontier: unions the per-container `/engine-graph/frontier` read over every
 * container currently in the graph (the root, plus any node that is some other node's `parent`) —
 * the same walk `driver/frontier.ts`'s `globalFrontier` performs server-side, reconstructed here
 * purely over the public HTTP surface (`/dag` to discover containers, `/frontier?context=` per
 * container), never a direct store read.
 */
export async function frontier(baseUrl: string, project: string): Promise<readonly DagNode[]> {
  const { nodes } = await dag(baseUrl, project);
  const containerIds = new Set<string>([ROOT_NODE_ID]);
  for (const candidate of nodes) {
    if (candidate.parent !== null) containerIds.add(candidate.parent);
  }

  const seen = new Set<string>();
  const result: DagNode[] = [];
  for (const containerId of containerIds) {
    for (const candidate of await contextFrontier(baseUrl, project, containerId)) {
      if (seen.has(candidate.id)) continue;
      seen.add(candidate.id);
      result.push(candidate);
    }
  }
  return result;
}

/** `GET /engine-graph/node` — one node by id. */
export async function node(baseUrl: string, project: string, nodeId: string): Promise<DagNode> {
  return getJson<DagNode>(baseUrl, `/engine-graph/node?project=${encodeURIComponent(project)}&node=${encodeURIComponent(nodeId)}`);
}

/**
 * `POST /engine-graph/submit-event` — with no `explicit` override, the daemon engages `nodeId` and
 * resolves it via its own faked capability ports (the driver's default script); with one, the
 * client dictates the `<type>.<outcome>` outcome directly instead.
 */
export async function submitEvent(
  baseUrl: string,
  project: string,
  nodeId: string,
  explicit?: ExplicitEvent,
): Promise<SubmitEventResult> {
  const body: Record<string, unknown> = { project, node: nodeId };
  if (explicit) {
    body.event = explicit.event;
    body.payload = explicit.payload;
  }
  const envelope = await postJson<SubmitEventResult>(baseUrl, '/engine-graph/submit-event', body);
  return assertOk(envelope, `submit-event('${nodeId}')`);
}

/** `POST /engine-graph/steer` — one of the 11 client-invocable steering primitives. */
export async function steer(
  baseUrl: string,
  project: string,
  primitive: string,
  params: Readonly<Record<string, unknown>>,
): Promise<unknown> {
  const envelope = await postJson(baseUrl, '/engine-graph/steer', { project, primitive, params });
  return assertOk(envelope, `steer('${primitive}')`);
}

/**
 * Drives one call at a time over `submit-event`'s own "relay a result, get the next move" contract:
 * each round trip carries the drive as far as deterministic nodes allow and stops at the first
 * external-actor node, naming it in the response envelope; this loop relays that exact node's
 * completion (via `options.resolve`) on the following call, repeating until the envelope reports no
 * further action. Never polls the frontier to pick a target — `submit-event` ignores which node a
 * no-event call names beyond existence, so the very first call bootstraps off the always-present
 * `ROOT_NODE_ID`, and every call after that targets whichever node the previous response stopped at.
 * `maxSteps` bounds the loop so a stuck scenario (no `resolve()` override for the stopped node type)
 * fails fast rather than hanging.
 */
export async function driveToQuiescence(baseUrl: string, project: string, options: DriveOptions = {}): Promise<DriveResult> {
  const maxSteps = options.maxSteps ?? 50;
  let steps = 0;
  let cursor: string = options.from?.id ?? ROOT_NODE_ID;
  let pending: ExplicitEvent | undefined;

  if (options.from) {
    pending = options.resolve?.(options.from);
    if (!pending) {
      throw new Error(
        `driveToQuiescence('${project}'): resuming at '${options.from.id}' (${options.from.type}/${options.from.executor}) with no resolve() override to relay its completion`,
      );
    }
  }

  for (;;) {
    if (steps >= maxSteps) {
      throw new Error(`driveToQuiescence('${project}'): exceeded ${maxSteps} steps without reaching quiescence`);
    }

    const result = await submitEvent(baseUrl, project, cursor, pending);
    steps += 1;

    if (result.action === null || result.node === null || result.executor === null) return { steps };

    const actor: StoppedActor = { id: result.node, type: result.action, executor: result.executor };
    const override = options.resolve?.(actor);
    if (!override) {
      throw new Error(
        `driveToQuiescence('${project}'): stopped at '${actor.id}' (${actor.type}/${actor.executor}) with no resolve() override to relay its completion`,
      );
    }

    cursor = actor.id;
    pending = override;
  }
}

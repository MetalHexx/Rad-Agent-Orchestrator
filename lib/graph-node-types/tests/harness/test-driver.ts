// The integration-proof test harness: a driver implementing the engine's driver contract —
// loop { read the (whole-tree) frontier -> engage each -> dispatch the executor against faked
// capability ports -> apply_event the outcome } until quiescence — plus the six hand-rolled faked
// capability ports every built-in's `act` reaches for. Every step below composes only the engine's
// own public primitives (`engage`/`apply_event`/`expand`/`reset`/`add_corrective`) and the
// registry-resolved `NodeTypeDefinition` hooks (`act`/`handle`/`projectStatus`) — there is no
// test-only graph back door.
import type {
  ActResult,
  AgentSpawnRequest,
  ChangeDelta,
  DagEdge,
  DagNode,
  DocReadPort,
  DocReadRequest,
  DocWritePort,
  DocWriteRequest,
  DocWriteResult,
  Envelope,
  EventToken,
  GitFacts,
  GitFactsPort,
  GitFactsRequest,
  NodeEvent,
  NodeId,
  NodeTypeName,
  NodeTypeRegistry,
  PrimitiveContext,
  Result,
  ReviewSpawnRequest,
  RequestHumanPort,
  RequestHumanRequest,
  RequestHumanResult,
  RoutingRequest,
  RunCommandPort,
  RunCommandRequest,
  RunCommandResult,
  SpawnAgentPort,
  SpawnAgentRequest,
  SpawnAgentResult,
} from '@rad-orchestration/graph-engine';
import { add_corrective, apply_event, engage, expand, readFrontier, reset, toggle } from '@rad-orchestration/graph-engine';
import type {
  ApprovalDecision,
  CodeReviewReviewedData,
  DecorationCadence,
  PrRepoRef,
  PrRepoResult,
  ReviewVerdict,
  Severity,
} from '../../src/index.js';
import { APPROVAL_DECIDED_TOKEN } from '../../src/rad-orc/approval.js';
import { CODE_REVIEW_REVIEWED_TOKEN } from '../../src/rad-orc/code-review.js';
import { EXPLOSION_PARSED_TOKEN, EXPLOSION_PARSE_FAILED_TOKEN, parseMasterPlan } from '../../src/rad-orc/explosion.js';
import { MASTER_PLAN_AUTHORED_TOKEN } from '../../src/rad-orc/master-plan.js';
import { PR_CREATED_TOKEN } from '../../src/rad-orc/pr.js';
import { TASK_COMPLETED_TOKEN } from '../../src/rad-orc/task.js';

// ── Faked capability ports ──────────────────────────────────────────────────────
// Hand-rolled fakes returning canned values — the same idiom as `lib/telemetry/tests/collector.test.ts`'s
// FakeAdapter/FakeSink/FakeCheckpoint, ported to the six engine capability ports.

export class FakeDocReadPort implements DocReadPort {
  private readonly docs = new Map<string, string>();

  /** Pre-loads the canned content a later `read` for `path` returns. */
  seed(path: string, content: string): void {
    this.docs.set(path, content);
  }

  async read(request: DocReadRequest): Promise<Envelope<{ readonly content: string }>> {
    const content = this.docs.get(request.path);
    if (content === undefined) return { outcome: 'error', data: { content: '' } };
    return { outcome: 'ok', data: { content } };
  }
}

export class FakeDocWritePort implements DocWritePort {
  readonly writes: DocWriteRequest[] = [];

  async write(request: DocWriteRequest): Promise<Envelope<DocWriteResult>> {
    this.writes.push(request);
    return { outcome: 'ok', data: { idempotencyKey: request.idempotencyKey, path: request.path } };
  }
}

export class FakeGitFactsPort implements GitFactsPort {
  constructor(private readonly canned: GitFacts = { branch: 'main', headSha: 'a1b2c3d', isClean: true }) {}

  async facts(_request: GitFactsRequest): Promise<Envelope<GitFacts>> {
    return { outcome: 'ok', data: this.canned };
  }
}

export class FakeSpawnAgentPort implements SpawnAgentPort {
  readonly spawned: SpawnAgentRequest[] = [];

  async spawn(request: SpawnAgentRequest): Promise<Envelope<SpawnAgentResult>> {
    this.spawned.push(request);
    return { outcome: 'ok', data: { idempotencyKey: request.idempotencyKey, spawned: true } };
  }
}

export class FakeRunCommandPort implements RunCommandPort {
  readonly ran: RunCommandRequest[] = [];

  async run(request: RunCommandRequest): Promise<Envelope<RunCommandResult>> {
    this.ran.push(request);
    return { outcome: 'ok', data: { idempotencyKey: request.idempotencyKey, exitCode: 0, stdout: '', stderr: '' } };
  }
}

export class FakeRequestHumanPort implements RequestHumanPort {
  private readonly responses = new Map<string, string>();

  /** Pre-loads the canned response a later `request` for `idempotencyKey` returns. */
  seed(idempotencyKey: string, response: string): void {
    this.responses.set(idempotencyKey, response);
  }

  async request(request: RequestHumanRequest): Promise<Envelope<RequestHumanResult>> {
    const response = this.responses.get(request.idempotencyKey) ?? 'granted';
    return { outcome: 'ok', data: { idempotencyKey: request.idempotencyKey, response } };
  }
}

export interface FakedCapabilityPorts {
  readonly docRead: FakeDocReadPort;
  readonly docWrite: FakeDocWritePort;
  readonly gitFacts: FakeGitFactsPort;
  readonly spawnAgent: FakeSpawnAgentPort;
  readonly runCommand: FakeRunCommandPort;
  readonly requestHuman: FakeRequestHumanPort;
}

export function createFakedCapabilityPorts(): FakedCapabilityPorts {
  return {
    docRead: new FakeDocReadPort(),
    docWrite: new FakeDocWritePort(),
    gitFacts: new FakeGitFactsPort(),
    spawnAgent: new FakeSpawnAgentPort(),
    runCommand: new FakeRunCommandPort(),
    requestHuman: new FakeRequestHumanPort(),
  };
}

// ── Engine glue: apply a resolved outcome exactly the way a real host would ────────
// `engage` only ever returns the `ActResult` to dispatch; committing whatever comes back from that
// dispatch — the data patch, a routing request, an expansion, and the node's own re-projected
// status — is the host's job. This is that job, factored once so every resolver below (and any
// custom node type's own resolver) shares it rather than re-deriving it.

export interface DriverOutcome {
  readonly token: EventToken;
  readonly envelope: Envelope;
}

/** `review`'s current chain tip — the predecessor no sibling predecessor names as its own `derivedFrom` — mirroring the engine's own internal `add_corrective` tip walk, kept host-side since routing carries no store access of its own. */
function findChainTip(nodes: readonly DagNode[], edges: readonly DagEdge[], review: NodeId): DagNode | undefined {
  const predecessorIds = edges.filter((edge) => edge.kind === 'depends_on' && edge.to === review).map((edge) => edge.from);
  const predecessors = predecessorIds
    .map((id) => nodes.find((node) => node.id === id))
    .filter((node): node is DagNode => node !== undefined);
  const predecessorIdSet = new Set(predecessors.map((node) => node.id));
  const referencedAsDerivedFrom = new Set(
    predecessors.map((node) => node.derivedFrom).filter((id): id is NodeId => id !== null && predecessorIdSet.has(id)),
  );
  return predecessors.find((node) => !referencedAsDerivedFrom.has(node.id)) ?? predecessors[predecessors.length - 1];
}

/**
 * Carries out one `HandleResult.routing` request. Only the three primitives the shipped built-ins'
 * own `handle` ever requests are supported (`reset`, `add_corrective`, `toggle`) — any other is a
 * driver bug, not a silently-ignored no-op. `add_corrective`'s own `handle`-supplied `params.data` deliberately
 * carries only `reviewReportPath`/`correctiveIndex` (see `code-review.ts`); the chain's original
 * scope contract (`handoffDocPath`/`repos`/`complexity`/`shouldCommit`) is carried forward here from
 * the review's current chain tip — the same host-side enrichment a real orchestrator performs
 * before minting a corrective, never invented by the engine's own compound primitive.
 */
function runRouting(ctx: PrimitiveContext, routing: RoutingRequest): Result<unknown> {
  switch (routing.primitive) {
    case 'reset': {
      const params = routing.params as unknown as { node: NodeId; cascade?: boolean };
      return reset(ctx, params.node, params.cascade ?? false);
    }
    case 'add_corrective': {
      const params = routing.params as unknown as {
        id: NodeId;
        type: NodeTypeName;
        review: NodeId;
        data?: Readonly<Record<string, unknown>>;
      };
      const tip = findChainTip(ctx.store.listNodes(ctx.scope), ctx.store.listEdges(ctx.scope), params.review);
      const carriedForward = tip
        ? {
            handoffDocPath: tip.data.handoffDocPath,
            repos: tip.data.repos,
            complexity: tip.data.complexity,
            shouldCommit: tip.data.shouldCommit,
          }
        : {};
      return add_corrective(ctx, params.id, params.type, params.review, {
        data: { ...carriedForward, ...params.data },
      });
    }
    case 'toggle': {
      const params = routing.params as unknown as { node: NodeId };
      return toggle(ctx, params.node);
    }
    default:
      throw new Error(`test driver: unsupported routing primitive '${routing.primitive}'`);
  }
}

/** Re-projects `nodeId`'s status via its resolved `NodeTypeDefinition.projectStatus`, writing the change only if it actually moved — the host-side half of the contract `apply_event` deliberately leaves undone (it only ever touches `data`). */
function syncProjectedStatus(ctx: PrimitiveContext, registry: NodeTypeRegistry, nodeId: NodeId): void {
  const node = ctx.store.getNode(ctx.scope, nodeId);
  if (!node) return;
  const definition = registry.resolve(node.type);
  if (!definition) return;

  const projected = definition.projectStatus(node.data);
  if (projected === node.status) return;

  const after: DagNode = { ...node, status: projected };
  const delta: ChangeDelta = {
    primitive: 'apply_event',
    params: { node: nodeId, projectedStatus: projected },
    nodeChanges: [{ op: 'updated', before: node, after }],
    edgeChanges: [],
  };
  const applied = ctx.store.apply(ctx.scope, delta);
  if (!applied.ok) throw new Error(`test driver: status sync failed for '${nodeId}': ${applied.error.message}`);
}

/** Commits one dispatched outcome: the node type's own `handle` reaction (data patch, routing, expansion), then the resulting status re-projection — the full "apply_event the outcome" step every resolver below ends with. */
export function applyOutcome(ctx: PrimitiveContext, registry: NodeTypeRegistry, nodeId: NodeId, outcome: DriverOutcome): void {
  const node = ctx.store.getNode(ctx.scope, nodeId);
  if (!node) throw new Error(`test driver: node '${nodeId}' does not exist`);
  const definition = registry.resolve(node.type);
  if (!definition) throw new Error(`test driver: node type '${node.type}' is not registered`);

  const ev: NodeEvent = { token: outcome.token, nodeId, envelope: outcome.envelope };
  const handled = definition.handle(ev);

  const applied = apply_event(ctx, nodeId, outcome.token, () => handled.dataChange ?? null);
  if (!applied.ok) throw new Error(`test driver: apply_event('${nodeId}') failed: ${applied.error.message}`);

  if (handled.routing) {
    const routed = runRouting(ctx, handled.routing);
    if (!routed.ok) throw new Error(`test driver: routing '${handled.routing.primitive}' failed: ${routed.error.message}`);
  }

  if (handled.expansion) {
    const expanded = expand(ctx, registry, nodeId, handled.expansion);
    if (!expanded.ok) throw new Error(`test driver: expansion from '${nodeId}' failed: ${expanded.error.message}`);
  }

  syncProjectedStatus(ctx, registry, nodeId);
}

// ── Whole-tree frontier + quiescence ────────────────────────────────────────────
// `readFrontier`/`isQuiescent` are scoped to one container; a driver walks the whole tree by
// union-ing that same public read over every container currently in the graph (the root, plus any
// node that is some other node's `parent`) — never a second, competing readiness derivation.

function containerIds(nodes: readonly DagNode[]): NodeId[] {
  const ids = new Set<NodeId>();
  for (const node of nodes) if (node.parent !== null) ids.add(node.parent);
  return [...ids];
}

export function globalFrontier(ctx: PrimitiveContext, root: NodeId): readonly DagNode[] {
  const nodes = ctx.store.listNodes(ctx.scope);
  const containers = new Set<NodeId>([root, ...containerIds(nodes)]);
  const seen = new Set<NodeId>();
  const result: DagNode[] = [];
  for (const containerId of containers) {
    for (const candidate of readFrontier(ctx, containerId)) {
      if (seen.has(candidate.id)) continue;
      seen.add(candidate.id);
      result.push(candidate);
    }
  }
  return result;
}

export function isGloballyQuiescent(ctx: PrimitiveContext, root: NodeId): boolean {
  return globalFrontier(ctx, root).length === 0;
}

// ── The driver loop ──────────────────────────────────────────────────────────────

export type NodeOutcomeResolver = (
  ctx: PrimitiveContext,
  registry: NodeTypeRegistry,
  node: DagNode,
  actResult: ActResult,
) => Promise<void> | void;

/**
 * The engine's driver contract, run to quiescence: read the whole-tree frontier, `engage` one
 * eligible node, hand its `ActResult` to the resolver registered for its `type`, repeat. One node
 * at a time (never a batched round) — a DAG has no ordering requirement on dispatch order, and
 * re-reading the frontier before every single `engage` sidesteps ever acting on a stale candidate.
 */
export async function runToQuiescence(
  ctx: PrimitiveContext,
  registry: NodeTypeRegistry,
  root: NodeId,
  resolvers: Readonly<Record<NodeTypeName, NodeOutcomeResolver>>,
  maxSteps = 300,
): Promise<{ readonly steps: number }> {
  let steps = 0;
  for (;;) {
    const [next] = globalFrontier(ctx, root);
    if (!next) break;

    steps += 1;
    if (steps > maxSteps) throw new Error(`test driver: exceeded ${maxSteps} steps without reaching quiescence`);

    const engaged = engage(ctx, registry, next.id);
    if (!engaged.ok) throw new Error(`test driver: engage('${next.id}') failed: ${engaged.error.message}`);

    const resolver = resolvers[next.type];
    if (!resolver) throw new Error(`test driver: no outcome resolver registered for node type '${next.type}'`);

    await resolver(ctx, registry, next, engaged.data);
  }
  return { steps };
}

// ── Built-in resolvers ───────────────────────────────────────────────────────────
// One resolver per `rad-orc:*` node type that ever reaches the frontier (`phase` never does — it
// always has children). Every resolver dispatches its declared `capabilities` against the faked
// ports above, using `script` for the canned semantic answer (a decision, a verdict, a commit
// result) a real capability call can't derive on its own.

export interface CommitResultLike {
  readonly name: string;
  readonly committed: boolean;
  readonly commitHash: string | null;
  readonly pushed: boolean;
}

export interface DriverScript {
  /** Content a `rad-orc:master_plan` node's doc-read reports back. Defaults to a small two-phase template-shaped doc. */
  readonly masterPlanDoc?: string;
  /** Per-node canned decision for a `rad-orc:approval` node's request-human call. Defaults to `'granted'`. */
  readonly approvalDecisions?: Readonly<Record<NodeId, ApprovalDecision>>;
  /** Per-node *queue* of verdict/severity pairs for a `rad-orc:code_review` node — one entry consumed per re-engagement (the review re-engages once per corrective cycle); the last entry repeats once the queue is exhausted. Defaults to a single `'approved'`/`'none'`. */
  readonly reviewVerdicts?: Readonly<Record<NodeId, readonly { readonly verdict: ReviewVerdict; readonly severity: Severity }[]>>;
  /** Per-node commit results a `rad-orc:task`/`rad-orc:corrective` coder spawn reports back. Defaults to one committed repo. */
  readonly taskResults?: Readonly<Record<NodeId, readonly CommitResultLike[]>>;
  /** Per-node `{name, pr_url}` results a `rad-orc:pr` node's gh loop reports back. Defaults to one synthesized entry per seeded repo. */
  readonly prResults?: Readonly<Record<NodeId, readonly PrRepoResult[]>>;
}

const DEFAULT_MASTER_PLAN_DOC = `# Master Plan

## Phase 1: Foundation
Doc: docs/phases/phase-1.md
Exit Criteria:
- Foundations laid

### Task 1: Scaffold the module

## Phase 2: Delivery
Doc: docs/phases/phase-2.md
Exit Criteria:
- Delivery shipped

### Task 1: Ship it
`;

const DEFAULT_COMMIT_RESULTS: readonly CommitResultLike[] = [
  { name: 'rad-orc-source', committed: true, commitHash: 'a1b2c3d', pushed: true },
];

/**
 * Builds the resolver set for every `rad-orc:*` node type reachable through the frontier, closing
 * over `ports` (so every dispatch genuinely reaches the faked capability surface) and `script` (so
 * a test controls the semantic answer per node). Merge a custom node type's own resolver alongside
 * this set's entries to drive a mixed built-in + custom graph through one `runToQuiescence` call.
 */
export function createBuiltInResolvers(
  ports: FakedCapabilityPorts,
  script: DriverScript = {},
): Readonly<Record<NodeTypeName, NodeOutcomeResolver>> {
  const reviewAttempts = new Map<NodeId, number>();

  async function resolveMasterPlan(ctx: PrimitiveContext, registry: NodeTypeRegistry, node: DagNode): Promise<void> {
    const requirementsPath = typeof node.data.requirementsDocPath === 'string' ? node.data.requirementsDocPath : 'requirements.md';
    const content = script.masterPlanDoc ?? DEFAULT_MASTER_PLAN_DOC;
    ports.docRead.seed(requirementsPath, content);
    await ports.docRead.read({ path: requirementsPath });

    const docPath = `docs/master-plan/${node.id}.md`;
    const written = await ports.docWrite.write({
      originatingNodeId: node.id,
      idempotencyKey: `${node.id}:write`,
      path: docPath,
      content,
    });
    // So a sibling `rad-orc:explosion` reads back exactly what was authored here.
    ports.docRead.seed(docPath, content);

    applyOutcome(ctx, registry, node.id, {
      token: MASTER_PLAN_AUTHORED_TOKEN,
      envelope: { outcome: 'ok', data: { docPath: written.data.path } },
    });
  }

  async function resolveExplosion(ctx: PrimitiveContext, registry: NodeTypeRegistry, node: DagNode): Promise<void> {
    const nodes = ctx.store.listNodes(ctx.scope);
    const masterPlan = nodes.find((n) => n.type === 'rad-orc:master_plan');
    const planApproval = nodes.find((n) => n.type === 'rad-orc:approval' && n.data.level === 'plan');
    if (!masterPlan || !planApproval) {
      throw new Error('test driver: rad-orc:explosion requires a seeded master_plan and a plan-level approval sibling');
    }

    const docPath = typeof masterPlan.data.docPath === 'string' ? masterPlan.data.docPath : '';
    const read = await ports.docRead.read({ path: docPath });
    const content = read.data.content;
    const parsed = parseMasterPlan(content);

    if (parsed.outcome === 'error') {
      const parseRetryCount = typeof node.data.parseRetryCount === 'number' ? node.data.parseRetryCount : 0;
      applyOutcome(ctx, registry, node.id, {
        token: EXPLOSION_PARSE_FAILED_TOKEN,
        envelope: { outcome: 'error', data: { parseError: parsed.data, masterPlanNodeId: masterPlan.id, parseRetryCount } },
      });
      return;
    }

    const cadence = node.data.cadence as DecorationCadence;
    applyOutcome(ctx, registry, node.id, {
      token: EXPLOSION_PARSED_TOKEN,
      envelope: { outcome: 'ok', data: { parsed: parsed.data, cadence, planApprovalNodeId: planApproval.id } },
    });
  }

  async function resolveApproval(ctx: PrimitiveContext, registry: NodeTypeRegistry, node: DagNode): Promise<void> {
    const level = node.data.level === 'final' ? 'final' : 'plan';
    const decision = script.approvalDecisions?.[node.id] ?? 'granted';
    const idempotencyKey = `${node.id}:decision`;
    ports.requestHuman.seed(idempotencyKey, decision);
    const response = await ports.requestHuman.request({
      originatingNodeId: node.id,
      idempotencyKey,
      prompt: `${level}-level approval?`,
    });
    const resolvedDecision = response.data.response as ApprovalDecision;

    let masterPlanNodeId: NodeId | undefined;
    if (resolvedDecision === 'denied' && level === 'plan') {
      masterPlanNodeId = ctx.store.listNodes(ctx.scope).find((n) => n.type === 'rad-orc:master_plan')?.id;
    }

    applyOutcome(ctx, registry, node.id, {
      token: APPROVAL_DECIDED_TOKEN,
      envelope: { outcome: 'ok', data: { decision: resolvedDecision, level, masterPlanNodeId } },
    });
  }

  async function resolveCoderNode(ctx: PrimitiveContext, registry: NodeTypeRegistry, node: DagNode, actResult: ActResult): Promise<void> {
    const payload = actResult.payload as AgentSpawnRequest;
    await ports.spawnAgent.spawn({ originatingNodeId: node.id, idempotencyKey: `${node.id}:spawn`, request: payload });

    const results = script.taskResults?.[node.id] ?? DEFAULT_COMMIT_RESULTS;
    applyOutcome(ctx, registry, node.id, {
      token: TASK_COMPLETED_TOKEN,
      envelope: { outcome: 'ok', data: { results } },
    });
  }

  async function resolveCodeReview(ctx: PrimitiveContext, registry: NodeTypeRegistry, node: DagNode, actResult: ActResult): Promise<void> {
    const attempt = reviewAttempts.get(node.id) ?? 0;
    reviewAttempts.set(node.id, attempt + 1);

    await ports.spawnAgent.spawn({
      originatingNodeId: node.id,
      idempotencyKey: `${node.id}:spawn:${attempt}`,
      request: actResult.payload as ReviewSpawnRequest,
    });

    const reviewReportPath =
      typeof node.data.reviewReportPath === 'string' && node.data.reviewReportPath.length > 0
        ? node.data.reviewReportPath
        : `reviews/${node.id}.md`;
    await ports.docRead.read({ path: reviewReportPath });

    const queue = script.reviewVerdicts?.[node.id];
    const entry = queue && queue.length > 0 ? queue[Math.min(attempt, queue.length - 1)] : { verdict: 'approved' as const, severity: 'none' as const };

    const data: CodeReviewReviewedData =
      entry.verdict === 'changes_requested'
        ? { verdict: entry.verdict, severity: entry.severity, correctiveIndex: attempt + 1, reviewReportPath }
        : { verdict: entry.verdict, severity: entry.severity };

    applyOutcome(ctx, registry, node.id, { token: CODE_REVIEW_REVIEWED_TOKEN, envelope: { outcome: 'ok', data } });
  }

  async function resolvePr(ctx: PrimitiveContext, registry: NodeTypeRegistry, node: DagNode): Promise<void> {
    const repos = Array.isArray(node.data.repos) ? (node.data.repos as PrRepoRef[]) : [];
    for (const repo of repos) {
      await ports.runCommand.run({
        originatingNodeId: node.id,
        idempotencyKey: `${node.id}:${repo.name}`,
        command: 'gh',
        args: ['pr', 'create'],
      });
    }

    const results = script.prResults?.[node.id] ?? repos.map((repo) => ({ name: repo.name, pr_url: `https://example.test/${node.id}/${repo.name}` }));
    applyOutcome(ctx, registry, node.id, { token: PR_CREATED_TOKEN, envelope: { outcome: 'ok', data: { results } } });
  }

  return {
    'rad-orc:master_plan': resolveMasterPlan,
    'rad-orc:explosion': resolveExplosion,
    'rad-orc:approval': resolveApproval,
    'rad-orc:task': resolveCoderNode,
    'rad-orc:corrective': resolveCoderNode,
    'rad-orc:code_review': resolveCodeReview,
    'rad-orc:pr': resolvePr,
  };
}

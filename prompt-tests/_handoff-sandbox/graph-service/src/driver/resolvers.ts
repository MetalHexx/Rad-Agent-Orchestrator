// graph-service/src/driver/resolvers.ts
//
// One resolver per `rad-orc:*` node type that ever reaches the frontier (`phase` never does — it
// always has children). Every resolver dispatches its declared `capabilities` against the faked
// ports (`capabilities/fakes.ts`), using `script` for the canned semantic answer (a decision, a
// verdict, a commit result) a real capability call can't derive on its own. Ported from
// `lib/graph-node-types/tests/harness/test-driver.ts`'s `createBuiltInResolvers` — same functions,
// same names.
import type {
  ActResult,
  AgentSpawnRequest,
  DagNode,
  NodeId,
  NodeTypeName,
  NodeTypeRegistry,
  PrimitiveContext,
  ReviewSpawnRequest,
  ReviewVerdict,
  Severity,
} from '@rad-orchestration/graph-engine';
import type { ApprovalDecision, CodeReviewReviewedData, DecorationCadence, PrRepoRef, PrRepoResult } from '@rad-orchestration/graph-node-types';
import {
  APPROVAL_DECIDED_TOKEN,
  CODE_REVIEW_REVIEWED_TOKEN,
  EXPLOSION_PARSED_TOKEN,
  EXPLOSION_PARSE_FAILED_TOKEN,
  MASTER_PLAN_AUTHORED_TOKEN,
  PR_CREATED_TOKEN,
  TASK_COMPLETED_TOKEN,
  parseMasterPlan,
} from '@rad-orchestration/graph-node-types';
import type { FakedCapabilityPorts } from '../capabilities/fakes.js';
import type { NodeOutcomeResolver } from './drive.js';
import { applyOutcome } from './outcome.js';

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
 * a caller controls the semantic answer per node). Merge a custom node type's own resolver
 * alongside this set's entries to drive a mixed built-in + custom graph through one
 * `runToQuiescence` call.
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
      throw new Error('driver: rad-orc:explosion requires a seeded master_plan and a plan-level approval sibling');
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

    applyOutcome(ctx, registry, node.id, {
      token: CODE_REVIEW_REVIEWED_TOKEN,
      envelope: { outcome: 'ok', data: data as unknown as Readonly<Record<string, unknown>> },
    });
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

  // fake driver: node-type → success token
  // The one node-type-aware mapping in this module: which resolver — and, inside it, which
  // success token — answers each `rad-orc:*` type's dispatch. Everything upstream of this map
  // (`advance`/`runToQuiescence`) is node-type-agnostic; it only ever looks a type up here.
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

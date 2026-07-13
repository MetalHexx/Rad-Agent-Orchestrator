// graph-service/src/driver/resolvers.ts
//
// One resolver per `rad-orc:*` node type that ever reaches the frontier (`phase` never does — it
// always has children; `master_plan` is `orchestrator-inline`, so the drive loop stops at it and
// authors the plan out-of-band rather than resolving it here). Every resolver derives its outcome
// from real inputs — the orchestrator's relayed signal (a coder's commit results, an operator's
// approval decision, a `gh` loop's per-repo PR results) and, for a review, a `doc-read` of the
// running report whose frontmatter carries the verdict — then commits it through the unchanged
// `applyOutcome`. There is no `DriverScript`: the service reads the verdict, the orchestrator only
// relays the report path (the locked "dumb orchestrator" decision). `explosion` is the one
// resolver that also runs real host code — the P01-T02 explosion runner — rather than relaying an
// orchestrator answer.
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
import { REVIEW_VERDICTS, SEVERITIES } from '@rad-orchestration/graph-engine';
import type {
  ApprovalDecision,
  CodeReviewReviewedData,
  DecorationCadence,
  PrRepoRef,
  PrRepoResult,
  TaskCompletedData,
} from '@rad-orchestration/graph-node-types';
import { APPROVAL_DECIDED_TOKEN, CODE_REVIEW_REVIEWED_TOKEN, PR_CREATED_TOKEN, TASK_COMPLETED_TOKEN } from '@rad-orchestration/graph-node-types';
import type { CapabilityPorts } from '../capabilities/ports.js';
import { runExplosion } from '../capabilities/explosion-runner.js';
import type { NodeOutcomeResolver } from './drive.js';
import { applyOutcome } from './outcome.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Normalizes a relayed coder-completion payload (`node.data.results`) into the frozen per-repo commit-result shape. */
function readCommitResults(value: unknown): TaskCompletedData['results'] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((entry) => ({
    name: typeof entry.name === 'string' ? entry.name : '',
    committed: entry.committed === true,
    commitHash: typeof entry.commitHash === 'string' ? entry.commitHash : null,
    pushed: entry.pushed === true,
  }));
}

/** Normalizes a relayed PR-loop payload (`node.data.results`) into the frozen `{name, pr_url}` per-repo shape. */
function readPrResults(value: unknown): readonly PrRepoResult[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((entry) => ({
    name: typeof entry.name === 'string' ? entry.name : '',
    pr_url: typeof entry.pr_url === 'string' ? entry.pr_url : null,
  }));
}

function isReviewVerdict(value: unknown): value is ReviewVerdict {
  return typeof value === 'string' && (REVIEW_VERDICTS as readonly string[]).includes(value);
}

function isSeverity(value: unknown): value is Severity {
  return typeof value === 'string' && (SEVERITIES as readonly string[]).includes(value);
}

/**
 * Reads a leading `--- … ---` YAML frontmatter block into a flat `key → value` map — the only
 * shape a review/audit report's verdict lives in, so a full YAML parser is deliberately not pulled
 * in. A quoted scalar is unwrapped; anything past the closing fence (the report body) is ignored.
 */
function readFrontmatter(content: string): Readonly<Record<string, string>> {
  const match = /^﻿?---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  if (!match) return {};
  const fields: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const field = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (field) fields[field[1]] = field[2].trim().replace(/^['"]|['"]$/g, '');
  }
  return fields;
}

/**
 * Builds the resolver set for every `rad-orc:*` node type reachable through the frontier, closing
 * over the real `ports` so each dispatch reaches the actual capability surface. Every resolver
 * derives its outcome from real inputs — the orchestrator's relayed signal and, for a review, a
 * `doc-read` of its report — never a canned script. Merge a custom node type's own resolver
 * alongside this set's entries to drive a mixed built-in + custom graph through one
 * `runToQuiescence` call.
 */
export function createBuiltInResolvers(ports: CapabilityPorts): Readonly<Record<NodeTypeName, NodeOutcomeResolver>> {
  const reviewAttempts = new Map<NodeId, number>();

  async function resolveExplosion(ctx: PrimitiveContext, registry: NodeTypeRegistry, node: DagNode): Promise<void> {
    const nodes = ctx.store.listNodes(ctx.scope);
    const masterPlan = nodes.find((n) => n.type === 'rad-orc:master_plan');
    const planApproval = nodes.find((n) => n.type === 'rad-orc:approval' && n.data.level === 'plan');
    if (!masterPlan || !planApproval) {
      throw new Error('driver: rad-orc:explosion requires a seeded master_plan and a plan-level approval sibling');
    }

    const outcome = await runExplosion(ports, {
      explosionNodeId: node.id,
      masterPlanDocPath: typeof masterPlan.data.docPath === 'string' ? masterPlan.data.docPath : '',
      masterPlanNodeId: masterPlan.id,
      planApprovalNodeId: planApproval.id,
      cadence: node.data.cadence as DecorationCadence,
      parseRetryCount: typeof node.data.parseRetryCount === 'number' ? node.data.parseRetryCount : 0,
    });

    applyOutcome(ctx, registry, node.id, outcome);
  }

  async function resolveApproval(ctx: PrimitiveContext, registry: NodeTypeRegistry, node: DagNode): Promise<void> {
    const level = node.data.level === 'final' ? 'final' : 'plan';
    // The request-human capability is the channel the operator's relayed decision rides back on;
    // the stable `:decision` key lets a re-run recognize an already-served prompt.
    const response = await ports.requestHuman.request({
      originatingNodeId: node.id,
      idempotencyKey: `${node.id}:decision`,
      prompt: `${level}-level approval?`,
    });
    const decision = response.data.response as ApprovalDecision;

    let masterPlanNodeId: NodeId | undefined;
    if (decision === 'denied' && level === 'plan') {
      masterPlanNodeId = ctx.store.listNodes(ctx.scope).find((n) => n.type === 'rad-orc:master_plan')?.id;
    }

    applyOutcome(ctx, registry, node.id, {
      token: APPROVAL_DECIDED_TOKEN,
      envelope: { outcome: 'ok', data: { decision, level, masterPlanNodeId } },
    });
  }

  async function resolveCoderNode(ctx: PrimitiveContext, registry: NodeTypeRegistry, node: DagNode, actResult: ActResult): Promise<void> {
    await ports.spawnAgent.spawn({
      originatingNodeId: node.id,
      idempotencyKey: `${node.id}:spawn`,
      request: actResult.payload as AgentSpawnRequest,
    });

    // The coder's per-repo commit results are relayed by the orchestrator onto this node's data.
    const results = readCommitResults(node.data.results);
    applyOutcome(ctx, registry, node.id, {
      token: TASK_COMPLETED_TOKEN,
      envelope: { outcome: 'ok', data: { results } satisfies TaskCompletedData },
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

    // The verdict is read here, off the report itself — never relayed by the orchestrator.
    const read = await ports.docRead.read({ path: reviewReportPath });
    if (read.outcome !== 'ok') {
      throw new Error(`driver: rad-orc:code_review '${node.id}' could not read its review report at '${reviewReportPath}'`);
    }
    const frontmatter = readFrontmatter(read.data.content);
    if (!isReviewVerdict(frontmatter.verdict)) {
      throw new Error(`driver: rad-orc:code_review '${node.id}' report at '${reviewReportPath}' has no valid 'verdict' in its frontmatter`);
    }
    const verdict = frontmatter.verdict;
    const severity = isSeverity(frontmatter.severity) ? frontmatter.severity : 'none';

    const data: CodeReviewReviewedData =
      verdict === 'changes_requested'
        ? { verdict, severity, correctiveIndex: attempt + 1, reviewReportPath }
        : { verdict, severity };

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

    // The per-repo `{name, pr_url}` outcomes are relayed by the orchestrator onto this node's data.
    const results = readPrResults(node.data.results);
    applyOutcome(ctx, registry, node.id, { token: PR_CREATED_TOKEN, envelope: { outcome: 'ok', data: { results } } });
  }

  // node-type → resolver: the one node-type-aware mapping in this module. Everything upstream of
  // this map (`advance`/`runToQuiescence`) is node-type-agnostic; it only ever looks a type up
  // here. `rad-orc:phase` never reaches the frontier and `rad-orc:master_plan` is resolved
  // out-of-band by the orchestrator, so neither carries a resolver.
  return {
    'rad-orc:explosion': resolveExplosion,
    'rad-orc:approval': resolveApproval,
    'rad-orc:task': resolveCoderNode,
    'rad-orc:corrective': resolveCoderNode,
    'rad-orc:code_review': resolveCodeReview,
    'rad-orc:pr': resolvePr,
  };
}

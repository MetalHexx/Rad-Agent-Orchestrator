import type {
  ActContext,
  ActResult,
  AgentName,
  CompletionPayloadSchema,
  DataSchema,
  EventToken,
  HandleResult,
  NodeEvent,
  NodeStatus,
  NodeTypeDefinition,
  Presentation,
  ResolveContext,
  ResolveOutcome,
  RoutingRequest,
  SpawnPayload,
} from '@rad-orchestration/graph-engine';
import { resolveReviewerAgent } from './agent-tier.js';

/**
 * One node type occupying all three review positions, disambiguated by its own `level` field —
 * mirrors `approval.ts`'s two-level dispatch, widened to three. The scope contract widens per
 * level (see the per-repo SHA/doc types below); the routing in `handle` never does.
 */
export const CODE_REVIEW_LEVELS = ['task', 'phase', 'final'] as const;
export type CodeReviewLevel = (typeof CODE_REVIEW_LEVELS)[number];

function readLevel(data: Readonly<Record<string, unknown>>): CodeReviewLevel {
  if (data.level === 'phase' || data.level === 'final') return data.level;
  return 'task';
}

/** Task-scope only — phase and final ignore it, but the ladder owns that rule, not this call site. */
function readComplexity(value: unknown): 'simple' | 'standard' | 'complex' | undefined {
  return value === 'simple' || value === 'standard' || value === 'complex' ? value : undefined;
}

// ── Per-repo base + level-specific SHA extensions ────────────────────────────────
// The seam to get right: these field names are frozen and must match the T02 fixture
// (`tests/fixtures/frozen-contracts.ts`'s `TaskRepoShas`/`PhaseRepoShas`/`FinalRepoShas`)
// character-for-character — never collapsed onto one shared field name across levels.

// The index signature mirrors `SpawnPayload.repos`'s own open shape (see the engine's
// `SpawnPayload` doc comment) — the level-specific SHA fields ride alongside the base ref, never
// collapsed onto one shared name, but the entry type stays open so it satisfies that contract.
interface ReviewRepoRef {
  readonly name: string;
  readonly path: string;
  readonly branch: string;
  readonly [field: string]: unknown;
}

export interface TaskReviewRepo extends ReviewRepoRef {
  readonly head_sha: string | null;
}

export interface PhaseReviewRepo extends ReviewRepoRef {
  readonly phase_first_sha: string | null;
  readonly phase_head_sha: string | null;
}

export interface FinalReviewRepo extends ReviewRepoRef {
  readonly project_base_sha: string | null;
  readonly project_head_sha: string | null;
}

function readRepoEntries(value: unknown): readonly Readonly<Record<string, unknown>>[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null);
}

function readRepoRef(entry: Readonly<Record<string, unknown>>): ReviewRepoRef {
  return {
    name: typeof entry.name === 'string' ? entry.name : '',
    path: typeof entry.path === 'string' ? entry.path : '',
    branch: typeof entry.branch === 'string' ? entry.branch : '',
  };
}

function readSha(entry: Readonly<Record<string, unknown>>, field: string): string | null {
  return typeof entry[field] === 'string' ? (entry[field] as string) : null;
}

function taskRepos(data: Readonly<Record<string, unknown>>): readonly TaskReviewRepo[] {
  return readRepoEntries(data.repos).map((entry) => ({ ...readRepoRef(entry), head_sha: readSha(entry, 'head_sha') }));
}

function phaseRepos(data: Readonly<Record<string, unknown>>): readonly PhaseReviewRepo[] {
  return readRepoEntries(data.repos).map((entry) => ({
    ...readRepoRef(entry),
    phase_first_sha: readSha(entry, 'phase_first_sha'),
    phase_head_sha: readSha(entry, 'phase_head_sha'),
  }));
}

function finalRepos(data: Readonly<Record<string, unknown>>): readonly FinalReviewRepo[] {
  return readRepoEntries(data.repos).map((entry) => ({
    ...readRepoRef(entry),
    project_base_sha: readSha(entry, 'project_base_sha'),
    project_head_sha: readSha(entry, 'project_head_sha'),
  }));
}

// ── The reviewer spawn payload ────────────────────────────────────────────────────
// Extends the engine's own `SpawnPayload` with the level-specific doc ref + per-repo SHAs the
// rad-code-review skill's scope table freezes. Discriminated by `agent`/`level` alone — no `kind`.

interface CodeReviewSpawnBase extends SpawnPayload {
  readonly level: CodeReviewLevel;
  readonly review_report_path: string;
}

export interface TaskCodeReviewSpawnPayload extends CodeReviewSpawnBase {
  readonly level: 'task';
  readonly handoff_doc: string;
  readonly repos: readonly TaskReviewRepo[];
}

export interface PhaseCodeReviewSpawnPayload extends CodeReviewSpawnBase {
  readonly level: 'phase';
  readonly phase_plan_doc: string;
  readonly repos: readonly PhaseReviewRepo[];
}

export interface FinalCodeReviewSpawnPayload extends CodeReviewSpawnBase {
  readonly level: 'final';
  readonly requirements_doc: string;
  readonly phase_plan_paths: readonly string[];
  readonly repos: readonly FinalReviewRepo[];
}

export type CodeReviewSpawnPayload = TaskCodeReviewSpawnPayload | PhaseCodeReviewSpawnPayload | FinalCodeReviewSpawnPayload;

// ── The collapsed `reviewed` event + uniform verdict routing ────────────────────

/** Fires once the orchestrator has doc-read the running review report and extracted its `verdict`. */
export const CODE_REVIEW_REVIEWED_TOKEN: EventToken = 'rad-orc:code_review.reviewed';

/** The vocabulary a review report's frontmatter `verdict` field must land in — owned here, this node type's own `resolve` being the sole place a verdict is ever derived. */
export const REVIEW_VERDICTS = ['approved', 'changes_requested', 'rejected'] as const;
export type ReviewVerdict = (typeof REVIEW_VERDICTS)[number];

/** The vocabulary a review report's frontmatter `severity` field must land in — owned alongside {@link REVIEW_VERDICTS}. */
export const SEVERITIES = ['none', 'low', 'medium', 'high'] as const;
export type Severity = (typeof SEVERITIES)[number];

/**
 * The envelope data `handle` expects on {@link CODE_REVIEW_REVIEWED_TOKEN}. `correctiveIndex`/
 * `reviewReportPath` ride alongside `verdict`/`severity` for the same reason `approval.ts`'s
 * `ApprovalDecidedData` carries its own extra context: `handle` is pure over the event alone, never
 * this node's own persisted `data`, so whatever a `changes_requested` routing needs travels here.
 */
export interface CodeReviewReviewedData {
  readonly verdict: ReviewVerdict;
  readonly severity: Severity;
  /** The next corrective attempt's 1-based index; required only when `verdict === 'changes_requested'`. */
  readonly correctiveIndex?: number;
  /** This review's own running report path, echoed back so a minted corrective can carry it forward. */
  readonly reviewReportPath?: string;
}

export const CODE_REVIEW_DATA_SCHEMA: DataSchema = {
  level: {
    kind: 'string',
    level: 'required',
    description: "Which of the three review positions this instance occupies — 'task' | 'phase' | 'final'.",
  },
  reviewReportPath: {
    kind: 'string',
    level: 'required',
    resolve: 'project-doc-path',
    description: 'The one running report this node owns across every corrective cycle at its scope.',
  },
  repos: {
    kind: 'array',
    level: 'required',
    resolve: 'worktree-repo-set',
    description: 'The repo set under review — SHAs are attached per level once known, `null` until then.',
  },
  complexity: {
    kind: 'string',
    level: 'optional',
    description: "Task-level only — this task's declared complexity, sizing the reviewer tier; phase and final always resolve to 'reviewer' regardless.",
  },
  handoffDocPath: {
    kind: 'string',
    level: 'optional',
    resolve: 'project-doc-path',
    description: 'Task-level only — the coder handoff doc this review reads.',
  },
  phasePlanDocPath: {
    kind: 'string',
    level: 'optional',
    resolve: 'project-doc-path',
    description: 'Phase-level only — the phase plan doc this review reads.',
  },
  requirementsDocPath: {
    kind: 'string',
    level: 'optional',
    resolve: 'project-doc-path',
    description: 'Final-level only — the requirements doc this review reads.',
  },
  phasePlanPaths: {
    kind: 'array',
    level: 'optional',
    resolve: 'project-doc-path',
    description: 'Final-level only — every phase plan doc path across the whole project.',
  },
  verdict: {
    kind: 'string',
    level: 'computed',
    description: "The reviewer's resolved verdict, once the running report has been read.",
  },
  severity: {
    kind: 'string',
    level: 'computed',
    description: "The reviewer's resolved severity, once the running report has been read.",
  },
};

const PRESENTATION: Presentation = {
  label: 'Code Review',
  description: 'One node type at task/phase/final, disambiguated by its own level; routes uniformly on verdict.',
};

const INSTRUCTIONS = [
  'Review this scope by following the `rad-code-review` skill.',
  '',
  "The node's own `level` names which scope is under review — task, phase, or final. Each repo",
  "entry's SHA fields bound the diff for that scope, and this level's own doc(s) — the task",
  'handoff, the phase plan, or the requirements doc plus every phase plan path — carry the scope',
  'contract to review against.',
  '',
  'Write your verdict into the running report at `review_report_path` — the same report to reopen',
  'on a re-adjudication rather than opening a fresh one each cycle.',
].join('\n');

function taskPayload(ctx: ActContext, reviewReportPath: string, agent: AgentName): TaskCodeReviewSpawnPayload {
  return {
    agent,
    level: 'task',
    review_report_path: reviewReportPath,
    handoff_doc: typeof ctx.data.handoffDocPath === 'string' ? ctx.data.handoffDocPath : '',
    repos: taskRepos(ctx.data),
  };
}

function phasePayload(ctx: ActContext, reviewReportPath: string, agent: AgentName): PhaseCodeReviewSpawnPayload {
  return {
    agent,
    level: 'phase',
    review_report_path: reviewReportPath,
    phase_plan_doc: typeof ctx.data.phasePlanDocPath === 'string' ? ctx.data.phasePlanDocPath : '',
    repos: phaseRepos(ctx.data),
  };
}

function finalPayload(ctx: ActContext, reviewReportPath: string, agent: AgentName): FinalCodeReviewSpawnPayload {
  const phasePlanPaths = Array.isArray(ctx.data.phasePlanPaths)
    ? ctx.data.phasePlanPaths.filter((entry): entry is string => typeof entry === 'string')
    : [];
  return {
    agent,
    level: 'final',
    review_report_path: reviewReportPath,
    requirements_doc: typeof ctx.data.requirementsDocPath === 'string' ? ctx.data.requirementsDocPath : '',
    phase_plan_paths: phasePlanPaths,
    repos: finalRepos(ctx.data),
  };
}

function act(ctx: ActContext): ActResult {
  const level = readLevel(ctx.data);
  const reviewReportPath = typeof ctx.data.reviewReportPath === 'string' ? ctx.data.reviewReportPath : '';
  // Passed through regardless of level — resolveReviewerAgent's own ladder owns ignoring it at phase/final.
  const agent = resolveReviewerAgent({ level, complexity: readComplexity(ctx.data.complexity) });

  const payload: CodeReviewSpawnPayload =
    level === 'task'
      ? taskPayload(ctx, reviewReportPath, agent)
      : level === 'phase'
        ? phasePayload(ctx, reviewReportPath, agent)
        : finalPayload(ctx, reviewReportPath, agent);

  return { executor: 'spawn-sub-agent', payload };
}

function handle(ev: NodeEvent): HandleResult {
  if (ev.token !== CODE_REVIEW_REVIEWED_TOKEN || ev.envelope.outcome !== 'ok') return {};
  const { verdict, severity, correctiveIndex, reviewReportPath } = ev.envelope.data as unknown as CodeReviewReviewedData;

  if (verdict === 'changes_requested') {
    const index = correctiveIndex ?? 1;
    const routing: RoutingRequest = {
      primitive: 'add_corrective',
      params: {
        id: `${ev.nodeId}-corrective-${index}`,
        type: 'rad-orc:corrective',
        review: ev.nodeId,
        data: { reviewReportPath: reviewReportPath ?? null, correctiveIndex: index },
      },
    };
    return { dataChange: { verdict, severity }, routing };
  }

  // 'approved' advances via projectStatus alone; 'rejected' is a recoverable halt — no primitive
  // names "halt" in the engine's closed vocabulary, mirroring approval.ts's final-level denial.
  // Either way, this routes on the verdict value alone, never a finding's own content.
  return { dataChange: { verdict, severity } };
}

function projectStatus(data: Readonly<Record<string, unknown>>): NodeStatus {
  if (data.verdict === 'approved') return 'done';
  if (data.verdict === 'rejected') return 'blocked';
  return 'not_started';
}

// ── Resolve: re-deriving the verdict from the running report ────────────────────
// The host-side half of this node's own code-behind: a relayed `reviewed` event is only a bare
// "the review finished" trigger — the verdict itself is never trusted from a caller, only ever
// read off the report this node owns. Mirrors what `relayCodeReviewCompletion` enforced in the
// service before this relocation.

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
 * How many corrective attempts this review node has already birthed — derived from the graph
 * itself (`${ctx.nodeId}-corrective-*` sibling ids among `ctx.nodes`) rather than in-memory state,
 * so it stays correct however this node's outcome gets re-derived and survives a process restart.
 */
function countReviewAttempts(ctx: ResolveContext): number {
  const prefix = `${ctx.nodeId}-corrective-`;
  return ctx.nodes.filter((candidate) => candidate.id.startsWith(prefix)).length;
}

/**
 * This node's own host-side outcome derivation: reads the running review report this node owns,
 * derives its `verdict`/`severity` from the report's own frontmatter alone, and — on
 * `changes_requested` — computes the next corrective attempt's 1-based index from this scope's own
 * `-corrective-*` siblings.
 */
async function resolve(ctx: ResolveContext): Promise<ResolveOutcome> {
  const reviewReportPath =
    typeof ctx.data.reviewReportPath === 'string' && ctx.data.reviewReportPath.length > 0
      ? ctx.data.reviewReportPath
      : `reviews/${ctx.nodeId}.md`;

  const read = await ctx.ports.docRead.read({ path: reviewReportPath });
  if (read.outcome !== 'ok') {
    throw new Error(`rad-orc:code_review '${ctx.nodeId}' could not read its review report at '${reviewReportPath}'`);
  }
  const frontmatter = readFrontmatter(read.data.content);
  if (!isReviewVerdict(frontmatter.verdict)) {
    throw new Error(`rad-orc:code_review '${ctx.nodeId}' report at '${reviewReportPath}' has no valid 'verdict' in its frontmatter`);
  }
  const verdict = frontmatter.verdict;
  const severity = isSeverity(frontmatter.severity) ? frontmatter.severity : 'none';
  const attempt = countReviewAttempts(ctx);

  const data: CodeReviewReviewedData =
    verdict === 'changes_requested'
      ? { verdict, severity, correctiveIndex: attempt + 1, reviewReportPath }
      : { verdict, severity };

  return { token: CODE_REVIEW_REVIEWED_TOKEN, envelope: { outcome: 'ok', data: data as unknown as Readonly<Record<string, unknown>> } };
}

const COMPLETION_PAYLOAD_SCHEMA: CompletionPayloadSchema = [
  { name: 'verdict', flag: true },
  { name: 'severity', flag: true },
];

export const CODE_REVIEW_NODE_TYPE: NodeTypeDefinition = {
  name: 'rad-orc:code_review',
  dataSchema: CODE_REVIEW_DATA_SCHEMA,
  traits: ['routes'],
  capabilities: ['doc-read', 'git-facts', 'spawn-agent'],
  presentation: PRESENTATION,
  instructions: INSTRUCTIONS,
  act,
  handle,
  projectStatus,
  resolve,
  completionToken: CODE_REVIEW_REVIEWED_TOKEN,
  completionPayloadSchema: COMPLETION_PAYLOAD_SCHEMA,
};

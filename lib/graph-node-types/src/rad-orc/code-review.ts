import type {
  ActContext,
  ActResult,
  DataSchema,
  EventToken,
  HandleResult,
  NodeEvent,
  NodeStatus,
  NodeTypeDefinition,
  Presentation,
  ReviewSpawnRequest,
  ReviewVerdict,
  RoutingRequest,
  Severity,
} from '@rad-orchestration/graph-engine';

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

// ── Per-repo base + level-specific SHA extensions ────────────────────────────────
// The seam to get right: these field names are frozen and must match the T02 fixture
// (`tests/fixtures/frozen-contracts.ts`'s `TaskRepoShas`/`PhaseRepoShas`/`FinalRepoShas`)
// character-for-character — never collapsed onto one shared field name across levels.

interface ReviewRepoRef {
  readonly name: string;
  readonly path: string;
  readonly branch: string;
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
// Extends the engine's own `ReviewSpawnRequest` with the level-specific doc ref + per-repo SHAs
// the rad-code-review skill's scope table freezes; `handoffDoc` mirrors whichever level-specific
// doc applies so the engine's generic required field is always satisfied.

interface CodeReviewSpawnBase extends ReviewSpawnRequest {
  readonly kind: 'reviewer';
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
    description: 'The one running report this node owns across every corrective cycle at its scope.',
  },
  repos: {
    kind: 'array',
    level: 'required',
    description: 'The repo set under review — SHAs are attached per level once known, `null` until then.',
  },
  handoffDocPath: {
    kind: 'string',
    level: 'optional',
    description: 'Task-level only — the coder handoff doc this review reads.',
  },
  phasePlanDocPath: {
    kind: 'string',
    level: 'optional',
    description: 'Phase-level only — the phase plan doc this review reads.',
  },
  requirementsDocPath: {
    kind: 'string',
    level: 'optional',
    description: 'Final-level only — the requirements doc this review reads.',
  },
  phasePlanPaths: {
    kind: 'array',
    level: 'optional',
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

const INSTRUCTIONS = `# rad-orc:code_review

One node type occupying all three review positions — \`task\`, \`phase\`, \`final\` — disambiguated
by its own \`level\` field, never three separate types. Spawns the level's own reviewer sub-agent
carrying that level's per-repo SHAs (\`head_sha\` at task scope; \`phase_first_sha\`+
\`phase_head_sha\` at phase scope; \`project_base_sha\`+\`project_head_sha\` at final scope) and doc
ref (\`handoff_doc\` / \`phase_plan_doc\` / \`requirements_doc\`+\`phase_plan_paths\`), then reads the
reviewer's \`verdict\` back via the doc-read capability. Routes uniformly at every level, on the
verdict value alone, never a finding's own content:

- \`approved\` — \`done\`, no routing request.
- \`changes_requested\` — \`add_corrective\`: the compound primitive births the next corrective
  attempt and re-points this same review back onto it.
- \`rejected\` — a recoverable halt: no primitive in the engine's vocabulary names "halt", so this
  node simply stops advancing.

Owns one running report per scope (\`reviewReportPath\`), re-adjudicated in place across every
corrective cycle rather than opening a fresh report each time.
`;

function taskPayload(ctx: ActContext, reviewReportPath: string): TaskCodeReviewSpawnPayload {
  const handoffDoc = typeof ctx.data.handoffDocPath === 'string' ? ctx.data.handoffDocPath : '';
  return {
    kind: 'reviewer',
    level: 'task',
    review_report_path: reviewReportPath,
    handoffDoc,
    handoff_doc: handoffDoc,
    repos: taskRepos(ctx.data),
  };
}

function phasePayload(ctx: ActContext, reviewReportPath: string): PhaseCodeReviewSpawnPayload {
  const phasePlanDoc = typeof ctx.data.phasePlanDocPath === 'string' ? ctx.data.phasePlanDocPath : '';
  return {
    kind: 'reviewer',
    level: 'phase',
    review_report_path: reviewReportPath,
    handoffDoc: phasePlanDoc,
    phase_plan_doc: phasePlanDoc,
    repos: phaseRepos(ctx.data),
  };
}

function finalPayload(ctx: ActContext, reviewReportPath: string): FinalCodeReviewSpawnPayload {
  const requirementsDoc = typeof ctx.data.requirementsDocPath === 'string' ? ctx.data.requirementsDocPath : '';
  const phasePlanPaths = Array.isArray(ctx.data.phasePlanPaths)
    ? ctx.data.phasePlanPaths.filter((entry): entry is string => typeof entry === 'string')
    : [];
  return {
    kind: 'reviewer',
    level: 'final',
    review_report_path: reviewReportPath,
    handoffDoc: requirementsDoc,
    requirements_doc: requirementsDoc,
    phase_plan_paths: phasePlanPaths,
    repos: finalRepos(ctx.data),
  };
}

function act(ctx: ActContext): ActResult {
  const level = readLevel(ctx.data);
  const reviewReportPath = typeof ctx.data.reviewReportPath === 'string' ? ctx.data.reviewReportPath : '';

  const payload: CodeReviewSpawnPayload =
    level === 'task' ? taskPayload(ctx, reviewReportPath) : level === 'phase' ? phasePayload(ctx, reviewReportPath) : finalPayload(ctx, reviewReportPath);

  return {
    instructions:
      `Spawn the ${level}-level reviewer via the spawn-agent capability with this level's own SHA/doc ` +
      "context, then once it reports, read the running review report's `verdict` via the doc-read " +
      'capability and feed it back as `rad-orc:code_review.reviewed`.',
    executor: 'spawn-sub-agent',
    payload,
  };
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
};

import type {
  ActContext,
  ActResult,
  AuditSpawnRequest,
  DataSchema,
  EventToken,
  HandleResult,
  NodeEvent,
  NodeId,
  NodeStatus,
  NodeTypeDefinition,
  Presentation,
  RoutingRequest,
} from '@rad-orchestration/graph-engine';

/** This node type's own two-outcome vocabulary — the auditor's own report verdict, never the engine's `EnvelopeOutcome` spine. */
export const PLAN_AUDIT_VERDICTS = ['approved', 'issues_found'] as const;
export type PlanAuditVerdict = (typeof PLAN_AUDIT_VERDICTS)[number];

/** Fires once the orchestrator has doc-read the running audit report and extracted its `verdict` — the neutral completion signal; the service's resolver reads the verdict, never this node's `handle`. */
export const PLAN_AUDIT_AUDITED_TOKEN: EventToken = 'rad-orc:plan_audit.audited';

/**
 * The envelope data `handle` expects on {@link PLAN_AUDIT_AUDITED_TOKEN}. `correctiveIndex`/
 * `reviewReportPath`/`masterPlanDoc`/`planApprovalNodeId` ride alongside `verdict` for the same
 * reason `code-review.ts`'s `CodeReviewReviewedData` carries its own extra context: `handle` is
 * pure over the event alone, never this node's own persisted `data`, so whatever an `issues_found`
 * routing needs travels here — including `planApprovalNodeId`, the downstream `rad-orc:approval`
 * (plan level) node `add_corrective_gate` holds, mirroring `approval.ts`'s own `masterPlanNodeId`
 * seam, and `masterPlanDoc`, the doc a minted `rad-orc:plan_corrective` needs to edit inline.
 */
export interface AuditedData {
  readonly verdict: PlanAuditVerdict;
  /** The next corrective attempt's 1-based index; required only when `verdict === 'issues_found'`. */
  readonly correctiveIndex?: number;
  /** This audit's own running report path, echoed back so a minted corrective can carry it forward. */
  readonly reviewReportPath?: string;
  /** This audit's own master-plan doc path, echoed back so a minted `rad-orc:plan_corrective` can edit it. */
  readonly masterPlanDoc?: string;
  /** Required when `verdict === 'issues_found'` — the plan-level `rad-orc:approval` node the corrective gates. */
  readonly planApprovalNodeId?: NodeId;
}

export const PLAN_AUDIT_DATA_SCHEMA: DataSchema = {
  requirementsDocPath: {
    kind: 'string',
    level: 'required',
    description: 'The approved requirements doc this audit reads.',
  },
  masterPlanDocPath: {
    kind: 'string',
    level: 'required',
    description: 'The just-authored master-plan doc this audit reads.',
  },
  reviewReportPath: {
    kind: 'string',
    level: 'required',
    description: "This audit's own running report — the one report the auditor writes its verdict to.",
  },
  verdict: {
    kind: 'string',
    level: 'computed',
    description: "The auditor's resolved verdict, once the running report has been read — 'approved' | 'issues_found'.",
  },
};

const PRESENTATION: Presentation = {
  label: 'Plan Audit',
  description: 'Independent-eyes audit of the master plan against requirements; routes on the report verdict.',
};

const INSTRUCTIONS = `# rad-orc:plan_audit

Spawns a \`general-purpose\` auditor sub-agent over two planning docs — the approved requirements
and the just-authored master plan — carrying this rubric so the auditor never has to look it up.
The auditor reads both end to end, spot-checks the plan against the real codebase, and writes a
structured report to \`reviewReportPath\`; this node then reads that report's \`verdict\` back via
the doc-read capability and feeds it back as \`rad-orc:plan_audit.audited\`. Routes on the verdict
value alone, never a finding's own content:

- \`approved\` — advances via \`projectStatus\` alone, no routing request.
- \`issues_found\` — births a corrective attempt answering this audit (the engine's own
  \`add_corrective_gate\` primitive) and gates the downstream plan-level \`rad-orc:approval\` on it,
  without resetting this audit itself — so the audit never re-runs and the gate holds until the
  correction lands and re-explodes the corrected plan.

## The four lenses

Run the plan through four lenses. They overlap at the edges; when a finding could sit under
two, file it under the one that best tells the main agent what to fix.

**Accurate — the plan matches the codebase**

The plan is only as good as the reality it pins. A brief built on an invented path or a
fabricated signature sends a coder down a hole before they write a line.

- Spot-check the load-bearing claims: the files a task says to create or touch exist where
  it says (or sit plausibly beside real siblings), and the signatures, types, and endpoints
  it pins read as real, not guessed.
- A pattern the plan tells a coder to mirror ("follow the existing handler in \`x.ts\`")
  actually exists and does what the plan claims it does.
- Discovery was grounded — the plan reads like its author opened the files, not like it
  describes a codebase from memory. A confidently wrong fact is the headline failure here.

**Consistent — Requirements and plan agree, and the plan agrees with itself**

- Each requirement is carried in the *shape* the requirements describe — the plan didn't
  quietly redefine scope, swap one contract for a different one, or contradict a stated
  non-goal.
- A contract pinned at a cross-repo seam reads **identically in both tasks that meet there**
  — same fields, same types, same nullability. A drifted shape on one side is a break
  waiting to surface at integration.
- The frontmatter seal is coherent: every task's \`Target repo:\` names a repo inside the
  sealed \`repos:\` set, so no task points at a boundary the requirements never approved.

**Coherent — sensible scope, order, complexity, and calibration**

- Phases sequence in a runnable order: a task doesn't lean on a seam a later phase builds.
  Each task's scope is one coherent unit of work, not a grab-bag stapled together to hit a
  size.
- Complexity reads honest. Most tasks should sit at the lighter end; a plan stamped
  \`complex\` across the board is a sizing smell, not a genuinely hard project.
- **Calibration — the load-bearing check.** Each brief's specificity must match the
  complexity it's stamped, and the load-bearing seams and cross-repo contracts must be
  actually *pinned*, not gestured at. Flag **both** directions:
  - **Too thin** — a \`simple\` task routes to the coder with the least room to fill gaps, so
    a one-line brief that omits the shape it needs — the signature, the data, the seam — is
    a finding, not a courtesy. Under-specification is the easy miss; look for it on purpose.
  - **Too much** — a brief that pastes a full implementation a coder could copy verbatim has
    written the answer, not a contract, and invents bugs the coder would otherwise have
    caught.
  - The target both directions bend toward is the contract-rich middle: distinctly richer
    than a one-liner, well short of the finished code.

**Complete — the plan covers the requirements**

- Walk each requirement and confirm a task carries its substance. Read for the capability it
  asks to build, not for a matching label — the same thing, said in the plan's own words, is
  coverage.
- A requirement with no home in any task is a gap. Name it, and name where it should land.
- Don't flag the deliberate omissions: the requirements name what's intentionally out of
  scope, and a plan is right to skip those. A genuine gap is missing work; a non-goal is
  finished thinking.

## What you return

A structured report for the main agent to action — not edits to either doc.

- **Frontmatter** carrying a single verdict:

  \`\`\`
  verdict: approved | issues_found
  \`\`\`

  Use \`approved\` only when nothing needs the author's attention; otherwise \`issues_found\`.
- **A findings list**, one entry per issue, each naming three things:
  - **Lens** — Accurate, Consistent, Coherent, or Complete.
  - **What's wrong** — the problem, stated so the main agent can act on it without
    re-deriving it.
  - **Where** — the phase/task and the file or contract it concerns.

Keep it concise and high-signal: a short, ordered list, not an essay. You surface the
problems; the main agent fixes them in the docs.
`;

function act(ctx: ActContext): ActResult {
  const requirementsDoc = typeof ctx.data.requirementsDocPath === 'string' ? ctx.data.requirementsDocPath : '';
  const masterPlanDoc = typeof ctx.data.masterPlanDocPath === 'string' ? ctx.data.masterPlanDocPath : '';
  const reviewReportPath = typeof ctx.data.reviewReportPath === 'string' ? ctx.data.reviewReportPath : '';

  const payload: AuditSpawnRequest = {
    kind: 'auditor',
    requirementsDoc,
    masterPlanDoc,
    reviewReportPath,
  };

  return {
    instructions:
      'Spawn a general-purpose auditor via the spawn-agent capability, carrying the requirements + master-plan ' +
      "doc paths and this node's own four-lens rubric, writing its verdict'd report to `reviewReportPath` — then " +
      "once it reports, read the running report's `verdict` via the doc-read capability and feed it back as " +
      '`rad-orc:plan_audit.audited`.',
    executor: 'spawn-sub-agent',
    payload,
  };
}

function handle(ev: NodeEvent): HandleResult {
  if (ev.token !== PLAN_AUDIT_AUDITED_TOKEN || ev.envelope.outcome !== 'ok') return {};
  const { verdict, correctiveIndex, reviewReportPath, masterPlanDoc, planApprovalNodeId } = ev.envelope.data as unknown as AuditedData;

  if (verdict === 'issues_found') {
    if (!planApprovalNodeId) {
      throw new Error("rad-orc:plan_audit: an 'issues_found' verdict requires planApprovalNodeId on the envelope");
    }
    const index = correctiveIndex ?? 1;
    const routing: RoutingRequest = {
      primitive: 'add_corrective_gate',
      params: {
        id: `${ev.nodeId}-corrective-${index}`,
        type: 'rad-orc:plan_corrective',
        source: ev.nodeId,
        gate: planApprovalNodeId,
        options: { data: { masterPlanDoc: masterPlanDoc ?? null, reviewReportPath: reviewReportPath ?? null } },
      },
    };
    return { dataChange: { verdict }, routing };
  }

  // 'approved' advances via projectStatus alone — no routing request.
  return { dataChange: { verdict } };
}

function projectStatus(data: Readonly<Record<string, unknown>>): NodeStatus {
  // Both verdicts leave this audit 'done': 'approved' advances its dependent directly, and
  // 'issues_found' must never reset back to 'not_started' (that would re-audit) — the gate that
  // holds the downstream approval is the `add_corrective_gate` edge `handle` requests above, never
  // this node's own status.
  return data.verdict === 'approved' || data.verdict === 'issues_found' ? 'done' : 'not_started';
}

export const PLAN_AUDIT_NODE_TYPE: NodeTypeDefinition = {
  name: 'rad-orc:plan_audit',
  dataSchema: PLAN_AUDIT_DATA_SCHEMA,
  traits: ['routes'],
  capabilities: ['spawn-agent', 'doc-read'],
  presentation: PRESENTATION,
  instructions: INSTRUCTIONS,
  act,
  handle,
  projectStatus,
};

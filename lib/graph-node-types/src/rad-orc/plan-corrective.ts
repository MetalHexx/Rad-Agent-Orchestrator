import type {
  ActContext,
  ActResult,
  DataSchema,
  Expansion,
  EventToken,
  HandleResult,
  NodeEvent,
  NodeId,
  NodeStatus,
  NodeTypeDefinition,
  Presentation,
  RoutingRequest,
} from '@rad-orchestration/graph-engine';

/** Fires once the orchestrator's inline plan-edit has reported back. */
export const PLAN_CORRECTIVE_COMPLETED_TOKEN: EventToken = 'rad-orc:plan_corrective.completed';

/**
 * The envelope data `handle` expects on {@link PLAN_CORRECTIVE_COMPLETED_TOKEN} — never persisted
 * on this node's own `data` (mirrors `plan-audit.ts`'s own `AuditedData`): the re-explode target
 * and the fresh batch travel here so `handle` stays a pure function over the event alone, exactly
 * what T02's `replace_expansion` primitive needs to tear down and replace the prior phase-loop
 * expansion in one delta.
 */
export interface PlanCorrectiveCompletedData {
  /** The `expands`-trait node (e.g. `rad-orc:explosion`) whose prior expansion is being replaced. */
  readonly explosionNodeId: NodeId;
  /** The corrected plan's fresh batch, built the same way the original explosion built its own. */
  readonly expansion: Expansion;
}

export const PLAN_CORRECTIVE_DATA_SCHEMA: DataSchema = {
  masterPlanDoc: {
    kind: 'string',
    level: 'required',
    description: 'The master-plan doc the orchestrator edits.',
  },
  reviewReportPath: {
    kind: 'string',
    level: 'required',
    description: 'The audit report whose findings to action.',
  },
  completed: {
    kind: 'boolean',
    level: 'computed',
    description: 'Whether the inline edit + re-explode has reported back.',
  },
};

const PRESENTATION: Presentation = {
  label: 'Plan Corrective',
  description: 'The audit-origin correction: an inline master-plan edit that re-explodes the corrected plan, no re-audit.',
};

const INSTRUCTIONS = `# rad-orc:plan_corrective

Born by \`rad-orc:plan_audit\`'s own \`add_corrective_gate\` on an \`issues_found\` verdict, gating
the plan-level \`rad-orc:approval\` until this lands. Distinct from \`rad-orc:corrective\`: the fix
here is a document edit the orchestrator performs inline, never a spawned coder. Executed inline —
read the running audit report, edit the master plan doc, then signal completion. Its own completion
drives the engine's \`replace_expansion\` primitive (T02's re-explode-and-proceed mechanism),
tearing down and replacing the prior phase-loop expansion with the corrected plan's fresh batch —
never a bare \`reset\` (which would cascade back onto \`rad-orc:plan_audit\` and force a re-audit)
and never a naive \`expand\` (which would collide on the prior expansion's still-live node ids). The
plan-level approval this corrective gates releases dependency-driven, once this node reports done —
never a routing request this node issues itself.
`;

function act(ctx: ActContext): ActResult {
  const masterPlanDoc = typeof ctx.data.masterPlanDoc === 'string' ? ctx.data.masterPlanDoc : '';
  const reviewReportPath = typeof ctx.data.reviewReportPath === 'string' ? ctx.data.reviewReportPath : '';

  return {
    instructions: `edit the master plan at \`${masterPlanDoc}\` per the audit findings in \`${reviewReportPath}\`, then signal completion.`,
    executor: 'orchestrator-inline',
  };
}

function handle(ev: NodeEvent): HandleResult {
  if (ev.token !== PLAN_CORRECTIVE_COMPLETED_TOKEN || ev.envelope.outcome !== 'ok') return {};
  const { explosionNodeId, expansion } = ev.envelope.data as unknown as PlanCorrectiveCompletedData;
  const routing: RoutingRequest = {
    primitive: 'replace_expansion',
    params: { node: explosionNodeId, expansion },
  };
  return { dataChange: { completed: true }, routing };
}

function projectStatus(data: Readonly<Record<string, unknown>>): NodeStatus {
  return data.completed === true ? 'done' : 'not_started';
}

export const PLAN_CORRECTIVE_NODE_TYPE: NodeTypeDefinition = {
  name: 'rad-orc:plan_corrective',
  dataSchema: PLAN_CORRECTIVE_DATA_SCHEMA,
  traits: [],
  capabilities: ['doc-read', 'doc-write'],
  presentation: PRESENTATION,
  instructions: INSTRUCTIONS,
  act,
  handle,
  projectStatus,
};

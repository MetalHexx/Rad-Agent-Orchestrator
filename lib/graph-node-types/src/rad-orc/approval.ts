import type {
  ActContext,
  ActResult,
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
import { PRIMITIVE_RESET } from '@rad-orchestration/graph-engine';

/** The two gate positions one `rad-orc:approval` instance can occupy — never a third. */
export const APPROVAL_LEVELS = ['plan', 'final'] as const;
export type ApprovalLevel = (typeof APPROVAL_LEVELS)[number];

/** This node type's own two-outcome vocabulary — never the engine's `EnvelopeOutcome` spine. */
export const APPROVAL_DECISIONS = ['granted', 'denied'] as const;
export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];

/** Fires once the operator has responded to the request-human prompt `act` issued. */
export const APPROVAL_DECIDED_TOKEN: EventToken = 'rad-orc:approval.decided';

/**
 * The envelope data `handle` expects on {@link APPROVAL_DECIDED_TOKEN}. `level`/`masterPlanNodeId`
 * ride alongside `decision` because `handle` is a pure function of the event alone — it never
 * reads this node's own persisted `data` (that's `act`'s `ActContext.data`, not `handle`'s
 * `NodeEvent`) — so whatever context a plan-level `denied` routing needs travels on the envelope.
 */
export interface ApprovalDecidedData {
  readonly decision: ApprovalDecision;
  readonly level: ApprovalLevel;
  /** Required when `level === 'plan'` — the `master_plan` node a `denied` decision cascade-resets. */
  readonly masterPlanNodeId?: NodeId;
}

export const APPROVAL_DATA_SCHEMA: DataSchema = {
  level: {
    kind: 'string',
    level: 'required',
    description: "Which gate position this instance occupies — 'plan' or 'final'.",
  },
  decision: {
    kind: 'string',
    level: 'computed',
    description: "The operator's granted/denied verdict, once resolved.",
  },
};

const PRESENTATION: Presentation = {
  label: 'Approval',
  description: "Human gate at the plan or final position; routes on its own granted/denied vocabulary.",
};

const INSTRUCTIONS = `# rad-orc:approval

One node type occupying either of two gate positions, disambiguated by its own \`level\` field —
\`plan\` (gates the seeded execution subgraph) or \`final\` (gates project completion). Routes on
its own two-outcome vocabulary, never the engine's \`ok\`/\`error\` envelope spine:

- \`granted\` — advance; no routing request, the DAG proceeds past this node on its own.
- \`denied\` at \`plan\` level — cascade-resets \`rad-orc:master_plan\` (re-authoring the plan and
  tearing down whatever \`rad-orc:explosion\` already seeded from the rejected one).
- \`denied\` at \`final\` level — a recoverable halt: this node stops advancing and awaits an
  out-of-band operator action, since no primitive in the engine's vocabulary names "halt".
`;

function act(_ctx: ActContext): ActResult {
  return {
    executor: 'request-human',
  };
}

function handle(ev: NodeEvent): HandleResult {
  if (ev.token !== APPROVAL_DECIDED_TOKEN || ev.envelope.outcome !== 'ok') return {};
  const { decision, level, masterPlanNodeId } = ev.envelope.data as unknown as ApprovalDecidedData;

  if (decision === 'granted') return { dataChange: { decision } };

  if (level === 'plan') {
    if (!masterPlanNodeId) {
      throw new Error("rad-orc:approval: a plan-level 'denied' decision requires masterPlanNodeId on the envelope");
    }
    const routing: RoutingRequest = { primitive: PRIMITIVE_RESET, params: { node: masterPlanNodeId, cascade: true } };
    return { dataChange: { decision }, routing };
  }

  // Final-level denial: a recoverable halt. No "halt" primitive exists in the engine's closed
  // `PrimitiveName` vocabulary, so this node simply stops advancing (no routing, no expansion);
  // recovery is an out-of-band operator action, outside this pure hook's authority.
  return { dataChange: { decision } };
}

function projectStatus(data: Readonly<Record<string, unknown>>): NodeStatus {
  if (data.decision === 'granted') return 'done';
  if (data.decision === 'denied') return 'blocked';
  return 'not_started';
}

export const APPROVAL_NODE_TYPE: NodeTypeDefinition = {
  name: 'rad-orc:approval',
  dataSchema: APPROVAL_DATA_SCHEMA,
  traits: ['routes'],
  capabilities: ['request-human'],
  presentation: PRESENTATION,
  instructions: INSTRUCTIONS,
  act,
  handle,
  projectStatus,
  completionToken: APPROVAL_DECIDED_TOKEN,
};

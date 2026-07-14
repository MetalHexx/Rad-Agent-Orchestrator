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
} from '@rad-orchestration/graph-engine';

/** Fires once the orchestrator's inline doc-read → doc-write cycle has authored the plan doc. */
export const MASTER_PLAN_AUTHORED_TOKEN: EventToken = 'rad-orc:master_plan.authored';

/** The envelope data `handle` expects on {@link MASTER_PLAN_AUTHORED_TOKEN}. */
export interface MasterPlanAuthoredData {
  readonly docPath: string;
}

export const MASTER_PLAN_DATA_SCHEMA: DataSchema = {
  requirementsDocPath: {
    kind: 'string',
    level: 'optional',
    description:
      "Override pointer to the requirements doc(s) to read; falls back to the project's standard location when absent.",
  },
  docPath: {
    kind: 'string',
    level: 'computed',
    description: 'Path to the authored master-plan doc, set once the doc-write step completes.',
  },
};

const PRESENTATION: Presentation = {
  label: 'Master Plan',
  description: 'Authors the phase/task breakdown from project requirements; re-authors after a plan-level denial.',
};

const INSTRUCTIONS = `# rad-orc:master_plan

Authors the project's phase/task master plan: read requirements → write the plan doc → the DAG
routes to \`rad-orc:explosion\` next (dependency-driven, not a routing request this node issues
itself). Executed inline by the orchestrator — no sub-agent spawn. A plan-level \`approval\` denial
resets this node back to \`not_started\` (via the engine's own cascade reset), and it re-authors
fresh the next time it becomes frontier-eligible.
`;

function act(ctx: ActContext): ActResult {
  const requirementsDocPath = typeof ctx.data.requirementsDocPath === 'string' ? ctx.data.requirementsDocPath : undefined;
  const readTarget = requirementsDocPath ?? "the project's requirements doc";
  return {
    instructions:
      `Read ${readTarget} via the doc-read capability, author the phase/task master plan from it, ` +
      'write it via the doc-write capability, then report back with the written doc path — the DAG ' +
      'routes to `rad-orc:explosion` next once this node completes.',
    executor: 'orchestrator-inline',
  };
}

function handle(ev: NodeEvent): HandleResult {
  if (ev.token !== MASTER_PLAN_AUTHORED_TOKEN || ev.envelope.outcome !== 'ok') return {};
  const { docPath } = ev.envelope.data as unknown as MasterPlanAuthoredData;
  return { dataChange: { docPath } };
}

function projectStatus(data: Readonly<Record<string, unknown>>): NodeStatus {
  return typeof data.docPath === 'string' && data.docPath.length > 0 ? 'done' : 'not_started';
}

export const MASTER_PLAN_NODE_TYPE: NodeTypeDefinition = {
  name: 'rad-orc:master_plan',
  dataSchema: MASTER_PLAN_DATA_SCHEMA,
  traits: [],
  capabilities: ['doc-read', 'doc-write'],
  presentation: PRESENTATION,
  instructions: INSTRUCTIONS,
  act,
  handle,
  projectStatus,
  completionToken: MASTER_PLAN_AUTHORED_TOKEN,
};

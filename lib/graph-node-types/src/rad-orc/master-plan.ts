import type {
  ActContext,
  ActResult,
  CompletionPayloadSchema,
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
    resolve: 'project-doc-path',
    description:
      "Override pointer to the requirements doc(s) to read; falls back to the project's standard location when absent.",
  },
  docPath: {
    kind: 'string',
    level: 'computed',
    resolve: 'project-doc-path',
    description: 'Path to the authored master-plan doc, set once the doc-write step completes.',
  },
};

const PRESENTATION: Presentation = {
  label: 'Master Plan',
  description: 'Authors the phase/task breakdown from project requirements; re-authors after a plan-level denial.',
};

const INSTRUCTIONS = `# rad-orc:master_plan

Author the project's phase/task master plan per the procedure in \`rad-create-plans\`'s
master-plan mode. Read the requirements doc (at \`requirementsDocPath\` if override-seeded,
else the project's standard path), author the plan doc following that skill, write it via
the doc-write capability, and report back with the written doc path. When \`last_parse_error\`
is present on the payload, this is a re-authoring — fix exactly what that error flags and
leave the rest of the plan intact.
`;

const COMPLETION_PAYLOAD_SCHEMA: CompletionPayloadSchema = [{ name: 'doc_path', flag: true }];

function act(ctx: ActContext): ActResult {
  // D18: the parse failure lives on the explosion sibling's own data; `reset` carries no patch, so read it.
  const explosion = ctx.nodes.find((n) => n.type === 'rad-orc:explosion');
  const lastParseError = explosion?.data.lastParseError;

  const result: ActResult = {
    executor: 'orchestrator-inline',
  };

  if (lastParseError) {
    (result as unknown as Record<string, unknown>).payload = { last_parse_error: lastParseError };
  }

  return result;
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
  completionPayloadSchema: COMPLETION_PAYLOAD_SCHEMA,
};

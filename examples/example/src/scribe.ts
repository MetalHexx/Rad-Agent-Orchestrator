import type {
  ActContext,
  ActResult,
  ContextPayload,
  DataSchema,
  EventToken,
  HandleResult,
  NodeEvent,
  NodeStatus,
  NodeTypeDefinition,
  ResolveContext,
  ResolveOutcome,
} from '@rad-orchestration/graph-engine';

const DEFAULT_CONTENT = 'Hello from example:scribe.';

const DATA_SCHEMA: DataSchema = {
  content: { kind: 'string', level: 'optional', description: 'The note content to write; defaults to a canned line.' },
  written: { kind: 'boolean', level: 'computed', description: 'Set once the host has written the note and relayed completion.' },
};

const SCRIBE_WRITTEN_TOKEN: EventToken = 'example:scribe.written';

function noteContent(data: Readonly<Record<string, unknown>>): string {
  return typeof data.content === 'string' ? data.content : DEFAULT_CONTENT;
}

function act(ctx: ActContext): ActResult {
  return {
    executor: 'orchestrator-inline',
    payload: { content: noteContent(ctx.data) } as ContextPayload,
  };
}

function handle(ev: NodeEvent): HandleResult {
  if (ev.token !== SCRIBE_WRITTEN_TOKEN || ev.envelope.outcome !== 'ok') return {};
  return { dataChange: { written: true } };
}

function projectStatus(data: Readonly<Record<string, unknown>>): NodeStatus {
  return data.written === true ? 'done' : 'not_started';
}

/**
 * This node's own host-side outcome derivation: writes the note through the declared `doc-write`
 * capability using a real port, then reports the write back as the node's completion outcome — the
 * capability-bearing counterpart to `example:greet`'s zero-capability inline speak.
 */
async function resolve(ctx: ResolveContext): Promise<ResolveOutcome> {
  const path = `example/${ctx.nodeId}.txt`;

  const written = await ctx.ports.docWrite.write({
    originatingNodeId: ctx.nodeId,
    idempotencyKey: `${ctx.nodeId}:write`,
    path,
    content: noteContent(ctx.data),
  });
  if (written.outcome !== 'ok') {
    throw new Error(`example:scribe '${ctx.nodeId}' could not write its note to '${path}'`);
  }

  return { token: SCRIBE_WRITTEN_TOKEN, envelope: { outcome: 'ok', data: { path: written.data.path } } };
}

const scribe: NodeTypeDefinition = {
  name: 'example:scribe',
  dataSchema: DATA_SCHEMA,
  traits: [],
  capabilities: ['doc-write'],
  presentation: {
    label: 'Scribe',
    description: 'A capability-bearing custom node — writes a note through doc-write and re-derives its own completion host-side.',
  },
  instructions:
    '# example:scribe\n\nWrite the note (the `content` value from the payload) through the doc-write capability, ' +
    'then report completion. Requests the doc-write capability; on relay, the host calls this type\'s own ' +
    '`resolve` to re-derive the outcome rather than trusting a caller-supplied one.',
  act,
  handle,
  projectStatus,
  resolve,
  completionToken: SCRIBE_WRITTEN_TOKEN,
};

export default scribe;

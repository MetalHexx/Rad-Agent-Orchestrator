import type {
  ActContext,
  ActResult,
  ContextPayload,
  DataSchema,
  HandleResult,
  NodeEvent,
  NodeStatus,
  NodeTypeDefinition,
} from '@rad-orchestration/graph-engine';

const DATA_SCHEMA: DataSchema = {
  greeting: { kind: 'string', level: 'optional', description: 'What to say; defaults to "Hello Custom Bundle".' },
  spoken: { kind: 'boolean', level: 'computed', description: 'Set once the greeting has been spoken.' },
};

function act(ctx: ActContext): ActResult {
  const greeting = typeof ctx.data.greeting === 'string' ? ctx.data.greeting : 'Hello Custom Bundle';
  return { executor: 'orchestrator-inline', payload: { greeting } as ContextPayload };
}

function handle(ev: NodeEvent): HandleResult {
  if (ev.token !== 'example:greet.spoken' || ev.envelope.outcome !== 'ok') return {};
  return { dataChange: { spoken: true } };
}

function projectStatus(data: Readonly<Record<string, unknown>>): NodeStatus {
  return data.spoken === true ? 'done' : 'not_started';
}

const greet: NodeTypeDefinition = {
  name: 'example:greet',
  dataSchema: DATA_SCHEMA,
  traits: [],
  capabilities: [],
  presentation: { label: 'Greet', description: 'A zero-capability custom greeting node.' },
  instructions:
    '# example:greet\n\nSpeak the `greeting` value from the payload (or "Hello Custom Bundle" if absent) inline, ' +
    'then report completion. Requests no capabilities.',
  act,
  handle,
  projectStatus,
};

export default greet;

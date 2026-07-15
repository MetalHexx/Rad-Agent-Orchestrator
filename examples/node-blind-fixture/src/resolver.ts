import type {
  ActContext,
  ActResult,
  DataSchema,
  HandleResult,
  NodeEvent,
  NodeStatus,
  NodeTypeDefinition,
} from '@rad-orchestration/graph-engine';

const DATA_SCHEMA: DataSchema = {
  bizarroSourceRepos: {
    kind: 'array',
    level: 'required',
    resolve: 'worktree-repo-set',
    description: 'Novel field name for repos — proves node-blind resolution by custom names.',
  },
  oddballDocPath: {
    kind: 'string',
    level: 'required',
    resolve: 'project-doc-path',
    description: 'Novel field name for a doc path — proves node-blind resolution by custom names.',
  },
  unresolvedMandatoryPath: {
    kind: 'string',
    level: 'required',
    description: 'A required field with no resolve hint — stays as-is from data.',
  },
  complete: {
    kind: 'boolean',
    level: 'computed',
    description: 'Set once this node completes.',
  },
};

function act(ctx: ActContext): ActResult {
  const msg = 'node-blind-fixture:resolver — a node-type discovery proof.';
  return {
    executor: 'orchestrator-inline',
    payload: {
      bizarroSourceRepos: ctx.data.bizarroSourceRepos,
      oddballDocPath: ctx.data.oddballDocPath,
      unresolvedMandatoryPath: ctx.data.unresolvedMandatoryPath,
    },
  };
}

function handle(ev: NodeEvent): HandleResult {
  if (ev.token !== 'node-blind-fixture:resolver.complete' || ev.envelope.outcome !== 'ok') return {};
  return { dataChange: { complete: true } };
}

function projectStatus(data: Readonly<Record<string, unknown>>): NodeStatus {
  return data.complete === true ? 'done' : 'not_started';
}

const resolver: NodeTypeDefinition = {
  name: 'node-blind-fixture:resolver',
  dataSchema: DATA_SCHEMA,
  traits: [],
  capabilities: [],
  presentation: {
    label: 'Node-Blind Resolver Fixture',
    description: 'Proves node-blind resolution with novel field names.',
  },
  instructions: 'node-blind-fixture:resolver — a node-type discovery proof.',
  act,
  handle,
  projectStatus,
};

export default resolver;

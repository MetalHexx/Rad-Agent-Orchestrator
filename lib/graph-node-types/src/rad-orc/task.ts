import type {
  ActContext,
  ActResult,
  AgentSpawnRequest,
  DataSchema,
  EventToken,
  HandleResult,
  NodeEvent,
  NodeStatus,
  NodeTypeDefinition,
  Presentation,
} from '@rad-orchestration/graph-engine';

/** One repo target as seeded on this node's own `data.repos` — mirrors the coder's own `HandoffRepo`. */
interface TaskRepoRef {
  readonly name: string;
  readonly path: string;
  readonly branch: string;
}

function readComplexity(value: unknown): 'simple' | 'standard' | 'complex' {
  return value === 'simple' || value === 'complex' ? value : 'standard';
}

function readRepos(value: unknown): readonly TaskRepoRef[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null)
    .map((entry) => ({
      name: typeof entry.name === 'string' ? entry.name : '',
      path: typeof entry.path === 'string' ? entry.path : '',
      branch: typeof entry.branch === 'string' ? entry.branch : '',
    }));
}

/**
 * Fires once the spawned coder sub-agent reports back — the same completion contract an original
 * task attempt and a `rad-orc:corrective` attempt both use, since a corrective coder run is
 * shaped identically from the harness's perspective (see `corrective.ts`, which listens on this
 * same token rather than declaring its own).
 */
export const TASK_COMPLETED_TOKEN: EventToken = 'rad-orc:task.completed';

/** The envelope data `handle` expects on {@link TASK_COMPLETED_TOKEN} — the coder's per-repo commit results. */
export interface TaskCompletedData {
  readonly results: readonly {
    readonly name: string;
    readonly committed: boolean;
    readonly commitHash: string | null;
    readonly pushed: boolean;
  }[];
}

export const TASK_DATA_SCHEMA: DataSchema = {
  handoffDocPath: {
    kind: 'string',
    level: 'required',
    description: 'Path to this task\'s authored handoff doc, seeded by explosion\'s parse of the master plan.',
  },
  repos: {
    kind: 'array',
    level: 'required',
    description: 'The `{name, path, branch}` repo set this task\'s coder spawn works against.',
  },
  complexity: {
    kind: 'string',
    level: 'required',
    description: "This task's declared complexity — 'simple' | 'standard' | 'complex'.",
  },
  shouldCommit: {
    kind: 'boolean',
    level: 'required',
    description: 'Whether the coder is directed to commit (and push) its own work once done.',
  },
  reviewReportPath: {
    kind: 'string',
    level: 'optional',
    description: 'The running review report path, present only once a review has already opened one.',
  },
  completed: {
    kind: 'boolean',
    level: 'computed',
    description: 'Whether the coder spawn has reported back.',
  },
  results: {
    kind: 'array',
    level: 'computed',
    description: 'The coder\'s own per-repo `{name, committed, commitHash, pushed}` results.',
  },
};

const PRESENTATION: Presentation = {
  label: 'Task',
  description: "Spawns a coder sub-agent against this task's own handoff doc and repo set.",
};

const INSTRUCTIONS = `# rad-orc:task

Spawns a coder sub-agent (\`AgentSpawnRequest\`) carrying this task's own handoff doc, repo set,
complexity, and commit directive — a pure declaration, no code-behind of its own. Once the coder
reports back, \`handle\` records its per-repo commit results and this node reaches \`done\`; its
dependents advance dependency-driven, never via a routing request this node issues itself.
`;

function act(ctx: ActContext): ActResult {
  const handoffDoc = typeof ctx.data.handoffDocPath === 'string' ? ctx.data.handoffDocPath : '';
  const reviewReportPath = typeof ctx.data.reviewReportPath === 'string' ? ctx.data.reviewReportPath : undefined;

  const payload: AgentSpawnRequest = {
    kind: 'coder',
    handoffDoc,
    complexity: readComplexity(ctx.data.complexity),
    repos: readRepos(ctx.data.repos),
    shouldCommit: ctx.data.shouldCommit === true,
    reviewReportPath,
  };

  return {
    instructions:
      "Spawn the coder sub-agent via the spawn-agent capability with this task's own handoff doc and repo " +
      'set; once it reports back, read its per-repo commit results (doc-read/git-facts as needed) and feed ' +
      'them back as `rad-orc:task.completed`.',
    executor: 'spawn-sub-agent',
    payload,
  };
}

function handle(ev: NodeEvent): HandleResult {
  if (ev.token !== TASK_COMPLETED_TOKEN || ev.envelope.outcome !== 'ok') return {};
  const { results } = ev.envelope.data as unknown as TaskCompletedData;
  return { dataChange: { completed: true, results } };
}

function projectStatus(data: Readonly<Record<string, unknown>>): NodeStatus {
  return data.completed === true ? 'done' : 'not_started';
}

export const TASK_NODE_TYPE: NodeTypeDefinition = {
  name: 'rad-orc:task',
  dataSchema: TASK_DATA_SCHEMA,
  traits: [],
  capabilities: ['doc-read', 'git-facts', 'spawn-agent'],
  presentation: PRESENTATION,
  instructions: INSTRUCTIONS,
  act,
  handle,
  projectStatus,
  completionToken: TASK_COMPLETED_TOKEN,
};

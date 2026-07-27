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

/** One repo target as seeded on this node's own `data.repos` — the frozen `PrRequestRepo` shape. */
export interface PrRepoRef {
  readonly name: string;
  readonly path: string;
  readonly branch: string;
  readonly base_branch: string;
}

/** One repo's own outcome — the frozen `{name, pr_url}` shape, `pr_url` null only on a failed open. */
export interface PrRepoResult {
  readonly name: string;
  readonly pr_url: string | null;
}

/** Fires once the inline `gh` loop has settled every repo's PR (opened fresh or resolved already-open). */
export const PR_CREATED_TOKEN: EventToken = 'rad-orc:pr.created';

/** The envelope data `handle` expects on {@link PR_CREATED_TOKEN}. */
export interface PrCreatedData {
  readonly results: readonly PrRepoResult[];
}

export const PR_DATA_SCHEMA: DataSchema = {
  repos: {
    kind: 'array',
    level: 'required',
    resolve: 'worktree-repo-set',
    description: 'The `{name, path, branch, base_branch}` repo set to open (or resolve) a PR for.',
  },
  completed: {
    kind: 'boolean',
    level: 'computed',
    description: 'Whether the inline gh loop has settled every repo.',
  },
  results: {
    kind: 'array',
    level: 'computed',
    description: 'The per-repo `{name, pr_url}` this node reports back once every repo has settled.',
  },
};

const PRESENTATION: Presentation = {
  label: 'PR',
  description: 'Opens (or resolves) one pull request per repo via the gh CLI, in a single inline loop.',
};

const INSTRUCTIONS = `# rad-orc:pr

Implement the opening or resolution of pull requests per the procedure in
\`rad-source-control\`'s \`working-with-prs.md\` reference. This node has seeded
the repos to work with. Per repo, open a PR against its \`base_branch\` (or resolve
the one already open for that branch) via the run-command capability, with a stable
idempotency key (this node's id plus the repo name) so a re-run never double-opens.
Report back per repo as \`{name, pr_url}\` via \`rad-orc:pr.created\`.
`;

const COMPLETION_PAYLOAD_SCHEMA: CompletionPayloadSchema = [{ name: 'repos', flag: false }];

function act(_ctx: ActContext): ActResult {
  return {
    executor: 'orchestrator-inline',
  };
}

function handle(ev: NodeEvent): HandleResult {
  if (ev.token !== PR_CREATED_TOKEN || ev.envelope.outcome !== 'ok') return {};
  const { results } = ev.envelope.data as unknown as PrCreatedData;
  return { dataChange: { completed: true, results } };
}

function projectStatus(data: Readonly<Record<string, unknown>>): NodeStatus {
  return data.completed === true ? 'done' : 'not_started';
}

export const PR_NODE_TYPE: NodeTypeDefinition = {
  name: 'rad-orc:pr',
  dataSchema: PR_DATA_SCHEMA,
  traits: [],
  capabilities: ['run-command'],
  presentation: PRESENTATION,
  instructions: INSTRUCTIONS,
  act,
  handle,
  projectStatus,
  completionToken: PR_CREATED_TOKEN,
  completionPayloadSchema: COMPLETION_PAYLOAD_SCHEMA,
};

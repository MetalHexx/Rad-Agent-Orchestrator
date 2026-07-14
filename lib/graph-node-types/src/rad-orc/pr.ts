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

function readRepos(value: unknown): readonly PrRepoRef[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null)
    .map((entry) => ({
      name: typeof entry.name === 'string' ? entry.name : '',
      path: typeof entry.path === 'string' ? entry.path : '',
      branch: typeof entry.branch === 'string' ? entry.branch : '',
      base_branch: typeof entry.base_branch === 'string' ? entry.base_branch : '',
    }));
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

Runs \`gh\` once per repo in this node's own \`repos\` data, inline in the orchestrator — a single
dispatch, never an \`expands\`-trait node — opening a PR against each repo's own \`base_branch\` or
resolving the one already open for that branch. Each outward \`gh\` call carries a stable
idempotency key (this node's id plus the repo name) so a re-run of this same node never
double-opens a PR. Reports back \`{name, pr_url}\` per repo as \`rad-orc:pr.created\`.
`;

function act(ctx: ActContext): ActResult {
  const repos = readRepos(ctx.data.repos);
  return {
    instructions:
      "Loop inline over this node's own repos and, per repo, run `gh pr create` against that repo's " +
      'base_branch (or resolve the PR already open for its branch) via the run-command capability — one ' +
      "inline loop, never an expansion — each call carrying a stable idempotency key (this node's id plus " +
      'the repo name) so a re-run never double-opens a PR. Report back per repo as `{name, pr_url}` via ' +
      `\`rad-orc:pr.created\`. Repos: ${repos.map((repo) => repo.name).join(', ') || '(none seeded)'}.`,
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
};

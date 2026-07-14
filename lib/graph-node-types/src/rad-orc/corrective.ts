import type {
  ActContext,
  ActResult,
  AgentSpawnRequest,
  DataSchema,
  HandleResult,
  NodeEvent,
  NodeStatus,
  NodeTypeDefinition,
  Presentation,
} from '@rad-orchestration/graph-engine';
import { TASK_COMPLETED_TOKEN } from './task.js';
import type { TaskCompletedData } from './task.js';

/** One repo target as seeded on this node's own `data.repos` — mirrors `task.ts`'s own `TaskRepoRef`. */
interface CorrectiveRepoRef {
  readonly name: string;
  readonly path: string;
  readonly branch: string;
}

function readComplexity(value: unknown): 'simple' | 'standard' | 'complex' {
  return value === 'simple' || value === 'complex' ? value : 'standard';
}

function readRepos(value: unknown): readonly CorrectiveRepoRef[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null)
    .map((entry) => ({
      name: typeof entry.name === 'string' ? entry.name : '',
      path: typeof entry.path === 'string' ? entry.path : '',
      branch: typeof entry.branch === 'string' ? entry.branch : '',
    }));
}

export const CORRECTIVE_DATA_SCHEMA: DataSchema = {
  handoffDocPath: {
    kind: 'string',
    level: 'required',
    description: "This attempt's own handoff doc — the same scope contract the chain's original attempt carried.",
  },
  repos: {
    kind: 'array',
    level: 'required',
    description: 'The `{name, path, branch}` repo set this corrective attempt works against.',
  },
  complexity: {
    kind: 'string',
    level: 'required',
    description: "This attempt's declared complexity — 'simple' | 'standard' | 'complex'.",
  },
  shouldCommit: {
    kind: 'boolean',
    level: 'required',
    description: 'Whether the coder is directed to commit (and push) its own work once done.',
  },
  reviewReportPath: {
    kind: 'string',
    level: 'required',
    description: 'The one running review report this attempt self-mediates into — always present, unlike an original task.',
  },
  correctiveIndex: {
    kind: 'number',
    level: 'required',
    description: "This attempt's 1-based position in the corrective chain gating its review.",
  },
  completed: {
    kind: 'boolean',
    level: 'computed',
    description: 'Whether the coder spawn has reported back.',
  },
  results: {
    kind: 'array',
    level: 'computed',
    description: "The coder's own per-repo `{name, committed, commitHash, pushed}` results.",
  },
};

const PRESENTATION: Presentation = {
  label: 'Corrective',
  description: 'An additive coder attempt born by `add_corrective`, self-mediating the running review report.',
};

const INSTRUCTIONS = `# rad-orc:corrective

An additive coder attempt: born by the engine's own \`add_corrective\` primitive once a
\`rad-orc:code_review\` comes back \`changes_requested\`, \`derivedFrom\` the chain's prior attempt
and carrying the same scope contract (handoff doc, repos, complexity) plus the one running review
report it must self-mediate — fixing and committing genuine findings, or disputing them in place,
never both silently. Reports back on the same \`rad-orc:task.completed\` contract an original
attempt uses; its own completion re-arms the review it answers, dependency-driven, never a routing
request this node issues itself.
`;

function act(ctx: ActContext): ActResult {
  const handoffDoc = typeof ctx.data.handoffDocPath === 'string' ? ctx.data.handoffDocPath : '';
  const reviewReportPath = typeof ctx.data.reviewReportPath === 'string' ? ctx.data.reviewReportPath : '';
  const correctiveIndex = typeof ctx.data.correctiveIndex === 'number' ? ctx.data.correctiveIndex : undefined;

  const payload: AgentSpawnRequest = {
    kind: 'coder',
    handoffDoc,
    complexity: readComplexity(ctx.data.complexity),
    repos: readRepos(ctx.data.repos),
    shouldCommit: ctx.data.shouldCommit === true,
    reviewReportPath,
    correctiveIndex,
  };

  return {
    instructions:
      "Spawn the coder sub-agent via the spawn-agent capability, carrying this attempt's handoff scope plus " +
      'the running review report path, so it can self-mediate the prior findings (fix-and-commit, or dispute ' +
      'into the same report) — then feed its per-repo commit results back as `rad-orc:task.completed`.',
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

export const CORRECTIVE_NODE_TYPE: NodeTypeDefinition = {
  name: 'rad-orc:corrective',
  dataSchema: CORRECTIVE_DATA_SCHEMA,
  traits: [],
  capabilities: ['doc-read', 'git-facts', 'spawn-agent'],
  presentation: PRESENTATION,
  instructions: INSTRUCTIONS,
  act,
  handle,
  projectStatus,
  completionToken: TASK_COMPLETED_TOKEN,
};

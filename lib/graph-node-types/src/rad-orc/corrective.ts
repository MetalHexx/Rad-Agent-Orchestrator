import type {
  ActContext,
  ActResult,
  CompletionPayloadSchema,
  DataSchema,
  HandleResult,
  NodeEvent,
  NodeStatus,
  NodeTypeDefinition,
  Presentation,
} from '@rad-orchestration/graph-engine';
import { TASK_COMPLETED_TOKEN } from './task.js';
import type { TaskCompletedData } from './task.js';
import { resolveCoderAgent } from './agent-tier.js';

function readComplexity(value: unknown): 'simple' | 'standard' | 'complex' {
  return value === 'simple' || value === 'complex' ? value : 'standard';
}

function readRepos(value: unknown): readonly Readonly<Record<string, unknown>>[] {
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
    resolve: 'project-doc-path',
    description: "This attempt's own handoff doc — the same scope contract the chain's original attempt carried.",
  },
  repos: {
    kind: 'array',
    level: 'required',
    resolve: 'worktree-repo-set',
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
    resolve: 'project-doc-path',
    description: 'The one running review report this attempt self-mediates into — always present, unlike an original task.',
  },
  correctiveIndex: {
    kind: 'number',
    level: 'required',
    description: "This attempt's 1-based position in the corrective chain gating its review.",
  },
  maxRetries: {
    kind: 'number',
    level: 'computed',
    description: 'The retry budget the add_corrective primitive stamps — never seeded by a template.',
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

const INSTRUCTIONS = [
  'Implement this task by following the `rad-execute-coding-task` skill.',
  '',
  'The task handoff at `handoff_doc` is self-contained — read it and implement it. Work in the',
  'worktree given for each entry in `repos`, on the branch named there. This attempt also carries',
  '`review_report_path`, the running review report to self-mediate: fix and commit genuine',
  'findings, or write a justified disposition into that same report for anything you dispute —',
  'never both silently. When `should_commit` is true, commit your own work per the',
  '`rad-source-control` skill before reporting back.',
  '',
  'Report per-repo results as `rad-orc:task.completed`.',
].join('\n');

const COMPLETION_PAYLOAD_SCHEMA: CompletionPayloadSchema = [
  { name: 'repos', flag: false },
  { name: 'branch', flag: true },
];

function act(ctx: ActContext): ActResult {
  const correctiveIndex = typeof ctx.data.correctiveIndex === 'number' ? ctx.data.correctiveIndex : undefined;
  const maxRetries = typeof ctx.data.maxRetries === 'number' ? ctx.data.maxRetries : undefined;

  return {
    executor: 'spawn-sub-agent',
    payload: {
      agent: resolveCoderAgent({ complexity: readComplexity(ctx.data.complexity), correctiveIndex, maxRetries }),
      handoff_doc: typeof ctx.data.handoffDocPath === 'string' ? ctx.data.handoffDocPath : '',
      repos: readRepos(ctx.data.repos),
      should_commit: ctx.data.shouldCommit === true,
      review_report_path: typeof ctx.data.reviewReportPath === 'string' ? ctx.data.reviewReportPath : '',
      corrective_index: correctiveIndex,
    },
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
  completionPayloadSchema: COMPLETION_PAYLOAD_SCHEMA,
};

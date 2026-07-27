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
    resolve: 'project-doc-path',
    description: 'Path to this task\'s authored handoff doc, seeded by explosion\'s parse of the master plan.',
  },
  repos: {
    kind: 'array',
    level: 'required',
    resolve: 'worktree-repo-set',
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
    resolve: 'project-doc-path',
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

const INSTRUCTIONS = [
  'Implement this task by following the `rad-execute-coding-task` skill.',
  '',
  'The task handoff at `handoff_doc` is self-contained — read it and implement it. Work in the',
  'worktree given for each entry in `repos`, on the branch named there. When `should_commit` is',
  'true, commit your own work per the `rad-source-control` skill before reporting back.',
  '',
  'Report per-repo results as `rad-orc:task.completed`.',
].join('\n');

const COMPLETION_PAYLOAD_SCHEMA: CompletionPayloadSchema = [
  { name: 'repos', flag: false },
  { name: 'branch', flag: true },
];

function act(ctx: ActContext): ActResult {
  return {
    executor: 'spawn-sub-agent',
    payload: {
      agent: resolveCoderAgent({ complexity: readComplexity(ctx.data.complexity) }), // no correctiveIndex — never escalate a first dispatch
      handoff_doc: typeof ctx.data.handoffDocPath === 'string' ? ctx.data.handoffDocPath : '',
      repos: readRepos(ctx.data.repos),
      should_commit: ctx.data.shouldCommit === true,
      ...(typeof ctx.data.reviewReportPath === 'string' ? { review_report_path: ctx.data.reviewReportPath } : {}),
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
  completionPayloadSchema: COMPLETION_PAYLOAD_SCHEMA,
};

// The `/engine-graph/*` route surface, against the package's own production composition root
// (`compose()` + `buildApp()`, real SQLite, `app.request()` — no socket). Covers each route's
// shape and rejection path; acyclicity/readiness themselves are the engine's own suites (skipped
// here per the handoff's own testing guidance).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DagEdge, DagNode, NodeTypeDefinition } from '@rad-orchestration/graph-engine';
import { ROOT_NODE_ID } from '@rad-orchestration/graph-engine';
import { BUILT_IN_NODE_TYPES } from '@rad-orchestration/graph-node-types';
import { afterEach, describe, expect, it } from 'vitest';
import { compose } from '../../src/compose.js';
import { buildApp } from '../../src/http/app.js';

interface EnvelopeBody<T> {
  readonly ok: boolean;
  readonly data?: T;
  readonly error?: { readonly code: string; readonly message: string };
}

/** The uniform, node-agnostic read shape every route now returns — the generic node relayed
 * verbatim plus the `presentation` the service attaches from the type definition. No per-type slot. */
interface NodeViewBody {
  readonly id: string;
  readonly type: string;
  readonly status: string;
  readonly parent: string | null;
  readonly data: Record<string, unknown>;
  readonly presentation: { readonly label: string; readonly description?: string };
}

function buildTestService(projectRoot?: string) {
  const service = compose(
    projectRoot
      ? { dbPath: ':memory:', builtInNodeTypes: BUILT_IN_NODE_TYPES, projectRoot }
      : { dbPath: ':memory:', builtInNodeTypes: BUILT_IN_NODE_TYPES },
  );
  return { service, app: buildApp(service) };
}

/** Real-filesystem project roots minted for a real-`docRead`/`docWrite` scenario — swept up after every test. */
const tempProjectRoots: string[] = [];

function makeTempProjectRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-service-engine-graph-'));
  tempProjectRoots.push(root);
  return root;
}

afterEach(() => {
  while (tempProjectRoots.length > 0) {
    const root = tempProjectRoots.pop();
    if (root) fs.rmSync(root, { recursive: true, force: true });
  }
});

function postJson(app: ReturnType<typeof buildApp>, path: string, body: unknown) {
  return app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const TASK_DATA = {
  handoffDocPath: 'tasks/task-1.md',
  // No `path` seeded here — the generic field resolver fills it fresh off a real `WorktreeRecord`
  // (`service.portfolio.addWorktree`), never a stored absolute path.
  repos: [{ name: 'rad-orc-source', branch: 'radorch/STEERABLE-DAG-2.3' }],
  complexity: 'simple' as const,
  shouldCommit: true,
};

/** Seeds `task-1` (`rad-orc:task`) -> `approval-1` (`rad-orc:approval`) via `/engine-graph/seed`. */
async function seedTaskAndApproval(app: ReturnType<typeof buildApp>, project: string) {
  const res = await postJson(app, '/engine-graph/seed', {
    project,
    seed: {
      steps: [
        { primitive: 'add_node', id: 'task-1', type: 'rad-orc:task', parent: ROOT_NODE_ID, data: TASK_DATA },
        { primitive: 'add_node', id: 'approval-1', type: 'rad-orc:approval', parent: ROOT_NODE_ID, data: { level: 'plan' } },
        { primitive: 'add_dependency', from: 'task-1', to: 'approval-1' },
      ],
    },
  });
  expect(res.status).toBe(200);
  return res;
}

describe('POST /engine-graph/seed', () => {
  it('replays add_node/add_dependency to stamp a small graph, reports a summary, and creates the cross-store portfolio project', async () => {
    const { service, app } = buildTestService();
    const res = await seedTaskAndApproval(app, 'proj-seed');

    const body = (await res.json()) as EnvelopeBody<{ nodesCreated: number; edgesCreated: number }>;
    expect(body.ok).toBe(true);
    expect(body.data).toEqual({ nodesCreated: 2, edgesCreated: 1 });

    const project = service.portfolio.getProject('proj-seed');
    expect(project?.id).toBe('proj-seed');
    expect(project?.createdAt).toEqual(expect.any(String));
  });

  it('is idempotent against an already-real portfolio project (create-if-absent, never a duplicate rejection)', async () => {
    const { app } = buildTestService();
    await seedTaskAndApproval(app, 'proj-seed-twice');

    const res = await postJson(app, '/engine-graph/seed', {
      project: 'proj-seed-twice',
      seed: { steps: [{ primitive: 'add_node', id: 'task-2', type: 'rad-orc:task', parent: ROOT_NODE_ID, data: TASK_DATA }] },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as EnvelopeBody<{ nodesCreated: number }>;
    expect(body.data).toEqual({ nodesCreated: 1, edgesCreated: 0 });
  });

  it('rejects a missing project with a structured 400 envelope', async () => {
    const { app } = buildTestService();
    const res = await postJson(app, '/engine-graph/seed', { seed: { steps: [] } });
    expect(res.status).toBe(400);
    const body = (await res.json()) as EnvelopeBody<never>;
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe('invalid_request');
  });
});

describe('GET /engine-graph/dag', () => {
  it('round-trips a seeded graph — nodes, edges, and a frontier reflecting readiness', async () => {
    const { app } = buildTestService();
    await seedTaskAndApproval(app, 'proj-dag');

    const res = await app.request('/engine-graph/dag?project=proj-dag');
    expect(res.status).toBe(200);
    const body = (await res.json()) as EnvelopeBody<{
      nodes: NodeViewBody[];
      edges: DagEdge[];
      frontier: NodeViewBody[];
      status: string;
    }>;
    expect(body.ok).toBe(true);
    const data = body.data!;

    expect(data.nodes.map((n) => n.id).sort()).toEqual([ROOT_NODE_ID, 'approval-1', 'task-1'].sort());
    expect(data.edges).toEqual([{ from: 'task-1', to: 'approval-1', kind: 'depends_on' }]);
    // approval-1 gates on task-1, which hasn't run yet — only task-1 is frontier-eligible.
    expect(data.frontier.map((n) => n.id)).toEqual(['task-1']);
    expect(data.status).toBe('in_progress');

    // Uniform node-agnostic shape: `presentation` is relayed from the type definition (never
    // authored by the service), alongside the generic structural slots the read still carries.
    const task = data.nodes.find((n) => n.id === 'task-1')!;
    expect(task.presentation.label).toEqual(expect.any(String));
    expect(task.parent).toBe(ROOT_NODE_ID);
  });

  it('rejects a missing project with a structured 400 envelope', async () => {
    const { app } = buildTestService();
    const res = await app.request('/engine-graph/dag');
    expect(res.status).toBe(400);
    const body = (await res.json()) as EnvelopeBody<never>;
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe('invalid_request');
  });
});

describe('GET /engine-graph/frontier', () => {
  it("reads one container's own readiness via the driver-facing readFrontier read", async () => {
    const { app } = buildTestService();
    await seedTaskAndApproval(app, 'proj-frontier');

    const res = await app.request(`/engine-graph/frontier?project=proj-frontier&context=${ROOT_NODE_ID}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as EnvelopeBody<DagNode[]>;
    expect(body.data?.map((n) => n.id)).toEqual(['task-1']);
  });

  it("rejects a missing 'context' with a structured 400 envelope", async () => {
    const { app } = buildTestService();
    const res = await app.request('/engine-graph/frontier?project=proj-frontier-missing-context');
    expect(res.status).toBe(400);
    const body = (await res.json()) as EnvelopeBody<never>;
    expect(body.error?.code).toBe('invalid_request');
  });
});

describe('GET /engine-graph/node', () => {
  it('returns one node by id', async () => {
    const { app } = buildTestService();
    await seedTaskAndApproval(app, 'proj-node');

    const res = await app.request('/engine-graph/node?project=proj-node&node=task-1');
    expect(res.status).toBe(200);
    const body = (await res.json()) as EnvelopeBody<NodeViewBody>;
    expect(body.data?.id).toBe('task-1');
    expect(body.data?.type).toBe('rad-orc:task');
    // Same uniform shape as every other route: the type's own presentation is relayed.
    expect(body.data?.presentation.label).toEqual(expect.any(String));
    expect(body.data?.parent).toBe(ROOT_NODE_ID);
  });

  it('returns a structured 404 for a node that does not exist', async () => {
    const { app } = buildTestService();
    await seedTaskAndApproval(app, 'proj-node-missing');

    const res = await app.request('/engine-graph/node?project=proj-node-missing&node=nope');
    expect(res.status).toBe(404);
    const body = (await res.json()) as EnvelopeBody<never>;
    expect(body.error?.code).toBe('not_found');
  });
});

interface NextActionEnvelopeBody {
  readonly action: string | null;
  readonly node: string | null;
  readonly executor: string | null;
  readonly instructions: string | null;
  readonly context: Record<string, unknown> | null;
  readonly completion_event: string | null;
  readonly completion_payload_schema: readonly { readonly name: string; readonly flag: boolean }[] | null;
  readonly delta: { nodeChanges: unknown[] };
  readonly frontier: DagNode[];
}

describe('POST /engine-graph/submit-event', () => {
  it('with no event, a deterministic drive auto-resolves nothing here (task-1 is spawn-sub-agent) and stops at it, surfacing the next-action envelope rather than faking the agent work', async () => {
    const { service, app } = buildTestService();
    await seedTaskAndApproval(app, 'proj-submit');
    // task-1's own engage resolves its declared fields — a real worktree record for the repo its
    // `repos` entry names must exist first.
    service.portfolio.addWorktree({ projectId: 'proj-submit', repo: 'rad-orc-source' }, null);

    const res = await postJson(app, '/engine-graph/submit-event', { project: 'proj-submit', node: 'task-1' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as EnvelopeBody<NextActionEnvelopeBody>;
    expect(body.ok).toBe(true);
    const data = body.data!;
    expect(data.action).toBe('rad-orc:task');
    expect(data.node).toBe('task-1');
    expect(data.executor).toBe('spawn-sub-agent');
    expect(data.instructions).toEqual(expect.any(String));
    expect(data.completion_event).toBe('rad-orc:task.completed');
    expect(data.completion_payload_schema).toEqual([
      { name: 'repos', flag: false },
      { name: 'branch', flag: true },
    ]);
    expect(data.delta.nodeChanges.length).toBeGreaterThan(0);
    // task-1 only reached in_progress (engaged, never faked done) — approval-1 stays gated.
    expect(data.frontier).toEqual([]);

    // The wiring seam this task exists for: the resolved `context` carries absolute paths under
    // this service's own `root`, never the seeded project-relative/bare values verbatim.
    const context = data.context as {
      readonly handoff_doc: string;
      readonly repos: readonly { readonly name: string; readonly path: string; readonly branch: string }[];
    };
    expect(context.handoff_doc).toBe(path.join(service.root, 'projects', 'proj-submit', 'tasks', 'task-1.md'));
    expect(context.repos).toEqual([
      { name: 'rad-orc-source', path: path.join(service.root, 'worktrees', 'proj-submit', 'rad-orc-source'), branch: 'radorch/STEERABLE-DAG-2.3' },
    ]);

    const nodeRes = await app.request('/engine-graph/node?project=proj-submit&node=task-1');
    const nodeBody = (await nodeRes.json()) as EnvelopeBody<DagNode>;
    expect(nodeBody.data?.status).toBe('in_progress');
  });

  it('with event+payload, the client dictates the outcome directly, then the drive resumes and returns the next actor node — one call relays a result and gets the next move', async () => {
    const { app } = buildTestService();
    await seedTaskAndApproval(app, 'proj-submit-event');

    const res = await postJson(app, '/engine-graph/submit-event', {
      project: 'proj-submit-event',
      node: 'task-1',
      event: 'rad-orc:task.completed',
      payload: { outcome: 'ok', data: { results: [{ name: 'rad-orc-source', committed: true, commitHash: 'abc123', pushed: true }] } },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as EnvelopeBody<NextActionEnvelopeBody>;
    expect(body.ok).toBe(true);
    const data = body.data!;
    // task-1 reaching done unblocked approval-1 (request-human) — the drive stopped there.
    expect(data.action).toBe('rad-orc:approval');
    expect(data.node).toBe('approval-1');
    expect(data.executor).toBe('request-human');
    expect(data.completion_event).toBe('rad-orc:approval.decided');

    const taskRes = await app.request('/engine-graph/node?project=proj-submit-event&node=task-1');
    const taskBody = (await taskRes.json()) as EnvelopeBody<DagNode>;
    expect(taskBody.data?.status).toBe('done');
    expect(taskBody.data?.data.results).toEqual([{ name: 'rad-orc-source', committed: true, commitHash: 'abc123', pushed: true }]);

    const approvalRes = await app.request('/engine-graph/node?project=proj-submit-event&node=approval-1');
    const approvalBody = (await approvalRes.json()) as EnvelopeBody<DagNode>;
    expect(approvalBody.data?.status).toBe('in_progress');
  });

  it('reports completion_event: null once relaying a result drives the graph to full quiescence', async () => {
    const { app } = buildTestService();
    await postJson(app, '/engine-graph/seed', {
      project: 'proj-submit-quiescence',
      seed: { steps: [{ primitive: 'add_node', id: 'task-1', type: 'rad-orc:task', parent: ROOT_NODE_ID, data: TASK_DATA }] },
    });

    const res = await postJson(app, '/engine-graph/submit-event', {
      project: 'proj-submit-quiescence',
      node: 'task-1',
      event: 'rad-orc:task.completed',
      payload: { outcome: 'ok', data: { results: [] } },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as EnvelopeBody<NextActionEnvelopeBody>;
    expect(body.ok).toBe(true);
    expect(body.data).toEqual({
      action: null,
      node: null,
      executor: null,
      instructions: null,
      context: null,
      completion_event: null,
      completion_payload_schema: null,
      delta: body.data!.delta,
      frontier: [],
    });

    const nodeRes = await app.request('/engine-graph/node?project=proj-submit-quiescence&node=task-1');
    const nodeBody = (await nodeRes.json()) as EnvelopeBody<DagNode>;
    expect(nodeBody.data?.status).toBe('done');
  });

  it('rejects an illegal relayed outcome as a structured rejection, never a 500', async () => {
    const { app } = buildTestService();
    await postJson(app, '/engine-graph/seed', {
      project: 'proj-submit-illegal',
      seed: { steps: [{ primitive: 'add_node', id: 'approval-1', type: 'rad-orc:approval', parent: ROOT_NODE_ID, data: { level: 'plan' } }] },
    });

    // A plan-level 'denied' decision requires `masterPlanNodeId` on the envelope — omitting it is
    // an illegal outcome the node type's own `handle` rejects.
    const res = await postJson(app, '/engine-graph/submit-event', {
      project: 'proj-submit-illegal',
      node: 'approval-1',
      event: 'rad-orc:approval.decided',
      payload: { outcome: 'ok', data: { decision: 'denied', level: 'plan' } },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as EnvelopeBody<never>;
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe('invalid_delta');

    const nodeRes = await app.request('/engine-graph/node?project=proj-submit-illegal&node=approval-1');
    const nodeBody = (await nodeRes.json()) as EnvelopeBody<DagNode>;
    expect(nodeBody.data?.status).toBe('not_started');
  });

  it('returns a structured 404 for a node that does not exist, never a throw', async () => {
    const { app } = buildTestService();
    await seedTaskAndApproval(app, 'proj-submit-missing');

    const res = await postJson(app, '/engine-graph/submit-event', { project: 'proj-submit-missing', node: 'nope' });
    expect(res.status).toBe(404);
    const body = (await res.json()) as EnvelopeBody<never>;
    expect(body.error?.code).toBe('not_found');
  });

  it('drives from a seeded graph past the deterministic rad-orc:explosion node itself, stopping at the next spawn-sub-agent/request-human node — never faking the agent work', async () => {
    const projectRoot = makeTempProjectRoot();
    fs.mkdirSync(path.join(projectRoot, 'docs', 'master-plan'), { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, 'docs', 'master-plan', 'master-plan.md'),
      [
        '# Master Plan',
        '',
        '## Phase 1: Foundation',
        'Doc: docs/phases/phase-1.md',
        'Exit Criteria:',
        '- Foundations laid',
        '',
        '### Task 1: Scaffold the module',
        '',
      ].join('\n'),
      'utf8',
    );
    const { app } = buildTestService(projectRoot);

    await postJson(app, '/engine-graph/seed', {
      project: 'proj-submit-explosion',
      seed: {
        steps: [
          { primitive: 'add_node', id: 'explosion', type: 'rad-orc:explosion', parent: ROOT_NODE_ID, data: { cadence: { perTask: [], perPhase: [], spine: [] } } },
          {
            primitive: 'add_node',
            id: 'master-plan',
            type: 'rad-orc:master_plan',
            parent: ROOT_NODE_ID,
            data: { docPath: 'docs/master-plan/master-plan.md' },
            dependsOn: ['explosion'],
          },
          { primitive: 'add_node', id: 'plan-approval', type: 'rad-orc:approval', parent: ROOT_NODE_ID, data: { level: 'plan' }, dependsOn: ['explosion'] },
        ],
      },
    });

    const res = await postJson(app, '/engine-graph/submit-event', { project: 'proj-submit-explosion', node: 'explosion' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as EnvelopeBody<NextActionEnvelopeBody>;
    expect(body.ok).toBe(true);
    // explosion resolved itself in-service (real doc-read/doc-write) — no spawn-sub-agent firing here.
    expect(body.data!.node).toBe('master-plan');
    expect(body.data!.action).toBe('rad-orc:master_plan');
    expect(body.data!.executor).toBe('orchestrator-inline');

    const explosionRes = await app.request('/engine-graph/node?project=proj-submit-explosion&node=explosion');
    const explosionBody = (await explosionRes.json()) as EnvelopeBody<DagNode>;
    expect(explosionBody.data?.status).toBe('done');
  });

  it("a rad-orc:code_review completion ignores the caller's own verdict, re-deriving it off the report's real frontmatter", async () => {
    const projectRoot = makeTempProjectRoot();
    fs.mkdirSync(path.join(projectRoot, 'reviews'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, 'reviews', 'review-1.md'), '---\nverdict: approved\nseverity: none\n---\n\n# Review Report\n', 'utf8');
    const { app } = buildTestService(projectRoot);

    await postJson(app, '/engine-graph/seed', {
      project: 'proj-submit-review-verdict',
      seed: {
        steps: [
          {
            primitive: 'add_node',
            id: 'review-1',
            type: 'rad-orc:code_review',
            parent: ROOT_NODE_ID,
            data: { level: 'task', reviewReportPath: 'reviews/review-1.md', repos: [] },
          },
        ],
      },
    });

    // The caller lies about the verdict — the report itself says `approved`.
    const res = await postJson(app, '/engine-graph/submit-event', {
      project: 'proj-submit-review-verdict',
      node: 'review-1',
      event: 'rad-orc:code_review.reviewed',
      payload: { outcome: 'ok', data: { verdict: 'changes_requested', severity: 'high' } },
    });
    expect(res.status).toBe(200);

    const reviewRes = await app.request('/engine-graph/node?project=proj-submit-review-verdict&node=review-1');
    const reviewBody = (await reviewRes.json()) as EnvelopeBody<DagNode>;
    // The service's own doc-read won — never the caller-supplied envelope.
    expect(reviewBody.data?.data.verdict).toBe('approved');
    expect(reviewBody.data?.status).toBe('done');

    const correctiveRes = await app.request('/engine-graph/node?project=proj-submit-review-verdict&node=review-1-corrective-1');
    expect(correctiveRes.status).toBe(404);
  });

  it('a resolution refusal (a repo field naming a repo with no registered worktree) returns a structured 400 with the resolver message intact, never a thrown 500 — and the node stays not_started', async () => {
    const { app } = buildTestService();
    await postJson(app, '/engine-graph/seed', {
      project: 'proj-submit-unresolvable',
      seed: {
        steps: [
          {
            primitive: 'add_node',
            id: 'task-1',
            type: 'rad-orc:task',
            parent: ROOT_NODE_ID,
            // No worktree ever registered for 'rad-orc-source' on this project — the repo field
            // cannot resolve.
            data: TASK_DATA,
          },
        ],
      },
    });

    const res = await postJson(app, '/engine-graph/submit-event', { project: 'proj-submit-unresolvable', node: 'task-1' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as EnvelopeBody<never>;
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe('invalid_delta');
    expect(body.error?.message).toMatch(/no worktree record for repo 'rad-orc-source'/);

    const nodeRes = await app.request('/engine-graph/node?project=proj-submit-unresolvable&node=task-1');
    const nodeBody = (await nodeRes.json()) as EnvelopeBody<DagNode>;
    expect(nodeBody.data?.status).toBe('not_started');
  });
});

/** A bespoke custom node type the service knows nothing of: it stops at an external actor and
 * declares its own completion token, so the envelope must source that token from the definition
 * (never a service-held map) and the read view must relay the type's own presentation. */
function customWidgetType(): NodeTypeDefinition {
  return {
    name: 'example:widget',
    dataSchema: {},
    traits: [],
    capabilities: ['request-human'],
    presentation: { label: 'Widget', description: 'A bespoke widget node' },
    instructions: '# widget',
    act: () => ({ instructions: 'build the widget by hand', executor: 'request-human' }),
    handle: () => ({}),
    projectStatus: () => 'not_started',
    completionToken: 'example:widget.built',
  };
}

describe('node-agnostic custom types', () => {
  it("sources a custom node's completion_event from its own declared token and relays its own presentation — zero service-side type knowledge", async () => {
    const service = compose({ dbPath: ':memory:', builtInNodeTypes: BUILT_IN_NODE_TYPES, customNodeTypes: [customWidgetType()] });
    const app = buildApp(service);

    await postJson(app, '/engine-graph/seed', {
      project: 'proj-custom',
      seed: { steps: [{ primitive: 'add_node', id: 'widget-1', type: 'example:widget', parent: ROOT_NODE_ID, data: { size: 'large' } }] },
    });

    const res = await postJson(app, '/engine-graph/submit-event', { project: 'proj-custom', node: 'widget-1' });
    expect(res.status).toBe(200);
    const data = ((await res.json()) as EnvelopeBody<NextActionEnvelopeBody>).data!;
    // The completion token travels on the definition — the service holds no node-type -> token map.
    expect(data.action).toBe('example:widget');
    expect(data.node).toBe('widget-1');
    expect(data.executor).toBe('request-human');
    expect(data.instructions).toBe('# widget');
    expect(data.completion_event).toBe('example:widget.built');
    // No completionPayloadSchema declared on this type — relayed as null, never a crash.
    expect(data.completion_payload_schema).toBeNull();

    // The read view relays the type's own presentation and its opaque data verbatim — no absent
    // generic slot the service could have filled, no per-type knowledge required.
    const nodeRes = await app.request('/engine-graph/node?project=proj-custom&node=widget-1');
    const nodeBody = (await nodeRes.json()) as EnvelopeBody<NodeViewBody>;
    expect(nodeBody.data?.presentation).toEqual({ label: 'Widget', description: 'A bespoke widget node' });
    expect(nodeBody.data?.data).toEqual({ size: 'large' });
    expect(nodeBody.data?.parent).toBe(ROOT_NODE_ID);
  });

  it('relays instructions: null for a type declaring none, rather than crashing on the absent field', async () => {
    const mute: NodeTypeDefinition = {
      name: 'example:mute',
      dataSchema: {},
      traits: [],
      capabilities: ['request-human'],
      presentation: { label: 'Mute' },
      // Deliberately no `instructions` declared.
      act: () => ({ executor: 'request-human' }),
      handle: () => ({}),
      projectStatus: () => 'not_started',
    };
    const service = compose({ dbPath: ':memory:', builtInNodeTypes: BUILT_IN_NODE_TYPES, customNodeTypes: [mute] });
    const app = buildApp(service);

    await postJson(app, '/engine-graph/seed', {
      project: 'proj-mute',
      seed: { steps: [{ primitive: 'add_node', id: 'mute-1', type: 'example:mute', parent: ROOT_NODE_ID, data: {} }] },
    });

    const res = await postJson(app, '/engine-graph/submit-event', { project: 'proj-mute', node: 'mute-1' });
    expect(res.status).toBe(200);
    const data = ((await res.json()) as EnvelopeBody<NextActionEnvelopeBody>).data!;
    expect(data.action).toBe('example:mute');
    expect(data.instructions).toBeNull();
    expect(data.completion_event).toBeNull();
    expect(data.completion_payload_schema).toBeNull();
  });
});

describe('POST /engine-graph/steer', () => {
  it('add_dependency reshapes the graph', async () => {
    const { app } = buildTestService();
    await postJson(app, '/engine-graph/seed', {
      project: 'proj-steer-add-dep',
      seed: {
        steps: [
          { primitive: 'add_node', id: 'a', type: 'rad-orc:task', parent: ROOT_NODE_ID, data: TASK_DATA },
          { primitive: 'add_node', id: 'b', type: 'rad-orc:approval', parent: ROOT_NODE_ID, data: { level: 'plan' } },
        ],
      },
    });

    const res = await postJson(app, '/engine-graph/steer', {
      project: 'proj-steer-add-dep',
      primitive: 'add_dependency',
      params: { from: 'a', to: 'b' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as EnvelopeBody<{ nodeChanges: unknown[]; edgeChanges: unknown[] }>;
    expect(body.ok).toBe(true);
    expect(body.data?.edgeChanges).toHaveLength(1);

    const dagRes = await app.request('/engine-graph/dag?project=proj-steer-add-dep');
    const dagBody = (await dagRes.json()) as EnvelopeBody<{ edges: DagEdge[] }>;
    expect(dagBody.data?.edges).toEqual([{ from: 'a', to: 'b', kind: 'depends_on' }]);
  });

  it('rejects an illegal mutation (a would-be cycle) as a structured rejection, not a 500', async () => {
    const { app } = buildTestService();
    await postJson(app, '/engine-graph/seed', {
      project: 'proj-steer-cycle',
      seed: {
        steps: [
          { primitive: 'add_node', id: 'a', type: 'rad-orc:task', parent: ROOT_NODE_ID, data: TASK_DATA },
          { primitive: 'add_node', id: 'b', type: 'rad-orc:approval', parent: ROOT_NODE_ID, data: { level: 'plan' } },
          { primitive: 'add_dependency', from: 'a', to: 'b' },
        ],
      },
    });

    const res = await postJson(app, '/engine-graph/steer', {
      project: 'proj-steer-cycle',
      primitive: 'add_dependency',
      params: { from: 'b', to: 'a' },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as EnvelopeBody<never>;
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe('cycle');
  });

  it('rejects an unknown primitive value with a structured error, never a throw', async () => {
    const { app } = buildTestService();
    const res = await postJson(app, '/engine-graph/steer', {
      project: 'proj-steer-unknown',
      primitive: 'not_a_real_primitive',
      params: {},
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as EnvelopeBody<never>;
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe('invalid_request');
  });

  it('rejects the driver-contract primitives apply_event/engage — they are not part of the steer allowlist', async () => {
    const { app } = buildTestService();
    const res = await postJson(app, '/engine-graph/steer', {
      project: 'proj-steer-driver-contract',
      primitive: 'apply_event',
      params: { node: 'task-1', event: 'x' },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as EnvelopeBody<never>;
    expect(body.error?.code).toBe('invalid_request');
  });

  it('core-opacity: add_node with an arbitrary opaque data blob is stored and round-tripped unread', async () => {
    const { app } = buildTestService();
    await postJson(app, '/engine-graph/seed', { project: 'proj-steer-opaque', seed: { steps: [] } });

    const opaqueData = { nested: { anything: [1, 2, 3] }, weird_key: true, note: 'never read by core' };
    const res = await postJson(app, '/engine-graph/steer', {
      project: 'proj-steer-opaque',
      primitive: 'add_node',
      params: { id: 'opaque-1', type: 'rad-orc:approval', parent: ROOT_NODE_ID, options: { data: opaqueData } },
    });
    expect(res.status).toBe(200);

    const nodeRes = await app.request('/engine-graph/node?project=proj-steer-opaque&node=opaque-1');
    const nodeBody = (await nodeRes.json()) as EnvelopeBody<DagNode>;
    expect(nodeBody.data?.data).toEqual(opaqueData);
  });
});

describe('POST /engine-graph/dry-run', () => {
  it('returns valid + preview without writing — the change_log row count is untouched', async () => {
    const { service, app } = buildTestService();
    await postJson(app, '/engine-graph/seed', {
      project: 'proj-dry-run',
      seed: {
        steps: [
          { primitive: 'add_node', id: 'a', type: 'rad-orc:task', parent: ROOT_NODE_ID, data: TASK_DATA },
          { primitive: 'add_node', id: 'b', type: 'rad-orc:approval', parent: ROOT_NODE_ID, data: { level: 'plan' } },
        ],
      },
    });

    const before = (service.db.prepare('SELECT COUNT(*) AS c FROM change_log').get() as { c: number }).c;

    const res = await postJson(app, '/engine-graph/dry-run', {
      project: 'proj-dry-run',
      mutation: { kind: 'add_dependency', from: 'a', to: 'b' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as EnvelopeBody<{ valid: boolean; preview: { edges: DagEdge[] } }>;
    expect(body.data?.valid).toBe(true);
    expect(body.data?.preview.edges).toEqual([{ from: 'a', to: 'b', kind: 'depends_on' }]);

    const after = (service.db.prepare('SELECT COUNT(*) AS c FROM change_log').get() as { c: number }).c;
    expect(after).toBe(before);

    const dagRes = await app.request('/engine-graph/dag?project=proj-dry-run');
    const dagBody = (await dagRes.json()) as EnvelopeBody<{ edges: DagEdge[] }>;
    expect(dagBody.data?.edges).toEqual([]);
  });

  it('surfaces an illegal mutation as valid:false with a reason, still writing nothing', async () => {
    const { app } = buildTestService();
    await postJson(app, '/engine-graph/seed', {
      project: 'proj-dry-run-invalid',
      seed: {
        steps: [
          { primitive: 'add_node', id: 'a', type: 'rad-orc:task', parent: ROOT_NODE_ID, data: TASK_DATA },
          { primitive: 'add_node', id: 'b', type: 'rad-orc:approval', parent: ROOT_NODE_ID, data: { level: 'plan' } },
          { primitive: 'add_dependency', from: 'a', to: 'b' },
        ],
      },
    });

    const res = await postJson(app, '/engine-graph/dry-run', {
      project: 'proj-dry-run-invalid',
      mutation: { kind: 'add_dependency', from: 'b', to: 'a' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as EnvelopeBody<{ valid: boolean; reason: string; preview: null }>;
    expect(body.data?.valid).toBe(false);
    expect(body.data?.reason).toEqual(expect.any(String));
    expect(body.data?.preview).toBeNull();
  });
});

describe('steer/dry-run share one pinned mutation request shape', () => {
  it('move_node: the identical {nodeId, newParent} fields dry-run validates are the exact fields steer commits', async () => {
    const { app } = buildTestService();
    await postJson(app, '/engine-graph/seed', {
      project: 'proj-shared-move',
      seed: {
        steps: [
          { primitive: 'add_node', id: 'a', type: 'rad-orc:task', parent: ROOT_NODE_ID, data: TASK_DATA },
          { primitive: 'add_node', id: 'b', type: 'rad-orc:approval', parent: ROOT_NODE_ID, data: { level: 'plan' } },
        ],
      },
    });

    const fields = { nodeId: 'a', newParent: 'b' };

    const dryRunRes = await postJson(app, '/engine-graph/dry-run', {
      project: 'proj-shared-move',
      mutation: { kind: 'move_node', ...fields },
    });
    expect(dryRunRes.status).toBe(200);
    const dryRunBody = (await dryRunRes.json()) as EnvelopeBody<{ valid: boolean }>;
    expect(dryRunBody.data?.valid).toBe(true);

    const steerRes = await postJson(app, '/engine-graph/steer', {
      project: 'proj-shared-move',
      primitive: 'move_node',
      params: fields,
    });
    expect(steerRes.status).toBe(200);
    const steerBody = (await steerRes.json()) as EnvelopeBody<{ nodeChanges: unknown[] }>;
    expect(steerBody.ok).toBe(true);

    const nodeRes = await app.request('/engine-graph/node?project=proj-shared-move&node=a');
    const nodeBody = (await nodeRes.json()) as EnvelopeBody<NodeViewBody>;
    expect(nodeBody.data?.parent).toBe('b');
  });

  it('remove_node: the identical {nodeId, strategy} fields dry-run previews are the exact fields steer commits', async () => {
    const { app } = buildTestService();
    await postJson(app, '/engine-graph/seed', {
      project: 'proj-shared-remove',
      seed: {
        steps: [{ primitive: 'add_node', id: 'a', type: 'rad-orc:task', parent: ROOT_NODE_ID, data: TASK_DATA }],
      },
    });

    const fields = { nodeId: 'a', strategy: { dependents: 'cascade' as const } };

    const dryRunRes = await postJson(app, '/engine-graph/dry-run', {
      project: 'proj-shared-remove',
      mutation: { kind: 'remove_node', ...fields },
    });
    expect(dryRunRes.status).toBe(200);
    const dryRunBody = (await dryRunRes.json()) as EnvelopeBody<{ valid: boolean; preview: { nodeIds: string[] } }>;
    expect(dryRunBody.data?.valid).toBe(true);
    expect(dryRunBody.data?.preview.nodeIds).toEqual(['a']);

    const steerRes = await postJson(app, '/engine-graph/steer', {
      project: 'proj-shared-remove',
      primitive: 'remove_node',
      params: fields,
    });
    expect(steerRes.status).toBe(200);

    const nodeRes = await app.request('/engine-graph/node?project=proj-shared-remove&node=a');
    expect(nodeRes.status).toBe(404);
  });
});

// The `/engine-graph/*` route surface, against the package's own production composition root
// (`compose()` + `buildApp()`, real SQLite, `app.request()` — no socket). Covers each route's
// shape and rejection path; acyclicity/readiness themselves are the engine's own suites (skipped
// here per the handoff's own testing guidance).
import type { DagEdge, DagNode } from '@rad-orchestration/graph-engine';
import { ROOT_NODE_ID } from '@rad-orchestration/graph-engine';
import { describe, expect, it } from 'vitest';
import { compose } from '../../src/compose.js';
import { buildApp } from '../../src/http/app.js';

interface EnvelopeBody<T> {
  readonly ok: boolean;
  readonly data?: T;
  readonly error?: { readonly code: string; readonly message: string };
}

function buildTestService() {
  const service = compose({ dbPath: ':memory:' });
  return { service, app: buildApp(service) };
}

function postJson(app: ReturnType<typeof buildApp>, path: string, body: unknown) {
  return app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const TASK_DATA = {
  handoffDocPath: '/tasks/task-1.md',
  repos: [{ name: 'rad-orc-source', path: '/repos/rad-orc-source', branch: 'radorch/STEERABLE-DAG-2.3' }],
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
      nodes: DagNode[];
      edges: DagEdge[];
      frontier: DagNode[];
      status: string;
    }>;
    expect(body.ok).toBe(true);
    const data = body.data!;

    expect(data.nodes.map((n) => n.id).sort()).toEqual([ROOT_NODE_ID, 'approval-1', 'task-1'].sort());
    expect(data.edges).toEqual([{ from: 'task-1', to: 'approval-1', kind: 'depends_on' }]);
    // approval-1 gates on task-1, which hasn't run yet — only task-1 is frontier-eligible.
    expect(data.frontier.map((n) => n.id)).toEqual(['task-1']);
    expect(data.status).toBe('in_progress');
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
    const body = (await res.json()) as EnvelopeBody<DagNode>;
    expect(body.data?.id).toBe('task-1');
    expect(body.data?.type).toBe('rad-orc:task');
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

describe('POST /engine-graph/submit-event', () => {
  it('with no event, advances a ready node via the full driver cycle and returns the applied delta + resulting frontier', async () => {
    const { app } = buildTestService();
    await seedTaskAndApproval(app, 'proj-submit');

    const res = await postJson(app, '/engine-graph/submit-event', { project: 'proj-submit', node: 'task-1' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as EnvelopeBody<{ delta: { nodeChanges: unknown[] }; frontier: DagNode[] }>;
    expect(body.ok).toBe(true);
    expect(body.data!.delta.nodeChanges.length).toBeGreaterThan(0);
    // task-1 reaching done unblocks approval-1, which now shows up in the whole-tree frontier.
    expect(body.data!.frontier.map((n) => n.id)).toEqual(['approval-1']);

    const nodeRes = await app.request('/engine-graph/node?project=proj-submit&node=task-1');
    const nodeBody = (await nodeRes.json()) as EnvelopeBody<DagNode>;
    expect(nodeBody.data?.status).toBe('done');
  });

  it('with event+payload, the client dictates the outcome directly rather than engaging + dispatching through a resolver', async () => {
    const { app } = buildTestService();
    await seedTaskAndApproval(app, 'proj-submit-event');

    const engageRes = await postJson(app, '/engine-graph/submit-event', {
      project: 'proj-submit-event',
      node: 'task-1',
      event: 'rad-orc:task.completed',
      payload: { outcome: 'ok', data: { results: [{ name: 'rad-orc-source', committed: true, commitHash: 'abc123', pushed: true }] } },
    });
    expect(engageRes.status).toBe(200);

    const nodeRes = await app.request('/engine-graph/node?project=proj-submit-event&node=task-1');
    const nodeBody = (await nodeRes.json()) as EnvelopeBody<DagNode>;
    expect(nodeBody.data?.status).toBe('done');
    expect(nodeBody.data?.data.results).toEqual([{ name: 'rad-orc-source', committed: true, commitHash: 'abc123', pushed: true }]);
  });

  it('returns a structured 404 for a node that does not exist, never a throw', async () => {
    const { app } = buildTestService();
    await seedTaskAndApproval(app, 'proj-submit-missing');

    const res = await postJson(app, '/engine-graph/submit-event', { project: 'proj-submit-missing', node: 'nope' });
    expect(res.status).toBe(404);
    const body = (await res.json()) as EnvelopeBody<never>;
    expect(body.error?.code).toBe('not_found');
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
    const nodeBody = (await nodeRes.json()) as EnvelopeBody<DagNode>;
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

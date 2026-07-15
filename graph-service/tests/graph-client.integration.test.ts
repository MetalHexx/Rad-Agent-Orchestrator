// graph-service/tests/graph-client.integration.test.ts
//
// The booted-service conformance suite: boots a real graph-service daemon (`harness/boot.ts`) and
// drives it exclusively through the real `@rad-orchestration/graph-client` — never the black-box
// HTTP helper (`harness/drive.ts`) other functional scenarios use. Every assertion targets an
// observable outcome (a returned payload's fields, a thrown `GraphClientError.code`, a delivered
// `StreamDelta`, cross-project isolation) so a drift between the client's hand-authored wire mirror
// (`lib/graph-client/src/types.ts`) and the service's actual response shape fails here first — this
// suite *is* R8's conformance oracle.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ROOT_NODE_ID } from '@rad-orchestration/graph-engine';
import { GraphClient, GraphClientError } from '@rad-orchestration/graph-client';
import type { StreamDelta } from '@rad-orchestration/graph-client';
import type { BootedDaemon } from './harness/boot.js';
import { bootDaemon } from './harness/boot.js';
import { FIXTURE_REPO, taskData } from './fixtures/repos.js';

const TASK_COMPLETED = {
  event: 'rad-orc:task.completed' as const,
  payload: {
    outcome: 'ok' as const,
    data: { results: [{ name: FIXTURE_REPO.name, committed: true, commitHash: 'abc123', pushed: true }] },
  },
};

function phaseData(): Record<string, unknown> {
  return { docPath: 'docs/phases/phase-1.md', exitCriteria: ['Foundations laid'] };
}

/**
 * Registers `repo` against `project` via the plain `/work-graph/worktree` route — never through
 * `GraphClient` (it carries no worktree surface; this is infra the scenario sets up, not part of
 * the client contract under test), the same raw-`fetch` idiom `createDroppableFetch` below already
 * uses for its own out-of-band concern. Lets the generic field resolver fill a `worktree-repo-set`
 * field's `path` fresh off a real `WorktreeRecord` once a node naming `repo` is engaged.
 */
async function addWorktree(baseUrl: string, projectId: string, repo: string): Promise<void> {
  const res = await fetch(`${baseUrl}/work-graph/worktree`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, repo }),
  });
  if (!res.ok) throw new Error(`addWorktree('${projectId}', '${repo}') failed: HTTP ${res.status}`);
}

async function waitUntil(check: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('waitUntil: timed out waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/**
 * A `fetch` that transparently relays every request but keeps a live handle on the most recent
 * response's body reader, plus a running count of connections opened — the seam a test uses to
 * force a genuine mid-stream drop (`forceDrop`, cancelling the real reader from the real server)
 * without touching the daemon or its port, so the client's own `subscribe()` reconnect logic
 * (`lib/graph-client/src/sse.ts`) runs unmodified against the same live connection.
 */
function createDroppableFetch(): {
  fetch: typeof fetch;
  forceDrop: () => Promise<void>;
  connectionCount: () => number;
} {
  let activeReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let count = 0;

  const wrappedFetch: typeof fetch = async (input, init) => {
    const response = await fetch(input, init);
    if (!response.body) return response;
    count += 1;
    const reader = response.body.getReader();
    activeReader = reader;
    const passthrough = new ReadableStream<Uint8Array>({
      async pull(controller) {
        const { value, done } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        controller.enqueue(value);
      },
      cancel(reason) {
        return reader.cancel(reason);
      },
    });
    return new Response(passthrough, { status: response.status, headers: response.headers });
  };

  return {
    fetch: wrappedFetch,
    async forceDrop(): Promise<void> {
      await activeReader?.cancel();
    },
    connectionCount: () => count,
  };
}

describe('integration: graph-client against a booted graph-service', () => {
  let daemon: BootedDaemon;
  let client: GraphClient;

  beforeEach(async () => {
    daemon = await bootDaemon();
    client = new GraphClient({ baseUrl: daemon.baseUrl() });
  });

  afterEach(async () => {
    await daemon.teardown();
  });

  describe('seed + read', () => {
    it('materializes seeded nodes/edges and reports the root- and container-scoped frontiers', async () => {
      const project = client.project('seed-read');
      await project.seed([
        { primitive: 'add_node', id: 'task-root', type: 'rad-orc:task', parent: ROOT_NODE_ID, data: taskData('tasks/task-root.md') },
        { primitive: 'add_node', id: 'phase-1', type: 'rad-orc:phase', parent: ROOT_NODE_ID, data: phaseData() },
        { primitive: 'add_node', id: 'task-a', type: 'rad-orc:task', parent: 'phase-1', data: taskData('tasks/task-a.md') },
        {
          primitive: 'add_node',
          id: 'task-b',
          type: 'rad-orc:task',
          parent: 'phase-1',
          data: taskData('tasks/task-b.md'),
          dependsOn: ['task-a'],
        },
      ]);

      const snapshot = await project.dag();
      expect(snapshot.nodes.map((node) => node.id)).toEqual(
        expect.arrayContaining(['task-root', 'phase-1', 'task-a', 'task-b']),
      );
      expect(snapshot.edges).toEqual(expect.arrayContaining([{ from: 'task-a', to: 'task-b', kind: 'depends_on' }]));
      // `phase-1` has children by the time this reads, so it never appears in root's own frontier
      // (a container is only ever entered, never itself engaged) — only the sibling leaf does.
      expect(snapshot.frontier.map((node) => node.id)).toEqual(['task-root']);
      expect(snapshot.status).toBe('in_progress');

      const nodeView = await project.node('task-a');
      expect(nodeView.id).toBe('task-a');
      expect(nodeView.type).toBe('rad-orc:task');
      expect(nodeView.status).toBe('not_started');
      expect(nodeView.presentation.label).toBeTruthy();

      expect((await project.frontier()).map((node) => node.id)).toEqual(['task-root']);
      expect((await project.frontier('phase-1')).map((node) => node.id)).toEqual(['task-a']);
    });
  });

  describe('drive: submitEvent', () => {
    it('advances the run and relays a completion via a populated NextActionEnvelope', async () => {
      const project = client.project('drive');
      await project.seed([
        { primitive: 'add_node', id: 'task-x', type: 'rad-orc:task', parent: ROOT_NODE_ID, data: taskData('tasks/task-x.md') },
      ]);
      await addWorktree(daemon.baseUrl(), 'drive', FIXTURE_REPO.name);

      const engaged = await project.submitEvent({ node: 'task-x' });
      expect(engaged.action).toBe('rad-orc:task');
      expect(engaged.node).toBe('task-x');
      expect(engaged.executor).toBe('spawn-sub-agent');
      expect(typeof engaged.instructions).toBe('string');
      expect(engaged.instructions?.length ?? 0).toBeGreaterThan(0);
      expect(engaged.completion_event).toBe('rad-orc:task.completed');
      expect(engaged.context).toMatchObject({ agent: 'coder' });
      expect(
        engaged.delta.nodeChanges.some((change) => change.after?.id === 'task-x' && change.after?.status === 'in_progress'),
      ).toBe(true);
      expect(engaged.frontier).toEqual([]);

      const completed = await project.submitEvent({ node: 'task-x', ...TASK_COMPLETED });
      expect(completed.action).toBeNull();
      expect(completed.node).toBeNull();
      expect(completed.executor).toBeNull();
      expect(completed.instructions).toBeNull();
      expect(completed.context).toBeNull();
      expect(completed.completion_event).toBeNull();
      expect(
        completed.delta.nodeChanges.some((change) => change.after?.id === 'task-x' && change.after?.status === 'done'),
      ).toBe(true);
      expect(completed.frontier).toEqual([]);

      expect((await project.dag()).status).toBe('done');
    });
  });

  describe('steer: every primitive kind', () => {
    it('addDependency creates a depends_on edge; the reverse edge would cycle and throws', async () => {
      const project = client.project('steer-add-dependency');
      await project.seed([
        { primitive: 'add_node', id: 'a1', type: 'rad-orc:task', parent: ROOT_NODE_ID, data: taskData('tasks/a1.md') },
        { primitive: 'add_node', id: 'b1', type: 'rad-orc:task', parent: ROOT_NODE_ID, data: taskData('tasks/b1.md') },
      ]);

      const delta = await project.addDependency('a1', 'b1');
      expect(delta.primitive).toBe('add_dependency');
      expect(delta.edgeChanges).toEqual(
        expect.arrayContaining([{ op: 'created', before: null, after: { from: 'a1', to: 'b1', kind: 'depends_on' } }]),
      );

      let caught: unknown;
      try {
        await project.addDependency('b1', 'a1');
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(GraphClientError);
      expect((caught as GraphClientError).code).toBe('cycle');
    });

    it('removeNode removes the node and, with a promote strategy, reparents its children', async () => {
      const project = client.project('steer-remove-node');
      await project.seed([
        { primitive: 'add_node', id: 'c1', type: 'rad-orc:task', parent: ROOT_NODE_ID, data: taskData('tasks/c1.md') },
        { primitive: 'add_node', id: 'c1-child', type: 'rad-orc:task', parent: 'c1', data: taskData('tasks/c1-child.md') },
      ]);

      const delta = await project.removeNode('c1', { dependents: 'detach', children: 'promote' });
      expect(delta.nodeChanges.some((change) => change.op === 'removed' && change.before?.id === 'c1')).toBe(true);
      expect(
        delta.nodeChanges.some(
          (change) => change.op === 'updated' && change.after?.id === 'c1-child' && change.after?.parent === ROOT_NODE_ID,
        ),
      ).toBe(true);
    });

    it('moveNode reparents a node under a container', async () => {
      const project = client.project('steer-move-node');
      await project.seed([
        { primitive: 'add_node', id: 'phase-1', type: 'rad-orc:phase', parent: ROOT_NODE_ID, data: phaseData() },
        { primitive: 'add_node', id: 'd1', type: 'rad-orc:task', parent: ROOT_NODE_ID, data: taskData('tasks/d1.md') },
      ]);

      const delta = await project.moveNode('d1', 'phase-1');
      expect(
        delta.nodeChanges.some(
          (change) => change.op === 'updated' && change.after?.id === 'd1' && change.after?.parent === 'phase-1',
        ),
      ).toBe(true);
    });

    it('expand materializes a new subgraph under the expanding node', async () => {
      const project = client.project('steer-expand');
      await project.seed([{ primitive: 'add_node', id: 'phase-1', type: 'rad-orc:phase', parent: ROOT_NODE_ID, data: phaseData() }]);

      const delta = await project.expand('phase-1', {
        specs: [
          { key: 'expanded-task', type: 'rad-orc:task', parent: 'phase-1', dependsOn: [], data: taskData('tasks/expanded-task.md') },
        ],
      });
      expect(delta.primitive).toBe('expand');
      expect(delta.nodeChanges.some((change) => change.op === 'created' && change.after?.id === 'expanded-task')).toBe(true);
    });

    it('addCorrective mints a corrective attempt and re-arms the review', async () => {
      const project = client.project('steer-add-corrective');
      await project.seed([
        { primitive: 'add_node', id: 'f1', type: 'rad-orc:task', parent: ROOT_NODE_ID, data: taskData('tasks/f1.md') },
        {
          primitive: 'add_node',
          id: 'g1',
          type: 'rad-orc:task',
          parent: ROOT_NODE_ID,
          data: taskData('tasks/g1.md'),
          dependsOn: ['f1'],
        },
      ]);
      await addWorktree(daemon.baseUrl(), 'steer-add-corrective', FIXTURE_REPO.name);

      // Completing f1 drives the run straight to engaging g1 (its own review analog) within the
      // same call — g1 lands `in_progress`, satisfying add_corrective's own precondition.
      await project.submitEvent({ node: 'f1' });
      await project.submitEvent({ node: 'f1', ...TASK_COMPLETED });

      const delta = await project.addCorrective('g1', 'g1-corrective', 'rad-orc:task');
      expect(delta.nodeChanges.some((change) => change.op === 'created' && change.after?.id === 'g1-corrective')).toBe(true);
      expect(
        delta.nodeChanges.some(
          (change) => change.op === 'updated' && change.after?.id === 'g1' && change.after?.status === 'not_started',
        ),
      ).toBe(true);
    });

    it('reset re-arms a node that already ran', async () => {
      const project = client.project('steer-reset');
      await project.seed([
        { primitive: 'add_node', id: 'h1', type: 'rad-orc:task', parent: ROOT_NODE_ID, data: taskData('tasks/h1.md') },
      ]);
      await addWorktree(daemon.baseUrl(), 'steer-reset', FIXTURE_REPO.name);
      await project.submitEvent({ node: 'h1' });

      const delta = await project.reset('h1', false);
      expect(
        delta.nodeChanges.some(
          (change) => change.op === 'updated' && change.after?.id === 'h1' && change.after?.status === 'not_started',
        ),
      ).toBe(true);
    });

    it('removing the project root is guarded and throws root_guarded', async () => {
      const project = client.project('steer-root-guard');

      let caught: unknown;
      try {
        await project.removeNode(ROOT_NODE_ID, { dependents: 'detach' });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(GraphClientError);
      expect((caught as GraphClientError).code).toBe('root_guarded');
    });
  });

  describe('dry-run', () => {
    it('previews a valid mutation without committing it', async () => {
      const project = client.project('dry-run-valid');
      await project.seed([
        { primitive: 'add_node', id: 'm1', type: 'rad-orc:task', parent: ROOT_NODE_ID, data: taskData('tasks/m1.md') },
        { primitive: 'add_node', id: 'm2', type: 'rad-orc:task', parent: ROOT_NODE_ID, data: taskData('tasks/m2.md') },
      ]);

      const result = await project.dryRun({ kind: 'add_dependency', from: 'm1', to: 'm2' });
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.preview).toBeTruthy();
      }

      expect((await project.dag()).edges).toEqual([]);
    });

    it('reports an invalid-but-well-formed mutation as { valid: false, reason } without throwing', async () => {
      const project = client.project('dry-run-invalid');
      await project.seed([
        { primitive: 'add_node', id: 'n1', type: 'rad-orc:task', parent: ROOT_NODE_ID, data: taskData('tasks/n1.md') },
        { primitive: 'add_node', id: 'n2', type: 'rad-orc:task', parent: ROOT_NODE_ID, data: taskData('tasks/n2.md') },
      ]);
      await project.addDependency('n1', 'n2');

      const result = await project.dryRun({ kind: 'add_dependency', from: 'n2', to: 'n1' });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason.length).toBeGreaterThan(0);
        expect(result.preview).toBeNull();
      }
    });
  });

  describe('error model', () => {
    // The engine-legality codes (`cycle`, `root_guarded`) are exercised above, in "steer: every
    // primitive kind" — this block covers the remaining reachable codes: a missing node, a
    // client-side-rejected malformed drive, an unregistered expansion type, a containment/
    // depends_on axis conflict, a malformed expansion batch, and a genuine transport failure.
    //
    // `driver_stalled` and `internal_error` have no test here: `driver_stalled` needs a drive loop
    // that runs past its 300-step ceiling without reaching quiescence or an external actor, and
    // `internal_error` is a defensive catch-all for an unexpected exception — neither is
    // deliberately constructible through the client's public surface without contriving an
    // artificial fixture, so both are exempted rather than faked.
    //
    // `not_in_frontier` also has no test: the only function that ever produces it is the engine's
    // `engage` (`lib/graph-engine/src/driver/contract.ts:56-73`), and its one caller reachable from
    // HTTP, `runToQuiescence` (`graph-service/src/driver/drive.ts:130-156`), always calls it against
    // `globalFrontier(...)`'s own freshly-read candidate (line 145-146) — engaging a node the very
    // same synchronous pass just certified as frontier-eligible — and throws a plain `Error` rather
    // than returning a `Result` if that ever fails (line 147), instead of surfacing a
    // `GraphClientError`. `submitEvent`'s other path (relaying a caller-supplied `event`) commits
    // through `apply_event`/`applyOutcome` directly, neither of which checks frontier membership at
    // all. No client-invocable primitive (`steer.ts`'s `STEER_PRIMITIVES`) calls `engage` either.
    // There is accordingly no reachable path from the client's public surface to a `not_in_frontier`
    // rejection in the current implementation.
    it('node() on a missing id throws not_found', async () => {
      const project = client.project('error-model-not-found');

      let caught: unknown;
      try {
        await project.node('does-not-exist');
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(GraphClientError);
      expect((caught as GraphClientError).code).toBe('not_found');
    });

    it('submitEvent with only one of event/payload throws invalid_request before any request is sent', async () => {
      const project = client.project('error-model-invalid-request');

      let caught: unknown;
      try {
        await project.submitEvent({ node: 'whatever', event: 'rad-orc:task.completed' });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(GraphClientError);
      expect((caught as GraphClientError).code).toBe('invalid_request');
    });

    it('expand with an unregistered spec type throws unknown_node_type', async () => {
      const project = client.project('error-model-unknown-node-type');
      await project.seed([
        { primitive: 'add_node', id: 'phase-1', type: 'rad-orc:phase', parent: ROOT_NODE_ID, data: phaseData() },
      ]);

      let caught: unknown;
      try {
        await project.expand('phase-1', {
          specs: [{ key: 'bogus', type: 'rad-orc:not-a-real-type', parent: 'phase-1', dependsOn: [], data: {} }],
        });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(GraphClientError);
      expect((caught as GraphClientError).code).toBe('unknown_node_type');
    });

    it('expand referencing a nonexistent dependsOn id throws invalid_delta', async () => {
      const project = client.project('error-model-invalid-delta');
      await project.seed([
        { primitive: 'add_node', id: 'phase-1', type: 'rad-orc:phase', parent: ROOT_NODE_ID, data: phaseData() },
      ]);

      let caught: unknown;
      try {
        await project.expand('phase-1', {
          specs: [
            {
              key: 'expanded-task',
              type: 'rad-orc:task',
              parent: 'phase-1',
              dependsOn: ['does-not-exist'],
              data: taskData('tasks/expanded-task.md'),
            },
          ],
        });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(GraphClientError);
      expect((caught as GraphClientError).code).toBe('invalid_delta');
    });

    it('addDependency between a container and its own child throws cross_axis_cycle', async () => {
      const project = client.project('error-model-cross-axis-cycle');
      await project.seed([
        { primitive: 'add_node', id: 'phase-1', type: 'rad-orc:phase', parent: ROOT_NODE_ID, data: phaseData() },
        { primitive: 'add_node', id: 'child-of-phase', type: 'rad-orc:task', parent: 'phase-1', data: taskData('tasks/child-of-phase.md') },
      ]);

      let caught: unknown;
      try {
        await project.addDependency('phase-1', 'child-of-phase');
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(GraphClientError);
      expect((caught as GraphClientError).code).toBe('cross_axis_cycle');
    });

    it('a request against a killed daemon throws a transport-failure code', async () => {
      const project = client.project('error-model-transport');
      await daemon.kill();

      let caught: unknown;
      try {
        await project.node('whatever');
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(GraphClientError);
      expect(['network_error', 'timeout']).toContain((caught as GraphClientError).code);
    });
  });

  describe('parallel projects: no cross-talk', () => {
    it('two projects seeded and driven concurrently against the one service never see each other', async () => {
      const p1 = client.project('parallel-p1');
      const p2 = client.project('parallel-p2');

      // Both projects seed a node under the *same* id ('task') — the strongest proof of partition
      // isolation available: even an id collision across projects can never cross-talk.
      await Promise.all([
        p1.seed([
          { primitive: 'add_node', id: 'task', type: 'rad-orc:task', parent: ROOT_NODE_ID, data: taskData('tasks/p1-task.md') },
          { primitive: 'add_node', id: 'p1-only', type: 'rad-orc:task', parent: ROOT_NODE_ID, data: taskData('tasks/p1-only.md') },
        ]),
        p2.seed([
          { primitive: 'add_node', id: 'task', type: 'rad-orc:task', parent: ROOT_NODE_ID, data: taskData('tasks/p2-task.md') },
          { primitive: 'add_node', id: 'p2-only', type: 'rad-orc:task', parent: ROOT_NODE_ID, data: taskData('tasks/p2-only.md') },
        ]),
      ]);
      await Promise.all([
        addWorktree(daemon.baseUrl(), 'parallel-p1', FIXTURE_REPO.name),
        addWorktree(daemon.baseUrl(), 'parallel-p2', FIXTURE_REPO.name),
      ]);

      await Promise.all([p1.submitEvent({ node: 'task' }), p2.submitEvent({ node: 'task' })]);

      const [snapshot1, snapshot2] = await Promise.all([p1.dag(), p2.dag()]);
      const ids1 = snapshot1.nodes.map((node) => node.id);
      const ids2 = snapshot2.nodes.map((node) => node.id);

      expect(ids1).toContain('p1-only');
      expect(ids1).not.toContain('p2-only');
      expect(ids2).toContain('p2-only');
      expect(ids2).not.toContain('p1-only');

      expect(snapshot1.nodes.find((node) => node.id === 'task')?.status).toBe('in_progress');
      expect(snapshot2.nodes.find((node) => node.id === 'task')?.status).toBe('in_progress');
    });
  });

  describe('SSE: project-filtering and reconnect', () => {
    it("delivers only this project's changes, never another project's", async () => {
      const p1 = client.project('sse-p1');
      const p2 = client.project('sse-p2');
      await p1.seed([{ primitive: 'add_node', id: 'task', type: 'rad-orc:task', parent: ROOT_NODE_ID, data: taskData('tasks/sse-p1.md') }]);
      await p2.seed([{ primitive: 'add_node', id: 'task', type: 'rad-orc:task', parent: ROOT_NODE_ID, data: taskData('tasks/sse-p2.md') }]);
      await addWorktree(daemon.baseUrl(), 'sse-p1', FIXTURE_REPO.name);
      await addWorktree(daemon.baseUrl(), 'sse-p2', FIXTURE_REPO.name);

      const received: StreamDelta[] = [];
      const sub = p1.subscribe((delta) => received.push(delta));
      try {
        await p2.submitEvent({ node: 'task' });
        // Give a would-be cross-talk delta a real chance to arrive before proving it never does.
        await new Promise((resolve) => setTimeout(resolve, 300));
        expect(received.some((delta) => delta.projectId === 'sse-p2')).toBe(false);

        await p1.submitEvent({ node: 'task' });
        await waitUntil(() => received.length > 0);

        expect(received.every((delta) => delta.projectId === 'sse-p1')).toBe(true);
        const delta = received[0]!;
        expect(delta.primitive).toBe('engage');
        expect(typeof delta.seq).toBe('number');
        expect(typeof delta.ts).toBe('string');
      } finally {
        sub.close();
      }
    });

    it('reconnects after a dropped stream and keeps delivering, until close() ends it', async () => {
      const project = client.project('sse-reconnect');
      await project.seed([
        { primitive: 'add_node', id: 'task', type: 'rad-orc:task', parent: ROOT_NODE_ID, data: taskData('tasks/sse-reconnect.md') },
      ]);
      await addWorktree(daemon.baseUrl(), 'sse-reconnect', FIXTURE_REPO.name);

      const { fetch: droppableFetch, forceDrop, connectionCount } = createDroppableFetch();
      const reconnectClient = new GraphClient({ baseUrl: daemon.baseUrl(), fetch: droppableFetch });
      const reconnectProject = reconnectClient.project('sse-reconnect');

      const received: StreamDelta[] = [];
      const sub = reconnectProject.subscribe((delta) => received.push(delta));
      try {
        await waitUntil(() => connectionCount() >= 1);

        await project.submitEvent({ node: 'task' });
        await waitUntil(() => received.length >= 1);
        const beforeDrop = received.length;

        await forceDrop();
        await waitUntil(() => connectionCount() >= 2, 5_000);

        await project.submitEvent({ node: 'task', ...TASK_COMPLETED });
        await waitUntil(() => received.length > beforeDrop);

        sub.close();
        const afterClose = received.length;
        await project.reset('task', false);
        await new Promise((resolve) => setTimeout(resolve, 300));
        expect(received.length).toBe(afterClose);
      } finally {
        sub.close();
      }
    }, 15_000);
  });
});

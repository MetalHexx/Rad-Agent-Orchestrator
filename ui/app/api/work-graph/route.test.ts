import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { withHomedir } from '@/lib/test-helpers';
import type { WorkGraphResponse, WorkGraphProjectDTO } from '@/types/work-graph';

const require = createRequire(import.meta.url);

const FORBIDDEN_FIELDS = ['"dir"', '"docs"', '"worktrees"', '"sourceControlInitialized"', '"status"'];

const WORK_GRAPH_YML = `version: 1
rev: 0
groups:
  "group:alpha":
    name: Alpha
    description: Alpha initiative
  "group:beta":
    name: Beta
    description: Beta initiative
edges:
  - type: contains
    from: "group:alpha"
    to: proj-a
  - type: contains
    from: "group:beta"
    to: proj-b
  - type: follows
    from: proj-a
    to: proj-b
  - type: spawned-from
    from: proj-a
    to: proj-c
  - type: made-up-type
    from: proj-b
    to: proj-c
`;

/** A stubbed homedir whose `~/.radorc` holds two groups (each containing one project), a
 *  cross-group edge, an ungrouped third project, and an ungrouped fourth project that is a
 *  portfolio root by both gates (a `-ROOT`-suffixed directory holding a document of its own
 *  name) — no git repositories anywhere under it. */
function buildFixture(): string {
  const home = mkdtempSync(join(tmpdir(), 'work-graph-'));
  const root = join(home, '.radorc');
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'work-graph.yml'), WORK_GRAPH_YML);
  const projectsDir = join(root, 'projects');
  mkdirSync(join(projectsDir, 'proj-a'), { recursive: true });
  mkdirSync(join(projectsDir, 'proj-b'), { recursive: true });
  mkdirSync(join(projectsDir, 'proj-c'), { recursive: true });
  writeFileSync(join(projectsDir, 'proj-a', 'state.json'), JSON.stringify({
    pipeline: { current_tier: 'execution' },
    graph: { status: 'in_progress', nodes: { phase_loop: { status: 'in_progress' } } },
  }));
  mkdirSync(join(projectsDir, 'PORTFOLIO-ROOT'), { recursive: true });
  writeFileSync(join(projectsDir, 'PORTFOLIO-ROOT', 'PORTFOLIO-ROOT.md'), '# Portfolio Root\n');
  return home;
}

test('GET /api/work-graph returns the full projected graph, dropping every server-only field', async () => {
  const root = buildFixture();
  await withHomedir(root, async () => {
    const { GET } = await import('./route');
    const res = await GET(new Request('http://t/api/work-graph'));
    assert.equal(res.status, 200);
    const body = (await res.json()) as WorkGraphResponse;

    assert.equal(body.schema, 'work-graph/v1');
    assert.equal(body.nodes.length, 6);
    assert.equal(body.edges.length, 5);
    assert.equal(body.groups.length, 2);
    assert.equal(body.danglingEdgeCount, 0);

    const raw = JSON.stringify(body);
    for (const forbidden of FORBIDDEN_FIELDS) {
      assert.equal(raw.includes(forbidden), false, `response must not carry ${forbidden}`);
    }

    const projA = body.nodes.find((n) => n.id === 'proj-a') as WorkGraphProjectDTO;
    assert.equal(projA.kind, 'project');
    assert.equal(projA.tier, 'execution');
    assert.equal(projA.state, 'executing', 'phase_loop in_progress resolves to the executing state');
    assert.equal(projA.stateLabel, 'Executing');
    assert.equal(projA.projectType, 'standard');
    const projB = body.nodes.find((n) => n.id === 'proj-b') as WorkGraphProjectDTO;
    assert.equal(projB.tier, null);
    assert.equal(projB.state, 'not_initialized', 'proj-b has no state.json at all');
    assert.equal(projB.stateLabel, 'Not Initialized');
    const portfolioRoot = body.nodes.find((n) => n.id === 'PORTFOLIO-ROOT') as WorkGraphProjectDTO;
    assert.equal(portfolioRoot.kind, 'project');
    assert.equal(portfolioRoot.projectType, 'portfolio', 'a -ROOT dir holding its own document projects as a portfolio');

    const followsEdge = body.edges.find((e) => e.type === 'follows')!;
    assert.equal(followsEdge.ranking, true, 'follows asserts an ordering');
    const spawnedFromEdge = body.edges.find((e) => e.type === 'spawned-from')!;
    assert.equal(spawnedFromEdge.ranking, false, 'spawned-from is decoration, not ordering');
    const unknownEdge = body.edges.find((e) => e.type === 'made-up-type')!;
    assert.equal(unknownEdge.ranking, false, 'an unrecognized edge type fails safe to non-ranking');
  });
});

test('GET ?group=<id> keeps only that group\'s contained nodes and in-scope edges, while groups stays complete', async () => {
  const root = buildFixture();
  await withHomedir(root, async () => {
    const { GET } = await import('./route');
    const res = await GET(new Request('http://t/api/work-graph?group=group:alpha'));
    assert.equal(res.status, 200);
    const body = (await res.json()) as WorkGraphResponse;

    assert.deepEqual(body.nodes.map((n) => n.id).sort(), ['group:alpha', 'proj-a']);
    // proj-a --follows--> proj-b is dropped: proj-b is out of scope, so the edge fails the "both endpoints in scope" test.
    assert.deepEqual(body.edges, [{ type: 'contains', from: 'group:alpha', to: 'proj-a', ranking: false }]);
    assert.equal(body.groups.length, 2);
  });
});

test('an unrecognized ?group= falls back to the full graph, not a 400 or an empty response', async () => {
  const root = buildFixture();
  await withHomedir(root, async () => {
    const { GET } = await import('./route');
    const res = await GET(new Request('http://t/api/work-graph?group=does-not-exist'));
    assert.equal(res.status, 200);
    const body = (await res.json()) as WorkGraphResponse;
    assert.equal(body.nodes.length, 6);
    assert.equal(body.edges.length, 5);
  });
});

test('?group=all returns the full graph', async () => {
  const root = buildFixture();
  await withHomedir(root, async () => {
    const { GET } = await import('./route');
    const res = await GET(new Request('http://t/api/work-graph?group=all'));
    assert.equal(res.status, 200);
    const body = (await res.json()) as WorkGraphResponse;
    assert.equal(body.nodes.length, 6);
  });
});

test('a thrown library error yields { error } with status 500, never a partial or empty graph', async () => {
  const home = mkdtempSync(join(tmpdir(), 'work-graph-bad-'));
  const root = join(home, '.radorc');
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'work-graph.yml'), 'groups: "unterminated\nedges: []\n');
  await withHomedir(home, async () => {
    const { GET } = await import('./route');
    const res = await GET(new Request('http://t/api/work-graph'));
    assert.equal(res.status, 500);
    const body = (await res.json()) as { error?: string };
    assert.equal(typeof body.error, 'string');
    assert.equal('nodes' in body, false);
  });
});

test('getGraph is composed exactly once per request', async () => {
  const root = buildFixture();
  await withHomedir(root, async () => {
    // route.ts's own `import { WorkGraphService } from '@rad-orchestration/work-graph'` resolves
    // through this same CJS require() cache (the ui workspace has no `"type": "module"`), so
    // patching the class fetched this way reaches the exact prototype the route constructs against.
    // A plain `await import(...)` here would land in Node's separate ESM module cache instead.
    const { WorkGraphService } = require('@rad-orchestration/work-graph');
    const { GET } = await import('./route');
    const original = WorkGraphService.prototype.getGraph;
    let calls = 0;
    WorkGraphService.prototype.getGraph = function (this: unknown, ...args: unknown[]) {
      calls += 1;
      return (original as (...a: unknown[]) => unknown).apply(this, args);
    };
    try {
      const res = await GET(new Request('http://t/api/work-graph'));
      assert.equal(res.status, 200);
      assert.equal(calls, 1);
    } finally {
      WorkGraphService.prototype.getGraph = original;
    }
  });
});

test('the route returns a correct, complete response even though git cannot run (exec is disabled)', async () => {
  const root = buildFixture();
  await withHomedir(root, async () => {
    // This fixture has no git repositories at all, so a correct response here only proves
    // itself: this test exists to fail loudly if the route's `exec` override is ever removed
    // and the route starts depending on `git worktree list` succeeding.
    const { GET } = await import('./route');
    const res = await GET(new Request('http://t/api/work-graph'));
    assert.equal(res.status, 200);
    const body = (await res.json()) as WorkGraphResponse;
    assert.equal(body.nodes.length, 6);
    assert.equal((body.nodes.find((n) => n.id === 'proj-a') as WorkGraphProjectDTO).tier, 'execution');
  });
});

test('the route validates and passes through known tier values including \'complete\'', async () => {
  const home = mkdtempSync(join(tmpdir(), 'work-graph-tiers-'));
  const root = join(home, '.radorc');
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'work-graph.yml'), `version: 1
rev: 0
groups: {}
edges: []
`);
  const projectsDir = join(root, 'projects');
  mkdirSync(join(projectsDir, 'proj-complete'), { recursive: true });
  mkdirSync(join(projectsDir, 'proj-unknown'), { recursive: true });
  // 'complete' is not an active tier the engine writes — the library reports it for a
  // structurally finished graph, whatever `current_tier` the file happens to carry.
  writeFileSync(join(projectsDir, 'proj-complete', 'state.json'), JSON.stringify({
    pipeline: { current_tier: 'review' }, graph: { status: 'completed', nodes: {} },
  }));
  writeFileSync(join(projectsDir, 'proj-unknown', 'state.json'), JSON.stringify({
    pipeline: { current_tier: 'unknown-future-tier' }, graph: { status: 'in_progress', nodes: {} },
  }));

  await withHomedir(home, async () => {
    const { GET } = await import('./route');
    const res = await GET(new Request('http://t/api/work-graph'));
    assert.equal(res.status, 200);
    const body = (await res.json()) as WorkGraphResponse;

    const projComplete = body.nodes.find((n) => n.id === 'proj-complete') as WorkGraphProjectDTO;
    assert.equal(projComplete.tier, 'complete', 'known tier \'complete\' should pass through');
    assert.equal(projComplete.state, 'complete', 'a structurally completed graph yields the complete state');
    assert.equal(projComplete.stateLabel, 'Complete');

    const projUnknown = body.nodes.find((n) => n.id === 'proj-unknown') as WorkGraphProjectDTO;
    assert.equal(projUnknown.tier, null, 'unknown tier should map to null');
    assert.equal(projUnknown.state, 'not_started', 'an unusable tier falls back to the structural shape of graph.nodes');
    assert.equal(projUnknown.stateLabel, 'Not Started');
  });
});

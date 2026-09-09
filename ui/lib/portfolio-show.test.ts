import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WorkGraphService } from '@rad-orchestration/work-graph';
import { withHomedir } from '@/lib/test-helpers';
import { getProjectsRoot, getRegistryRoot } from '@/lib/path-resolver';
import { defaultFsReads, portfolioShow, workGraphAdapter } from './portfolio-show';
import type { GraphBackend, GraphPort, PortfolioShowResult } from './portfolio-show';
import type { FsReads } from './portfolio-identity';

/** Files keyed by their path relative to the project directory. */
interface ProjectSpec {
  files?: Record<string, string>;
  state?: unknown;
}

/** A stubbed homedir whose `~/.radorc` carries a real work-graph.yml and a real
 *  project tree — the same fixture shape ui/app/api/work-graph/route.test.ts builds,
 *  since both drive `WorkGraphService` against the filesystem rather than a stub. */
function buildHome(spec: { workGraph: string; projects: Record<string, ProjectSpec> }): string {
  const home = mkdtempSync(path.join(tmpdir(), 'portfolio-show-'));
  const root = path.join(home, '.radorc');
  mkdirSync(root, { recursive: true });
  writeFileSync(path.join(root, 'work-graph.yml'), spec.workGraph);
  for (const [name, project] of Object.entries(spec.projects)) {
    const dir = path.join(root, 'projects', name);
    mkdirSync(dir, { recursive: true });
    if (project.state !== undefined) {
      writeFileSync(path.join(dir, 'state.json'), JSON.stringify(project.state));
    }
    for (const [relative, content] of Object.entries(project.files ?? {})) {
      const file = path.join(dir, relative);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, content);
    }
  }
  return home;
}

/** Composed exactly the way portfolio-detect.ts composes it: one adapter over a
 *  service whose git resolution is disabled. */
function show(portfolio: string): PortfolioShowResult {
  const root = getRegistryRoot();
  return portfolioShow({
    projectsDir: getProjectsRoot(),
    portfolio,
    port: workGraphAdapter({
      root,
      service: new WorkGraphService({ root, exec: () => { throw new Error('worktree resolution disabled'); } }),
    }),
    fs: defaultFsReads(),
  });
}

const EXECUTING_STATE = {
  pipeline: { current_tier: 'execution' },
  graph: { status: 'in_progress', nodes: { phase_loop: { status: 'in_progress' } } },
};
const COMPLETE_STATE = { pipeline: { current_tier: 'review' }, graph: { status: 'completed', nodes: {} } };

const PORTFOLIO_WORK_GRAPH = `version: 1
rev: 0
groups:
  "group:portfolio":
    name: Portfolio
    description: The portfolio
edges:
  - type: contains
    from: "group:portfolio"
    to: PORTFOLIO-ROOT
  - type: contains
    from: "group:portfolio"
    to: PORTFOLIO-1
  - type: contains
    from: "group:portfolio"
    to: PORTFOLIO-2
  - type: contains
    from: "group:portfolio"
    to: PORTFOLIO-3
  - type: contains
    from: "group:portfolio"
    to: SESSION-TRACKING-DESIGN
`;

/** PORTFOLIO, bound to group:portfolio. SESSION-TRACKING-DESIGN is deliberately a
 *  member that holds a document of its own name without being a portfolio root — it
 *  must survive as an iteration. */
function portfolioHome(over: { rootDoc?: string } = {}): string {
  return buildHome({
    workGraph: PORTFOLIO_WORK_GRAPH,
    projects: {
      'PORTFOLIO-ROOT': {
        files: {
          'PORTFOLIO-ROOT.md': over.rootDoc ?? '---\nstatus: active\n---\nBody\n',
          'PORTFOLIO-DECISIONS.md': 'decisions',
        },
      },
      'PORTFOLIO-1': {
        state: EXECUTING_STATE,
        files: {
          'PORTFOLIO-1-REQUIREMENTS.md': 'reqs',
          'PORTFOLIO-1-MASTER-PLAN.md': 'plan',
          'PORTFOLIO-1-AMENDMENT-02.md': 'amendment two',
          'PORTFOLIO-1-AMENDMENT-01.md': 'amendment one',
          'NOTES.md': 'not an amendment',
          'reports/PORTFOLIO-1-FINAL-REVIEW.md': 'review',
          'reports/phase-1-review.md': 'phase review',
        },
      },
      'PORTFOLIO-2': {},
      'PORTFOLIO-3': { files: { 'PORTFOLIO-3-REQUIREMENTS.md': 'reqs' } },
      'SESSION-TRACKING-DESIGN': {
        state: COMPLETE_STATE,
        files: { 'SESSION-TRACKING-DESIGN.md': 'self-named, not a portfolio' },
      },
    },
  });
}

const iteration = (result: PortfolioShowResult, name: string) =>
  result.iterations.find((i) => i.name === name)!;

// ── workGraphAdapter ─────────────────────────────────────────────────────────

const EMPTY_GRAPH = { schema: 'work-graph/v1' as const, nodes: [], edges: [], danglingEdges: [] };

/** A `GraphBackend` whose `getGraph` counts its own calls; the rest are unused by
 *  this test but required to satisfy the interface. */
function countingBackend(): GraphBackend & { calls: number } {
  const backend = {
    calls: 0,
    getGraph: () => { backend.calls += 1; return EMPTY_GRAPH; },
    createGroup: () => { throw new Error('unused in this test'); },
    deleteGroup: () => { throw new Error('unused in this test'); },
    addMember: () => { throw new Error('unused in this test'); },
    removeMember: () => { throw new Error('unused in this test'); },
  };
  return backend as unknown as GraphBackend & { calls: number };
}

test('workGraphAdapter serves listGroups + listMembers + getGraph off a single composition', () => {
  const backend = countingBackend();
  const port = workGraphAdapter({ root: '/root', service: backend });

  port.listGroups();
  port.listMembers('group:portfolio');
  const full = port.getGraph();

  assert.equal(backend.calls, 1, 'listGroups + listMembers + getGraph must share one composition');
  assert.equal(full, EMPTY_GRAPH);
});

// ── Resolution ───────────────────────────────────────────────────────────────

test('a base name, a group display name, and a full group id all resolve the same portfolio', async () => {
  await withHomedir(portfolioHome(), () => {
    const byBase = show('PORTFOLIO');
    assert.deepEqual(show('Portfolio'), byBase);
    assert.deepEqual(show('group:portfolio'), byBase);

    assert.equal(byBase.name, 'PORTFOLIO');
    assert.equal(byBase.group, 'group:portfolio');
    assert.equal(byBase.status, 'active');
    const rootDir = path.join(getProjectsRoot(), 'PORTFOLIO-ROOT');
    assert.deepEqual(byBase.root, {
      project: 'PORTFOLIO-ROOT',
      dir: rootDir,
      doc: path.join(rootDir, 'PORTFOLIO-ROOT.md'),
    });
  });
});

test('a matched group holding no root document falls through to the base-name path', async () => {
  const home = buildHome({
    workGraph: `version: 1
rev: 0
groups:
  "group:standalone":
    name: Standalone
    description: Holds no portfolio root
edges:
  - type: contains
    from: "group:standalone"
    to: MR-1
`,
    projects: {
      'MR-1': {},
      'STANDALONE-ROOT': { files: { 'STANDALONE-ROOT.md': 'root' } },
    },
  });
  await withHomedir(home, () => {
    const result = show('STANDALONE');
    assert.equal(result.name, 'STANDALONE');
    assert.equal(result.group, null, 'no contains edge points at STANDALONE-ROOT');
    assert.deepEqual(result.iterations, []);
  });
});

test('portfolioShow throws when neither a group nor a root directory resolves', async () => {
  await withHomedir(portfolioHome(), () => {
    assert.throws(() => show('NOPE'), /No portfolio named 'NOPE'/);
  });
});

// ── Iterations ───────────────────────────────────────────────────────────────

test('iterations exclude the resolved root project, keep a self-named member, and ascend by name', async () => {
  await withHomedir(portfolioHome(), () => {
    assert.deepEqual(
      show('PORTFOLIO').iterations.map((i) => i.name),
      ['PORTFOLIO-1', 'PORTFOLIO-2', 'PORTFOLIO-3', 'SESSION-TRACKING-DESIGN'],
    );
  });
});

test('derivedStatus comes from document presence, except that a complete state ships regardless', async () => {
  await withHomedir(portfolioHome(), () => {
    const result = show('PORTFOLIO');
    assert.equal(iteration(result, 'PORTFOLIO-2').derivedStatus, 'proposed');
    assert.equal(iteration(result, 'PORTFOLIO-3').derivedStatus, 'planned');
    assert.equal(iteration(result, 'PORTFOLIO-1').derivedStatus, 'executing');

    const shipped = iteration(result, 'SESSION-TRACKING-DESIGN');
    assert.equal(shipped.state, 'complete');
    assert.equal(shipped.docs.requirements, null);
    assert.equal(shipped.derivedStatus, 'shipped', 'shipping dominates document presence');
  });
});

test('iteration documents resolve to absolute paths, with amendments ascending and reports/ read from disk', async () => {
  await withHomedir(portfolioHome(), () => {
    const result = show('PORTFOLIO');
    const dir = path.join(getProjectsRoot(), 'PORTFOLIO-1');
    assert.deepEqual(iteration(result, 'PORTFOLIO-1').docs, {
      requirements: path.join(dir, 'PORTFOLIO-1-REQUIREMENTS.md'),
      masterPlan: path.join(dir, 'PORTFOLIO-1-MASTER-PLAN.md'),
      amendments: [
        path.join(dir, 'PORTFOLIO-1-AMENDMENT-01.md'),
        path.join(dir, 'PORTFOLIO-1-AMENDMENT-02.md'),
      ],
      finalReview: path.join(dir, 'reports', 'PORTFOLIO-1-FINAL-REVIEW.md'),
    });
    assert.deepEqual(iteration(result, 'PORTFOLIO-3').docs, {
      requirements: path.join(getProjectsRoot(), 'PORTFOLIO-3', 'PORTFOLIO-3-REQUIREMENTS.md'),
      masterPlan: null,
      amendments: [],
      finalReview: null,
    });
  });
});

// ── Portfolio documents and degradation ──────────────────────────────────────

test('all five portfolio documents are reported with their existence, present or not', async () => {
  await withHomedir(portfolioHome(), () => {
    const result = show('PORTFOLIO');
    const rootDir = path.join(getProjectsRoot(), 'PORTFOLIO-ROOT');
    assert.deepEqual(Object.keys(result.docs).sort(), ['decisions', 'groundTruth', 'iterations', 'root', 'technical']);
    assert.deepEqual(result.docs.root, { path: path.join(rootDir, 'PORTFOLIO-ROOT.md'), exists: true });
    assert.deepEqual(result.docs.decisions, { path: path.join(rootDir, 'PORTFOLIO-DECISIONS.md'), exists: true });
    assert.deepEqual(result.docs.technical, { path: path.join(rootDir, 'PORTFOLIO-TECHNICAL.md'), exists: false });
    assert.equal(result.docs.iterations.exists, false);
    assert.equal(result.docs.groundTruth.exists, false);
  });
});

test('a root document with no frontmatter or an off-enum status resolves with status null, not a throw', async () => {
  await withHomedir(portfolioHome({ rootDoc: 'No frontmatter here.\n' }), () => {
    assert.equal(show('PORTFOLIO').status, null);
  });
  await withHomedir(portfolioHome({ rootDoc: '---\nstatus: retired\n---\nBody\n' }), () => {
    assert.equal(show('PORTFOLIO').status, null);
  });
});

test('rejects a path-shaped portfolio value before touching the filesystem or the graph port', () => {
  for (const value of ['../ESCAPE', '/abs/path', 'A\\B']) {
    const calls: string[] = [];
    const fs: FsReads = {
      exists: (p) => { calls.push(`exists:${p}`); return false; },
      readFile: (p) => { calls.push(`readFile:${p}`); return ''; },
      readDirNames: (p) => { calls.push(`readDirNames:${p}`); return []; },
      isDirectory: (p) => { calls.push(`isDirectory:${p}`); return false; },
    };
    const port: GraphPort = {
      listGroups: () => { calls.push('listGroups'); return []; },
      listMembers: () => { calls.push('listMembers'); return []; },
      getGraph: () => { calls.push('getGraph'); return EMPTY_GRAPH; },
      createGroup: () => { calls.push('createGroup'); throw new Error('unused in this test'); },
      deleteGroup: () => { calls.push('deleteGroup'); throw new Error('unused in this test'); },
      addMember: () => { calls.push('addMember'); throw new Error('unused in this test'); },
      removeMember: () => { calls.push('removeMember'); throw new Error('unused in this test'); },
    };

    assert.throws(
      () => portfolioShow({ projectsDir: path.join('root', 'projects'), portfolio: value, port, fs }),
      /must be a plain portfolio or group name, not a path/,
    );
    assert.deepEqual(calls, [], `value "${value}" must reject before any read`);
  }
});

// ── dependsOn ────────────────────────────────────────────────────────────────

test('surfaces an iteration with one recorded dependency', async () => {
  const home = buildHome({
    workGraph: `version: 1
rev: 0
groups:
  "group:portfolio":
    name: Portfolio
    description: The portfolio
edges:
  - type: contains
    from: "group:portfolio"
    to: PORTFOLIO-ROOT
  - type: contains
    from: "group:portfolio"
    to: PORTFOLIO-1
  - type: contains
    from: "group:portfolio"
    to: PORTFOLIO-2
  - type: depends-on
    from: PORTFOLIO-2
    to: PORTFOLIO-1
`,
    projects: {
      'PORTFOLIO-ROOT': { files: { 'PORTFOLIO-ROOT.md': '---\nstatus: active\n---\nBody\n' } },
      'PORTFOLIO-1': {},
      'PORTFOLIO-2': {},
    },
  });
  await withHomedir(home, () => {
    const result = show('PORTFOLIO');
    assert.deepEqual(iteration(result, 'PORTFOLIO-2').dependsOn, ['PORTFOLIO-1']);
  });
});

test('surfaces multiple dependencies sorted ascending', async () => {
  const home = buildHome({
    workGraph: `version: 1
rev: 0
groups:
  "group:portfolio":
    name: Portfolio
    description: The portfolio
edges:
  - type: contains
    from: "group:portfolio"
    to: PORTFOLIO-ROOT
  - type: contains
    from: "group:portfolio"
    to: PORTFOLIO-1
  - type: contains
    from: "group:portfolio"
    to: PORTFOLIO-2
  - type: contains
    from: "group:portfolio"
    to: PORTFOLIO-3
  - type: depends-on
    from: PORTFOLIO-3
    to: PORTFOLIO-2
  - type: depends-on
    from: PORTFOLIO-3
    to: PORTFOLIO-1
`,
    projects: {
      'PORTFOLIO-ROOT': { files: { 'PORTFOLIO-ROOT.md': '---\nstatus: active\n---\nBody\n' } },
      'PORTFOLIO-1': {},
      'PORTFOLIO-2': {},
      'PORTFOLIO-3': {},
    },
  });
  await withHomedir(home, () => {
    const result = show('PORTFOLIO');
    assert.deepEqual(iteration(result, 'PORTFOLIO-3').dependsOn, ['PORTFOLIO-1', 'PORTFOLIO-2']);
  });
});

test('returns empty array when an iteration has no recorded dependencies', async () => {
  await withHomedir(portfolioHome(), () => {
    const result = show('PORTFOLIO');
    assert.deepEqual(iteration(result, 'PORTFOLIO-1').dependsOn, []);
  });
});

test('filters by edge type: ignores non-depends-on edges from the same node', async () => {
  const home = buildHome({
    workGraph: `version: 1
rev: 0
groups:
  "group:portfolio":
    name: Portfolio
    description: The portfolio
edges:
  - type: contains
    from: "group:portfolio"
    to: PORTFOLIO-ROOT
  - type: contains
    from: "group:portfolio"
    to: PORTFOLIO-1
  - type: contains
    from: "group:portfolio"
    to: PORTFOLIO-2
  - type: contains
    from: "group:portfolio"
    to: PORTFOLIO-3
  - type: follows
    from: PORTFOLIO-1
    to: PORTFOLIO-2
  - type: depends-on
    from: PORTFOLIO-1
    to: PORTFOLIO-3
`,
    projects: {
      'PORTFOLIO-ROOT': { files: { 'PORTFOLIO-ROOT.md': '---\nstatus: active\n---\nBody\n' } },
      'PORTFOLIO-1': {},
      'PORTFOLIO-2': {},
      'PORTFOLIO-3': {},
    },
  });
  await withHomedir(home, () => {
    const result = show('PORTFOLIO');
    assert.deepEqual(iteration(result, 'PORTFOLIO-1').dependsOn, ['PORTFOLIO-3']);
  });
});

test('matches edges on project.id, not project.dir', async () => {
  const home = buildHome({
    workGraph: `version: 1
rev: 0
groups:
  "group:portfolio":
    name: Portfolio
    description: The portfolio
edges:
  - type: contains
    from: "group:portfolio"
    to: PORTFOLIO-ROOT
  - type: contains
    from: "group:portfolio"
    to: PORTFOLIO-1
  - type: contains
    from: "group:portfolio"
    to: PORTFOLIO-2
  - type: depends-on
    from: PORTFOLIO-1
    to: PORTFOLIO-2
`,
    projects: {
      'PORTFOLIO-ROOT': { files: { 'PORTFOLIO-ROOT.md': '---\nstatus: active\n---\nBody\n' } },
      'PORTFOLIO-1': {},
      'PORTFOLIO-2': {},
    },
  });
  await withHomedir(home, () => {
    const result = show('PORTFOLIO');
    // Should match on id, regardless of the physical dir location.
    assert.deepEqual(iteration(result, 'PORTFOLIO-1').dependsOn, ['PORTFOLIO-2']);
  });
});

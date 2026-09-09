import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import child_process from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WorkGraphService } from '@rad-orchestration/work-graph';
import { withHomedir } from '@/lib/test-helpers';
import { getProjectsRoot, getRegistryRoot } from '@/lib/path-resolver';
import { detectPortfolio } from './portfolio-detect';

/** PROJECT-X carries a repo binding on purpose: that is what makes the library's
 *  `git worktree list` resolution fire, so the no-subprocess test below has something
 *  real to suppress. */
const PROJECT_X_STATE = {
  pipeline: {
    current_tier: 'execution',
    source_control: { repos: [{ name: 'repo-a' }] },
  },
  graph: { status: 'in_progress', nodes: { phase_loop: { status: 'in_progress' } } },
};

function buildHome(workGraph: string, projects: Record<string, Record<string, string>>): string {
  const home = mkdtempSync(path.join(tmpdir(), 'portfolio-detect-'));
  const root = path.join(home, '.radorc');
  mkdirSync(root, { recursive: true });
  writeFileSync(path.join(root, 'work-graph.yml'), workGraph);
  for (const [name, files] of Object.entries(projects)) {
    const dir = path.join(root, 'projects', name);
    mkdirSync(dir, { recursive: true });
    for (const [file, content] of Object.entries(files)) {
      writeFileSync(path.join(dir, file), content);
    }
  }
  return home;
}

/** group:portfolio holds PORTFOLIO-ROOT and PROJECT-X; LONE-PROJECT sits in no group. */
function memberHome(): string {
  return buildHome(
    `version: 1
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
    to: PROJECT-X
`,
    {
      'PORTFOLIO-ROOT': { 'PORTFOLIO-ROOT.md': '---\nstatus: active\n---\nBody\n' },
      'PROJECT-X': { 'state.json': JSON.stringify(PROJECT_X_STATE) },
      'LONE-PROJECT': {},
    },
  );
}

test('detectPortfolio resolves the portfolio name, root dir, and iteration dir for a member', async () => {
  await withHomedir(memberHome(), async () => {
    assert.deepEqual(await detectPortfolio('PROJECT-X'), {
      name: 'PORTFOLIO',
      rootDir: path.join(getProjectsRoot(), 'PORTFOLIO-ROOT'),
      iterationDir: path.join(getProjectsRoot(), 'PROJECT-X'),
    });
  });
});

test('detectPortfolio returns null for a project no group contains', async () => {
  await withHomedir(memberHome(), async () => {
    assert.equal(await detectPortfolio('LONE-PROJECT'), null);
  });
});

test('detectPortfolio returns null for the portfolio root itself — it is never one of its own iterations', async () => {
  await withHomedir(memberHome(), async () => {
    assert.equal(await detectPortfolio('PORTFOLIO-ROOT'), null);
  });
});

test('detectPortfolio returns null when the containing group holds no portfolio root document', async () => {
  const home = buildHome(
    `version: 1
rev: 0
groups:
  "group:orphan":
    name: Orphan
    description: A group that is not a portfolio
edges:
  - type: contains
    from: "group:orphan"
    to: PROJECT-X
`,
    { 'PROJECT-X': { 'state.json': JSON.stringify(PROJECT_X_STATE) } },
  );
  await withHomedir(home, async () => {
    assert.equal(await detectPortfolio('PROJECT-X'), null, 'the thrown "no portfolio named" collapses to null');
  });
});

test('detectPortfolio returns null rather than throwing when the registry itself is unreadable', async () => {
  // Composing the graph throws on this file. Both call sites read a null as
  // "not a portfolio member"; debrief/launch has no guard of its own, so a
  // throw escaping here would turn a clean 404 into a 500.
  const home = buildHome('groups: "unterminated\nedges: []\n', { 'PROJECT-X': {} });
  await withHomedir(home, async () => {
    assert.equal(await detectPortfolio('PROJECT-X'), null);
  });
});

test('detectPortfolio reaches child_process for nothing — the exec override really does suppress git resolution', async () => {
  const spawned: string[] = [];
  mock.method(child_process, 'execFileSync', (file: string) => { spawned.push(file); return ''; });
  mock.method(
    child_process,
    'execFile',
    (file: string, _args: string[], _opts: unknown, _cb: (...cbArgs: unknown[]) => void) => {
      spawned.push(file);
      return {} as never;
    },
  );
  try {
    await withHomedir(memberHome(), async () => {
      // Control: the same spy DOES catch the library's `git worktree list` when git
      // resolution is left enabled. Without this, a zero count below could just as
      // well mean the spy never reached the call site.
      new WorkGraphService({ root: getRegistryRoot() }).getGraph();
      assert.ok(spawned.length > 0, 'a service with git resolution enabled must reach child_process');

      spawned.length = 0;
      assert.ok(await detectPortfolio('PROJECT-X'), 'the happy path must still resolve');
      assert.deepEqual(spawned, [], 'detectPortfolio must spawn no subprocess of any kind');
    });
  } finally {
    mock.restoreAll();
  }
});

// Cross-surface cohesion guard, sibling to `project-state-cohesion.test.ts`.
//
// Every surface that answers "what kind of project directory is this?" is driven here
// from one shared fixture set, and each must derive the same canonical kind and select
// the right badge for it. A surface that never learns about a kind — or a new kind that
// leaves a surface behind — fails this test instead of shipping a project that renders
// as blank.
//
// This file reaches into `ui/` internals the same way `project-state-cohesion.test.ts`
// does. See that file's own header comment, and `tests/AGENTS.md`, for why the reach-in
// stays confined to this folder.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { WorkGraphService, PROJECT_KINDS } from '@rad-orchestration/work-graph';
import type { GraphDTO, Project, ProjectKind } from '@rad-orchestration/work-graph';
import { writeIdentity } from '@rad-orchestration/repo-registry';

import { discoverProjects } from '@/lib/fs-reader';
import { withHomedir } from '@/lib/test-helpers';
import { toNodeDTO } from '@/lib/work-graph-dto';
import { buildWorkGraphView } from '@/lib/work-graph-view';
import { KIND_PRESENTATION } from '@/components/badges/project-kind-presentation';
import { ProjectListItem } from '@/components/sidebar/project-list-item';
import { ProjectHeader } from '@/components/dag-timeline/project-header';
import { WorkGraphProjectNode } from '@/components/work-graph/work-graph-project-node';
import type { ProjectSummary } from '@/types/components';
import type { WorkGraphProjectData, WorkGraphResponse } from '@/types/work-graph';

// The UI components are compiled with the classic JSX transform, which expects
// `React` in scope.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).React = React;

// A real value reference so esbuild's unused-import elision can't drop this import —
// its side effect of populating require.cache (this module, transitively
// next/navigation) is exactly what loadMockedProjectNode below depends on.
assert.strictEqual(WorkGraphProjectNode.name, 'WorkGraphProjectNode');

/**
 * WorkGraphProjectNode calls useRouter() unconditionally, which throws outside a
 * mounted Next app router. `ui/`'s own package boundary compiles it to CJS
 * require() under tsx, so the shared, process-wide `require.cache` is reachable
 * from here via `createRequire` — the same require-cache-swap technique
 * `work-graph-project-node.test.tsx` uses for its own render helper, adapted for
 * this file's ESM module scope (this repo root is `"type": "module"`).
 *
 * `ReactFlowProvider` is pulled off the same `req` rather than from an ESM
 * import of `@xyflow/react` at the top of this file — CJS and ESM keep separate
 * module instances, and the node's `Handle`s only see the provider's context
 * when both come from the identical instance.
 */
function loadMockedProjectNode(): { Node: typeof WorkGraphProjectNode; Provider: typeof import('@xyflow/react').ReactFlowProvider } {
  const req = createRequire(import.meta.url) as NodeRequire & {
    cache: Record<string, { exports: unknown } | undefined>;
  };
  const navPath = req.resolve('next/navigation');
  const nodePath = req.resolve('@/components/work-graph/work-graph-project-node');
  const origNavExports = req.cache[navPath]?.exports;
  assert.ok(origNavExports, 'next/navigation must be in require cache before mock');

  const mock = Object.create(origNavExports as object) as Record<string, unknown>;
  Object.defineProperty(mock, 'useRouter', {
    value: () => ({ push: () => {} }),
    writable: true,
    enumerable: true,
    configurable: true,
  });

  req.cache[navPath]!.exports = mock;
  delete req.cache[nodePath];
  try {
    const fresh = req('@/components/work-graph/work-graph-project-node') as {
      WorkGraphProjectNode: typeof WorkGraphProjectNode;
    };
    const xyflow = req('@xyflow/react') as { ReactFlowProvider: typeof import('@xyflow/react').ReactFlowProvider };
    return { Node: fresh.WorkGraphProjectNode, Provider: xyflow.ReactFlowProvider };
  } finally {
    req.cache[navPath]!.exports = origNavExports;
  }
}

let MockedProjectNode: typeof WorkGraphProjectNode;
let MockedReactFlowProvider: typeof import('@xyflow/react').ReactFlowProvider;

const SURFACES = {
  projectList: 'project list badge',
  projectHdr: 'project header badge',
  canvasNode: 'work-graph canvas node',
} as const;

/**
 * `ProjectHeader` shows the side-project kind badge ADDITIVELY, beside the pipeline
 * badge, rather than replacing it — a side project still executes through the
 * pipeline and is tagged as one at the same time. A portfolio has no pipeline to
 * report, so its kind badge genuinely replaces the state badge everywhere. See
 * `project-header.tsx`'s own side-project branch and its
 * `project-header.delete-control.test.tsx` ("its own kind badge renders alongside
 * the state badge"), which already pins this as intentional.
 */
const BOTH_BADGES_ALLOWED = new Set<string>([`${SURFACES.projectHdr}:side-project`]);

interface Fixture {
  /** Project directory name — uppercase, per the UI reader's project-dir rule. */
  name: string;
  /** The kind every surface is expected to derive from this fixture. */
  expects: ProjectKind;
  /** Absent → no `state.json` at all; present → serialised verbatim. */
  state?: unknown;
  /** Writes `${name}.md` inside the fixture directory — the document a directory
   *  needs to hold in order to be a portfolio root (paired with a `-ROOT`-suffixed
   *  name), or, on the composite-gate fixture, a decoy without that suffix. */
  ownNameDoc?: boolean;
  /** Pins the composite root-detection gate rather than exercising a kind of its
   *  own — excluded from the vocabulary-coverage assertion. */
  nonVocabulary?: boolean;
}

type NodeFixture = Record<string, { status: string }>;

/** A minimal but valid `state.json`, resolving to the `executing` state — non-empty
 *  on every surface that reports a state, so a fixture that omits it never falls
 *  into the "no badge at all" case for reasons that have nothing to do with kind. */
function stateFile(nodes: NodeFixture, projectType?: 'side-project'): unknown {
  return {
    $schema: 'orchestration-state-v6',
    ...(projectType ? { project: { project_type: projectType } } : {}),
    pipeline: { gate_mode: null, source_control: null, current_tier: 'execution', halt_reason: null },
    graph: { template_id: 'cohesion-fixture', status: 'in_progress', current_node_path: null, nodes },
  };
}

function planningNodes(status: string): NodeFixture {
  return { requirements: { status }, master_plan: { status }, explode_master_plan: { status } };
}

const EXECUTING_NODES: NodeFixture = { ...planningNodes('completed'), phase_loop: { status: 'in_progress' } };

const FIXTURES: readonly Fixture[] = [
  {
    name: 'FIXTURE-KIND-STANDARD',
    expects: 'standard',
    state: stateFile(EXECUTING_NODES),
  },
  {
    name: 'FIXTURE-KIND-SIDE-PROJECT',
    expects: 'side-project',
    state: stateFile(EXECUTING_NODES, 'side-project'),
  },
  {
    name: 'FIXTURE-KIND-PORTFOLIO-ROOT',
    expects: 'portfolio',
    ownNameDoc: true,
  },
  {
    // Composite gate: a same-named document alone is not enough to be a portfolio
    // root — the `-ROOT` suffix is required too. Exercises no kind of its own (it
    // pins the gate, not the vocabulary), so it stays out of the coverage assertion.
    name: 'FIXTURE-KIND-DOC-ONLY',
    expects: 'standard',
    ownNameDoc: true,
    nonVocabulary: true,
  },
];

interface KindReport {
  libraryKind: ProjectKind;
  readerKind: ProjectKind;
  list: BadgePresence;
  header: BadgePresence;
  canvas: BadgePresence;
}

interface BadgePresence {
  state: boolean;
  kind: boolean;
}

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'project-kind-cohesion-'));
const radorcRoot = path.join(home, '.radorc');
const reportsByFixture = new Map<string, KindReport>();

function writeFixtureTree(): void {
  const projectsDir = path.join(radorcRoot, 'projects');
  for (const fixture of FIXTURES) {
    const dir = path.join(projectsDir, fixture.name);
    fs.mkdirSync(dir, { recursive: true });
    if (fixture.state !== undefined) {
      fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(fixture.state, null, 2), 'utf8');
    }
    if (fixture.ownNameDoc) {
      fs.writeFileSync(path.join(dir, `${fixture.name}.md`), `# ${fixture.name}\n`, 'utf8');
    }
  }
  writeIdentity({
    root: radorcRoot,
    repos: {
      'cohesion-fixture-repo': {
        remote: 'https://example.invalid/cohesion-fixture-repo.git',
        default_branch: 'main',
        description: 'Fixture repo — keeps the registry non-empty for reads that expect one.',
      },
    },
    repoGroups: {},
  });
}

/** Which of the two badges are present, read back out of rendered markup rather than
 *  trusted from the fixture's own fields — the state guard's own convention. */
function badgePresence(markup: string): BadgePresence {
  return {
    state: /aria-label="Pipeline status: [^"]*"/.test(markup),
    kind: /aria-label="Project kind: [^"]*"/.test(markup),
  };
}

/** The badges the sidebar row shows, from a rendered `ProjectListItem`. */
function listBadges(summary: ProjectSummary): BadgePresence {
  const markup = renderToStaticMarkup(
    createElement(ProjectListItem, { project: summary, selected: false, onClick: () => {} }),
  );
  return badgePresence(markup);
}

/** The badges the project header shows, from a rendered `ProjectHeader`. Driven with
 *  a state supplied: `state`/`stateLabel` are optional props, and with neither the
 *  header legitimately renders no badge at all for a kind that doesn't force one — a
 *  fact about the fixture's inputs, not about the component. */
function headerBadges(summary: ProjectSummary): BadgePresence {
  const markup = renderToStaticMarkup(
    createElement(ProjectHeader, {
      projectName: summary.name,
      state: summary.state,
      stateLabel: summary.stateLabel,
      projectType: summary.project_type,
      followMode: false,
      onToggleFollowMode: () => {},
    }),
  );
  return badgePresence(markup);
}

/** The badges the work-graph canvas shows, from a rendered `WorkGraphProjectNode` —
 *  the real component, mounted via the same `useRouter` require-cache mock
 *  `work-graph-project-node.test.tsx` uses, read back out of rendered markup like
 *  every other surface here rather than re-deriving its badge ternary. */
function canvasBadges(project: Project): BadgePresence {
  const response: WorkGraphResponse = {
    schema: 'work-graph/v1',
    nodes: [toNodeDTO(project)],
    edges: [],
    groups: [],
    danglingEdgeCount: 0,
  };
  const view = buildWorkGraphView(response, { filter: '', scope: 'all', enabledEdgeTypes: [] });
  const node = view.nodes.find((n) => n.type === 'workGraphProject');
  assert.ok(node, `the canvas dropped ${project.name}`);
  const data = node.data as WorkGraphProjectData;
  const markup = renderToStaticMarkup(
    createElement(MockedReactFlowProvider, null, createElement(MockedProjectNode, { data })),
  );
  return badgePresence(markup);
}

function reportsFor(name: string): KindReport {
  const report = reportsByFixture.get(name);
  assert.ok(report, `no surface report collected for ${name}`);
  return report;
}

/** The kind every surface agreed this fixture exercises — asserted per fixture below. */
function agreedKind(fixture: Fixture): ProjectKind {
  return reportsFor(fixture.name).libraryKind;
}

/** Asserts the one badge the fixture's kind selects is present, and the other is not —
 *  except the one documented case where the header shows both (see `BOTH_BADGES_ALLOWED`). */
function assertBadgeSelection(surface: string, fixture: Fixture, badges: BadgePresence): void {
  const replacesStateBadge = KIND_PRESENTATION[fixture.expects].replacesStateBadge;
  const bothAllowed = BOTH_BADGES_ALLOWED.has(`${surface}:${fixture.expects}`);
  const expectState = !replacesStateBadge;
  const expectKind = replacesStateBadge || bothAllowed;
  assert.equal(
    badges.state, expectState,
    `${surface}: ${fixture.name} (${fixture.expects}) — expected state badge ${expectState}, got ${badges.state}`,
  );
  assert.equal(
    badges.kind, expectKind,
    `${surface}: ${fixture.name} (${fixture.expects}) — expected kind badge ${expectKind}, got ${badges.kind}`,
  );
}

before(async () => {
  ({ Node: MockedProjectNode, Provider: MockedReactFlowProvider } = loadMockedProjectNode());
  writeFixtureTree();

  const summaries = new Map<string, ProjectSummary>();
  await withHomedir(home, async () => {
    for (const summary of await discoverProjects()) summaries.set(summary.name, summary);
  });

  const graph: GraphDTO = new WorkGraphService({ root: radorcRoot }).getGraph();
  const projects = new Map(
    graph.nodes.filter((node): node is Project => node.kind === 'project').map((p) => [p.id, p]),
  );

  for (const fixture of FIXTURES) {
    const summary = summaries.get(fixture.name);
    const project = projects.get(fixture.name);
    assert.ok(summary, `the UI reader did not discover ${fixture.name}`);
    assert.ok(project, `the library did not derive a project for ${fixture.name}`);
    reportsByFixture.set(fixture.name, {
      libraryKind: project.projectType,
      readerKind: summary.project_type ?? 'standard',
      list: listBadges(summary),
      header: headerBadges(summary),
      canvas: canvasBadges(project),
    });
  }
});

after(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

for (const fixture of FIXTURES) {
  test(`every surface agrees on the kind for ${fixture.name}`, () => {
    const report = reportsFor(fixture.name);

    assert.equal(
      report.libraryKind, report.readerKind,
      `${fixture.name}: the library and the dashboard reader disagree — library='${report.libraryKind}' reader='${report.readerKind}'`,
    );
    assert.equal(
      report.libraryKind, fixture.expects,
      `${fixture.name}: fixture no longer exercises '${fixture.expects}'`,
    );

    assertBadgeSelection(SURFACES.projectList, fixture, report.list);
    assertBadgeSelection(SURFACES.projectHdr, fixture, report.header);
    assertBadgeSelection(SURFACES.canvasNode, fixture, report.canvas);
  });
}

test('every kind in the library vocabulary is exercised by a fixture', () => {
  const exercised = new Set(FIXTURES.filter((f) => !f.nonVocabulary).map(agreedKind));
  for (const kind of PROJECT_KINDS) {
    assert.ok(exercised.has(kind), `no fixture exercises the '${kind}' kind`);
  }
});

test('KIND_PRESENTATION has an entry for every kind in the library vocabulary', () => {
  for (const kind of PROJECT_KINDS) {
    assert.ok(KIND_PRESENTATION[kind], `KIND_PRESENTATION has no entry for '${kind}'`);
  }
});

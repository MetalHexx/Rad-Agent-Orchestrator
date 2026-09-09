// Cross-surface cohesion guard.
//
// Every surface that answers "what state is this project in?" is driven here from
// one shared fixture set, and each must report the same canonical state and the
// same word. A surface that invents its own vocabulary, or a new state that leaves
// a surface behind, fails this test instead of shipping.
//
// This file reaches across module boundaries on purpose: `ui/` may never import
// `cli/src/`, and `cli/` may not import `ui/`, so the root guard is the only place
// all of them can be exercised together. Every reach-in stays in this file — if a
// surface cannot be imported cleanly, lift its pure step into its own module
// rather than widening the reach from here.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { WorkGraphService, PROJECT_STATES, PROJECT_STATE_LABELS } from '@rad-orchestration/work-graph';
import type { GraphDTO, Project, ProjectState } from '@rad-orchestration/work-graph';
import { writeIdentity } from '@rad-orchestration/repo-registry';

import { discoverProjects } from '@/lib/fs-reader';
import { withHomedir } from '@/lib/test-helpers';
import { STATE_PRESENTATION } from '@/components/badges/project-state-presentation';
import { toNodeDTO } from '@/lib/work-graph-dto';
import { buildWorkGraphView } from '@/lib/work-graph-view';
import { ProjectListItem } from '@/components/sidebar/project-list-item';
import { ProjectHeader } from '@/components/dag-timeline/project-header';
import type { ProjectSummary } from '@/types/components';
import type { WorkGraphProjectData, WorkGraphResponse } from '@/types/work-graph';
import { toLeanProject, renderProjectTable } from '../cli/src/commands/project/lean.js';
import { renderPreamble } from '../cli/src/commands/session-context/render.js';

// The UI components are compiled with the classic JSX transform, which expects
// `React` in scope.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).React = React;

const SURFACES = {
  projectList: 'project list badge',
  projectDetail: 'project detail badge',
  canvasNode: 'work-graph canvas node',
  cliLean: 'work-graph CLI (lean project)',
  cliTable: 'work-graph CLI (project table)',
  preamble: 'session-start preamble',
} as const;

interface SurfaceReport {
  surface: string;
  /** `null` for the surfaces that render only the word and never carry the state value. */
  state: ProjectState | null;
  label: string;
}

interface Fixture {
  /** Project directory name — uppercase, per the UI reader's project-dir rule. */
  name: string;
  /** The state every surface is expected to derive from this fixture. */
  expects: ProjectState;
  /** Absent → no `state.json` at all; a string → written verbatim; an object → serialised. */
  state?: unknown;
  /** Surfaces that legitimately do not report a state for this fixture. */
  skipSurfaces?: readonly string[];
}

type NodeFixture = Record<string, { status: string }>;

/**
 * A `state.json` carrying only the fields the state derivation reads: the schema
 * marker the UI reader recognises, the pipeline tier, and the graph.
 */
function stateFile(graphStatus: string, currentTier: string, nodes: NodeFixture): unknown {
  return {
    $schema: 'orchestration-state-v6',
    pipeline: { gate_mode: null, source_control: null, current_tier: currentTier, halt_reason: null },
    graph: { template_id: 'cohesion-fixture', status: graphStatus, current_node_path: null, nodes },
  };
}

/** A planning tier scaffolds only the steps its template carries, never all of them. */
function planningNodes(status: string): NodeFixture {
  return { requirements: { status }, master_plan: { status }, explode_master_plan: { status } };
}

const FIXTURES: readonly Fixture[] = [
  {
    name: 'FIXTURE-COMPLETE-CURRENT',
    expects: 'complete',
    state: stateFile('completed', 'review', { ...planningNodes('completed'), phase_loop: { status: 'completed' } }),
  },
  {
    // An earlier engine wrote `current_tier: complete`, a value the current schema no
    // longer permits. It must resolve identically to the current-engine row above.
    name: 'FIXTURE-COMPLETE-LEGACY',
    expects: 'complete',
    state: stateFile('completed', 'complete', { ...planningNodes('completed'), phase_loop: { status: 'completed' } }),
  },
  {
    name: 'FIXTURE-HALTED-GRAPH',
    expects: 'halted',
    state: stateFile('halted', 'review', { ...planningNodes('completed'), phase_loop: { status: 'in_progress' } }),
  },
  {
    name: 'FIXTURE-HALTED-TIER',
    expects: 'halted',
    state: stateFile('in_progress', 'halted', { ...planningNodes('completed'), phase_loop: { status: 'in_progress' } }),
  },
  {
    name: 'FIXTURE-EXECUTING',
    expects: 'executing',
    state: stateFile('in_progress', 'execution', { ...planningNodes('completed'), phase_loop: { status: 'in_progress' } }),
  },
  {
    name: 'FIXTURE-PENDING-REVIEW',
    expects: 'pending_review',
    state: stateFile('in_progress', 'review', {
      ...planningNodes('completed'),
      phase_loop: { status: 'completed' },
      final_review: { status: 'not_started' },
    }),
  },
  {
    name: 'FIXTURE-PLANNING',
    expects: 'planning',
    state: stateFile('in_progress', 'planning', {
      requirements: { status: 'in_progress' },
      master_plan: { status: 'not_started' },
      explode_master_plan: { status: 'not_started' },
    }),
  },
  {
    name: 'FIXTURE-PLANNED',
    expects: 'planned',
    state: stateFile('in_progress', 'planning', planningNodes('completed')),
  },
  {
    name: 'FIXTURE-NOT-STARTED',
    expects: 'not_started',
    state: stateFile('not_started', 'planning', planningNodes('not_started')),
  },
  {
    name: 'FIXTURE-NO-STATE',
    expects: 'not_initialized',
  },
  {
    name: 'FIXTURE-MALFORMED',
    expects: 'not_initialized',
    state: '{ "graph": { "status": "in_progress"',
    // Documented exception: the project list renders a WarningBadge for a malformed
    // project instead of the pipeline badge — an error affordance, not a state report
    // — so the list is not one of this fixture's state-reporting surfaces.
    skipSurfaces: [SURFACES.projectList],
  },
];

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'project-state-cohesion-'));
const radorcRoot = path.join(home, '.radorc');
const reportsByFixture = new Map<string, SurfaceReport[]>();

function writeFixtureTree(): void {
  const projectsDir = path.join(radorcRoot, 'projects');
  for (const fixture of FIXTURES) {
    const dir = path.join(projectsDir, fixture.name);
    fs.mkdirSync(dir, { recursive: true });
    if (fixture.state === undefined) continue;
    const body = typeof fixture.state === 'string' ? fixture.state : JSON.stringify(fixture.state, null, 2);
    fs.writeFileSync(path.join(dir, 'state.json'), body, 'utf8');
  }
  // The preamble renders its Active Projects row only when the registry has at least
  // one repo; without this it takes the empty-state greeting path instead.
  writeIdentity({
    root: radorcRoot,
    repos: {
      'cohesion-fixture-repo': {
        remote: 'https://example.invalid/cohesion-fixture-repo.git',
        default_branch: 'main',
        description: 'Fixture repo — makes the preamble take its registry-present path.',
      },
    },
    repoGroups: {},
  });
}

/**
 * The word a rendered React surface actually shows in its pipeline badge, read back
 * out of the markup its own component produced. Reading the fixture's `stateLabel`
 * instead would leave a component that plumbs the wrong field into its badge green.
 */
function renderedBadgeLabel(markup: string, surface: string): string {
  const badge = /aria-label="Pipeline status: [^"]*"[^>]*>([\s\S]*?)<\/span>/.exec(markup);
  assert.ok(badge, `${surface}: rendered no pipeline badge`);
  let inner = badge[1];
  let stripped: string;
  do {
    stripped = inner;
    inner = inner.replace(/<[^>]*>/g, '');
  } while (inner !== stripped);
  const word = inner.trim();
  assert.ok(word, `${surface}: the pipeline badge rendered no word`);
  return word;
}

/** The word the sidebar row shows, from a rendered ProjectListItem. */
function projectListLabel(summary: ProjectSummary): string {
  const markup = renderToStaticMarkup(
    createElement(ProjectListItem, { project: summary, selected: false, onClick: () => {} }),
  );
  return renderedBadgeLabel(markup, SURFACES.projectList);
}

/** The word the project detail header shows, from a rendered ProjectHeader. */
function projectDetailLabel(summary: ProjectSummary, project: Project): string {
  const markup = renderToStaticMarkup(
    createElement(ProjectHeader, {
      projectName: project.name,
      state: summary.state,
      stateLabel: summary.stateLabel,
      followMode: false,
      onToggleFollowMode: () => {},
    }),
  );
  return renderedBadgeLabel(markup, SURFACES.projectDetail);
}

/** The state the canvas node ends up carrying, via the route's lifted DTO transform. */
function canvasNodeData(project: Project): WorkGraphProjectData {
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
  return node.data as WorkGraphProjectData;
}

/** The word the CLI's project table shows in its STATE column. */
function cliTableLabel(project: Project): string {
  const row = renderProjectTable([project]).split('\n').find((line) => line.startsWith(`${project.name}\t`));
  assert.ok(row, `the CLI table rendered no row for ${project.name}`);
  return row.split('\t')[1];
}

/**
 * The word the session-start preamble shows for a project. `active` is built the way
 * the session-context command builds it, so the guard proves the preamble relays the
 * canonical label rather than rewording it.
 */
function preambleLabel(project: Project): string {
  const preamble = renderPreamble({
    root: radorcRoot,
    active: [{ name: project.name, stateLabel: project.stateLabel }],
  });
  const row = preamble.split('\n').find((line) => line.startsWith('**Active Projects**'));
  assert.ok(row, `the preamble rendered no Active Projects row for ${project.name}`);
  const item = row.split(' · ').find((part) => part.includes(`\`${project.name}\``));
  assert.ok(item, `the preamble's Active Projects row omitted ${project.name}`);
  return item.slice(item.indexOf('(') + 1, item.lastIndexOf(')'));
}

function surfaceReports(fixture: Fixture, summary: ProjectSummary, project: Project, graph: GraphDTO): SurfaceReport[] {
  const canvas = canvasNodeData(project);
  const lean = toLeanProject(project, graph);
  // Each word is produced lazily so a surface this fixture skips is never asked for
  // one — a skipped surface renders a different affordance entirely.
  const candidates: Array<{ surface: string; state: ProjectState | null; label: () => string }> = [
    // The list and the detail header are both handed the same ProjectSummary — the
    // one the UI's reader produced from the fixture on disk — and each is rendered
    // so the word compared below is the one its component really emits.
    { surface: SURFACES.projectList, state: summary.state, label: () => projectListLabel(summary) },
    { surface: SURFACES.projectDetail, state: summary.state, label: () => projectDetailLabel(summary, project) },
    { surface: SURFACES.canvasNode, state: canvas.state, label: () => canvas.stateLabel },
    { surface: SURFACES.cliLean, state: lean.state, label: () => lean.stateLabel },
    { surface: SURFACES.cliTable, state: null, label: () => cliTableLabel(project) },
    { surface: SURFACES.preamble, state: null, label: () => preambleLabel(project) },
  ];
  return candidates
    .filter((candidate) => !fixture.skipSurfaces?.includes(candidate.surface))
    .map(({ surface, state, label }) => ({ surface, state, label: label() }));
}

function formatReports(reports: SurfaceReport[]): string {
  return reports.map((r) => `${r.surface} -> ${r.state ?? '(word only)'} / "${r.label}"`).join('; ');
}

function reportsFor(name: string): SurfaceReport[] {
  const reports = reportsByFixture.get(name);
  assert.ok(reports, `no surface reports collected for ${name}`);
  return reports;
}

/** The state all of a fixture's surfaces agreed on — asserted per fixture below. */
function agreedState(fixture: Fixture): ProjectState {
  const state = reportsFor(fixture.name).find((r) => r.state !== null)?.state;
  assert.ok(state, `no surface reported a state value for ${fixture.name}`);
  return state;
}

before(async () => {
  writeFixtureTree();

  const summaries = new Map<string, ProjectSummary>();
  await withHomedir(home, async () => {
    for (const summary of await discoverProjects()) summaries.set(summary.name, summary);
  });

  const graph = new WorkGraphService({ root: radorcRoot }).getGraph();
  const projects = new Map(
    graph.nodes.filter((node): node is Project => node.kind === 'project').map((p) => [p.id, p]),
  );

  for (const fixture of FIXTURES) {
    const summary = summaries.get(fixture.name);
    const project = projects.get(fixture.name);
    assert.ok(summary, `the UI reader did not discover ${fixture.name}`);
    assert.ok(project, `the library did not derive a project for ${fixture.name}`);
    reportsByFixture.set(fixture.name, surfaceReports(fixture, summary, project, graph));
  }
});

after(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

for (const fixture of FIXTURES) {
  test(`every surface reports one state and one word for ${fixture.name}`, () => {
    const reports = reportsFor(fixture.name);

    const states = [...new Set(reports.map((r) => r.state).filter((s): s is ProjectState => s !== null))];
    assert.equal(states.length, 1, `${fixture.name}: surfaces disagree on the state — ${formatReports(reports)}`);
    const state = states[0];
    assert.equal(state, fixture.expects, `${fixture.name}: fixture no longer exercises '${fixture.expects}'`);

    const labels = [...new Set(reports.map((r) => r.label))];
    assert.equal(labels.length, 1, `${fixture.name}: surfaces disagree on the word — ${formatReports(reports)}`);
    assert.equal(
      labels[0],
      PROJECT_STATE_LABELS[state],
      `${fixture.name}: the word shown is not the library's label for '${state}' — ${formatReports(reports)}`,
    );

    assert.ok(
      STATE_PRESENTATION[state]?.cssVar,
      `${fixture.name}: the detail badge has no presentation for '${state}'`,
    );
  });
}

test('every state in the library vocabulary is exercised by a fixture', () => {
  const exercised = new Set(FIXTURES.map(agreedState));
  for (const state of PROJECT_STATES) {
    assert.ok(exercised.has(state), `no fixture exercises the '${state}' state`);
  }
});

test('every surface produces a word for every state in the library vocabulary', () => {
  for (const state of PROJECT_STATES) {
    const fixture = FIXTURES.find((f) => agreedState(f) === state);
    assert.ok(fixture, `no fixture exercises the '${state}' state`);
    for (const report of reportsFor(fixture.name)) {
      assert.ok(report.label.trim().length > 0, `${report.surface} shows no word for '${state}'`);
    }
    assert.ok(STATE_PRESENTATION[state]?.cssVar, `the badge presentation table has no entry for '${state}'`);
  }
});

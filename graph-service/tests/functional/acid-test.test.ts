// graph-service/tests/functional/acid-test.test.ts
//
// The acid test: proves the severance the whole 2.6 phase exists for. A capability-bearing custom
// node (`example:scribe`, discovered purely off a temp `~/.radorc/node-types/custom/` tree) is
// driven end to end over real HTTP + real capabilities — the daemon's own `start()` scan, the same
// generic `/engine-graph/*` surface every built-in drives through, zero reach into the node's own
// internals. It surfaces a **non-null** `completion_event` when the drive stops at it (the
// custom-node completion-token guarantee: a pre-2.6 custom stop would have surfaced `null`),
// relaying that event drives the host to call the node's own `resolve` — whose `doc-write` side
// effect lands on disk and whose derived outcome moves it to `done` — and it appears in the
// response envelope fully formed. A
// companion regression proves the maximal built-in chain still drives to its first external-actor
// stop (and on through `explosion`'s own disk-loaded `resolve`) with every built-in loaded from
// disk, never imported.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ROOT_NODE_ID, createNodeTypeRegistry } from '@rad-orchestration/graph-engine';
import type { DagNode } from '@rad-orchestration/graph-engine';
import type { BootedDaemon } from '../harness/boot.js';
import { bootDaemon } from '../harness/boot.js';
import { dag, driveToQuiescence, frontier, seed, submitEvent } from '../harness/drive.js';
import { discoverNodeTypes } from '../../src/node-types/scan.js';
import { compileTemplate } from '../../src/templates/compile.js';
import { createPlanningRelay } from '../fixtures/plan-relay.js';
import { PLAN_SUBGRAPH_IDS, WELL_FORMED_MASTER_PLAN_DOC, planSubgraphSeedSteps } from '../fixtures/plan-subgraph-seed.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const TEMPLATES_DIR = path.join(REPO_ROOT, 'runtime-config', 'node-graph-templates');
const EXAMPLE_PACKAGE_DIR = path.join(REPO_ROOT, 'examples', 'example');

/** The uniform node view every route relays: the persisted node plus its type's own `presentation` — not part of the core engine's own `DagNode`. */
interface NodeView extends DagNode {
  readonly presentation: { readonly label: string; readonly description?: string };
}

function readTemplate(fileName: string): Promise<string> {
  return fs.readFile(path.join(TEMPLATES_DIR, fileName), 'utf8');
}

describe('acid test: the capability-bearing custom node (example:scribe)', () => {
  let daemon: BootedDaemon;
  let nodeTypesRoot: string;

  beforeEach(async () => {
    daemon = await bootDaemon({
      stageNodeTypes: async (root) => {
        nodeTypesRoot = path.join(root, 'node-types');
        const dest = path.join(nodeTypesRoot, 'custom', 'example');
        await fs.mkdir(dest, { recursive: true });
        await fs.cp(EXAMPLE_PACKAGE_DIR, dest, { recursive: true });
      },
    });
  });

  afterEach(async () => {
    await daemon.teardown();
  });

  it('drives to done through the generic surface alone, with zero service edits and zero internals reached into', async () => {
    const project = 'acid-test-scribe';

    // (a) Discovered and seeded — compiled entirely from the daemon's own disk scan, never from an
    // imported node-type module: proves the template only compiles because that scan already
    // registered `example:scribe`.
    const { builtins, customs, errors } = await discoverNodeTypes(nodeTypesRoot);
    expect(errors).toEqual([]);
    const registry = createNodeTypeRegistry(builtins, customs);

    const source = await readTemplate('example-scribe.yml');
    const compiled = compileTemplate(source, registry);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;

    await seed(daemon.baseUrl(), project, compiled.steps);
    expect((await frontier(daemon.baseUrl(), project)).map((n) => n.id)).toEqual(['scribe']);

    // (b) The drive stops at it as an external actor, and the next-action envelope surfaces a
    // non-null `completion_event` equal to its own declared `completionToken` — a pre-2.6 custom
    // stop would have surfaced `null` here.
    const stop = await submitEvent(daemon.baseUrl(), project, ROOT_NODE_ID);
    expect(stop.node).toBe('scribe');
    expect(stop.action).toBe('example:scribe');
    expect(stop.executor).toBe('orchestrator-inline');
    expect(stop.completion_event).toBe('example:scribe.written');

    // (c) Relaying that exact completion event drives the host to call the node's own `resolve`,
    // whose `doc-write` side effect lands, and whose derived outcome moves the node to `done`.
    const relayed = await submitEvent(daemon.baseUrl(), project, 'scribe', {
      event: stop.completion_event!,
      payload: { outcome: 'ok', data: {} },
    });
    expect(relayed.action).toBeNull();
    expect(relayed.node).toBeNull();
    expect(relayed.executor).toBeNull();

    expect(daemon.readDoc('example/scribe.txt')).toBe('Hello from example:scribe.');

    // (d) It appears in the response envelope fully formed: uniform node shape, its own
    // `presentation`, its own opaque data — no service-side type knowledge required.
    const snapshot = await dag(daemon.baseUrl(), project);
    const scribeNode = snapshot.nodes.find((candidate) => candidate.id === 'scribe') as NodeView | undefined;
    expect(scribeNode?.type).toBe('example:scribe');
    expect(scribeNode?.status).toBe('done');
    expect(scribeNode?.data.written).toBe(true);
    expect(scribeNode?.presentation).toEqual({
      label: 'Scribe',
      description: 'A capability-bearing custom node — writes a note through doc-write and re-derives its own completion host-side.',
    });
    expect(snapshot.status).toBe('done');
  });
});

describe('acid test: the maximal built-in chain (disk-loaded built-ins)', () => {
  let daemon: BootedDaemon;

  beforeEach(async () => {
    daemon = await bootDaemon();
  });

  afterEach(async () => {
    await daemon.teardown();
  });

  it('drives to the first external-actor stop, and on through explosion, whose own resolve writes its docs — every built-in loaded from disk, none imported', async () => {
    const project = 'acid-test-maximal-chain';
    await seed(daemon.baseUrl(), project, planSubgraphSeedSteps());

    const first = await submitEvent(daemon.baseUrl(), project, ROOT_NODE_ID);
    expect(first.node).toBe(PLAN_SUBGRAPH_IDS.masterPlan);
    expect(first.action).toBe('rad-orc:master_plan');
    expect(first.executor).toBe('orchestrator-inline');

    const relay = createPlanningRelay(daemon, { masterPlanDocs: [WELL_FORMED_MASTER_PLAN_DOC] });
    const { steps } = await driveToQuiescence(daemon.baseUrl(), project, {
      resolve: relay,
      from: { id: first.node!, type: first.action!, executor: first.executor! },
      maxSteps: 100,
    });
    expect(steps).toBeGreaterThan(0);

    // explosion's own resolve wrote the phase docs to disk, off the same disk-discovered registry.
    expect(daemon.readDoc('docs/phases/phase-1.md')).toContain('## Phase 1: Foundation');
    expect(daemon.readDoc('docs/phases/phase-2.md')).toContain('## Phase 2: Delivery');

    expect((await dag(daemon.baseUrl(), project)).status).toBe('done');
  });
});

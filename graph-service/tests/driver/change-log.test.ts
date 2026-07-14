// The Done-when acceptance proof, against the package's own production composition root: seed a
// container (the project-scoped root) with one custom `noop`-executor node type carrying its own
// `resolve` hook (`rad-orc:task` no longer qualifies — its `resolve` is by design never in-service;
// it only ever completes via a relayed real coder spawn), drive it through `advance`, and confirm
// the full applyOutcome cycle (engage -> apply_event -> syncProjectedStatus) moves it
// not_started -> in_progress -> done with no real side effects, appending a `change_log` row per
// transition on the real (SQLite-backed) store `compose()` wires.
import type { EventToken, NodeEvent, NodeTypeDefinition, PrimitiveContext, ProjectScope } from '@rad-orchestration/graph-engine';
import { ROOT_NODE_ID } from '@rad-orchestration/graph-engine';
import { BUILT_IN_NODE_TYPES } from '@rad-orchestration/graph-node-types';
import { describe, expect, it } from 'vitest';
import { compose } from '../../src/compose.js';
import { advance } from '../../src/driver/drive.js';

interface ChangeLogRow {
  readonly primitive: string;
}

const DONE_TOKEN: EventToken = 'x:auto-step.done';

/** A minimal `noop`-executor node type resolving itself in-service — standing in for a deterministic/host-side code-behind without pulling in a real built-in's own preconditions or capability I/O. */
const AUTO_STEP_NODE_TYPE: NodeTypeDefinition = {
  name: 'x:auto-step',
  dataSchema: {},
  traits: [],
  capabilities: [],
  presentation: { label: 'Auto Step' },
  instructions: '# x:auto-step',
  act: () => ({ instructions: 'resolve in-service', executor: 'noop' }),
  handle: (ev: NodeEvent) => (ev.token === DONE_TOKEN && ev.envelope.outcome === 'ok' ? { dataChange: { ran: true } } : {}),
  projectStatus: (data) => (data.ran === true ? 'done' : 'not_started'),
  resolve: async () => ({ token: DONE_TOKEN, envelope: { outcome: 'ok', data: {} } }),
};

describe('advance against compose()’s SQLite-backed service', () => {
  it('moves a seeded custom noop node not_started -> in_progress -> done, one change_log row per transition', async () => {
    const service = compose({ dbPath: ':memory:', builtInNodeTypes: BUILT_IN_NODE_TYPES, customNodeTypes: [AUTO_STEP_NODE_TYPE] });
    const projectScope: ProjectScope = { projectId: 'proj-change-log' };

    const seeded = service.engine.add_node(projectScope, 'step-1', 'x:auto-step', ROOT_NODE_ID, {});
    expect(seeded.ok).toBe(true);

    const node = service.execStore.getNode(projectScope, 'step-1');
    if (!node) throw new Error('missing seeded node');
    expect(node.status).toBe('not_started');

    const ctx: PrimitiveContext = { store: service.execStore, scope: projectScope };
    const result = await advance(ctx, service.registry, service.capabilities, node);

    expect(result.ok).toBe(true);
    expect(service.execStore.getNode(projectScope, 'step-1')?.status).toBe('done');

    const rows = service.db
      .prepare('SELECT primitive FROM change_log WHERE project_id = ? ORDER BY rowid')
      .all(projectScope.projectId) as ChangeLogRow[];

    // add_node seeds the node; engage writes in_progress; apply_event commits the resolve outcome's
    // data patch; syncProjectedStatus (the host-side half apply_event deliberately leaves undone)
    // commits the actual done transition — four primitive commits, four rows, none of them a real
    // agent/git/process/network side effect.
    expect(rows.map((row) => row.primitive)).toEqual(['add_node', 'engage', 'apply_event', 'apply_event']);
  });
});

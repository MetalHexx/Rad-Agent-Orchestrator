// The Done-when acceptance proof, against the package's own production composition root: seed a
// container (the project-scoped root) with one `rad-orc:task`, drive it through `advance`, and
// confirm the full applyOutcome cycle (engage -> apply_event -> syncProjectedStatus) moves it
// not_started -> in_progress -> done with no real side effects, appending a `change_log` row per
// transition on the real (SQLite-backed) store `compose()` wires.
import type { PrimitiveContext, ProjectScope } from '@rad-orchestration/graph-engine';
import { ROOT_NODE_ID } from '@rad-orchestration/graph-engine';
import { describe, expect, it } from 'vitest';
import { compose } from '../../src/compose.js';
import { advance } from '../../src/driver/drive.js';

interface ChangeLogRow {
  readonly primitive: string;
}

describe('advance against compose()’s SQLite-backed service', () => {
  it('moves a seeded rad-orc:task not_started -> in_progress -> done, one change_log row per transition', async () => {
    const service = compose({ dbPath: ':memory:' });
    const projectScope: ProjectScope = { projectId: 'proj-change-log' };

    const seeded = service.engine.add_node(projectScope, 'task-1', 'rad-orc:task', ROOT_NODE_ID, {
      data: {
        handoffDocPath: '/tasks/task-1.md',
        repos: [{ name: 'rad-orc-source', path: '/repos/rad-orc-source', branch: 'radorch/STEERABLE-DAG-2.3' }],
        complexity: 'simple',
        shouldCommit: true,
      },
    });
    expect(seeded.ok).toBe(true);

    const node = service.execStore.getNode(projectScope, 'task-1');
    if (!node) throw new Error('missing seeded node');
    expect(node.status).toBe('not_started');

    const ctx: PrimitiveContext = { store: service.execStore, scope: projectScope };
    const result = await advance(ctx, service.registry, service.resolvers, node);

    expect(result.ok).toBe(true);
    expect(service.execStore.getNode(projectScope, 'task-1')?.status).toBe('done');

    const rows = service.db
      .prepare('SELECT primitive FROM change_log WHERE project_id = ? ORDER BY rowid')
      .all(projectScope.projectId) as ChangeLogRow[];

    // add_node seeds the node; engage writes in_progress; apply_event commits the task's data
    // patch; syncProjectedStatus (the host-side half apply_event deliberately leaves undone)
    // commits the actual done transition — four primitive commits, four rows, none of them a real
    // agent/git/process/network side effect.
    expect(rows.map((row) => row.primitive)).toEqual(['add_node', 'engage', 'apply_event', 'apply_event']);
  });
});

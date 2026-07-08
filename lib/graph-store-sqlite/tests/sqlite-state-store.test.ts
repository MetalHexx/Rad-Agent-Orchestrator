import { describe, expect, it } from 'vitest';
import type { ChangeDelta, DagNode } from '@rad-orchestration/graph-engine';
import { ROOT_NODE_ID } from '@rad-orchestration/graph-engine';
import { openDatabase } from '../src/db.js';
import { SqliteStateStore } from '../src/sqlite-state-store.js';

const SCOPE = { projectId: 'proj-a' };

function node(id: string, overrides: Partial<DagNode> = {}): DagNode {
  return {
    id,
    type: 'rad-orc:task',
    status: 'not_started',
    parent: ROOT_NODE_ID,
    order: 0,
    derivedFrom: null,
    data: {},
    ...overrides,
  };
}

function createDelta(nodes: DagNode[], primitive: ChangeDelta['primitive'] = 'add_node', params: ChangeDelta['params'] = {}): ChangeDelta {
  return {
    primitive,
    params,
    nodeChanges: nodes.map((after) => ({ op: 'created' as const, before: null, after })),
    edgeChanges: [],
  };
}

interface ChangeLogRow {
  seq: number;
  project_id: string;
  ts: string;
  actor: string | null;
  primitive: string;
  params: string;
  node_changes: string;
  edge_changes: string;
}

function changeLogRows(db: ReturnType<typeof openDatabase>): ChangeLogRow[] {
  return db.prepare('SELECT * FROM change_log').all() as ChangeLogRow[];
}

describe('SqliteStateStore — change_log', () => {
  it('a successful apply appends exactly one change_log row carrying the primitive + JSON snapshots', () => {
    const db = openDatabase(':memory:');
    const store = new SqliteStateStore(db);
    const delta = createDelta([node('task-a')], 'add_node', { id: 'task-a' });

    const result = store.apply(SCOPE, delta);

    expect(result.ok).toBe(true);
    const rows = changeLogRows(db);
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row.primitive).toBe('add_node');
    expect(row.actor).toBeNull();
    expect(typeof row.ts).toBe('string');
    expect(row.ts.length).toBeGreaterThan(0);
    expect(() => JSON.parse(row.params)).not.toThrow();
    expect(JSON.parse(row.params)).toEqual({ id: 'task-a' });
    expect(JSON.parse(row.node_changes)).toEqual(delta.nodeChanges);
    expect(JSON.parse(row.edge_changes)).toEqual([]);
  });

  it('leaves change_log untouched and does not advance seq when a delta is rejected', () => {
    const db = openDatabase(':memory:');
    const store = new SqliteStateStore(db);
    store.apply(SCOPE, createDelta([node('task-a')]));
    expect(changeLogRows(db)).toHaveLength(1);

    const result = store.apply(SCOPE, {
      primitive: 'remove_node',
      params: {},
      nodeChanges: [{ op: 'removed', before: node('ghost'), after: null }],
      edgeChanges: [],
    });

    expect(result.ok).toBe(false);
    expect(changeLogRows(db)).toHaveLength(1);
  });
});

describe('SqliteStateStore — optional field round-trip', () => {
  it('round-trips a node with disabled: true and a budgetAnchor', () => {
    const db = openDatabase(':memory:');
    const store = new SqliteStateStore(db);
    const written = node('task-a', { disabled: true, budgetAnchor: ROOT_NODE_ID });

    const result = store.apply(SCOPE, createDelta([written]));

    expect(result.ok).toBe(true);
    expect(store.getNode(SCOPE, 'task-a')).toEqual(written);
  });

  it('reads back a node with neither optional field without those keys present', () => {
    const db = openDatabase(':memory:');
    const store = new SqliteStateStore(db);
    const written = node('task-a');

    store.apply(SCOPE, createDelta([written]));
    const read = store.getNode(SCOPE, 'task-a');

    expect(read).toEqual(written);
    expect(read && Object.hasOwn(read, 'disabled')).toBe(false);
    expect(read && Object.hasOwn(read, 'budgetAnchor')).toBe(false);
  });
});

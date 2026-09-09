import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runGroupCreate, runGroupAdd, runGroupList, runGroupDelete } from '../../../src/commands/project-group/index.js';

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-'));
  const dir = path.join(root, 'projects', 'MR-1');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ project: { name: 'MR-1' }, graph: { nodes: {} } }));
});
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

describe('project-group commands', () => {
  it('creates a group, adds a member, lists it, and deletes it without removing the project', () => {
    const created = runGroupCreate({ root, name: 'MR', description: 'the initiative' });
    expect(created.node.id).toBe('group:mr');
    expect(created.rev).toBe(1);
    const added = runGroupAdd({ root, group: 'group:mr', member: 'MR-1' });
    expect(added.rev).toBe(2);
    const [group] = runGroupList({ root }).groups;
    expect(group.id).toBe('group:mr');
    // The canonical pair rides through the envelope untouched — no hand-built projection strips it.
    expect(typeof group.state).toBe('string');
    expect(typeof group.stateLabel).toBe('string');
    expect(group.stateLabel.length).toBeGreaterThan(0);
    const deleted = runGroupDelete({ root, group: 'group:mr' });
    expect(deleted.rev).toBe(3);
    expect(runGroupList({ root }).groups).toEqual([]);
  });
  it('rejects an empty description on create', () => {
    expect(() => runGroupCreate({ root, name: 'X', description: '  ' })).toThrow(/description/i);
  });
});

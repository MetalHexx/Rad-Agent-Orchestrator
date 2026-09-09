import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runGraphLink, runGraphUnlink, runGraphShow, runGraphPrune, parseDepth } from '../../../src/commands/graph/index.js';
import { UserError } from '../../../src/framework/errors.js';

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'g-'));
  for (const name of ['MR-1', 'MR-2']) {
    const dir = path.join(root, 'projects', name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ project: { name }, graph: { nodes: {} } }));
  }
});
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

describe('graph commands', () => {
  it('links and unlinks a relationship edge, and show returns the projection', () => {
    expect(runGraphLink({ root, from: 'MR-2', to: 'MR-1', type: 'follows' }).rev).toBe(1);
    expect(runGraphShow({ root }).data.edges).toEqual([{ type: 'follows', from: 'MR-2', to: 'MR-1' }]);
    expect(runGraphUnlink({ root, from: 'MR-2', to: 'MR-1', type: 'follows' }).rev).toBe(2);
    expect(runGraphShow({ root }).data.edges).toEqual([]);
  });
  it('show surfaces the canonical state and stateLabel on every node', () => {
    const { nodes } = runGraphShow({ root }).data;
    expect(nodes.length).toBeGreaterThan(0);
    for (const node of nodes) {
      expect(typeof node.state).toBe('string');
      expect(typeof node.stateLabel).toBe('string');
      expect(node.stateLabel.length).toBeGreaterThan(0);
    }
  });
  it('scopes show by root and depth', () => {
    runGraphLink({ root, from: 'MR-2', to: 'MR-1', type: 'follows' });
    const scoped = runGraphShow({ root, rootId: 'MR-2', depth: 0 });
    expect(scoped.data.nodes.map((n: { id: string }) => n.id)).toEqual(['MR-2']);
  });
  it('prune reports removed dangling edges', () => {
    // no dangling edges present → nothing removed
    expect(runGraphPrune({ root }).removed).toEqual([]);
  });
  it('rejects a non-numeric --depth with a clean user error instead of silently degrading', () => {
    expect(() => parseDepth('abc')).toThrow(UserError);
    expect(() => parseDepth('abc')).toThrow('--depth must be a non-negative number');
    expect(() => parseDepth('-1')).toThrow('--depth must be a non-negative number');
  });
  it('parses a valid non-negative --depth and passes undefined through unchanged', () => {
    expect(parseDepth('0')).toBe(0);
    expect(parseDepth('3')).toBe(3);
    expect(parseDepth(undefined)).toBeUndefined();
  });
});

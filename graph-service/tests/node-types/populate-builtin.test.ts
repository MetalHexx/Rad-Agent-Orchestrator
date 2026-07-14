// graph-service/tests/node-types/populate-builtin.test.ts
//
// Proves the disk-artifact seam end to end: `populateBuiltinNodeTypes` stages the
// `graph-node-types` package's own built `manifest.yml` + `dist/` at
// `<root>/node-types/builtin/rad-orc/`, and `discoverNodeTypes` resolves all nine `rad-orc:*`
// built-ins from that `builtin/` bucket with no customs and no errors.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createNodeTypeRegistry } from '@rad-orchestration/graph-engine';
import { discoverNodeTypes } from '../../src/node-types/scan.js';
import { populateBuiltinNodeTypes } from '../../src/node-types/populate-builtin.js';

const RAD_ORC_BUILT_IN_NAMES = [
  'rad-orc:phase',
  'rad-orc:master_plan',
  'rad-orc:plan_audit',
  'rad-orc:explosion',
  'rad-orc:approval',
  'rad-orc:task',
  'rad-orc:code_review',
  'rad-orc:corrective',
  'rad-orc:pr',
].sort();

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'graph-service-populate-builtin-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('populateBuiltinNodeTypes', () => {
  it('populates <root>/node-types/builtin/rad-orc/ such that discoverNodeTypes resolves all nine built-ins', async () => {
    await populateBuiltinNodeTypes(root);

    const nodeTypesRoot = path.join(root, 'node-types');
    const result = await discoverNodeTypes(nodeTypesRoot);

    expect(result.errors).toEqual([]);
    expect(result.customs).toEqual([]);
    expect(result.builtins.map((definition) => definition.name).sort()).toEqual(RAD_ORC_BUILT_IN_NAMES);

    const registry = createNodeTypeRegistry(result.builtins, result.customs);
    for (const name of RAD_ORC_BUILT_IN_NAMES) {
      expect(registry.resolve(name)?.name).toBe(name);
    }
  });

  it('is idempotent — re-populating never accumulates stale artifacts alongside the fresh copy', async () => {
    await populateBuiltinNodeTypes(root);
    await populateBuiltinNodeTypes(root);

    const result = await discoverNodeTypes(path.join(root, 'node-types'));
    expect(result.errors).toEqual([]);
    expect(result.builtins).toHaveLength(9);
  });
});

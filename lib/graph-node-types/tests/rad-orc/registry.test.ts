import { createNodeTypeRegistry } from '@rad-orchestration/graph-engine';
import { describe, expect, it } from 'vitest';
import { BUILT_IN_NODE_TYPES } from '../../src/index.js';

describe('the four rad-orc:* built-ins register through the ordinary NodeTypeRegistry', () => {
  it('resolves all four by name, exactly like any custom node type would', () => {
    const registry = createNodeTypeRegistry(BUILT_IN_NODE_TYPES);
    for (const name of ['rad-orc:phase', 'rad-orc:master_plan', 'rad-orc:explosion', 'rad-orc:approval'] as const) {
      expect(registry.resolve(name)?.name).toBe(name);
    }
    expect(registry.list()).toHaveLength(4);
  });
});

import { createNodeTypeRegistry } from '@rad-orchestration/graph-engine';
import { describe, expect, it } from 'vitest';
import { BUILT_IN_NODE_TYPES } from '../../src/index.js';

describe('the ten rad-orc:* built-ins register through the ordinary NodeTypeRegistry', () => {
  it('resolves all ten by name, exactly like any custom node type would', () => {
    const registry = createNodeTypeRegistry(BUILT_IN_NODE_TYPES);
    for (const name of [
      'rad-orc:phase',
      'rad-orc:master_plan',
      'rad-orc:explosion',
      'rad-orc:approval',
      'rad-orc:task',
      'rad-orc:code_review',
      'rad-orc:corrective',
      'rad-orc:pr',
      'rad-orc:plan_audit',
      'rad-orc:plan_corrective',
    ] as const) {
      expect(registry.resolve(name)?.name).toBe(name);
    }
    expect(registry.list()).toHaveLength(10);
  });
});

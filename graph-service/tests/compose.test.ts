import { describe, expect, it } from 'vitest';
import type { NodeTypeDefinition, NodeTypeName } from '@rad-orchestration/graph-engine';
import { compose } from '../src/compose.js';

function stubCustomType(name: NodeTypeName): NodeTypeDefinition {
  return {
    name,
    dataSchema: {},
    traits: [],
    capabilities: [],
    presentation: { label: 'Stub' },
    instructions: 'stub instructions',
    act: () => ({ instructions: '', executor: 'orchestrator-inline' }),
    handle: () => ({}),
    projectStatus: () => 'not_started',
  };
}

describe('compose', () => {
  it('builds a coherent services object over an in-memory database', () => {
    const service = compose({ dbPath: ':memory:' });

    expect(service.dbPath).toBe(':memory:');
    expect(service.db.pragma('user_version', { simple: true })).toEqual(expect.any(Number));

    // The registry resolves a built-in the engine ships out of the box.
    expect(service.registry.resolve('rad-orc:task')).toBeDefined();
    expect(service.registry.list().length).toBeGreaterThan(0);

    // The engine is bound to the same store/registry pair — exercising it shouldn't throw and
    // should return the engine's own Result shape.
    const scope = { projectId: 'proj-1' };
    const result = service.engine.add_node(scope, 'task-1', 'rad-orc:task', 'root', {});
    expect(typeof result.ok).toBe('boolean');

    // The portfolio store is usable through the same handle.
    expect(service.portfolio.listProjects()).toEqual([]);

    // The capability ports are wired and ready for the driver to hand to a node's own `resolve` hook.
    expect(service.capabilities.docRead).toBeDefined();
    expect(service.capabilities.spawnAgent).toBeDefined();

    expect(service.version.service).toEqual(expect.any(String));
    expect(service.version.engine).toEqual(expect.any(String));
  });

  it('layers a discovered custom node type over the built-ins, resolvable through the registry', () => {
    const custom = stubCustomType('example:greet');
    const service = compose({ dbPath: ':memory:', customNodeTypes: [custom] });

    expect(service.registry.resolve('example:greet')).toBe(custom);
    expect(service.registry.resolve('rad-orc:task')).toBeDefined();
  });

  it('throws at construction when a custom claims the reserved rad-orc: prefix', () => {
    const impersonator = stubCustomType('rad-orc:impersonator');

    expect(() => compose({ dbPath: ':memory:', customNodeTypes: [impersonator] })).toThrow(/rad-orc:impersonator/);
  });

  it('throws at construction when two customs share a name', () => {
    const first = stubCustomType('dup:thing');
    const second = stubCustomType('dup:thing');

    expect(() => compose({ dbPath: ':memory:', customNodeTypes: [first, second] })).toThrow(/dup:thing/);
  });
});

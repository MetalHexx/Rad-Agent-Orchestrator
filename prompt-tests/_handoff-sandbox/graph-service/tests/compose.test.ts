import { describe, expect, it } from 'vitest';
import { compose } from '../src/compose.js';

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

    // The capability ports + their per-node-type resolvers are wired and ready for the driver.
    expect(service.capabilities.docRead).toBeDefined();
    expect(service.capabilities.spawnAgent).toBeDefined();
    expect(service.resolvers['rad-orc:task']).toBeInstanceOf(Function);

    expect(service.version.service).toEqual(expect.any(String));
    expect(service.version.engine).toEqual(expect.any(String));
  });
});

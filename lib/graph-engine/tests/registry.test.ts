import { describe, expect, it } from 'vitest';
import {
  createEngine,
  createNodeTypeRegistry,
  InMemoryStateStore,
  NODE_TYPE_ORIGINS,
  ROOT_NODE_ID,
} from '../src/index.js';
import type { NodeTypeDefinition, ProjectScope } from '../src/index.js';

function scope(projectId: string): ProjectScope {
  return { projectId };
}

/** A minimal registered definition — only `name` matters to registry construction/resolution. */
function stubType(name: NodeTypeDefinition['name']): NodeTypeDefinition {
  return {
    name,
    dataSchema: {},
    traits: [],
    capabilities: [],
    presentation: { label: name },
    instructions: '',
    act: () => ({ instructions: '', executor: 'noop' }),
    handle: () => ({}),
    projectStatus: () => 'not_started',
  };
}

describe('NodeTypeOrigin vocabulary', () => {
  it('has exactly builtin and custom', () => {
    expect(NODE_TYPE_ORIGINS).toEqual(['builtin', 'custom']);
  });
});

describe('createNodeTypeRegistry — construction rules', () => {
  it('resolves a registered built-in by name', () => {
    const registry = createNodeTypeRegistry([stubType('rad-orc:task')]);
    expect(registry.resolve('rad-orc:task')?.name).toBe('rad-orc:task');
  });

  it('resolves undefined for an unregistered name', () => {
    const registry = createNodeTypeRegistry([stubType('rad-orc:task')]);
    expect(registry.resolve('acme-qa:security-scan')).toBeUndefined();
  });

  it('lists every registered definition, built-in and custom alike', () => {
    const registry = createNodeTypeRegistry([stubType('rad-orc:task')], [stubType('acme-qa:security-scan')]);
    expect(registry.list().map((def) => def.name).sort()).toEqual(['acme-qa:security-scan', 'rad-orc:task']);
  });

  it('throws when a custom definition claims the reserved rad-orc: prefix', () => {
    expect(() => createNodeTypeRegistry([], [stubType('rad-orc:rogue')])).toThrow(/reserved/);
  });

  it('lets a built-in definition register under rad-orc: unchecked', () => {
    expect(() => createNodeTypeRegistry([stubType('rad-orc:task')])).not.toThrow();
  });

  it('throws when two built-ins share a name', () => {
    expect(() => createNodeTypeRegistry([stubType('rad-orc:task'), stubType('rad-orc:task')])).toThrow(/already registered/);
  });

  it('throws when a custom duplicates a built-in name (uniqueness, independent of the prefix rule)', () => {
    expect(() =>
      createNodeTypeRegistry([stubType('acme-qa:shared-name')], [stubType('acme-qa:shared-name')]),
    ).toThrow(/already registered/);
  });

  it('throws when two customs share a name', () => {
    expect(() =>
      createNodeTypeRegistry([], [stubType('acme-qa:scan'), stubType('acme-qa:scan')]),
    ).toThrow(/already registered/);
  });
});

describe('createEngine — the composition point', () => {
  it('binds store + registry so add_node resolves a registered type before committing', () => {
    const engine = createEngine(new InMemoryStateStore(), createNodeTypeRegistry([stubType('rad-orc:task')]));
    const proj = scope('proj-a');

    const result = engine.add_node(proj, 'task-a', 'rad-orc:task', ROOT_NODE_ID);

    expect(result.ok).toBe(true);
  });

  it('surfaces unknown_node_type from add_node for a type the injected registry never saw', () => {
    const engine = createEngine(new InMemoryStateStore(), createNodeTypeRegistry([stubType('rad-orc:task')]));
    const proj = scope('proj-a');

    const result = engine.add_node(proj, 'task-a', 'acme-qa:security-scan', ROOT_NODE_ID);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('unknown_node_type');
  });

  it('surfaces unknown_node_type from expand for an unregistered spec type', () => {
    const engine = createEngine(new InMemoryStateStore(), createNodeTypeRegistry([stubType('rad-orc:task')]));
    const proj = scope('proj-a');

    const result = engine.expand(proj, ROOT_NODE_ID, {
      specs: [{ key: 'child', type: 'acme-qa:security-scan', parent: ROOT_NODE_ID, dependsOn: [] }],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('unknown_node_type');
  });
});

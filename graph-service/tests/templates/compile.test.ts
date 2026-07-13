import { describe, expect, it } from 'vitest';
import { ROOT_NODE_ID, createNodeTypeRegistry } from '@rad-orchestration/graph-engine';
import { BUILT_IN_NODE_TYPES } from '@rad-orchestration/graph-node-types';
import { compileTemplate } from '../../src/templates/compile.js';

const registry = createNodeTypeRegistry(BUILT_IN_NODE_TYPES);

describe('compileTemplate', () => {
  it('compiles a well-formed template to the expected add_node SeedStep[]', () => {
    const source = `
template:
  id: standard-task
  version: '1.0.0'
  description: a plan followed by a task that depends on it
nodes:
  - id: plan-1
    type: rad-orc:master_plan
    order: 0
    data:
      title: plan
  - id: task-1
    type: rad-orc:task
    order: 1
    depends_on: [plan-1]
    data:
      title: task
`;
    const result = compileTemplate(source, registry);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.steps).toEqual([
      {
        primitive: 'add_node',
        id: 'plan-1',
        type: 'rad-orc:master_plan',
        parent: ROOT_NODE_ID,
        order: 0,
        data: { title: 'plan' },
        dependsOn: undefined,
      },
      {
        primitive: 'add_node',
        id: 'task-1',
        type: 'rad-orc:task',
        parent: ROOT_NODE_ID,
        order: 1,
        data: { title: 'task' },
        dependsOn: ['plan-1'],
      },
    ]);
  });

  it('defaults a node’s order to its declaration index when omitted', () => {
    const source = `
template:
  id: default-order
  version: '1.0.0'
  description: no explicit order
nodes:
  - id: a
    type: rad-orc:task
  - id: b
    type: rad-orc:task
`;
    const result = compileTemplate(source, registry);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.steps.map((step) => (step.primitive === 'add_node' ? [step.id, step.order] : null))).toEqual([
      ['a', 0],
      ['b', 1],
    ]);
  });

  it('rejects a node referencing a type absent from the registry', () => {
    const source = `
template:
  id: unknown-type
  version: '1.0.0'
  description: references a type the registry does not know
nodes:
  - id: task-1
    type: rad-orc:nonexistent
`;
    const result = compileTemplate(source, registry);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('unknown_type');
    expect(result.error.nodeId).toBe('task-1');
  });

  it('rejects a dependency cycle over depends_on', () => {
    const source = `
template:
  id: cyclic
  version: '1.0.0'
  description: a -> b -> a
nodes:
  - id: a
    type: rad-orc:task
    depends_on: [b]
  - id: b
    type: rad-orc:task
    depends_on: [a]
`;
    const result = compileTemplate(source, registry);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('cycle');
  });

  it('rejects unparseable YAML', () => {
    const source = `
template:
  id: [unterminated
`;
    const result = compileTemplate(source, registry);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('parse');
  });

  it('rejects a template document missing the required template/nodes shape', () => {
    const source = `
nodes:
  - id: task-1
    type: rad-orc:task
`;
    const result = compileTemplate(source, registry);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('malformed');
  });

  it('rejects a node declaration missing its required id', () => {
    const source = `
template:
  id: malformed-node
  version: '1.0.0'
  description: a node with no id
nodes:
  - type: rad-orc:task
`;
    const result = compileTemplate(source, registry);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('malformed');
  });

  it('emits no steps on any failure (all-or-nothing)', () => {
    const source = `
template:
  id: partial-then-fail
  version: '1.0.0'
  description: a valid node followed by an unknown type
nodes:
  - id: task-1
    type: rad-orc:task
  - id: task-2
    type: rad-orc:nonexistent
`;
    const result = compileTemplate(source, registry);

    expect(result.ok).toBe(false);
    expect('steps' in result).toBe(false);
  });
});

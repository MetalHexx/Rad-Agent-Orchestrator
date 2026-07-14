// Proves the shipping templates under runtime-config/node-graph-templates/ compile to the
// documented SeedStep[] shape — not a content-assertion on the YAML/prose itself.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ROOT_NODE_ID, createNodeTypeRegistry } from '@rad-orchestration/graph-engine';
import { BUILT_IN_NODE_TYPES } from '@rad-orchestration/graph-node-types';
import greetNodeType from '../../../examples/example/dist/greet.js';
import { compileTemplate } from '../../src/templates/compile.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const TEMPLATES_DIR = path.join(REPO_ROOT, 'runtime-config', 'node-graph-templates');

function readTemplate(fileName: string): string {
  return fs.readFileSync(path.join(TEMPLATES_DIR, fileName), 'utf8');
}

describe('rad-orc-coding.yml (the maximal template)', () => {
  const registry = createNodeTypeRegistry(BUILT_IN_NODE_TYPES);

  it('compiles to the four-node spine with the maximal cadence and plan-level approval', () => {
    const result = compileTemplate(readTemplate('rad-orc-coding.yml'), registry);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.steps).toEqual([
      {
        primitive: 'add_node',
        id: 'master_plan',
        type: 'rad-orc:master_plan',
        parent: ROOT_NODE_ID,
        order: 0,
        data: { requirementsDocPath: 'docs/requirements.md' },
        dependsOn: undefined,
      },
      {
        primitive: 'add_node',
        id: 'plan_audit',
        type: 'rad-orc:plan_audit',
        parent: ROOT_NODE_ID,
        order: 1,
        data: undefined,
        dependsOn: ['master_plan'],
      },
      {
        primitive: 'add_node',
        id: 'explosion',
        type: 'rad-orc:explosion',
        parent: ROOT_NODE_ID,
        order: 2,
        data: {
          cadence: {
            perTask: ['rad-orc:code_review'],
            perPhase: ['rad-orc:code_review'],
            spine: ['rad-orc:code_review', 'rad-orc:pr', 'rad-orc:approval'],
          },
        },
        dependsOn: ['plan_audit'],
      },
      {
        primitive: 'add_node',
        id: 'plan_approval',
        type: 'rad-orc:approval',
        parent: ROOT_NODE_ID,
        order: 3,
        data: { level: 'plan' },
        dependsOn: ['explosion'],
      },
    ]);
  });
});

describe('example-greet.yml (the companion template)', () => {
  const registry = createNodeTypeRegistry(BUILT_IN_NODE_TYPES, [greetNodeType]);

  it('compiles to a single add_node step of type example:greet', () => {
    const result = compileTemplate(readTemplate('example-greet.yml'), registry);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.steps).toEqual([
      {
        primitive: 'add_node',
        id: 'greet',
        type: 'example:greet',
        parent: ROOT_NODE_ID,
        order: 0,
        data: undefined,
        dependsOn: undefined,
      },
    ]);
  });
});

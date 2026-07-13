import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createNodeTypeRegistry } from '@rad-orchestration/graph-engine';
import { BUILT_IN_NODE_TYPES } from '@rad-orchestration/graph-node-types';
import { discoverCustomNodeTypes } from '../../src/node-types/scan.js';

const EXAMPLE_PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../examples/example');

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'graph-service-node-types-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

async function copyExamplePackage(): Promise<void> {
  const dest = path.join(root, 'custom', 'example');
  await fs.mkdir(dest, { recursive: true });
  await fs.cp(EXAMPLE_PACKAGE_DIR, dest, { recursive: true });
}

async function writePackage(pkgName: string, manifestYaml: string, files: Readonly<Record<string, string>>): Promise<void> {
  const dir = path.join(root, 'custom', pkgName);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'manifest.yml'), manifestYaml, 'utf8');
  for (const [name, content] of Object.entries(files)) {
    await fs.writeFile(path.join(dir, name), content, 'utf8');
  }
}

function manifestFor(namespace: string, name: string, entrypoint: string): string {
  return `namespace: ${namespace}\nversion: "1.0.0"\ndescription: "test fixture"\nnodeTypes:\n  - name: ${name}\n    entrypoint: ${entrypoint}\n`;
}

function definitionModule(name: string): string {
  return [
    'export default {',
    `  name: '${name}',`,
    '  dataSchema: {},',
    '  traits: [],',
    '  capabilities: [],',
    "  presentation: { label: 'Fixture' },",
    "  instructions: 'fixture instructions',",
    "  act() { return { instructions: '', executor: 'orchestrator-inline' }; },",
    '  handle() { return {}; },',
    "  projectStatus() { return 'not_started'; },",
    '};',
    '',
  ].join('\n');
}

describe('discoverCustomNodeTypes', () => {
  it('loads the example package into customs with no errors, and resolves through createNodeTypeRegistry', async () => {
    await copyExamplePackage();

    const result = await discoverCustomNodeTypes(root);

    expect(result.errors).toEqual([]);
    expect(result.customs).toHaveLength(1);
    expect(result.customs[0]?.name).toBe('example:greet');

    const registry = createNodeTypeRegistry(BUILT_IN_NODE_TYPES, result.customs);
    expect(registry.resolve('example:greet')).toBe(result.customs[0]);
  });

  it('returns an empty result when there is no custom subtree at all', async () => {
    const result = await discoverCustomNodeTypes(root);
    expect(result).toEqual({ customs: [], errors: [] });
  });

  it('collects a named load error for a module that throws on import, and excludes it from customs', async () => {
    await writePackage('broken', manifestFor('broken', 'broken:thing', './thing.js'), {
      'thing.js': "throw new Error('boom');\n",
    });

    const result = await discoverCustomNodeTypes(root);

    expect(result.customs).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.package).toBe('broken');
    expect(result.errors[0]?.entrypoint).toBe('./thing.js');
    expect(result.errors[0]?.reason).toContain('boom');
  });

  it('collects a named load error for an ill-shaped default export (missing hooks), and excludes it from customs', async () => {
    await writePackage('shapeless', manifestFor('shapeless', 'shapeless:thing', './thing.js'), {
      'thing.js': "export default { name: 'shapeless:thing' };\n",
    });

    const result = await discoverCustomNodeTypes(root);

    expect(result.customs).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.package).toBe('shapeless');
    expect(result.errors[0]?.reason).toContain('act');
  });

  it('collects a named load error when the exported name does not match the manifest-declared name', async () => {
    await writePackage('mismatch', manifestFor('mismatch', 'mismatch:thing', './thing.js'), {
      'thing.js': definitionModule('other:thing'),
    });

    const result = await discoverCustomNodeTypes(root);

    expect(result.customs).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.package).toBe('mismatch');
    expect(result.errors[0]?.reason).toContain('mismatch:thing');
  });

  it('collects a named load error when the manifest declares a name outside its own namespace', async () => {
    await writePackage('outsider', manifestFor('outsider', 'other:thing', './thing.js'), {
      'thing.js': definitionModule('other:thing'),
    });

    const result = await discoverCustomNodeTypes(root);

    expect(result.customs).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.package).toBe('outsider');
    expect(result.errors[0]?.reason).toContain('outsider');
  });

  it('never reads the builtin/ subtree', async () => {
    await fs.mkdir(path.join(root, 'builtin', 'whatever'), { recursive: true });
    await fs.writeFile(path.join(root, 'builtin', 'whatever', 'manifest.yml'), manifestFor('builtin-pkg', 'builtin-pkg:x', './x.js'), 'utf8');

    const result = await discoverCustomNodeTypes(root);

    expect(result).toEqual({ customs: [], errors: [] });
  });
});

describe('createNodeTypeRegistry defers the reserved-prefix and uniqueness rules', () => {
  it('the loader lets a rad-orc:-namespaced custom through; the registry throws constructing it', async () => {
    await writePackage('impersonator', manifestFor('rad-orc', 'rad-orc:impersonator', './impersonator.js'), {
      'impersonator.js': definitionModule('rad-orc:impersonator'),
    });

    const result = await discoverCustomNodeTypes(root);
    expect(result.errors).toEqual([]);
    expect(result.customs).toHaveLength(1);

    expect(() => createNodeTypeRegistry(BUILT_IN_NODE_TYPES, result.customs)).toThrow(/rad-orc:impersonator/);
  });

  it('the loader lets two customs sharing a name through; the registry throws constructing it', async () => {
    await writePackage('dup-a', manifestFor('dup', 'dup:thing', './thing.js'), { 'thing.js': definitionModule('dup:thing') });
    await writePackage('dup-b', manifestFor('dup', 'dup:thing', './thing.js'), { 'thing.js': definitionModule('dup:thing') });

    const result = await discoverCustomNodeTypes(root);
    expect(result.errors).toEqual([]);
    expect(result.customs).toHaveLength(2);

    expect(() => createNodeTypeRegistry(BUILT_IN_NODE_TYPES, result.customs)).toThrow(/dup:thing/);
  });
});

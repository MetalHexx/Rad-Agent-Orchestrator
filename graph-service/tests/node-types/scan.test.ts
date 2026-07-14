import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createNodeTypeRegistry } from '@rad-orchestration/graph-engine';
import { BUILT_IN_NODE_TYPES } from '@rad-orchestration/graph-node-types';
import { discoverCustomNodeTypes, discoverNodeTypes } from '../../src/node-types/scan.js';

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

async function writeSubtreePackage(
  subtree: 'builtin' | 'custom',
  pkgName: string,
  manifestYaml: string,
  files: Readonly<Record<string, string>>,
): Promise<void> {
  const dir = path.join(root, subtree, pkgName);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'manifest.yml'), manifestYaml, 'utf8');
  for (const [name, content] of Object.entries(files)) {
    await fs.writeFile(path.join(dir, name), content, 'utf8');
  }
}

async function writePackage(pkgName: string, manifestYaml: string, files: Readonly<Record<string, string>>): Promise<void> {
  await writeSubtreePackage('custom', pkgName, manifestYaml, files);
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

  it('collects a named load error when the entrypoint resolves outside the package directory', async () => {
    await writePackage('escapee', manifestFor('escapee', 'escapee:thing', '../../../etc/passwd'), {});

    const result = await discoverCustomNodeTypes(root);

    expect(result.customs).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.package).toBe('escapee');
    expect(result.errors[0]?.entrypoint).toBe('../../../etc/passwd');
    expect(result.errors[0]?.reason).toContain('outside the package directory');
  });

  it('collects a named load error when the entrypoint is an absolute path', async () => {
    const outside = path.join(root, 'outside.js');
    await fs.writeFile(outside, "export default {};\n", 'utf8');
    await writePackage('absolutist', manifestFor('absolutist', 'absolutist:thing', outside), {});

    const result = await discoverCustomNodeTypes(root);

    expect(result.customs).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.package).toBe('absolutist');
    expect(result.errors[0]?.reason).toContain('outside the package directory');
  });

  it('collects a named load error when dataSchema is not an object', async () => {
    await writePackage('bad-data-schema', manifestFor('bad-data-schema', 'bad-data-schema:thing', './thing.js'), {
      'thing.js': definitionModule('bad-data-schema:thing').replace('dataSchema: {},', 'dataSchema: null,'),
    });

    const result = await discoverCustomNodeTypes(root);

    expect(result.customs).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.reason).toContain('dataSchema');
  });

  it('collects a named load error when a dataSchema field has an invalid kind', async () => {
    await writePackage('bad-field-kind', manifestFor('bad-field-kind', 'bad-field-kind:thing', './thing.js'), {
      'thing.js': definitionModule('bad-field-kind:thing').replace(
        'dataSchema: {},',
        "dataSchema: { foo: { kind: 'not-a-kind', level: 'optional' } },",
      ),
    });

    const result = await discoverCustomNodeTypes(root);

    expect(result.customs).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.reason).toContain('dataSchema.foo');
  });

  it('collects a named load error when traits is not an array', async () => {
    await writePackage('bad-traits', manifestFor('bad-traits', 'bad-traits:thing', './thing.js'), {
      'thing.js': definitionModule('bad-traits:thing').replace('traits: [],', 'traits: {},'),
    });

    const result = await discoverCustomNodeTypes(root);

    expect(result.customs).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.reason).toContain('traits');
  });

  it('collects a named load error when capabilities is not an array', async () => {
    await writePackage('bad-capabilities', manifestFor('bad-capabilities', 'bad-capabilities:thing', './thing.js'), {
      'thing.js': definitionModule('bad-capabilities:thing').replace('capabilities: [],', 'capabilities: null,'),
    });

    const result = await discoverCustomNodeTypes(root);

    expect(result.customs).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.reason).toContain('capabilities');
  });

  it('collects a named load error when instructions is not a string', async () => {
    await writePackage('bad-instructions', manifestFor('bad-instructions', 'bad-instructions:thing', './thing.js'), {
      'thing.js': definitionModule('bad-instructions:thing').replace("instructions: 'fixture instructions',", 'instructions: 123,'),
    });

    const result = await discoverCustomNodeTypes(root);

    expect(result.customs).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.reason).toContain('instructions');
  });

  it('collects a named load error when presentation is missing a string label', async () => {
    await writePackage('bad-presentation', manifestFor('bad-presentation', 'bad-presentation:thing', './thing.js'), {
      'thing.js': definitionModule('bad-presentation:thing').replace("presentation: { label: 'Fixture' },", 'presentation: { description: "no label" },'),
    });

    const result = await discoverCustomNodeTypes(root);

    expect(result.customs).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.reason).toContain('presentation');
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

describe('discoverNodeTypes', () => {
  it('returns empty buckets when neither subtree exists', async () => {
    const result = await discoverNodeTypes(root);
    expect(result).toEqual({ builtins: [], customs: [], errors: [] });
  });

  it('loads a rad-orc:-namespaced builtin/ package into builtins and a custom/ package into customs', async () => {
    await writeSubtreePackage('builtin', 'core', manifestFor('rad-orc', 'rad-orc:core-thing', './thing.js'), {
      'thing.js': definitionModule('rad-orc:core-thing'),
    });
    await copyExamplePackage();

    const result = await discoverNodeTypes(root);

    expect(result.errors).toEqual([]);
    expect(result.builtins).toHaveLength(1);
    expect(result.builtins[0]?.name).toBe('rad-orc:core-thing');
    expect(result.customs).toHaveLength(1);
    expect(result.customs[0]?.name).toBe('example:greet');

    const registry = createNodeTypeRegistry(result.builtins, result.customs);
    expect(registry.resolve('rad-orc:core-thing')).toBe(result.builtins[0]);
    expect(registry.resolve('example:greet')).toBe(result.customs[0]);
  });

  it('loads a plain-JS package from builtin/, proving the loader is language-agnostic', async () => {
    await writeSubtreePackage('builtin', 'raw-js', manifestFor('rad-orc', 'rad-orc:raw', './raw.js'), {
      'raw.js': definitionModule('rad-orc:raw'),
    });

    const result = await discoverNodeTypes(root);

    expect(result.errors).toEqual([]);
    expect(result.builtins).toHaveLength(1);
    expect(result.builtins[0]?.name).toBe('rad-orc:raw');
  });

  it('collects a named load error for a broken builtin/ package without affecting the custom/ bucket', async () => {
    await writeSubtreePackage('builtin', 'broken', manifestFor('rad-orc', 'rad-orc:broken', './thing.js'), {
      'thing.js': "throw new Error('boom');\n",
    });
    await copyExamplePackage();

    const result = await discoverNodeTypes(root);

    expect(result.builtins).toEqual([]);
    expect(result.customs).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.package).toBe('broken');
    expect(result.errors[0]?.reason).toContain('boom');
  });

  it('lets a custom/ package claim a rad-orc: name structurally, then rejects it when passed as customs to the registry', async () => {
    await writeSubtreePackage('custom', 'impersonator', manifestFor('rad-orc', 'rad-orc:impersonator', './thing.js'), {
      'thing.js': definitionModule('rad-orc:impersonator'),
    });

    const result = await discoverNodeTypes(root);

    expect(result.errors).toEqual([]);
    expect(result.customs).toHaveLength(1);
    expect(result.customs[0]?.name).toBe('rad-orc:impersonator');

    expect(() => createNodeTypeRegistry(result.builtins, result.customs)).toThrow(/rad-orc:impersonator/);
  });
});

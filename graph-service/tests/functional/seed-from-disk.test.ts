// graph-service/tests/functional/seed-from-disk.test.ts
//
// End-to-end proof of the whole seed-from-disk chain over real HTTP + real capabilities: a shipped
// `runtime-config/node-graph-templates/*.yml` template, read off disk, compiled by `compileTemplate`
// against a registry, and replayed into a real daemon's store via `seed`, then driven to its first
// frontier over the wire. Two scenarios: the maximal template compiled against `BUILT_IN_NODE_TYPES`
// alone, and the `example:greet` companion compiled against a registry built from customs the
// daemon's own `start()` scan discovered — proving compilation only succeeds because that scan ran
// first.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ROOT_NODE_ID, createNodeTypeRegistry } from '@rad-orchestration/graph-engine';
import { BUILT_IN_NODE_TYPES } from '@rad-orchestration/graph-node-types';
import type { BootedDaemon } from '../harness/boot.js';
import { bootDaemon } from '../harness/boot.js';
import { dag, frontier, seed, submitEvent } from '../harness/drive.js';
import { discoverCustomNodeTypes } from '../../src/node-types/scan.js';
import { compileTemplate } from '../../src/templates/compile.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const TEMPLATES_DIR = path.join(REPO_ROOT, 'runtime-config', 'node-graph-templates');
const EXAMPLE_PACKAGE_DIR = path.join(REPO_ROOT, 'examples', 'example');

function readTemplate(fileName: string): Promise<string> {
  return fs.readFile(path.join(TEMPLATES_DIR, fileName), 'utf8');
}

describe('functional: seed-from-disk', () => {
  describe('the maximal template (built-ins only)', () => {
    let daemon: BootedDaemon;

    beforeEach(async () => {
      daemon = await bootDaemon();
    });

    afterEach(async () => {
      await daemon.teardown();
    });

    it('compiles rad-orc-coding.yml against the built-in registry, seeds the four-node spine, and stops the drive at master_plan', async () => {
      const project = 'seed-from-disk-maximal';
      const registry = createNodeTypeRegistry(BUILT_IN_NODE_TYPES);
      const source = await readTemplate('rad-orc-coding.yml');
      const compiled = compileTemplate(source, registry);
      expect(compiled.ok).toBe(true);
      if (!compiled.ok) return;

      await seed(daemon.baseUrl(), project, compiled.steps);

      const snapshot = await dag(daemon.baseUrl(), project);
      const byId = new Map(snapshot.nodes.map((node) => [node.id, node]));
      expect(byId.get('master_plan')).toMatchObject({ type: 'rad-orc:master_plan', parent: ROOT_NODE_ID, order: 0 });
      expect(byId.get('plan_audit')).toMatchObject({ type: 'rad-orc:plan_audit', parent: ROOT_NODE_ID, order: 1 });
      expect(byId.get('explosion')).toMatchObject({ type: 'rad-orc:explosion', parent: ROOT_NODE_ID, order: 2 });
      expect(byId.get('plan_approval')).toMatchObject({ type: 'rad-orc:approval', parent: ROOT_NODE_ID, order: 3 });

      // plan_audit sits between master_plan and explosion: the dependency chain runs through it,
      // not around it.
      const edgeKeys = new Set(snapshot.edges.map((edge) => `${edge.from}->${edge.to}`));
      expect(edgeKeys.has('master_plan->plan_audit')).toBe(true);
      expect(edgeKeys.has('plan_audit->explosion')).toBe(true);
      expect(edgeKeys.has('explosion->plan_approval')).toBe(true);
      expect(edgeKeys.has('master_plan->explosion')).toBe(false);

      expect((await frontier(daemon.baseUrl(), project)).map((node) => node.id)).toEqual(['master_plan']);

      // The first external-actor stop: master_plan is orchestrator-inline, so a no-event
      // submit-event bootstrap engages it and stops there rather than auto-resolving through it.
      const result = await submitEvent(daemon.baseUrl(), project, ROOT_NODE_ID);
      expect(result.node).toBe('master_plan');
      expect(result.action).toBe('rad-orc:master_plan');
      expect(result.executor).toBe('orchestrator-inline');
    });
  });

  describe('the custom path (example:greet)', () => {
    let daemon: BootedDaemon;
    let nodeTypesRoot: string;

    beforeEach(async () => {
      daemon = await bootDaemon({
        stageNodeTypes: async (root) => {
          nodeTypesRoot = path.join(root, 'node-types');
          const dest = path.join(nodeTypesRoot, 'custom', 'example');
          await fs.mkdir(dest, { recursive: true });
          await fs.cp(EXAMPLE_PACKAGE_DIR, dest, { recursive: true });
        },
      });
    });

    afterEach(async () => {
      await daemon.teardown();
    });

    it('compiles example-greet.yml against the daemon-scanned customs, seeds the one-node project, and surfaces the greet instruction on drive', async () => {
      const project = 'seed-from-disk-custom';

      // Built from the same scan `start()` ran before this daemon ever came up — proving the
      // template only compiles because that scan already registered `example:greet`.
      const { customs, errors } = await discoverCustomNodeTypes(nodeTypesRoot);
      expect(errors).toEqual([]);
      const registry = createNodeTypeRegistry(BUILT_IN_NODE_TYPES, customs);

      const source = await readTemplate('example-greet.yml');
      const compiled = compileTemplate(source, registry);
      expect(compiled.ok).toBe(true);
      if (!compiled.ok) return;

      await seed(daemon.baseUrl(), project, compiled.steps);
      expect((await frontier(daemon.baseUrl(), project)).map((node) => node.id)).toEqual(['greet']);

      const result = await submitEvent(daemon.baseUrl(), project, ROOT_NODE_ID);
      expect(result.node).toBe('greet');
      expect(result.action).toBe('example:greet');
      expect(result.executor).toBe('orchestrator-inline');
      // `instructions` is relayed from the type's own static declaration (never a per-invocation
      // `act()` value) — `example:greet`'s per-node greeting text lives in its opaque `data`/payload,
      // not this field.
      expect(result.instructions).toContain('example:greet');
    });
  });
});

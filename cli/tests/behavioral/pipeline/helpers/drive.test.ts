import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildWorld } from './world.js';
import { useRealCatalog } from './catalog.js';
import { driveToNode, EVENT_CHAINS } from './drive.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const EXTRA_HIGH_PATH = path.resolve(__dirname, '../../../../../runtime-config/templates/extra-high.yml');
const EXTRA_HIGH_BODY = fs.readFileSync(EXTRA_HIGH_PATH, 'utf8');

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });
beforeEach(() => { cleanups.push(useRealCatalog()); });

describe('driveToNode helper', () => {
  it('exposes a chain map keyed by every step id in extra-high.yml that the suite asserts on', () => {
    for (const target of ['master_plan', 'explode_master_plan', 'final_review',
                          'task_executor', 'code_review', 'phase_review', 'final_pr']) {
      expect(EVENT_CHAINS).toHaveProperty(target);
      expect(Array.isArray(EVENT_CHAINS[target as keyof typeof EVENT_CHAINS])).toBe(true);
    }
  });

  it('drives the engine to master_plan with a single start signal and returns a result', async () => {
    const world = buildWorld({
      template: { id: 'extra-high', body: EXTRA_HIGH_BODY },
      state: null,
      config: { default_template: 'extra-high' },
      sideFiles: [],
    });
    cleanups.push(world.cleanup);
    const result = await driveToNode(world, 'master_plan');
    expect(result.action).toBe('spawn_master_plan');
  });
});

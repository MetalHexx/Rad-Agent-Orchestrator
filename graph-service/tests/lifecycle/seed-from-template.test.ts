import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { seedFromTemplateInProcess } from '../../src/lifecycle/seed-from-template.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const MAXIMAL_TEMPLATE_PATH = path.join(REPO_ROOT, 'runtime-config', 'node-graph-templates', 'rad-orc-coding.yml');

let root: string;
let dbPath: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'graph-service-seed-'));
  dbPath = path.join(root, 'seed.db');
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('seedFromTemplateInProcess', () => {
  it('compiles the maximal template and replays it into the expected four-node spine', async () => {
    const result = await seedFromTemplateInProcess({
      templatePath: MAXIMAL_TEMPLATE_PATH,
      project: 'proj-1',
      root,
      dbPath,
    });

    // master_plan, plan_audit, explosion, plan_approval — each of the latter three `depends_on`
    // the one before it, so three `depends_on` edges land alongside the four nodes.
    expect(result).toEqual({ project: 'proj-1', nodesCreated: 4, edgesCreated: 3 });
  });

  it('propagates a template compile error instead of seeding anything', async () => {
    const badTemplatePath = path.join(root, 'bad.yml');
    await fs.writeFile(
      badTemplatePath,
      [
        'template:',
        '  id: bad',
        "  version: '1.0.0'",
        '  description: references an unregistered type',
        'nodes:',
        '  - id: mystery',
        '    type: not-a-real:type',
      ].join('\n'),
      'utf8',
    );

    await expect(
      seedFromTemplateInProcess({ templatePath: badTemplatePath, project: 'proj-2', root, dbPath }),
    ).rejects.toThrow(/unknown_type|not-a-real:type/);
  });
});

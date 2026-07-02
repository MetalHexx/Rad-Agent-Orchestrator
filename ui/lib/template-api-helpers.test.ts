/**
 * Tests for ui/lib/template-api-helpers.ts
 * Run with: npx tsx --test ui/lib/template-api-helpers.test.ts (from ui/ directory)
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import {
  resolveTemplateDir,
  isValidTemplateId,
  listTemplateFiles,
  readTemplateFile,
  writeTemplateFile,
  templateFileExists,
} from '@/lib/template-api-helpers';
import type { OrchestrationConfig } from '@/types/config';

/* ------------------------------------------------------------------ */
/*  Test fixtures                                                      */
/* ------------------------------------------------------------------ */

const TEMPLATE_FIXTURE = `template:
  id: test-template
  version: "1.0"
  description: A test template
nodes:
  - id: step-1
    kind: step
    label: Test Step
    depends_on: []
    action: do-something
`;

const MINIMAL_CONFIG: OrchestrationConfig = {
  version: '4',
  limits: {
    max_retries_per_task: 2,
  },
  human_gates: {
    after_planning: true,
    execution_mode: 'ask',
    after_final_review: true,
  },
  source_control: {
    auto_commit: 'always',
    auto_pr: 'ask',
  },
};

/* ------------------------------------------------------------------ */
/*  Tests                                                               */
/* ------------------------------------------------------------------ */

describe('resolveTemplateDir', () => {
  it('returns ~/.radorc/templates regardless of workspaceRoot', () => {
    const result = resolveTemplateDir('/workspace', MINIMAL_CONFIG);
    assert.equal(result, path.join(os.homedir(), '.radorc', 'templates'));
  });

  it('returns the same path for any config', () => {
    const result = resolveTemplateDir('/workspace', MINIMAL_CONFIG);
    assert.equal(result, path.join(os.homedir(), '.radorc', 'templates'));
  });

  it('returns the same path regardless of workspaceRoot argument', () => {
    const result1 = resolveTemplateDir('/my/workspace', MINIMAL_CONFIG);
    const result2 = resolveTemplateDir('/other/path', MINIMAL_CONFIG);
    const expected = path.join(os.homedir(), '.radorc', 'templates');
    assert.equal(result1, expected);
    assert.equal(result2, expected);
  });
});

describe('isValidTemplateId', () => {
  it('returns true for valid IDs', () => {
    assert.equal(isValidTemplateId('full'), true);
    assert.equal(isValidTemplateId('quick'), true);
    assert.equal(isValidTemplateId('my-template'), true);
    assert.equal(isValidTemplateId('template_v2'), true);
    assert.equal(isValidTemplateId('ABC123'), true);
  });

  it('returns false for path traversal: ../etc/passwd', () => {
    assert.equal(isValidTemplateId('../etc/passwd'), false);
  });

  it('returns false for path with forward slash: foo/bar', () => {
    assert.equal(isValidTemplateId('foo/bar'), false);
  });

  it('returns false for path with backslash: foo\\bar', () => {
    assert.equal(isValidTemplateId('foo\\bar'), false);
  });

  it('returns false for dot-prefixed: .hidden', () => {
    assert.equal(isValidTemplateId('.hidden'), false);
  });

  it('returns false for ID with space: has space', () => {
    assert.equal(isValidTemplateId('has space'), false);
  });

  it('returns false for empty string', () => {
    assert.equal(isValidTemplateId(''), false);
  });
});

describe('listTemplateFiles / readTemplateFile / writeTemplateFile / templateFileExists', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'tpl-helpers-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true });
  });

  // listTemplateFiles

  it('listTemplateFiles returns TemplateSummary[] for .yml files', async () => {
    await writeFile(path.join(tmpDir, 'test-template.yml'), TEMPLATE_FIXTURE, 'utf-8');
    const result = await listTemplateFiles(tmpDir);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'test-template');
    assert.equal(result[0].description, 'A test template');
    assert.equal(result[0].version, '1.0');
  });

  it('listTemplateFiles returns empty array for empty directory', async () => {
    const result = await listTemplateFiles(tmpDir);
    assert.deepEqual(result, []);
  });

  it('listTemplateFiles skips non-.yml files', async () => {
    await writeFile(path.join(tmpDir, 'readme.md'), '# readme', 'utf-8');
    await writeFile(path.join(tmpDir, 'notes.txt'), 'notes', 'utf-8');
    const result = await listTemplateFiles(tmpDir);
    assert.deepEqual(result, []);
  });

  it('listTemplateFiles skips .yml files that fail to parse', async () => {
    await writeFile(path.join(tmpDir, 'good.yml'), TEMPLATE_FIXTURE, 'utf-8');
    await writeFile(path.join(tmpDir, 'bad.yml'), ':: invalid yaml ::', 'utf-8');
    const result = await listTemplateFiles(tmpDir);
    // bad.yml either fails to parse or parses without template key — either way skip it
    // but good.yml should still appear
    const ids = result.map(r => r.id);
    assert.ok(ids.includes('good'), `expected "good" in [${ids.join(', ')}]`);
    assert.ok(!ids.includes('bad'), 'bad.yml should be excluded from results');
  });

  it('listTemplateFiles returns multiple summaries', async () => {
    const fixture2 = TEMPLATE_FIXTURE.replace('test-template', 'other-template')
      .replace('A test template', 'Another template')
      .replace('"1.0"', '"2.0"');
    await writeFile(path.join(tmpDir, 'test-template.yml'), TEMPLATE_FIXTURE, 'utf-8');
    await writeFile(path.join(tmpDir, 'other-template.yml'), fixture2, 'utf-8');
    const result = await listTemplateFiles(tmpDir);
    assert.equal(result.length, 2);
    const ids = result.map(r => r.id).sort();
    assert.deepEqual(ids, ['other-template', 'test-template']);
  });

  it('listTemplateFiles populates status when template.status is set in YAML', async () => {
    const fixtureWithStatus = `template:
  id: deprecated-thing
  version: "0.1"
  description: An old template
  status: deprecated
nodes:
  - id: step-1
    kind: step
    label: Test Step
    depends_on: []
    action: do-something
`;
    await writeFile(path.join(tmpDir, 'deprecated-thing.yml'), fixtureWithStatus, 'utf-8');
    const result = await listTemplateFiles(tmpDir);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'deprecated-thing');
    assert.equal(result[0].status, 'deprecated');
  });

  it('listTemplateFiles leaves status undefined when YAML has no template.status', async () => {
    await writeFile(path.join(tmpDir, 'test-template.yml'), TEMPLATE_FIXTURE, 'utf-8');
    const result = await listTemplateFiles(tmpDir);
    assert.equal(result.length, 1);
    assert.equal(result[0].status, undefined);
  });

  // readTemplateFile

  it('readTemplateFile returns rawYaml and definition for existing template', async () => {
    await writeFile(path.join(tmpDir, 'test-template.yml'), TEMPLATE_FIXTURE, 'utf-8');
    const result = await readTemplateFile(tmpDir, 'test-template');
    assert.ok(result !== null);
    assert.equal(typeof result.rawYaml, 'string');
    assert.ok(result.rawYaml.includes('test-template'));
    assert.equal(result.definition.template.id, 'test-template');
    assert.equal(result.definition.template.version, '1.0');
    assert.equal(result.definition.template.description, 'A test template');
    assert.equal(result.definition.nodes.length, 1);
  });

  it('readTemplateFile returns null for non-existent ID', async () => {
    const result = await readTemplateFile(tmpDir, 'does-not-exist');
    assert.equal(result, null);
  });

  // writeTemplateFile

  it('writeTemplateFile writes content to {id}.yml', async () => {
    await writeTemplateFile(tmpDir, 'new-template', TEMPLATE_FIXTURE);
    const result = await readTemplateFile(tmpDir, 'new-template');
    assert.ok(result !== null);
    assert.equal(result.definition.template.id, 'test-template');
  });

  it('writeTemplateFile writes atomically — final file has correct content', async () => {
    const content = TEMPLATE_FIXTURE;
    await writeTemplateFile(tmpDir, 'atomic-test', content);
    const exists = await templateFileExists(tmpDir, 'atomic-test');
    assert.equal(exists, true);
    const result = await readTemplateFile(tmpDir, 'atomic-test');
    assert.ok(result !== null);
    assert.equal(result.rawYaml, content);
  });

  it('writeTemplateFile overwrites existing file', async () => {
    await writeFile(path.join(tmpDir, 'update-me.yml'), TEMPLATE_FIXTURE, 'utf-8');
    const updated = TEMPLATE_FIXTURE.replace('A test template', 'Updated description');
    await writeTemplateFile(tmpDir, 'update-me', updated);
    const result = await readTemplateFile(tmpDir, 'update-me');
    assert.ok(result !== null);
    assert.equal(result.definition.template.description, 'Updated description');
  });

  // templateFileExists

  it('templateFileExists returns true for existing template', async () => {
    await writeFile(path.join(tmpDir, 'existing.yml'), TEMPLATE_FIXTURE, 'utf-8');
    const result = await templateFileExists(tmpDir, 'existing');
    assert.equal(result, true);
  });

  it('templateFileExists returns false for non-existent template', async () => {
    const result = await templateFileExists(tmpDir, 'missing');
    assert.equal(result, false);
  });
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILLS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), '..');

test('rad-execute-parallel skill folder is removed at source (FR-2, AD-5)', () => {
  assert.ok(!fs.existsSync(path.join(SKILLS, 'rad-execute-parallel')),
    'rad-execute-parallel/ must not exist — adapter discovery drops it everywhere');
});

test('non-DAG worktree tooling is left untouched (NFR-2)', () => {
  assert.ok(fs.existsSync(path.join(SKILLS, 'rad-source-control')),
    'rad-source-control skill remains');
  assert.ok(fs.existsSync(path.join(
    SKILLS, 'rad-source-control/references/working-with-worktrees.md')),
    'working-with-worktrees.md remains usable outside the pipeline');
});

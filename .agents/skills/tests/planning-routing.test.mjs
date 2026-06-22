import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILLS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), '..');
const plan = fs.readFileSync(path.join(SKILLS, 'rad-plan/SKILL.md'), 'utf8');
const approve = fs.readFileSync(
  path.join(SKILLS, 'rad-approve-plan/SKILL.md'), 'utf8');

test('rad-plan routes only to rad-execute (FR-13, FR-17)', () => {
  assert.doesNotMatch(plan, /rad-execute-parallel/);
  assert.match(plan, /\/rad-execute\b/);
});

test('rad-approve-plan routes only to rad-execute (FR-13, FR-17)', () => {
  assert.doesNotMatch(approve, /rad-execute-parallel/);
  assert.match(approve, /\/rad-execute\b/);
});

test('rad-approve-plan frontmatter description has no parallel reference (FR-17)', () => {
  const fm = approve.split('---')[1] ?? '';
  assert.doesNotMatch(fm, /rad-execute-parallel/);
});

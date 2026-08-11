import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isProjectDirName } from './project-name';

test('rejects the four known non-project directories', () => {
  assert.equal(isProjectDirName('.git'), false);
  assert.equal(isProjectDirName('_archived'), false);
  assert.equal(isProjectDirName('_future'), false);
  assert.equal(isProjectDirName('C--Users-Metal--radorc-worktrees-MULTI-REPO-6'), false);
});

test('admits dotted version names', () => {
  assert.equal(isProjectDirName('TELEMETRY-5.2.1'), true);
  assert.equal(isProjectDirName('GLOBAL-WORKSPACES-1.3.2-HARNESS-VERSION-TRACKING'), true);
});

test('admits plain hyphenated names', () => {
  assert.equal(isProjectDirName('AIOPS-91-PROJECT-LEAK'), true);
});

test('admits digit-initial names', () => {
  assert.equal(isProjectDirName('42-SOMETHING'), true);
});

test('rejects lowercase and mixed-case names', () => {
  assert.equal(isProjectDirName('lowercase-project'), false);
  assert.equal(isProjectDirName('Mixed-Case'), false);
});

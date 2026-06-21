import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import type { Registry } from '@rad-orchestration/repo-registry';
import { computeSnapshot } from './read-shape.js';

function fixture(localPaths: Record<string, string>): Registry {
  return {
    repos: { 'checkout-api': { remote: 'github.com/acme/checkout-api', default_branch: 'main', description: 'Checkout svc' } },
    repoGroups: { checkout: { description: 'Payments domain', members: ['checkout-api'] } },
    localPaths,
  };
}

test('repo maps default_branch->defaultBranch, resolves groups, omits no fields (FR-3)', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'rs-'));
  try {
    const snap = computeSnapshot(fixture({ 'checkout-api': dir }));
    const repo = snap.repos.find(r => r.slug === 'checkout-api')!;
    assert.equal(repo.remote, 'github.com/acme/checkout-api');
    assert.equal(repo.defaultBranch, 'main');
    assert.equal(repo.description, 'Checkout svc');
    assert.deepEqual(repo.groups, ['checkout']);
    assert.equal('default_branch' in (repo as unknown as Record<string, unknown>), false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('repo-group maps members and carries no bind field (FR-3)', () => {
  const snap = computeSnapshot(fixture({}));
  const grp = snap.repoGroups.find(g => g.slug === 'checkout')!;
  assert.deepEqual(grp.members, ['checkout-api']);
  assert.equal('bind' in (grp as unknown as Record<string, unknown>), false);
});

test('bind is bound when path resolves to a directory (FR-4, DD-3)', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'rs-'));
  try {
    const repo = computeSnapshot(fixture({ 'checkout-api': dir })).repos[0];
    assert.deepEqual(repo.bind, { state: 'bound', path: dir });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('bind is missing when path is recorded but gone (FR-4, DD-3)', () => {
  const repo = computeSnapshot(fixture({ 'checkout-api': 'C:\\nope\\gone-xyz' })).repos[0];
  assert.equal(repo.bind.state, 'missing');
  assert.equal(repo.bind.path, 'C:\\nope\\gone-xyz');
});

test('bind is unbound with null path when no local path recorded (FR-4, DD-3)', () => {
  const repo = computeSnapshot(fixture({})).repos[0];
  assert.equal(repo.bind.state, 'unbound');
  assert.equal(repo.bind.path, null);
});

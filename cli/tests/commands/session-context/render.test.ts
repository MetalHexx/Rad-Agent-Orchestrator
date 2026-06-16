import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { addRepo, writeIdentity, createGroup } from '@rad-orchestration/repo-registry';
import { renderPreamble } from '../../../src/commands/session-context/render.js';

let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-')); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

describe('session-context preamble', () => {
  it('empty state: warm verbatim greeting wrapped in a delivery directive, no registry block', () => {
    const text = renderPreamble({ root });
    // Benign delivery directive so the assistant relays the message (not improvises).
    expect(text).toMatch(/Begin your first reply/);
    // The locked empty-state copy.
    expect(text).toMatch(/Rad Orc is ready!/);
    expect(text).toMatch(/there aren't any repositories registered yet/);
    expect(text).toMatch(/plan and make changes across them/);
    expect(text).toMatch(/\/rad-repo/);
    // Empty state never renders the registry block.
    expect(text).not.toMatch(/\[unbound\]/i);
    expect(text).not.toMatch(/your repo map is loaded/);
  });

  it('structured block: header, Repos/Repo Groups/Active/Config rows with backticked slugs and counts', () => {
    addRepo({ root, name: 'repo-one', identity: { remote: 'g', default_branch: 'main', description: '' }, localPath: '/c/one' });
    addRepo({ root, name: 'repo-two', identity: { remote: 'h', default_branch: 'main', description: '' }, localPath: '/c/two' });
    createGroup({ root, name: 'core-set', members: ['repo-one', 'repo-two'] });
    const text = renderPreamble({
      root,
      active: [{ name: 'MULTI-REPO-3', tier: 'execution' }, { name: 'PROJECT-GRAPH-1', tier: 'planning' }],
      config: { autoCommit: 'always', autoPr: 'never' },
    });
    expect(text).toMatch(/\*\*Rad Orc — environment loaded\*\*/);
    expect(text).toMatch(/\*\*Repos\*\* \(2\) · `repo-one` `repo-two`/);
    expect(text).toMatch(/\*\*Repo Groups\*\* \(1\) · `core-set`/);
    expect(text).toMatch(/\*\*Active Projects\*\* \(2\) · `MULTI-REPO-3` \(execution\) · `PROJECT-GRAPH-1` \(planning\)/);
    expect(text).toMatch(/\*\*Config\*\* · auto-commit `always` · auto-pr `never`/);
  });
  it('no active work: drops the Active row but keeps Repos and Config', () => {
    addRepo({ root, name: 'repo-one', identity: { remote: 'g', default_branch: 'main', description: '' }, localPath: '/c/one' });
    const text = renderPreamble({ root, active: [], config: { autoCommit: 'ask', autoPr: 'ask' } });
    expect(text).toMatch(/\*\*Repos\*\* \(1\)/);
    expect(text).not.toMatch(/\*\*Active Projects\*\*/);
    expect(text).toMatch(/\*\*Config\*\*/);
  });
  it('renames the Active row to Active Projects (DD-2)', () => {
    addRepo({ root, name: 'repo-one', identity: { remote: 'g', default_branch: 'main', description: '' }, localPath: '/c/one' });
    const out = renderPreamble({ root, active: [{ name: 'X', tier: 'medium' }], config: { autoCommit: 'ask', autoPr: 'ask' } });
    expect(out).toContain('**Active Projects** (1)');
    expect(out).not.toContain('**Active** (');
  });
  it('shows observability in the Config row only when enabled (FR-7, DD-1)', () => {
    addRepo({ root, name: 'repo-one', identity: { remote: 'g', default_branch: 'main', description: '' }, localPath: '/c/one' });
    const on = renderPreamble({ root, config: { autoCommit: 'ask', autoPr: 'ask', telemetryEnabled: true } });
    expect(on).toContain('observability `on`');
    const off = renderPreamble({ root, config: { autoCommit: 'ask', autoPr: 'ask', telemetryEnabled: false } });
    expect(off).not.toContain('observability');
  });
  it('unbound repo: rides along as a single line, no full paths, no skill menu', () => {
    addRepo({ root, name: 'bound-one', identity: { remote: 'g', default_branch: 'main', description: '' }, localPath: '/c/b' });
    writeIdentity({ root, repos: { 'bound-one': { remote: 'g', default_branch: 'main', description: '' }, 'unbound-one': { remote: 'h', default_branch: 'main', description: '' } }, repoGroups: {} });
    const text = renderPreamble({ root, active: [], config: { autoCommit: 'ask', autoPr: 'ask' } });
    expect(text).toContain('unbound-one');
    expect(text).not.toContain('/c/b');
    expect(text).not.toMatch(/where-to-work/);
  });
});

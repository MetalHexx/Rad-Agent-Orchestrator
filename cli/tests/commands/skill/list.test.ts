import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { addRepo, createGroup, readRegistry, writeIdentity } from '@rad-orchestration/repo-registry';
import { skillList, skillListCommand } from '../../../src/commands/skill/list.js';
import { runCommand } from '../../../src/framework/command.js';
import { userDataPaths } from '../../../src/lib/paths.js';
import type * as PathsModule from '../../../src/lib/paths.js';

// Module-boundary mock: the skill-list handler reads its registry root via
// userDataPaths(), which resolves to the operator's real ~/.radorc. Override
// only that export (keep resolveInstallRoot/installPaths real, same as
// runCommand's own version-skew/log-sink plumbing) so a CLI-path test can
// point the handler at a disposable temp registry instead of mutating the
// developer's real one.
vi.mock('../../../src/lib/paths.js', async (importOriginal) => {
  const actual = await importOriginal<typeof PathsModule>();
  return { ...actual, userDataPaths: vi.fn(actual.userDataPaths) };
});

function mockUserDataPathsRoot(root: string): void {
  vi.mocked(userDataPaths).mockReturnValue({
    root,
    installJson: path.join(root, 'install.json'),
    orchestrationYml: path.join(root, 'orchestration.yml'),
    ui: path.join(root, 'ui'),
    templates: path.join(root, 'templates'),
    projects: path.join(root, 'projects'),
    sideProjects: path.join(root, 'side-projects'),
    worktrees: path.join(root, 'worktrees'),
    logs: path.join(root, 'logs'),
    runtime: path.join(root, 'runtime'),
    telemetry: path.join(root, 'telemetry'),
    bootstrapLock: path.join(root, 'runtime', 'bootstrap.lock'),
    actionEvents: path.join(root, 'action-events'),
    communicationStyles: path.join(root, 'communication-styles'),
  });
}

function writeSkill(dir: string, body: string) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), body, 'utf8');
}

let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-')); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

function registerRepo(name: string, repoRoot: string) {
  addRepo({ root, name, identity: { remote: 'g', default_branch: 'main', description: '' }, localPath: repoRoot });
}

describe('skillList core', () => {
  it('resolves a single registered repo name and tags entries with its repo', () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-repo-'));
    writeSkill(path.join(repoRoot, 's/bbb'), '---\nname: bbb\ndescription: b\n---\n');
    writeSkill(path.join(repoRoot, 's/aaa'), '---\nname: aaa\ndescription: a\n---\n');
    registerRepo('repo-one', repoRoot);

    const result = skillList({ root, repos: ['repo-one'] });
    expect(result.skills.map(s => s.name)).toEqual(['aaa', 'bbb']);
    expect(result.skills.every(s => s.repo === 'repo-one')).toBe(true);
    expect(result.unscannable).toEqual([]);
  });

  it('accepts a comma-separated list of repo names', () => {
    const rootA = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-a-'));
    const rootB = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-b-'));
    writeSkill(path.join(rootA, 's/one'), '---\nname: one\ndescription: d\n---\n');
    writeSkill(path.join(rootB, 's/two'), '---\nname: two\ndescription: d\n---\n');
    registerRepo('repo-a', rootA);
    registerRepo('repo-b', rootB);

    const result = skillList({ root, repos: ['repo-a', 'repo-b'] });
    expect(result.skills.map(s => `${s.repo}:${s.name}`).sort()).toEqual(['repo-a:one', 'repo-b:two']);
  });

  it('expands a repo-group to its members', () => {
    const rootA = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-grp-a-'));
    const rootB = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-grp-b-'));
    writeSkill(path.join(rootA, 's/one'), '---\nname: one\ndescription: d\n---\n');
    writeSkill(path.join(rootB, 's/two'), '---\nname: two\ndescription: d\n---\n');
    registerRepo('grp-a', rootA);
    registerRepo('grp-b', rootB);
    createGroup({ root, name: 'my-group', members: ['grp-a', 'grp-b'] });

    const result = skillList({ root, repoGroups: ['my-group'] });
    expect(result.skills.map(s => `${s.repo}:${s.name}`).sort()).toEqual(['grp-a:one', 'grp-b:two']);
  });

  it('deduplicates a repo reachable through both --repo and --repo-group', () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-dedupe-'));
    writeSkill(path.join(repoRoot, 's/one'), '---\nname: one\ndescription: d\n---\n');
    registerRepo('dup-repo', repoRoot);
    createGroup({ root, name: 'dup-group', members: ['dup-repo'] });

    const result = skillList({ root, repos: ['dup-repo'], repoGroups: ['dup-group'] });
    expect(result.skills.map(s => s.name)).toEqual(['one']);
  });

  it('throws for an unregistered repo name', () => {
    expect(() => skillList({ root, repos: ['ghost'] })).toThrow(/ghost/);
  });

  it('throws for an unknown group name', () => {
    expect(() => skillList({ root, repoGroups: ['ghost-group'] })).toThrow(/ghost-group/);
  });

  it('reports an unbound repository in unscannable instead of throwing', () => {
    writeIdentity({ root, repos: { 'unbound-repo': { remote: 'g', default_branch: 'main', description: '' } }, repoGroups: {} });

    const result = skillList({ root, repos: ['unbound-repo'] });
    expect(result.skills).toEqual([]);
    expect(result.unscannable).toEqual([{ repo: 'unbound-repo', reason: 'registered but not bound to a local path', hint: expect.stringMatching(/repo bind/) }]);
  });

  it('mixed request: one repo resolves, another is unbound', () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-mixed-'));
    writeSkill(path.join(repoRoot, 's/one'), '---\nname: one\ndescription: d\n---\n');
    registerRepo('bound-repo', repoRoot);
    const reg = readRegistry({ root });
    writeIdentity({ root, repos: { ...reg.repos, 'unbound-repo': { remote: 'g', default_branch: 'main', description: '' } }, repoGroups: reg.repoGroups });

    const result = skillList({ root, repos: ['bound-repo', 'unbound-repo'] });
    expect(result.skills.map(s => s.name)).toEqual(['one']);
    expect(result.unscannable.map(u => u.repo)).toEqual(['unbound-repo']);
  });

  it('a bound repo with no SKILL.md returns empty in both lists', () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-empty-'));
    registerRepo('empty-repo', repoRoot);
    const result = skillList({ root, repos: ['empty-repo'] });
    expect(result.skills).toEqual([]);
    expect(result.unscannable).toEqual([]);
  });

  it('warn channel routes through the supplied warn callback, never process.stderr', () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-warn-'));
    writeSkill(path.join(repoRoot, 's/malformed'), '---\nname: test\ndescription: test\n');
    registerRepo('warn-repo', repoRoot);

    const warn = vi.fn();
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      skillList({ root, repos: ['warn-repo'], warn });
      expect(warn).toHaveBeenCalled();
      expect(warn.mock.calls[0][0]).toMatch(/malformed|frontmatter not terminated/);
      expect(stderrSpy).not.toHaveBeenCalled();
    } finally {
      stderrSpy.mockRestore();
    }
  });
});

describe('skillList CLI path (runCommand argv → handler args)', () => {
  it('neither --repo nor --repo-group supplied emits a user_error naming both flags', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => { throw new Error(`exit:${code}`); }) as never);
    try {
      await runCommand(skillListCommand, {
        argv: ['--non-interactive', '--json'],
        env: { ...process.env, RADORCH_NO_LOG: '1' },
        isTTY: false, stderr: process.stderr,
      });
    } catch (e) {
      expect((e as Error).message).toBe('exit:1');
    }
    const stdout = log.mock.calls.map(c => String(c[0])).join('\n');
    expect(stdout).toMatch(/"ok"\s*:\s*false/);
    expect(stdout).toMatch(/--repo/);
    expect(stdout).toMatch(/--repo-group/);
    log.mockRestore();
    exitSpy.mockRestore();
  });

  it('a single comma-separated --repo flag value resolves and scans both named repos', async () => {
    const rootA = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-cli-a-'));
    const rootB = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-cli-b-'));
    writeSkill(path.join(rootA, 's/one'), '---\nname: one\ndescription: d\n---\n');
    writeSkill(path.join(rootB, 's/two'), '---\nname: two\ndescription: d\n---\n');
    registerRepo('cli-repo-a', rootA);
    registerRepo('cli-repo-b', rootB);
    mockUserDataPathsRoot(root);

    const stdoutChunks: string[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      stdoutChunks.push(args.map(String).join(' '));
    });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    try {
      await runCommand(skillListCommand, {
        argv: ['--repo', 'cli-repo-a,cli-repo-b', '--non-interactive', '--json'],
        env: { ...process.env, RADORCH_NO_LOG: '1' },
        isTTY: false, stderr: process.stderr,
      });
    } finally {
      log.mockRestore();
      exitSpy.mockRestore();
    }
    const envelope = JSON.parse(stdoutChunks.join(''));
    expect(envelope.ok).toBe(true);
    expect(envelope.data.skills.map((s: { repo: string; name: string }) => `${s.repo}:${s.name}`).sort()).toEqual(['cli-repo-a:one', 'cli-repo-b:two']);
  });
});

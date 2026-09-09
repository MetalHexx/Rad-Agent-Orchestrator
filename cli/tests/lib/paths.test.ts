import { describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { resolveInstallRoot, installPaths, userDataPaths } from '../../src/lib/paths.js';

describe('resolveInstallRoot', () => {
  it('returns ~/.radorc', () => {
    const root = resolveInstallRoot();
    expect(root).toBe(path.join(os.homedir(), '.radorc'));
  });
});

describe('installPaths', () => {
  it('exposes the canonical layout under a given root', () => {
    const root = '/tmp/rad-x';
    const p = installPaths(root);
    expect(p.installJson).toBe(path.join(root, 'install.json'));
    expect(p.gitignore).toBe(path.join(root, '.gitignore'));
    expect(p.projectsDir).toBe(path.join(root, 'projects'));
    expect(p.worktreesDir).toBe(path.join(root, 'worktrees'));
    expect(p.logsDir).toBe(path.join(root, 'logs'));
    expect(p.cliLog).toBe(path.join(root, 'logs', 'cli.log'));
    expect(p.harnessesDir).toBe(path.join(root, 'runtime', 'harnesses'));
  });
  it('produces native paths when given a Windows-style root', () => {
    const winRoot = 'C:\\Users\\example\\.radorc';
    const paths = installPaths(winRoot);
    // The cliLog must be a contiguous descendant of the root, not a corrupted prefix.
    expect(paths.cliLog.startsWith(winRoot)).toBe(true);
    expect(paths.cliLog).not.toContain('Users\\example.radorc');
    expect(paths.logsDir.startsWith(winRoot)).toBe(true);
  });
});

describe('userDataPaths worktrees key (FR-1)', () => {
  it('resolves worktrees to <root>/worktrees', () => {
    const p = userDataPaths();
    expect(p.worktrees).toBe(path.join(os.homedir(), '.radorc', 'worktrees'));
  });
  it('places worktrees as a sibling of sideProjects under the same root', () => {
    const p = userDataPaths();
    expect(path.dirname(p.worktrees)).toBe(p.root);
    expect(path.dirname(p.sideProjects)).toBe(p.root);
  });
});

describe('userDataPaths.actionEvents', () => {
  it('resolves to ~/.radorc/action-events', () => {
    const p = userDataPaths();
    expect(p.actionEvents).toBe(path.join(os.homedir(), '.radorc', 'action-events'));
  });
  it('is a sibling of root, not nested under templates or runtime', () => {
    const p = userDataPaths();
    expect(p.actionEvents.startsWith(p.root + path.sep)).toBe(true);
    expect(p.actionEvents).not.toContain(path.sep + 'templates' + path.sep);
    expect(p.actionEvents).not.toContain(path.sep + 'runtime' + path.sep);
  });
});

describe('userDataPaths.communicationStyles', () => {
  it('resolves to ~/.radorc/communication-styles', () => {
    const p = userDataPaths();
    expect(p.communicationStyles).toBe(path.join(os.homedir(), '.radorc', 'communication-styles'));
  });
  it('is a sibling of root, not nested under templates or runtime', () => {
    const p = userDataPaths();
    expect(p.communicationStyles.startsWith(p.root + path.sep)).toBe(true);
    expect(p.communicationStyles).not.toContain(path.sep + 'templates' + path.sep);
    expect(p.communicationStyles).not.toContain(path.sep + 'runtime' + path.sep);
  });
});

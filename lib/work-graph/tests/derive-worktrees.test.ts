import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveWorktrees, resolveWorktreeName, type ResolveDeps } from '../src/derive/worktrees.js';
import type { WorktreeRef } from '../src/types.js';

let root: string;
let projectsDir: string;
let worktreesDir: string;
let sideProjectsDir: string;
let clonePath: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'wg-'));
  projectsDir = path.join(root, 'projects');
  worktreesDir = path.join(root, 'worktrees');
  sideProjectsDir = path.join(root, 'side-projects');
  clonePath = path.join(root, 'clones', 'rad-orc-source');
  fs.mkdirSync(path.join(projectsDir, 'DEMO-1'), { recursive: true });
});
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

function writeState(sc: unknown) {
  fs.writeFileSync(path.join(projectsDir, 'DEMO-1', 'state.json'),
    JSON.stringify({ project: { name: 'DEMO-1' }, pipeline: { source_control: sc }, graph: { nodes: {} } }));
}

function writeSideProjectState(sc: unknown) {
  fs.writeFileSync(path.join(projectsDir, 'DEMO-1', 'state.json'),
    JSON.stringify({ project: { name: 'DEMO-1', project_type: 'side-project' }, pipeline: { source_control: sc }, graph: { nodes: {} } }));
}

/** Porcelain output that lists exactly `wtPath`, checked out on `branch`. */
function porcelain(wtPath: string, branch: string): string {
  return `worktree ${wtPath}\nHEAD abc\nbranch refs/heads/${branch}\n\n`;
}

interface Binding {
  name: WorktreeRef['resolvedVia'] | 'side-project';
  seed: () => void;
  deps: () => Partial<ResolveDeps>;
  expected: () => WorktreeRef;
}

// Every binding kind the derivation knows, asserted through one path: seed the
// project's source_control, resolve, and expect the on-disk location plus the
// git facts read live at it.
const bindings: Binding[] = [
  {
    name: 'side-project',
    seed: () => writeSideProjectState({ repos: [{ name: 'DEMO-1', branch: 'main' }] }),
    deps: () => ({ sideProjectsDir }),
    expected: () => ({ repo: 'DEMO-1', path: path.join(sideProjectsDir, 'DEMO-1'), branch: 'feature/x', exists: true, resolvedVia: 'convention' }),
  },
  {
    name: 'convention',
    seed: () => writeState({ repos: [{ name: 'rad-orc-source' }] }),
    deps: () => ({}),
    expected: () => ({ repo: 'rad-orc-source', path: path.join(worktreesDir, 'DEMO-1', 'rad-orc-source'), branch: 'feature/x', exists: true, resolvedVia: 'convention' }),
  },
  {
    name: 'shared-worktree-name',
    seed: () => writeState({ repos: [{ name: 'rad-orc-source' }], worktree_name: 'PARENT-1' }),
    deps: () => ({}),
    expected: () => ({ repo: 'rad-orc-source', path: path.join(worktreesDir, 'PARENT-1', 'rad-orc-source'), branch: 'feature/x', exists: true, resolvedVia: 'shared-worktree-name' }),
  },
  {
    name: 'registry-clone',
    seed: () => writeState({ repos: [{ name: 'rad-orc-source', in_place: true }] }),
    deps: () => ({ registryLocalPaths: { 'rad-orc-source': clonePath } }),
    expected: () => ({ repo: 'rad-orc-source', path: clonePath, branch: 'feature/x', exists: true, resolvedVia: 'registry-clone' }),
  },
];

describe('binding kinds', () => {
  it.each(bindings)('resolves a $name binding to its on-disk path with live exists/branch', (binding) => {
    binding.seed();
    const expected = binding.expected();
    const refs = resolveWorktrees('DEMO-1', {
      projectsDir,
      worktreesDir,
      exec: () => porcelain(expected.path, 'feature/x'),
      ...binding.deps(),
    });
    expect(refs).toEqual([expected]);
  });
});

describe('worktree resolution', () => {
  it('returns [] when source_control is null', () => {
    writeState(null);
    expect(resolveWorktrees('DEMO-1', { projectsDir, worktreesDir, exec: () => '' })).toEqual([]);
  });
  it('falls back to the legacy single worktree_path with exists=false when git lists nothing', () => {
    writeState({ branch: 'MULTI-REPO-3', worktree_path: '/abs/wt/MULTI-REPO-3' });
    const refs = resolveWorktrees('DEMO-1', { projectsDir, worktreesDir, exec: () => '' });
    expect(refs).toEqual([{ repo: 'MULTI-REPO-3', path: '/abs/wt/MULTI-REPO-3', branch: 'MULTI-REPO-3', exists: false, resolvedVia: 'git' }]);
  });
  it('reports resolvedVia: convention when the recorded worktree_name equals the project name', () => {
    writeState({ repos: [{ name: 'rad-orc-source' }], worktree_name: 'DEMO-1' });
    const wtPath = path.join(worktreesDir, 'DEMO-1', 'rad-orc-source');
    const refs = resolveWorktrees('DEMO-1', { projectsDir, worktreesDir, exec: () => '' });
    expect(refs).toEqual([{ repo: 'rad-orc-source', path: wtPath, branch: null, exists: false, resolvedVia: 'convention' }]);
  });
});

describe('resolveWorktreeName', () => {
  it('returns the shared name when state.json records one', () => {
    writeState({ repos: [{ name: 'rad-orc-source' }], worktree_name: 'PARENT-1' });
    expect(resolveWorktreeName('DEMO-1', { projectsDir })).toBe('PARENT-1');
  });
  it('returns the project name when worktree_name is absent', () => {
    writeState({ repos: [{ name: 'rad-orc-source' }] });
    expect(resolveWorktreeName('DEMO-1', { projectsDir })).toBe('DEMO-1');
  });
  it('returns the project name when worktree_name is an empty string', () => {
    writeState({ repos: [{ name: 'rad-orc-source' }], worktree_name: '' });
    expect(resolveWorktreeName('DEMO-1', { projectsDir })).toBe('DEMO-1');
  });
  it('returns the project name when state.json is missing', () => {
    expect(resolveWorktreeName('DEMO-1', { projectsDir })).toBe('DEMO-1');
  });
  it('returns the project name when state.json is unparseable', () => {
    fs.writeFileSync(path.join(projectsDir, 'DEMO-1', 'state.json'), '{not json');
    expect(resolveWorktreeName('DEMO-1', { projectsDir })).toBe('DEMO-1');
  });
});

describe('side-project resolution', () => {
  it('resolves a side-project to sideProjectsDir/<name> with branch and exists from porcelain', () => {
    writeSideProjectState({ worktree_name: 'DEMO-1', repos: [{ name: 'DEMO-1', branch: 'main' }] });
    const spPath = path.join(sideProjectsDir, 'DEMO-1');
    const porcelain = `worktree ${spPath}\nHEAD abc\nbranch refs/heads/main\n\n`;
    const refs = resolveWorktrees('DEMO-1', { projectsDir, worktreesDir, sideProjectsDir, exec: () => porcelain });
    expect(refs).toEqual([{ repo: 'DEMO-1', path: spPath, branch: 'main', exists: true, resolvedVia: 'convention' }]);
  });
  it('reports exists=false and falls back to the sealed branch when git lists nothing', () => {
    writeSideProjectState({ worktree_name: 'DEMO-1', repos: [{ name: 'DEMO-1', branch: 'main' }] });
    const spPath = path.join(sideProjectsDir, 'DEMO-1');
    const refs = resolveWorktrees('DEMO-1', { projectsDir, worktreesDir, sideProjectsDir, exec: () => '' });
    expect(refs).toEqual([{ repo: 'DEMO-1', path: spPath, branch: 'main', exists: false, resolvedVia: 'convention' }]);
  });
  it('defaults the repo name to the project name when sc.repos is empty', () => {
    writeSideProjectState({ repos: [] });
    const spPath = path.join(sideProjectsDir, 'DEMO-1');
    const refs = resolveWorktrees('DEMO-1', { projectsDir, worktreesDir, sideProjectsDir, exec: () => '' });
    expect(refs).toEqual([{ repo: 'DEMO-1', path: spPath, branch: null, exists: false, resolvedVia: 'convention' }]);
  });
  it('degrades to standard worktree resolution when sideProjectsDir is not provided', () => {
    writeSideProjectState({ repos: [{ name: 'rad-orc-source' }] });
    const wtPath = path.join(worktreesDir, 'DEMO-1', 'rad-orc-source');
    const refs = resolveWorktrees('DEMO-1', { projectsDir, worktreesDir, exec: () => '' });
    expect(refs).toEqual([{ repo: 'rad-orc-source', path: wtPath, branch: null, exists: false, resolvedVia: 'convention' }]);
  });
});

describe('clone-binding fallbacks', () => {
  it('falls back to the convention path when an in_place repo has no registry entry', () => {
    writeState({ repos: [{ name: 'rad-orc-source', in_place: true }] });
    const wtPath = path.join(worktreesDir, 'DEMO-1', 'rad-orc-source');
    const refs = resolveWorktrees('DEMO-1', { projectsDir, worktreesDir, registryLocalPaths: { other: '/abs/other' }, exec: () => '' });
    expect(refs).toEqual([{ repo: 'rad-orc-source', path: wtPath, branch: null, exists: false, resolvedVia: 'convention' }]);
  });
  it('falls back to the convention path when registryLocalPaths is omitted entirely', () => {
    writeState({ repos: [{ name: 'rad-orc-source', in_place: true }] });
    const wtPath = path.join(worktreesDir, 'DEMO-1', 'rad-orc-source');
    const refs = resolveWorktrees('DEMO-1', { projectsDir, worktreesDir, exec: () => '' });
    expect(refs).toEqual([{ repo: 'rad-orc-source', path: wtPath, branch: null, exists: false, resolvedVia: 'convention' }]);
  });
  it('resolves each repo independently when repos[] mixes an in_place binding with a worktree one', () => {
    writeState({ repos: [{ name: 'rad-orc-source', in_place: true }, { name: 'rad-orc-ui' }] });
    const refs = resolveWorktrees('DEMO-1', { projectsDir, worktreesDir, registryLocalPaths: { 'rad-orc-source': clonePath }, exec: () => '' });
    expect(refs).toEqual([
      { repo: 'rad-orc-source', path: clonePath, branch: null, exists: false, resolvedVia: 'registry-clone' },
      { repo: 'rad-orc-ui', path: path.join(worktreesDir, 'DEMO-1', 'rad-orc-ui'), branch: null, exists: false, resolvedVia: 'convention' },
    ]);
  });
});

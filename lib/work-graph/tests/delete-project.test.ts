import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { planProjectDeletion, deleteProject, type DeletionDeps, type DeletionReport } from '../src/delete-project.js';
import { GraphIndex } from '../src/store.js';
import type { Edge, Result } from '../src/types.js';
import type { GitExec } from '../src/derive/worktrees.js';

function unwrap<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(`expected ok, got error ${r.error.code}: ${r.error.message}`);
  return r.data;
}

interface ExecCall { args: string[]; cwd?: string }

/** A configurable recording `GitExec` — each hook controls one git subcommand family. */
function makeExec(hooks: {
  worktreeList?: (cwd: string) => string;
  gitCommonDir?: (cwd: string) => string; // throws by default (simulates "not a git repository")
  onWorktreeRemove?: (worktreePath: string, cwd: string) => void;
} = {}): { exec: GitExec; calls: ExecCall[] } {
  const calls: ExecCall[] = [];
  const exec: GitExec = (_file, args, opts) => {
    calls.push({ args, cwd: opts.cwd });
    if (args[0] === 'worktree' && args[1] === 'list') return hooks.worktreeList ? hooks.worktreeList(opts.cwd ?? '') : '';
    if (args[0] === 'rev-parse') {
      if (!hooks.gitCommonDir) throw new Error('not a git repository');
      return `${hooks.gitCommonDir(opts.cwd ?? '')}\n`;
    }
    if (args[0] === 'worktree' && args[1] === 'remove') {
      hooks.onWorktreeRemove?.(args[3] ?? '', opts.cwd ?? '');
      return '';
    }
    return ''; // 'worktree prune' and anything else
  };
  return { exec, calls };
}

let root: string;
let projectsDir: string;
let worktreesDir: string;
let sideProjectsDir: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'wg-del-'));
  projectsDir = path.join(root, 'projects');
  worktreesDir = path.join(root, 'worktrees');
  sideProjectsDir = path.join(root, 'side-projects');
  fs.mkdirSync(projectsDir, { recursive: true });
  fs.mkdirSync(worktreesDir, { recursive: true });
  fs.mkdirSync(sideProjectsDir, { recursive: true });
});
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

function writeProjectState(name: string, sc: unknown, projectType?: 'side-project') {
  const dir = path.join(projectsDir, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({
    project: { name, ...(projectType ? { project_type: projectType } : {}) },
    pipeline: { source_control: sc },
    graph: { nodes: {} },
  }));
}

function addEdge(index: GraphIndex, edge: Edge): void {
  const stored = index.read();
  stored.edges.push(edge);
  const written = index.write(stored, stored.rev);
  if (!written.ok) throw new Error('test setup failed to write edge');
}

function deps(overrides: Partial<DeletionDeps> = {}): DeletionDeps {
  return {
    projectsDir, worktreesDir, sideProjectsDir,
    registryLocalPaths: {},
    exec: () => '',
    index: new GraphIndex(root),
    ...overrides,
  };
}

describe('planProjectDeletion — composition', () => {
  it('returns one item per worktree, the project directory, and the graph entry, with correct exists flags, touching nothing on disk', () => {
    writeProjectState('MULTI-1', { repos: [{ name: 'repo-a' }, { name: 'repo-b' }] });
    const repoAPath = path.join(worktreesDir, 'MULTI-1', 'repo-a');
    fs.mkdirSync(repoAPath, { recursive: true }); // repo-a is on disk; repo-b is not
    const projectDir = path.join(projectsDir, 'MULTI-1');

    const plan = unwrap(planProjectDeletion('MULTI-1', deps()));

    expect(plan.project).toBe('MULTI-1');
    expect(plan.items).toEqual([
      { kind: 'worktree', label: 'repo-a', path: repoAPath, exists: true, disposition: 'remove' },
      { kind: 'worktree', label: 'repo-b', path: path.join(worktreesDir, 'MULTI-1', 'repo-b'), exists: false, disposition: 'remove' },
      { kind: 'project-dir', label: 'MULTI-1', path: projectDir, exists: true, disposition: 'remove' },
      { kind: 'graph-edges', label: 'MULTI-1', path: null, exists: false, disposition: 'remove' },
    ]);
    // touches nothing on disk
    expect(fs.existsSync(repoAPath)).toBe(true);
    expect(fs.existsSync(projectDir)).toBe(true);
  });

  it('shows a graph-edges item as existing when a stored edge references the project', () => {
    writeProjectState('EDGED-1', {});
    const index = new GraphIndex(root);
    addEdge(index, { type: 'contains', from: 'group:g', to: 'EDGED-1' });
    const plan = unwrap(planProjectDeletion('EDGED-1', deps({ index })));
    expect(plan.items.find((i) => i.kind === 'graph-edges')?.exists).toBe(true);
  });

  it('shows a side project as a side-project-repo item labelled with the project name', () => {
    writeProjectState('SIDE-1', { repos: [{ name: 'unrelated-repo-name', branch: 'main' }] }, 'side-project');
    const spPath = path.join(sideProjectsDir, 'SIDE-1');
    fs.mkdirSync(spPath, { recursive: true });
    const plan = unwrap(planProjectDeletion('SIDE-1', deps()));
    expect(plan.items[0]).toEqual({ kind: 'side-project-repo', label: 'SIDE-1', path: spPath, exists: true, disposition: 'remove' });
  });

  it('marks a registry-clone worktree protected with a reason, and leaves it disposition unaffected by exists', () => {
    writeProjectState('INPLACE-1', { repos: [{ name: 'rad-orc-source', in_place: true }] });
    const clonePath = path.join(root, 'clones', 'rad-orc-source');
    fs.mkdirSync(clonePath, { recursive: true });
    const plan = unwrap(planProjectDeletion('INPLACE-1', deps({ registryLocalPaths: { 'rad-orc-source': clonePath } })));
    const item = plan.items[0];
    expect(item?.disposition).toBe('protected');
    expect(item?.protectedReason).toMatch(/rad-orc-source/);
    expect(item?.exists).toBe(true);
  });
});

describe('planProjectDeletion — validation', () => {
  const absolutePath = path.join(path.parse(process.cwd()).root, 'abs-project-id');
  it.each([['..'], ['a/b'], ['a\\b'], [absolutePath]])('rejects %s with a validation error and no filesystem access', (bad) => {
    const spy = vi.spyOn(fs, 'existsSync');
    const result = planProjectDeletion(bad, deps());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a validation failure');
    expect(result.error.code).toBe('validation');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('rejects an unknown project with a validation error naming it', () => {
    const result = planProjectDeletion('NEVER-EXISTED', deps());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a validation failure');
    expect(result.error.code).toBe('validation');
    expect(result.error.message).toMatch(/NEVER-EXISTED/);
  });

  it('rejects a project directory that is a symlink resolving outside the projects directory', (ctx) => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'wg-del-outside-'));
    const linkPath = path.join(projectsDir, 'ESCAPE-1');
    try {
      fs.symlinkSync(outside, linkPath, 'junction');
    } catch {
      // Skippable on platforms/CI users without symlink privilege.
      fs.rmSync(outside, { recursive: true, force: true });
      ctx.skip();
      return;
    }

    try {
      const planResult = planProjectDeletion('ESCAPE-1', deps());
      expect(planResult.ok).toBe(false);
      if (planResult.ok) throw new Error('expected a validation failure');
      expect(planResult.error.code).toBe('validation');
      expect(planResult.error.message).toMatch(/symlink/);

      const deleteResult = deleteProject('ESCAPE-1', deps());
      expect(deleteResult.ok).toBe(false);
      if (deleteResult.ok) throw new Error('expected a validation failure');
      expect(deleteResult.error.code).toBe('validation');
      expect(deleteResult.error.message).toMatch(/symlink/);

      // The escape was refused, not merely reported — nothing outside the projects dir was touched.
      expect(fs.existsSync(outside)).toBe(true);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it('rejects a project-directory symlink aliasing a sibling project still inside the projects directory, leaving the victim untouched', (ctx) => {
    writeProjectState('VICTIM-1', { repos: [{ name: 'repo-v' }] });
    const victimWtPath = path.join(worktreesDir, 'VICTIM-1', 'repo-v');
    fs.mkdirSync(victimWtPath, { recursive: true });
    const victimDir = path.join(projectsDir, 'VICTIM-1');
    const victimStatePath = path.join(victimDir, 'state.json');
    const linkPath = path.join(projectsDir, 'ALIAS-1');

    try {
      fs.symlinkSync(victimDir, linkPath, 'junction');
    } catch {
      // Skippable on platforms/CI users without symlink privilege.
      ctx.skip();
      return;
    }

    const planResult = planProjectDeletion('ALIAS-1', deps());
    expect(planResult.ok).toBe(false);
    if (planResult.ok) throw new Error('expected a validation failure');
    expect(planResult.error.code).toBe('validation');
    expect(planResult.error.message).toMatch(/symlink/);

    const deleteResult = deleteProject('ALIAS-1', deps());
    expect(deleteResult.ok).toBe(false);
    if (deleteResult.ok) throw new Error('expected a validation failure');
    expect(deleteResult.error.code).toBe('validation');
    expect(deleteResult.error.message).toMatch(/symlink/);

    // The alias was refused, not merely reported — the victim's directory,
    // state.json, and worktree are all still present.
    expect(fs.existsSync(victimDir)).toBe(true);
    expect(fs.existsSync(victimStatePath)).toBe(true);
    expect(fs.existsSync(victimWtPath)).toBe(true);
  });
});

describe('deleteProject — protected clone', () => {
  it('leaves a registry-clone worktree untouched and still deletes the rest', () => {
    writeProjectState('INPLACE-2', { repos: [{ name: 'rad-orc-source', in_place: true }] });
    const clonePath = path.join(root, 'clones', 'rad-orc-source');
    fs.mkdirSync(clonePath, { recursive: true });
    const marker = path.join(clonePath, 'marker.txt');
    fs.writeFileSync(marker, 'keep-me');
    const { exec, calls } = makeExec();

    const report = unwrap(deleteProject('INPLACE-2', deps({ registryLocalPaths: { 'rad-orc-source': clonePath }, exec })));

    expect(report.complete).toBe(true);
    expect(report.items.find((i) => i.kind === 'worktree')?.outcome).toBe('protected');
    expect(fs.existsSync(marker)).toBe(true);
    expect(fs.readFileSync(marker, 'utf8')).toBe('keep-me');
    expect(calls.some((c) => c.args[0] === 'worktree' && c.args[1] === 'remove')).toBe(false);
    expect(fs.existsSync(path.join(projectsDir, 'INPLACE-2'))).toBe(false);
  });
});

describe('deleteProject — side project removal', () => {
  it('removes a side-project repository even when it was never git init\'ed', () => {
    writeProjectState('SIDE-2', { repos: [{ name: 'SIDE-2', branch: 'main' }] }, 'side-project');
    const spPath = path.join(sideProjectsDir, 'SIDE-2');
    fs.mkdirSync(spPath, { recursive: true });
    fs.writeFileSync(path.join(spPath, 'file.txt'), 'content'); // a plain directory, no .git

    const report = unwrap(deleteProject('SIDE-2', deps()));

    const item = report.items.find((i) => i.kind === 'side-project-repo');
    expect(item?.outcome).toBe('removed');
    expect(item?.outcome).not.toBe('already-absent');
    expect(fs.existsSync(spPath)).toBe(false);
    expect(report.complete).toBe(true);
  });
});

describe('deleteProject — resumability', () => {
  it('run twice in a row returns complete: true both times, the second run reading already-absent', () => {
    writeProjectState('RUN2-1', { repos: [{ name: 'repo-x' }] });
    const wtPath = path.join(worktreesDir, 'RUN2-1', 'repo-x');
    fs.mkdirSync(wtPath, { recursive: true });
    const clonePath = path.join(root, 'clones', 'repo-x');
    fs.mkdirSync(clonePath, { recursive: true });
    const index = new GraphIndex(root);
    addEdge(index, { type: 'contains', from: 'group:g', to: 'RUN2-1' });
    const { exec } = makeExec();

    const first = unwrap(deleteProject('RUN2-1', deps({ index, registryLocalPaths: { 'repo-x': clonePath }, exec })));
    expect(first.complete).toBe(true);
    expect(first.items.map((i) => i.outcome)).toEqual(['removed', 'removed', 'removed']);
    expect(fs.existsSync(path.join(projectsDir, 'RUN2-1'))).toBe(false);

    const second = unwrap(deleteProject('RUN2-1', deps({ index, registryLocalPaths: { 'repo-x': clonePath }, exec })));
    expect(second.complete).toBe(true);
    // state.json is gone with the project directory, so resolveWorktrees no longer finds repo-x —
    // only project-dir and graph-edges remain, both already-absent.
    expect(second.items).toHaveLength(2);
    expect(second.items.every((i) => i.outcome === 'already-absent')).toBe(true);
  });
});

describe('deleteProject — per-item failure isolation', () => {
  it('marks the project directory failed on a thrown rm, reports the other items real outcomes, and sets complete: false', () => {
    writeProjectState('RMFAIL-1', {}); // no repos — nothing to resolve as a worktree
    const index = new GraphIndex(root);
    addEdge(index, { type: 'contains', from: 'group:g', to: 'RMFAIL-1' });
    const projectDir = path.join(projectsDir, 'RMFAIL-1');

    const report = unwrap(deleteProject('RMFAIL-1', deps({ index }), {
      rm: () => { throw new Error('resource busy or locked'); },
    }));

    expect(report.complete).toBe(false);
    const dirResult = report.items.find((i) => i.kind === 'project-dir');
    expect(dirResult?.outcome).toBe('failed');
    expect(dirResult?.error).toBeTruthy();
    const edgesResult = report.items.find((i) => i.kind === 'graph-edges');
    expect(edgesResult?.outcome).toBe('removed'); // real outcome, not held back
    expect(fs.existsSync(projectDir)).toBe(true);
  });
});

describe('deleteProject — hold-back rule', () => {
  it('holds the project directory and graph edges back when a worktree removal fails, then completes on retry', () => {
    writeProjectState('HOLD-1', { repos: [{ name: 'repo-y' }] });
    const wtPath = path.join(worktreesDir, 'HOLD-1', 'repo-y');
    fs.mkdirSync(wtPath, { recursive: true });
    const projectDir = path.join(projectsDir, 'HOLD-1');
    const index = new GraphIndex(root);
    addEdge(index, { type: 'contains', from: 'group:g', to: 'HOLD-1' });
    const { exec: failingExec } = makeExec(); // no gitCommonDir hook — rev-parse always throws

    const first = unwrap(deleteProject('HOLD-1', deps({ index, exec: failingExec })));
    expect(first.complete).toBe(false);
    expect(first.items.find((i) => i.kind === 'worktree')?.outcome).toBe('failed');
    const heldDir = first.items.find((i) => i.kind === 'project-dir');
    expect(heldDir?.outcome).toBe('held-back');
    expect(heldDir?.error).toBeTruthy();
    const heldEdges = first.items.find((i) => i.kind === 'graph-edges');
    expect(heldEdges?.outcome).toBe('held-back');
    expect(fs.existsSync(projectDir)).toBe(true); // still on disk

    const clonePath = path.join(root, 'clones', 'repo-y');
    fs.mkdirSync(clonePath, { recursive: true });
    const { exec: workingExec } = makeExec();
    const second = unwrap(deleteProject('HOLD-1', deps({ index, exec: workingExec, registryLocalPaths: { 'repo-y': clonePath } })));
    expect(second.complete).toBe(true);
    expect(second.items.find((i) => i.kind === 'worktree')?.outcome).toBe('removed');
    expect(second.items.find((i) => i.kind === 'project-dir')?.outcome).toBe('removed');
    expect(second.items.find((i) => i.kind === 'graph-edges')?.outcome).toBe('removed');
    expect(fs.existsSync(projectDir)).toBe(false);
  });
});

describe('deleteProject — exists distinction and git argv', () => {
  it('attempts a worktree that is on disk but absent from `git worktree list`, and never falls back to a recursive delete', () => {
    writeProjectState('GHOST-1', { repos: [{ name: 'repo-z' }] });
    const wtPath = path.join(worktreesDir, 'GHOST-1', 'repo-z');
    fs.mkdirSync(wtPath, { recursive: true }); // present on disk
    const clonePath = path.join(root, 'clones', 'repo-z');
    fs.mkdirSync(clonePath, { recursive: true });
    const removedPaths: string[] = [];
    const { exec, calls } = makeExec({
      worktreeList: () => '', // git lists nothing at this cwd
      onWorktreeRemove: (worktreePath) => { removedPaths.push(worktreePath); },
    });
    const rmCalls: string[] = [];
    const rm = (target: string) => { rmCalls.push(target); fs.rmSync(target, { recursive: true, force: true }); };

    const plan = unwrap(planProjectDeletion('GHOST-1', deps({ registryLocalPaths: { 'repo-z': clonePath }, exec })));
    expect(plan.items.find((i) => i.kind === 'worktree')?.exists).toBe(true); // not already-absent

    const report = unwrap(deleteProject('GHOST-1', deps({ registryLocalPaths: { 'repo-z': clonePath }, exec }), { rm }));
    const item = report.items.find((i) => i.kind === 'worktree');
    expect(item?.outcome).toBe('removed');

    const removeCall = calls.find((c) => c.args[0] === 'worktree' && c.args[1] === 'remove');
    expect(removeCall?.args).toEqual(['worktree', 'remove', '--force', wtPath]);
    expect(removeCall?.cwd).toBe(clonePath);
    expect(removedPaths).toEqual([wtPath]);
    expect(rmCalls).not.toContain(wtPath); // no recursive delete on a worktree path
  });
});

describe('deleteProject — worktree transient lock retry', () => {
  it('retries a transient `git worktree remove` failure and succeeds within the retry budget', () => {
    writeProjectState('RETRY-1', { repos: [{ name: 'repo-r' }] });
    const wtPath = path.join(worktreesDir, 'RETRY-1', 'repo-r');
    fs.mkdirSync(wtPath, { recursive: true });
    const clonePath = path.join(root, 'clones', 'repo-r');
    fs.mkdirSync(clonePath, { recursive: true });
    let attempts = 0;
    const { exec } = makeExec({
      onWorktreeRemove: () => {
        attempts += 1;
        if (attempts < 3) throw new Error('resource busy or locked');
      },
    });
    const sleeps: number[] = [];

    const report = unwrap(deleteProject('RETRY-1', deps({ registryLocalPaths: { 'repo-r': clonePath }, exec }), {
      sleep: (ms) => sleeps.push(ms),
    }));

    const item = report.items.find((i) => i.kind === 'worktree');
    expect(item?.outcome).toBe('removed');
    expect(attempts).toBe(3);
    expect(sleeps).toHaveLength(2); // one delay after each of the two failed attempts, none after the success
    expect(report.complete).toBe(true);
  });

  it('reports the item failed with the underlying error after exhausting the retry budget', () => {
    writeProjectState('RETRY-2', { repos: [{ name: 'repo-s' }] });
    const wtPath = path.join(worktreesDir, 'RETRY-2', 'repo-s');
    fs.mkdirSync(wtPath, { recursive: true });
    const clonePath = path.join(root, 'clones', 'repo-s');
    fs.mkdirSync(clonePath, { recursive: true });
    let attempts = 0;
    const { exec } = makeExec({
      onWorktreeRemove: () => { attempts += 1; throw new Error('resource busy or locked'); },
    });
    const sleeps: number[] = [];

    const report = unwrap(deleteProject('RETRY-2', deps({ registryLocalPaths: { 'repo-s': clonePath }, exec }), {
      sleep: (ms) => sleeps.push(ms),
    }));

    const item = report.items.find((i) => i.kind === 'worktree');
    expect(item?.outcome).toBe('failed');
    expect(item?.error).toMatch(/resource busy or locked/);
    expect(attempts).toBe(6); // one initial attempt plus five retries
    expect(sleeps).toHaveLength(5);
    expect(report.complete).toBe(false);
  });
});

describe('deleteProject — caller-supplied skip', () => {
  it('leaves a skipped worktree on disk, reports it skipped, and still removes the project directory with complete: true', () => {
    writeProjectState('SKIP-1', { repos: [{ name: 'repo-a' }] });
    const wtPath = path.join(worktreesDir, 'SKIP-1', 'repo-a');
    fs.mkdirSync(wtPath, { recursive: true });
    const index = new GraphIndex(root);
    addEdge(index, { type: 'contains', from: 'group:g', to: 'SKIP-1' });

    const report = unwrap(deleteProject('SKIP-1', deps({ index }), { skip: [{ kind: 'worktree', label: 'repo-a' }] }));

    expect(report.items.find((i) => i.kind === 'worktree')?.outcome).toBe('skipped');
    expect(fs.existsSync(wtPath)).toBe(true);
    expect(report.items.find((i) => i.kind === 'project-dir')?.outcome).toBe('removed');
    expect(fs.existsSync(path.join(projectsDir, 'SKIP-1'))).toBe(false);
    expect(report.complete).toBe(true);
  });

  it('leaves a skipped side-project repo on disk and still completes', () => {
    writeProjectState('SKIP-2', { repos: [{ name: 'SKIP-2', branch: 'main' }] }, 'side-project');
    const spPath = path.join(sideProjectsDir, 'SKIP-2');
    fs.mkdirSync(spPath, { recursive: true });
    fs.writeFileSync(path.join(spPath, 'file.txt'), 'content');

    const report = unwrap(deleteProject('SKIP-2', deps(), { skip: [{ kind: 'side-project-repo', label: 'SKIP-2' }] }));

    expect(report.items.find((i) => i.kind === 'side-project-repo')?.outcome).toBe('skipped');
    expect(fs.existsSync(spPath)).toBe(true);
    expect(report.complete).toBe(true);
  });

  it('does not hold back project-dir or graph-edges for a skip, while a genuine worktree failure still does', () => {
    writeProjectState('SEAM-1', { repos: [{ name: 'repo-a' }] });
    const wtPath = path.join(worktreesDir, 'SEAM-1', 'repo-a');
    fs.mkdirSync(wtPath, { recursive: true });
    const index = new GraphIndex(root);
    addEdge(index, { type: 'contains', from: 'group:g', to: 'SEAM-1' });

    const skipped = unwrap(deleteProject('SEAM-1', deps({ index }), { skip: [{ kind: 'worktree', label: 'repo-a' }] }));
    expect(skipped.items.find((i) => i.kind === 'worktree')?.outcome).toBe('skipped');
    expect(skipped.items.find((i) => i.kind === 'project-dir')?.outcome).toBe('removed');
    expect(skipped.items.find((i) => i.kind === 'graph-edges')?.outcome).toBe('removed');
    expect(skipped.complete).toBe(true);

    writeProjectState('SEAM-2', { repos: [{ name: 'repo-b' }] });
    const wtPath2 = path.join(worktreesDir, 'SEAM-2', 'repo-b');
    fs.mkdirSync(wtPath2, { recursive: true });
    const index2 = new GraphIndex(root);
    addEdge(index2, { type: 'contains', from: 'group:g', to: 'SEAM-2' });
    const { exec: failingExec } = makeExec(); // no gitCommonDir hook — rev-parse always throws

    const failed = unwrap(deleteProject('SEAM-2', deps({ index: index2, exec: failingExec })));
    expect(failed.items.find((i) => i.kind === 'worktree')?.outcome).toBe('failed');
    expect(failed.items.find((i) => i.kind === 'project-dir')?.outcome).toBe('held-back');
    expect(failed.items.find((i) => i.kind === 'graph-edges')?.outcome).toBe('held-back');
    expect(failed.complete).toBe(false);
  });

  it('ignores a skip naming project-dir and removes it anyway', () => {
    writeProjectState('SKIP-4', {});

    const report = unwrap(deleteProject('SKIP-4', deps(), { skip: [{ kind: 'project-dir', label: 'SKIP-4' }] }));

    expect(report.items.find((i) => i.kind === 'project-dir')?.outcome).toBe('removed');
    expect(fs.existsSync(path.join(projectsDir, 'SKIP-4'))).toBe(false);
    expect(report.complete).toBe(true);
  });

  it('is a no-op when a skip entry matches nothing in the plan', () => {
    writeProjectState('SKIP-5', { repos: [{ name: 'repo-c' }] });
    const wtPath = path.join(worktreesDir, 'SKIP-5', 'repo-c');
    fs.mkdirSync(wtPath, { recursive: true });
    const clonePath = path.join(root, 'clones', 'repo-c');
    fs.mkdirSync(clonePath, { recursive: true });
    const { exec } = makeExec();

    const report = unwrap(deleteProject('SKIP-5', deps({ registryLocalPaths: { 'repo-c': clonePath }, exec }), {
      skip: [{ kind: 'worktree', label: 'no-such-repo' }],
    }));

    expect(report.items.find((i) => i.kind === 'worktree')?.outcome).toBe('removed');
    expect(report.complete).toBe(true);
  });
});

describe('deleteProject — execution order', () => {
  it('attempts worktrees before the project directory', () => {
    writeProjectState('ORDER-1', { repos: [{ name: 'repo-o' }] });
    const wtPath = path.join(worktreesDir, 'ORDER-1', 'repo-o');
    fs.mkdirSync(wtPath, { recursive: true });
    const clonePath = path.join(root, 'clones', 'repo-o');
    fs.mkdirSync(clonePath, { recursive: true });
    const order: string[] = [];
    const { exec } = makeExec({ onWorktreeRemove: () => { order.push('worktree'); } });
    const rm = (target: string) => { order.push('project-dir'); fs.rmSync(target, { recursive: true, force: true }); };

    const report: Result<DeletionReport> = deleteProject('ORDER-1', deps({ registryLocalPaths: { 'repo-o': clonePath }, exec }), { rm });
    unwrap(report);

    expect(order.indexOf('worktree')).toBeLessThan(order.indexOf('project-dir'));
  });
});

describe('buildPlan — malformed state.json fails the whole plan closed', () => {
  it('rejects state.json that is not valid JSON, leaving the project directory untouched', () => {
    const dir = path.join(projectsDir, 'BADJSON-1');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'state.json'), '{ this is not json');

    const planResult = planProjectDeletion('BADJSON-1', deps());
    expect(planResult.ok).toBe(false);
    if (planResult.ok) throw new Error('expected a validation failure');
    expect(planResult.error.code).toBe('validation');
    expect(planResult.error.message).toMatch(/BADJSON-1/);

    const deleteResult = deleteProject('BADJSON-1', deps());
    expect(deleteResult.ok).toBe(false);
    if (deleteResult.ok) throw new Error('expected a validation failure');
    expect(deleteResult.error.code).toBe('validation');

    expect(fs.existsSync(dir)).toBe(true);
    expect(fs.existsSync(path.join(dir, 'state.json'))).toBe(true);
  });

  it('rejects a non-object pipeline.source_control field, leaving the project directory untouched', () => {
    const dir = path.join(projectsDir, 'BADSC-1');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ pipeline: { source_control: 'not-an-object' } }));

    const result = deleteProject('BADSC-1', deps());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a validation failure');
    expect(result.error.code).toBe('validation');
    expect(fs.existsSync(dir)).toBe(true);
  });

  it('still succeeds with zero worktree/side-project items when pipeline is present but has no source_control key — distinguishing "absent" from "corrupt"', () => {
    const dir = path.join(projectsDir, 'NOSC-1');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ pipeline: { halt_reason: null } }));

    const plan = unwrap(planProjectDeletion('NOSC-1', deps()));
    expect(plan.items.filter((i) => i.kind === 'worktree' || i.kind === 'side-project-repo')).toHaveLength(0);
    expect(plan.items.map((i) => i.kind)).toEqual(['project-dir', 'graph-edges']);
  });

  it('still includes and removes a sideProjectsDir/<id> directory even with no pipeline.source_control anywhere in state.json', () => {
    const dir = path.join(projectsDir, 'ORPHANSIDE-1');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ project: { name: 'ORPHANSIDE-1' } }));
    const spPath = path.join(sideProjectsDir, 'ORPHANSIDE-1');
    fs.mkdirSync(spPath, { recursive: true });
    fs.writeFileSync(path.join(spPath, 'marker.txt'), 'content');

    const plan = unwrap(planProjectDeletion('ORPHANSIDE-1', deps()));
    const planItem = plan.items.find((i) => i.kind === 'side-project-repo');
    expect(planItem).toBeTruthy();
    expect(planItem?.path).toBe(spPath);

    const report = unwrap(deleteProject('ORPHANSIDE-1', deps()));
    expect(report.items.find((i) => i.kind === 'side-project-repo')?.outcome).toBe('removed');
    expect(fs.existsSync(spPath)).toBe(false);
    expect(report.complete).toBe(true);
  });
});

describe('buildPlan — containment guard against path traversal', () => {
  it('rejects a worktree_name traversal that resolves inside sideProjectsDir under a different project, leaving the victim untouched', () => {
    writeProjectState('ATTACKER-1', { worktree_name: '../side-projects/VICTIM-SIDE', repos: [{ name: 'repo-a' }] });
    const victimSidePath = path.join(sideProjectsDir, 'VICTIM-SIDE');
    fs.mkdirSync(victimSidePath, { recursive: true });
    fs.writeFileSync(path.join(victimSidePath, 'marker.txt'), 'keep-me');

    const planResult = planProjectDeletion('ATTACKER-1', deps());
    expect(planResult.ok).toBe(false);
    if (planResult.ok) throw new Error('expected a validation failure');
    expect(planResult.error.code).toBe('validation');
    expect(planResult.error.message).toMatch(/ATTACKER-1/);

    const deleteResult = deleteProject('ATTACKER-1', deps());
    expect(deleteResult.ok).toBe(false);
    if (deleteResult.ok) throw new Error('expected a validation failure');
    expect(deleteResult.error.code).toBe('validation');

    expect(fs.existsSync(victimSidePath)).toBe(true);
    expect(fs.existsSync(path.join(victimSidePath, 'marker.txt'))).toBe(true);
  });

  it('rejects a repo-name traversal that escapes worktreesDir entirely', () => {
    writeProjectState('ATTACKER-2', { repos: [{ name: '../../outside-repo' }] });

    const result = deleteProject('ATTACKER-2', deps());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a validation failure');
    expect(result.error.code).toBe('validation');
    expect(fs.existsSync(path.join(root, 'outside-repo'))).toBe(false);
  });

  it('rejects a legacy absolute worktree_path pointing outside worktreesDir', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'wg-del-legacy-'));
    try {
      writeProjectState('ATTACKER-3', { worktree_path: outside });

      const planResult = planProjectDeletion('ATTACKER-3', deps());
      expect(planResult.ok).toBe(false);
      if (planResult.ok) throw new Error('expected a validation failure');
      expect(planResult.error.code).toBe('validation');

      const deleteResult = deleteProject('ATTACKER-3', deps());
      expect(deleteResult.ok).toBe(false);
      if (deleteResult.ok) throw new Error('expected a validation failure');
      expect(deleteResult.error.code).toBe('validation');

      expect(fs.existsSync(outside)).toBe(true);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});

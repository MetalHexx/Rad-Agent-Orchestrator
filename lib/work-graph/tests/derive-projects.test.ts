import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listProjectNames, deriveProject } from '../src/derive/projects.js';

let root: string;
let projectsDir: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'wg-'));
  projectsDir = path.join(root, 'projects');
  const dir = path.join(projectsDir, 'DEMO-1');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({
    project: { name: 'DEMO-1', project_type: 'side-project' },
    pipeline: { current_tier: 'execution', source_control: { branch: 'x', worktree_path: '/w', auto_commit: 'always', auto_pr: 'always' } },
    graph: { nodes: { a: { status: 'completed' } } },
  }));
  fs.writeFileSync(path.join(dir, 'DEMO-1-REQUIREMENTS.md'), '');
  fs.writeFileSync(path.join(dir, 'DEMO-1-MASTER-PLAN.md'), '');
  fs.writeFileSync(path.join(dir, 'DEMO-1-ERROR-LOG.md'), '');
  fs.mkdirSync(path.join(projectsDir, '_archive'), { recursive: true });
});
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

describe('project derivation', () => {
  it('lists project folders, skipping underscore-prefixed dirs', () => {
    expect(listProjectNames(projectsDir)).toEqual(['DEMO-1']);
  });
  it('derives metadata, docs slots, and projectType from state.json', () => {
    const p = deriveProject('DEMO-1', { projectsDir, worktreesDir: path.join(root, 'worktrees'), exec: () => '' });
    expect(p?.kind).toBe('project');
    expect(p?.id).toBe('DEMO-1');
    expect(p?.dir).toBe(path.join(projectsDir, 'DEMO-1'));
    expect(p?.tier).toBe('execution');
    expect(p?.state).toBe('pending_review');
    expect(p?.stateLabel).toBe('Pending Review');
    expect(p?.projectType).toBe('side-project');
    expect(p?.sourceControlInitialized).toBe(true);
    expect(p?.docs.requirements).toBe('DEMO-1-REQUIREMENTS.md');
    expect(p?.docs.masterPlan).toBe('DEMO-1-MASTER-PLAN.md');
    expect(p?.docs.brainstorming).toBeUndefined();
    expect(p?.docs.others).toEqual(['DEMO-1-ERROR-LOG.md']);
  });
  it('reports the registered clone path for an in_place repo instead of the convention path', () => {
    const clonePath = path.join(root, 'clones', 'rad-orc-source');
    fs.writeFileSync(path.join(projectsDir, 'DEMO-1', 'state.json'), JSON.stringify({
      project: { name: 'DEMO-1' },
      pipeline: { source_control: { repos: [{ name: 'rad-orc-source', in_place: true }] } },
      graph: { nodes: {} },
    }));
    const p = deriveProject('DEMO-1', {
      projectsDir,
      worktreesDir: path.join(root, 'worktrees'),
      registryLocalPaths: { 'rad-orc-source': clonePath },
      exec: () => '',
    });
    expect(p?.worktrees).toEqual([
      { repo: 'rad-orc-source', path: clonePath, branch: null, exists: false, resolvedVia: 'registry-clone' },
    ]);
  });
  it('defaults projectType to standard when absent and returns null for a missing folder', () => {
    fs.writeFileSync(path.join(projectsDir, 'DEMO-1', 'state.json'), JSON.stringify({ project: { name: 'DEMO-1' }, graph: { nodes: {} } }));
    expect(deriveProject('DEMO-1', { projectsDir, worktreesDir: path.join(root, 'worktrees'), exec: () => '' })?.projectType).toBe('standard');
    expect(deriveProject('GHOST', { projectsDir, worktreesDir: path.join(root, 'worktrees'), exec: () => '' })).toBeNull();
  });

  describe('docs denylist', () => {
    it('excludes both machinery files and keeps a non-markdown supplemental file', () => {
      const dir = path.join(projectsDir, 'DEMO-1');
      fs.writeFileSync(path.join(dir, 'template.yml'), '');
      fs.writeFileSync(path.join(dir, 'data.csv'), '');
      const p = deriveProject('DEMO-1', { projectsDir, worktreesDir: path.join(root, 'worktrees'), exec: () => '' });
      expect(p?.docs.others).toEqual(['data.csv', 'DEMO-1-ERROR-LOG.md']);
      expect(p?.docs.others).not.toContain('state.json');
      expect(p?.docs.others).not.toContain('template.yml');
    });
    it('excludes .project-sessions.json from docs.others', () => {
      const dir = path.join(projectsDir, 'DEMO-1');
      fs.writeFileSync(path.join(dir, '.project-sessions.json'), '{}');
      fs.writeFileSync(path.join(dir, 'supplemental.md'), '');
      const p = deriveProject('DEMO-1', { projectsDir, worktreesDir: path.join(root, 'worktrees'), exec: () => '' });
      expect(p?.docs.others).toEqual(['DEMO-1-ERROR-LOG.md', 'supplemental.md']);
      expect(p?.docs.others).not.toContain('.project-sessions.json');
    });
  });

  describe('docs.subfolders', () => {
    it('lists subdirectory names, sorted, without descending into them', () => {
      const dir = path.join(projectsDir, 'DEMO-1');
      fs.mkdirSync(path.join(dir, 'tasks'), { recursive: true });
      fs.mkdirSync(path.join(dir, 'phases'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'tasks', 'nested.md'), '');
      const p = deriveProject('DEMO-1', { projectsDir, worktreesDir: path.join(root, 'worktrees'), exec: () => '' });
      expect(p?.docs.subfolders).toEqual(['phases', 'tasks']);
      expect(p?.docs.others).not.toContain('nested.md');
      expect(p?.docs.others.some((f) => f.includes('tasks'))).toBe(false);
    });
    it('is empty when the project has no subdirectories', () => {
      const p = deriveProject('DEMO-1', { projectsDir, worktreesDir: path.join(root, 'worktrees'), exec: () => '' });
      expect(p?.docs.subfolders).toEqual([]);
    });
  });

  describe('portfolio kind', () => {
    const derive = (name: string) =>
      deriveProject(name, { projectsDir, worktreesDir: path.join(root, 'worktrees'), exec: () => '' });
    const makeDir = (name: string, files: Record<string, string>) => {
      const dir = path.join(projectsDir, name);
      fs.mkdirSync(dir, { recursive: true });
      for (const [file, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, file), body);
    };

    it('derives the portfolio kind and fills the root slot for a -ROOT dir holding its own document', () => {
      makeDir('PLATFORM-ROOT', { 'PLATFORM-ROOT.md': '', 'appendix.md': '' });
      const p = derive('PLATFORM-ROOT');
      expect(p?.projectType).toBe('portfolio');
      expect(p?.docs.root).toBe('PLATFORM-ROOT.md');
    });

    it('does not leak the root document into docs.others', () => {
      makeDir('PLATFORM-ROOT', { 'PLATFORM-ROOT.md': '', 'appendix.md': '' });
      expect(derive('PLATFORM-ROOT')?.docs.others).toEqual(['appendix.md']);
    });

    it('leaves a same-named document in docs.others when the dir has no -ROOT suffix', () => {
      makeDir('PLATFORM', { 'PLATFORM.md': '' });
      const p = derive('PLATFORM');
      expect(p?.projectType).toBe('standard');
      expect(p?.docs.root).toBeUndefined();
      expect(p?.docs.others).toEqual(['PLATFORM.md']);
    });

    it('keeps the state-derived kind for a -ROOT dir with no document of its own name', () => {
      makeDir('PLATFORM-ROOT', { 'notes.md': '' });
      const p = derive('PLATFORM-ROOT');
      expect(p?.projectType).toBe('standard');
      expect(p?.docs.root).toBeUndefined();
    });

    it('wins over a state.json declaring side-project', () => {
      makeDir('PLATFORM-ROOT', {
        'PLATFORM-ROOT.md': '',
        'state.json': JSON.stringify({ project: { name: 'PLATFORM-ROOT', project_type: 'side-project' }, graph: { nodes: {} } }),
      });
      expect(derive('PLATFORM-ROOT')?.projectType).toBe('portfolio');
    });

    it('returns null for a -ROOT directory that does not exist', () => {
      expect(derive('GHOST-ROOT')).toBeNull();
    });

    it('derives the portfolio kind for a symlinked root doc, agreeing with the existence-check paths', (ctx) => {
      const dir = path.join(projectsDir, 'SYMLINK-ROOT');
      fs.mkdirSync(dir, { recursive: true });
      const realDoc = path.join(dir, '_real-doc.md');
      fs.writeFileSync(realDoc, '# real\n');
      const linkPath = path.join(dir, 'SYMLINK-ROOT.md');
      try {
        fs.symlinkSync(realDoc, linkPath, 'file');
      } catch {
        // Skippable on platforms/CI users without symlink privilege.
        ctx.skip();
        return;
      }
      const p = derive('SYMLINK-ROOT');
      expect(p?.projectType).toBe('portfolio');
      expect(p?.docs.root).toBe('SYMLINK-ROOT.md');
    });
  });

  describe('haltReason', () => {
    const derive = () => deriveProject('DEMO-1', { projectsDir, worktreesDir: path.join(root, 'worktrees'), exec: () => '' });
    const writeState = (pipeline: Record<string, unknown>) =>
      fs.writeFileSync(path.join(projectsDir, 'DEMO-1', 'state.json'), JSON.stringify({
        project: { name: 'DEMO-1' }, pipeline, graph: { nodes: {} },
      }));

    it('is the recorded string when present', () => {
      writeState({ halt_reason: 'blocked on missing credentials' });
      expect(derive()?.haltReason).toBe('blocked on missing credentials');
    });
    it('is null when halt_reason is explicitly null', () => {
      writeState({ halt_reason: null });
      expect(derive()?.haltReason).toBeNull();
    });
    it('is null when pipeline itself is absent', () => {
      fs.writeFileSync(path.join(projectsDir, 'DEMO-1', 'state.json'), JSON.stringify({ project: { name: 'DEMO-1' }, graph: { nodes: {} } }));
      expect(derive()?.haltReason).toBeNull();
    });
    it('is null when halt_reason is a non-string value', () => {
      writeState({ halt_reason: 42 });
      expect(derive()?.haltReason).toBeNull();
    });
    it('is null when halt_reason is an empty string', () => {
      writeState({ halt_reason: '' });
      expect(derive()?.haltReason).toBeNull();
    });
  });
});

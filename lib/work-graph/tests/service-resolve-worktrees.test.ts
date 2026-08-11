import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeLocal } from '@rad-orchestration/repo-registry';
import { WorkGraphService } from '../src/service.js';
import type { Project } from '../src/types.js';

// End-to-end coverage that the service forwards sideProjectsDir into deriveWorktrees,
// so a side-project resolves to side-projects/<name> rather than a non-existent
// worktrees-convention path (the MULTI-REPO-5 regression that broke side-project runs).
let root: string;
let projectsDir: string;
let sideProjectsDir: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'wg-svc-sp-'));
  projectsDir = path.join(root, 'projects');
  sideProjectsDir = path.join(root, 'side-projects');
  fs.mkdirSync(path.join(projectsDir, 'SP-1'), { recursive: true });
  fs.writeFileSync(path.join(projectsDir, 'SP-1', 'state.json'),
    JSON.stringify({
      project: { name: 'SP-1', project_type: 'side-project' },
      pipeline: { source_control: { worktree_name: 'SP-1', repos: [{ name: 'SP-1', branch: 'main' }] } },
      graph: { nodes: {} },
    }));
});
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

describe('WorkGraphService.resolveWorktrees side-project forwarding', () => {
  it('forwards an explicit sideProjectsDir so a side-project resolves to side-projects/<name>', () => {
    const svc = new WorkGraphService({ root, worktreesDir: path.join(root, 'worktrees'), sideProjectsDir, exec: () => '' });
    expect(svc.resolveWorktrees('SP-1')).toEqual([
      { repo: 'SP-1', path: path.join(sideProjectsDir, 'SP-1'), branch: 'main', exists: false, resolvedVia: 'convention' },
    ]);
  });
  it('defaults sideProjectsDir to <root>/side-projects when omitted (getter default — wiring is hardening, not load-bearing)', () => {
    const svc = new WorkGraphService({ root, worktreesDir: path.join(root, 'worktrees'), exec: () => '' });
    expect(svc.resolveWorktrees('SP-1')).toEqual([
      { repo: 'SP-1', path: path.join(root, 'side-projects', 'SP-1'), branch: 'main', exists: false, resolvedVia: 'convention' },
    ]);
  });
});

// A clone binding is only useful if the registry reaches the derivation. The service
// is the only place that can read it, and it feeds two independent routes — the direct
// resolveWorktrees wrapper and the composed graph behind listProjects.
describe('WorkGraphService clone-binding registry forwarding', () => {
  let clonePath: string;
  beforeEach(() => {
    clonePath = path.join(root, 'clones', 'rad-orc-source');
    fs.mkdirSync(path.join(projectsDir, 'CLONE-1'), { recursive: true });
    fs.writeFileSync(path.join(projectsDir, 'CLONE-1', 'state.json'),
      JSON.stringify({
        project: { name: 'CLONE-1' },
        pipeline: { source_control: { repos: [{ name: 'rad-orc-source', in_place: true }] } },
        graph: { nodes: {} },
      }));
    writeLocal({ root, localPaths: { 'rad-orc-source': clonePath } });
  });

  function service(): WorkGraphService {
    return new WorkGraphService({ root, worktreesDir: path.join(root, 'worktrees'), sideProjectsDir, exec: () => '' });
  }

  it('resolves an in_place repo to its registered clone path', () => {
    expect(service().resolveWorktrees('CLONE-1')).toEqual([
      { repo: 'rad-orc-source', path: clonePath, branch: null, exists: false, resolvedVia: 'registry-clone' },
    ]);
  });

  it('reports the same clone path through listProjects', () => {
    const project = service().listProjects().find((p: Project) => p.id === 'CLONE-1');
    expect(project?.worktrees).toEqual([
      { repo: 'rad-orc-source', path: clonePath, branch: null, exists: false, resolvedVia: 'registry-clone' },
    ]);
  });
});

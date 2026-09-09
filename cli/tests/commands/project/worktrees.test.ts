import { describe, it, expect } from 'vitest';
import { buildWorktreesResult, assertProjectExists } from '../../../src/commands/project/worktrees.js';
import { UserError } from '../../../src/framework/errors.js';
import type { WorktreeRef } from '@rad-orchestration/work-graph';

describe('project worktrees result shaping', () => {
  it('returns the actionable per-worktree fields and drops resolvedVia plumbing', () => {
    const refs: WorktreeRef[] = [
      { repo: 'rad-orc-source', path: 'C:/w/MR-3/rad-orc-source', branch: 'feature/x', exists: true, resolvedVia: 'convention' },
    ];
    expect(buildWorktreesResult('MR-3', refs, 'MR-3', 'standard')).toEqual({
      name: 'MR-3',
      worktree_name: 'MR-3',
      workspace: 'present',
      worktrees: [{ repo: 'rad-orc-source', path: 'C:/w/MR-3/rad-orc-source', branch: 'feature/x', exists: true }],
    });
  });

  it('carries worktree_name verbatim when it differs from name, without collapsing the two', () => {
    const refs: WorktreeRef[] = [
      { repo: 'rad-orc-source', path: 'C:/w/PARENT-1/rad-orc-source', branch: 'feature/x', exists: true, resolvedVia: 'shared-worktree-name' },
    ];
    const result = buildWorktreesResult('CHILD-2', refs, 'PARENT-1', 'standard');
    expect(result.name).toBe('CHILD-2');
    expect(result.worktree_name).toBe('PARENT-1');
  });
});

describe('workspace disposition', () => {
  it('is in-place when a registry-clone ref is present, even alongside other refs', () => {
    const refs: WorktreeRef[] = [
      { repo: 'rad-orc-source', path: '/clone/rad-orc-source', branch: 'main', exists: true, resolvedVia: 'registry-clone' },
      { repo: 'rad-orc-ui', path: '/w/DEMO/rad-orc-ui', branch: null, exists: false, resolvedVia: 'convention' },
    ];
    expect(buildWorktreesResult('DEMO', refs, 'DEMO', 'standard').workspace).toBe('in-place');
  });

  it('is present when at least one non-clone ref exists on disk', () => {
    const refs: WorktreeRef[] = [
      { repo: 'rad-orc-source', path: '/w/DEMO/rad-orc-source', branch: 'feature/x', exists: true, resolvedVia: 'convention' },
    ];
    expect(buildWorktreesResult('DEMO', refs, 'DEMO', 'standard').workspace).toBe('present');
  });

  it('is absent when every ref reports exists: false', () => {
    const refs: WorktreeRef[] = [
      { repo: 'rad-orc-source', path: '/w/DEMO/rad-orc-source', branch: null, exists: false, resolvedVia: 'convention' },
    ];
    expect(buildWorktreesResult('DEMO', refs, 'DEMO', 'standard').workspace).toBe('absent');
  });

  it('is absent for a project with no refs at all', () => {
    expect(buildWorktreesResult('DEMO', [], 'DEMO', 'standard').workspace).toBe('absent');
  });

  it('is side-project regardless of ref shape, taking priority over in-place and present', () => {
    const refs: WorktreeRef[] = [
      { repo: 'my-repo', path: '/side-projects/DEMO', branch: 'main', exists: true, resolvedVia: 'convention' },
      { repo: 'other-repo', path: '/clone/other-repo', branch: 'main', exists: true, resolvedVia: 'registry-clone' },
    ];
    expect(buildWorktreesResult('DEMO', refs, 'DEMO', 'side-project').workspace).toBe('side-project');
  });

  it('computes a portfolio root identically to a standard project, taking neither the side-project nor an unhandled branch', () => {
    expect(buildWorktreesResult('DEMO', [], 'DEMO', 'portfolio').workspace).toBe('absent');
  });
});

describe('assertProjectExists', () => {
  it('throws a UserError when getNode reports no node for the id', () => {
    expect(() => assertProjectExists('NOPE', () => null)).toThrow(UserError);
  });

  it('does not throw when getNode reports a node for the id', () => {
    expect(() => assertProjectExists('DEMO-1', () => ({ id: 'DEMO-1', kind: 'project' }))).not.toThrow();
  });

  it('throws a UserError when getNode reports a group node', () => {
    expect(() => assertProjectExists('grp:foo', () => ({ id: 'grp:foo', kind: 'group' }))).toThrow(UserError);
  });
});

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { WorktreeRef } from '../types.js';

export type GitExec = (file: string, args: string[], opts: { cwd?: string }) => string;
export interface ResolveDeps {
  projectsDir: string;
  worktreesDir: string;
  sideProjectsDir?: string;
  /** Repo name → absolute local clone path, from the registry. Absent → clone bindings fall back to the convention path. */
  registryLocalPaths?: Record<string, string>;
  exec?: GitExec;
}

const defaultExec: GitExec = (file, args, opts) =>
  execFileSync(file, args, { cwd: opts.cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }) as unknown as string;

function listWorktrees(exec: GitExec, cwd: string): Map<string, string | null> {
  const out = new Map<string, string | null>();
  let text = '';
  try { text = exec('git', ['worktree', 'list', '--porcelain'], { cwd }); } catch { return out; }
  let cur: string | null = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('worktree ')) { cur = path.resolve(line.slice('worktree '.length).trim()); out.set(cur, null); }
    else if (line.startsWith('branch ') && cur) out.set(cur, line.slice('branch '.length).trim().replace('refs/heads/', ''));
    else if (line.trim() === '') cur = null;
  }
  return out;
}

export function resolveWorktrees(projectName: string, deps: ResolveDeps): WorktreeRef[] {
  const exec = deps.exec ?? defaultExec;
  const statePath = path.join(deps.projectsDir, projectName, 'state.json');
  if (!fs.existsSync(statePath)) return [];
  let state: any;
  try { state = JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch { return []; }
  const sc = state?.pipeline?.source_control;
  if (!sc || typeof sc !== 'object') return [];

  // Side-project: a single local-only git repo at sideProjectsDir/<projectName>
  // (no managed worktree). source-control init seals repos:[<projectName>],
  // branch 'main', remote_url null. Resolve to the real on-disk location so the
  // pipeline hands consumers a usable path instead of a worktrees-convention path
  // that does not exist for a side-project. Mirrors locate()'s side-project awareness.
  if (state?.project?.project_type === 'side-project' && deps.sideProjectsDir) {
    const repoName = Array.isArray(sc.repos) && sc.repos[0]?.name ? sc.repos[0].name : projectName;
    const spPath = path.join(deps.sideProjectsDir, projectName);
    const live = listWorktrees(exec, spPath);
    const key = path.resolve(spPath);
    return [{
      repo: repoName,
      path: spPath,
      branch: live.get(key) ?? (typeof sc.repos?.[0]?.branch === 'string' ? sc.repos[0].branch : null),
      exists: live.has(key),
      resolvedVia: 'convention',
    }];
  }
  // FR-3: worktree reuse is derived from a shared `worktree_name` read from
  // state.pipeline.source_control, never stored. It defaults to the project name;
  // a child running inside a parent's worktree carries the parent's name here.
  const sharedName = typeof sc.worktree_name === 'string' && sc.worktree_name !== '' ? sc.worktree_name : null;
  const worktreeName = sharedName ?? projectName;
  // Genuine reuse: the shared name came from source_control and differs from the folder name.
  const repoResolvedVia: WorktreeRef['resolvedVia'] =
    sharedName !== null && sharedName !== projectName ? 'shared-worktree-name' : 'convention';
  // A repo bound in place has no managed worktree: it resolves to the operator's
  // registered clone. With no registry entry the convention path stands in — this
  // derivation is a read on a hot path and must not become a failure point.
  if (Array.isArray(sc.repos) && sc.repos.length > 0) {
    return sc.repos.map((r: { name: string; in_place?: boolean }) => {
      const clonePath = r.in_place === true ? deps.registryLocalPaths?.[r.name] : undefined;
      const wtPath = clonePath ?? path.join(deps.worktreesDir, worktreeName, r.name);
      const live = listWorktrees(exec, wtPath);
      const key = path.resolve(wtPath);
      return {
        repo: r.name,
        path: wtPath,
        branch: live.get(key) ?? null,
        exists: live.has(key),
        resolvedVia: clonePath ? 'registry-clone' as const : repoResolvedVia,
      };
    });
  }
  const wtPath = typeof sc.worktree_path === 'string' ? sc.worktree_path : null;
  if (!wtPath) return [];
  const live = listWorktrees(exec, wtPath);
  const key = path.resolve(wtPath);
  return [{ repo: path.basename(wtPath), path: wtPath, branch: typeof sc.branch === 'string' ? sc.branch : null, exists: live.has(key), resolvedVia: 'git' as const }];
}

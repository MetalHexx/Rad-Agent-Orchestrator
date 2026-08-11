import path from 'node:path';

import { isProjectDirName } from '../project-name';

export interface RawFsEvent {
  type: 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir';
  filePath: string;
}

export interface StateSemanticEvent {
  topic: string;
  projectName: string;
}

export interface LifecycleSemanticEvent {
  topic: string;
  kind: 'project_added' | 'project_removed';
  projectName: string;
}

export function stateTopicForProject(projectName: string): string {
  return `state:${projectName}`;
}

export function lifecycleTopic(): string {
  return 'lifecycle';
}

function segments(filePath: string, projectsRoot: string): string[] {
  const rel = path.relative(projectsRoot, filePath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return [];
  return rel.split(/[\\/]/).filter(Boolean);
}

export function classifyStateEvent(e: RawFsEvent, projectsRoot: string): StateSemanticEvent | null {
  if (e.type !== 'add' && e.type !== 'change') return null;
  const segs = segments(e.filePath, projectsRoot);
  if (segs.length !== 2 || segs[1] !== 'state.json') return null;
  return { topic: stateTopicForProject(segs[0]), projectName: segs[0] };
}

export function classifyLifecycleEvent(e: RawFsEvent, projectsRoot: string): LifecycleSemanticEvent | null {
  const segs = segments(e.filePath, projectsRoot);
  // state.json add/unlink → project_added / project_removed (keyed by the project dir)
  if ((e.type === 'add' || e.type === 'unlink') && segs.length === 2 && segs[1] === 'state.json') {
    if (!isProjectDirName(segs[0])) return null;
    return {
      topic: lifecycleTopic(),
      kind: e.type === 'add' ? 'project_added' : 'project_removed',
      projectName: segs[0],
    };
  }
  // First-level directory add/remove (catches a project created with no state.json)
  if ((e.type === 'addDir' || e.type === 'unlinkDir') && segs.length === 1) {
    if (!isProjectDirName(segs[0])) return null;
    return {
      topic: lifecycleTopic(),
      kind: e.type === 'addDir' ? 'project_added' : 'project_removed',
      projectName: segs[0],
    };
  }
  return null;
}

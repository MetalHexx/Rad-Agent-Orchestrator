import path from 'node:path';

import type { RawFsEvent } from './state-adapter';

export interface SessionsSemanticEvent {
  topic: string;
  projectName: string;
}

const SESSIONS_FILE = '.project-sessions.json';

export function sessionsTopicForProject(projectName: string): string {
  return `sessions:${projectName}`;
}

// Reimplemented rather than imported: state-adapter.ts's segments() is
// module-private.
function segments(filePath: string, projectsRoot: string): string[] {
  const rel = path.relative(projectsRoot, filePath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return [];
  return rel.split(/[\\/]/).filter(Boolean);
}

// Exact-basename match only: the CLI's writer creates `.project-sessions.json.lock`
// and `.project-sessions.json.<pid>.tmp` siblings on every save, and a
// startsWith/includes match would fire on that lock churn.
export function classifySessionsEvent(e: RawFsEvent, projectsRoot: string): SessionsSemanticEvent | null {
  if (e.type !== 'add' && e.type !== 'change') return null;
  const segs = segments(e.filePath, projectsRoot);
  if (segs.length !== 2 || segs[1] !== SESSIONS_FILE) return null;
  return { topic: sessionsTopicForProject(segs[0]), projectName: segs[0] };
}

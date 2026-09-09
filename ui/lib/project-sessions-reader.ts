import fs from 'node:fs';
import path from 'node:path';

/**
 * Verbatim transplant of the READ path only from the canonical
 * `cli/src/lib/project-sessions.ts`. The UI may never import `cli/src/`
 * directly (see `ui/AGENTS.md`), and the dashboard is a read-only consumer
 * of a file the CLI is sole writer of — the same pattern already used for
 * `state.json`. Deliberately excludes the write path, the lock, and the
 * upsert: this module never mutates `.project-sessions.json`.
 */

export const PROJECT_SESSIONS_FILE = '.project-sessions.json';

export type Harness = 'claude' | 'copilot';

export interface SessionActivity {
  type: string;
  description: string;
  at: string;
}

export interface ProjectSessionEntry {
  sessionId: string;
  name: string;
  cwd: string;
  harness: Harness;
  createdAt: string;
  lastSeenAt: string;
  activity: SessionActivity[];
}

export interface ProjectSessionsFile {
  version: 1;
  sessions: ProjectSessionEntry[];
  updatedAt: string;
}

export function projectSessionsPath(projectDir: string): string {
  return path.join(projectDir, PROJECT_SESSIONS_FILE);
}

/** Absent or malformed reads as a valid empty file — never throws. */
export function readProjectSessions(projectDir: string): ProjectSessionsFile {
  try {
    const raw = JSON.parse(
      fs.readFileSync(projectSessionsPath(projectDir), 'utf8'),
    ) as Partial<ProjectSessionsFile>;
    return {
      version: 1,
      sessions: Array.isArray(raw.sessions) ? (raw.sessions as ProjectSessionEntry[]) : [],
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '',
    };
  } catch {
    return { version: 1, sessions: [], updatedAt: '' };
  }
}

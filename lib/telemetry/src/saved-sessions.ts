import fs from 'node:fs';
import path from 'node:path';

export interface SavedSessionSnapshot {
  worktree: string | null;
  model: string | null;
  startedAt: string;
  durationMs: number;
  totalSpend: number;
  tokens: { input: number; output: number; cacheRead: number; cacheCreation: number };
  toolCalls: number;
  toolErrors: number;
  subagents: number;
  filesTouched: number;
}

export interface SavedSession {
  sessionId: string;
  title: string;
  savedAt: string;
  snapshot: SavedSessionSnapshot;
}

export interface SavedSessionsIndex {
  version: 1;
  sessions: SavedSession[];
  updatedAt: string;
}

const INDEX_FILE = '.saved-sessions.json';
export function savedIndexPath(root: string): string { return path.join(root, INDEX_FILE); }

// Absent or malformed index reads as a valid empty index; unknown fields are ignored. (NFR-4)
export function readSavedIndex(root: string): SavedSessionsIndex {
  try {
    const raw = JSON.parse(fs.readFileSync(savedIndexPath(root), 'utf8')) as Partial<SavedSessionsIndex>;
    return {
      version: 1,
      sessions: Array.isArray(raw.sessions) ? (raw.sessions as SavedSession[]) : [],
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '',
    };
  } catch { return { version: 1, sessions: [], updatedAt: '' }; }
}

export function isSessionSaved(root: string, sessionId: string): boolean {
  return readSavedIndex(root).sessions.some((s) => s.sessionId === sessionId);
}

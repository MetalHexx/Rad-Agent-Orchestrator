import fs from 'node:fs';
import path from 'node:path';

export const PROJECT_INDEX_FILE = '.project-sessions-index.json';

export interface ProjectSessionIndexEntry {
  sessionId: string;
  project: string;
  updatedAt: string;
}

export interface ProjectSessionIndex {
  version: 1;
  sessions: ProjectSessionIndexEntry[];
  updatedAt: string;
}

export function projectIndexPath(root: string): string { return path.join(root, PROJECT_INDEX_FILE); }

/** Absent or malformed index reads as a valid empty index; unknown fields are ignored. */
export function readProjectIndex(root: string): ProjectSessionIndex {
  try {
    const raw = JSON.parse(fs.readFileSync(projectIndexPath(root), 'utf8')) as Partial<ProjectSessionIndex>;
    return {
      version: 1,
      sessions: Array.isArray(raw.sessions) ? (raw.sessions as ProjectSessionIndexEntry[]) : [],
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '',
    };
  } catch { return { version: 1, sessions: [], updatedAt: '' }; }
}

// Atomic write: temp + rename, matching the saved-sessions index.
function writeIndex(root: string, index: ProjectSessionIndex): void {
  fs.mkdirSync(root, { recursive: true });
  const file = projectIndexPath(root);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(index, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

const LOCK_STALE_MS = 10_000;
const LOCK_MAX_WAIT_MS = 5_000;
const LOCK_POLL_MS = 10;

function lockPath(root: string): string { return `${projectIndexPath(root)}.lock`; }

/** Blocking synchronous sleep — safe here because this only ever runs on the CLI's main thread. */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Serializes read-modify-write access to the index with an exclusive lock file
 * (atomic `wx` create), so two concurrent `session save` calls can't both read the
 * same snapshot and have the second write clobber the first's entry. A lock older
 * than LOCK_STALE_MS is treated as an abandoned holder (crash) and reclaimed; a
 * live holder is waited out up to LOCK_MAX_WAIT_MS before being reclaimed anyway,
 * so a wedged process can't deadlock every future save.
 */
function withLock<T>(root: string, fn: () => T): T {
  fs.mkdirSync(root, { recursive: true });
  const p = lockPath(root);
  const start = Date.now();
  for (;;) {
    try {
      fs.closeSync(fs.openSync(p, 'wx'));
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      let stale = true;
      try { stale = Date.now() - fs.statSync(p).mtimeMs > LOCK_STALE_MS; } catch { /* vanished mid-check; retry acquire */ }
      if (!stale && Date.now() - start <= LOCK_MAX_WAIT_MS) { sleepSync(LOCK_POLL_MS); continue; }
      try { fs.unlinkSync(p); } catch { /* raced another reclaimer */ }
    }
  }
  try { return fn(); } finally { try { fs.unlinkSync(p); } catch { /* already released */ } }
}

/**
 * Attribute a session to a project, deduped by session id — a re-save rewrites the
 * entry's project and updatedAt rather than appending. The project name is stored
 * alongside the id so a reader can filter by project without opening a project folder.
 *
 * `now` is injectable so a caller writing this index alongside the project record can
 * stamp both stores from one clock read; it defaults to the wall clock.
 */
export function writeProjectIndexEntry(root: string, e: { sessionId: string; project: string; now?: Date }): ProjectSessionIndexEntry {
  return withLock(root, () => {
    const index = readProjectIndex(root);
    const updatedAt = (e.now ?? new Date()).toISOString();
    const existing = index.sessions.find((s) => s.sessionId === e.sessionId);
    const record: ProjectSessionIndexEntry = existing ?? { sessionId: e.sessionId, project: e.project, updatedAt };
    if (existing) { existing.project = e.project; existing.updatedAt = updatedAt; }
    else index.sessions.push(record);
    index.updatedAt = updatedAt;
    writeIndex(root, index);
    return record;
  });
}

export function lookupSessionProject(root: string, sessionId: string): string | null {
  return readProjectIndex(root).sessions.find((s) => s.sessionId === sessionId)?.project ?? null;
}

/** Drop every index entry attributed to `project`. Returns how many were removed.
 *  A project with no claims is a no-op that writes nothing. */
export function removeProjectIndexEntries(root: string, project: string): number {
  return withLock(root, () => {
    const index = readProjectIndex(root);
    const remaining = index.sessions.filter((s) => s.project !== project);
    const removed = index.sessions.length - remaining.length;
    if (removed === 0) return 0;
    writeIndex(root, { version: 1, sessions: remaining, updatedAt: new Date().toISOString() });
    return removed;
  });
}

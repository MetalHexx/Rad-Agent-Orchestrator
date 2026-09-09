import fs from 'node:fs';
import path from 'node:path';

export const PROJECT_SESSIONS_FILE = '.project-sessions.json';

export const ACTIVITY_TYPES = ['brainstorming', 'requirements', 'master-plan', 'amend', 'execution', 'other', 'execution-complete', 'final-approved', 'final-rejected', 'halted', 'corrective'] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export interface SessionActivity {
  type: string; // one of ACTIVITY_TYPES, or any caller-supplied value
  description: string;
  at: string; // ISO-8601
}

export interface ProjectSessionEntry {
  sessionId: string; // the key
  name: string; // human handle for the whole conversation
  cwd: string; // the LAUNCH directory — what resume keys on
  harness: 'claude' | 'copilot';
  createdAt: string;
  lastSeenAt: string;
  activity: SessionActivity[]; // append-only, one entry per save
}

export interface ProjectSessionsFile {
  version: 1;
  sessions: ProjectSessionEntry[];
  updatedAt: string;
}

export function projectSessionsPath(projectDir: string): string {
  return path.join(projectDir, PROJECT_SESSIONS_FILE);
}

// Absent or malformed file reads as a valid empty index; unknown fields are ignored.
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

export interface UpsertInput {
  sessionId: string;
  name?: string; // required only when creating
  cwd: string;
  harness: 'claude' | 'copilot';
  activity: { type: string; description: string };
  now: Date; // injected — never read the clock inside
}

export type UpsertResult =
  | { ok: true; entry: ProjectSessionEntry; created: boolean }
  | { ok: false; reason: 'name_required' };

// Atomic write: temp + rename
function writeSessionsFile(projectDir: string, file: ProjectSessionsFile): void {
  fs.mkdirSync(projectDir, { recursive: true });
  const filepath = projectSessionsPath(projectDir);
  const tmp = `${filepath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(file, null, 2), 'utf8');
  fs.renameSync(tmp, filepath);
}

const LOCK_STALE_MS = 10_000;
const LOCK_MAX_WAIT_MS = 5_000;
const LOCK_POLL_MS = 10;

function lockPath(projectDir: string): string { return `${projectSessionsPath(projectDir)}.lock`; }

/** Blocking synchronous sleep — safe here because this only ever runs on the CLI's main thread. */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Serializes read-modify-write access to the sessions file with an exclusive lock
 * file (atomic `wx` create), so two concurrent `session save` calls can't both read
 * the same snapshot and have the second write clobber the first's entry. A lock
 * older than LOCK_STALE_MS is treated as an abandoned holder (crash) and reclaimed;
 * a live holder is waited out up to LOCK_MAX_WAIT_MS before being reclaimed anyway,
 * so a wedged process can't deadlock every future save.
 */
function withLock<T>(projectDir: string, fn: () => T): T {
  fs.mkdirSync(projectDir, { recursive: true });
  const p = lockPath(projectDir);
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

export function upsertProjectSession(
  projectDir: string,
  input: UpsertInput,
): UpsertResult {
  return withLock(projectDir, () => {
    const file = readProjectSessions(projectDir);
    const existing = file.sessions.find((s) => s.sessionId === input.sessionId);

    if (existing) {
      // Append activity
      existing.activity.push({
        type: input.activity.type,
        description: input.activity.description,
        at: input.now.toISOString(),
      });
      existing.lastSeenAt = input.now.toISOString();
      // Update name if provided
      if (input.name && input.name.trim() !== '') {
        existing.name = input.name;
      }
      file.updatedAt = input.now.toISOString();
      writeSessionsFile(projectDir, file);
      return { ok: true, entry: existing, created: false };
    }

    // No match
    if (!input.name || input.name.trim() === '') {
      return { ok: false, reason: 'name_required' };
    }

    // Create new entry
    const now = input.now.toISOString();
    const entry: ProjectSessionEntry = {
      sessionId: input.sessionId,
      name: input.name,
      cwd: input.cwd,
      harness: input.harness,
      createdAt: now,
      lastSeenAt: now,
      activity: [
        {
          type: input.activity.type,
          description: input.activity.description,
          at: now,
        },
      ],
    };
    file.sessions.push(entry);
    file.updatedAt = now;
    writeSessionsFile(projectDir, file);
    return { ok: true, entry, created: true };
  });
}

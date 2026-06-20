import fs from 'node:fs';
import path from 'node:path';
import { SCHEMA_VERSION, type CheckpointStore } from '../types.js';

export class FileCheckpointStore implements CheckpointStore {
  constructor(private readonly opts: { root: string }) {}
  private dir(): string { const d = path.join(this.opts.root, 'checkpoints'); fs.mkdirSync(d, { recursive: true }); return d; }
  private file(s: string): string { return path.join(this.dir(), `${s}.json`); }
  private lockPath(s: string): string { return path.join(this.dir(), `${s}.lock`); }

  seen(sessionId: string): Set<string> {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file(sessionId), 'utf8')) as { seen?: string[] };
      return new Set(raw.seen ?? []);
    } catch { return new Set(); }
  }
  commit(sessionId: string, ids: Set<string>): void {
    const payload = { sessionId, schemaVersion: SCHEMA_VERSION, updatedAt: new Date().toISOString(), seen: [...ids] };
    const file = this.file(sessionId);
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(payload), 'utf8');
    fs.renameSync(tmp, file); // MoveFileEx replace-existing on a same-volume Windows path — atomic (NFR-3)
  }
  // The age backstop for a lock whose holder still appears alive — i.e. a wedged
  // worker or a reused PID. It MUST comfortably exceed the worst-case time a real
  // capture holds the lock, or a slow-but-live capture would have its lock stolen
  // by a concurrent worker and produce duplicate rows. A real capture is sub-second
  // (~250ms against an 8MB transcript), so 120s leaves a large margin while still
  // bounding how long a genuinely-stuck worker blocks a session's captures. This
  // replaces the shim's old synchronous 10s SIGKILL bound (gone now that captures
  // detach, CLI-side async). Note: a dead-PID holder is reclaimed immediately on the
  // next capture via the liveness probe below, independent of this TTL — so the TTL
  // only governs the alive-but-aged (wedged / PID-reuse) case, never a normal worker.
  private readonly lockTtlMs = 120 * 1000;

  private isStaleLock(raw: string): boolean {
    try {
      const { pid, acquiredAt } = JSON.parse(raw) as { pid?: number; acquiredAt?: string };
      const ageMs = acquiredAt ? Date.now() - Date.parse(acquiredAt) : Infinity;
      if (Number.isFinite(ageMs) && ageMs > this.lockTtlMs) return true;   // aged out
      if (typeof pid === 'number' && Number.isInteger(pid) && pid > 0) {
        try { process.kill(pid, 0); return false; }                        // signalable ⇒ alive
        // EPERM ⇒ process exists but we can't signal it ⇒ alive. Any other
        // error (ESRCH ⇒ no such process, EINVAL ⇒ invalid pid, etc.) ⇒ stale.
        catch (e) { return (e as NodeJS.ErrnoException).code !== 'EPERM'; }
      }
      return true;                                                         // missing / non-positive / non-integer pid ⇒ unusable ⇒ stale
    } catch { return true; }                                               // unparseable ⇒ stale
  }

  tryLock(sessionId: string): boolean {
    const p = this.lockPath(sessionId);
    const acquire = (): boolean => {
      const fd = fs.openSync(p, 'wx');
      fs.writeSync(fd, JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }));
      fs.closeSync(fd);
      return true;
    };
    try { return acquire(); }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      let raw = '';
      try { raw = fs.readFileSync(p, 'utf8'); } catch { /* vanished mid-check */ }
      if (raw === '' || this.isStaleLock(raw)) {
        try { fs.unlinkSync(p); } catch { /* already released */ }
        try { return acquire(); } catch { return false; }                  // lost a race ⇒ locked
      }
      return false;
    }
  }
  unlock(sessionId: string): void {
    try { fs.unlinkSync(this.lockPath(sessionId)); } catch { /* already released */ }
  }
}

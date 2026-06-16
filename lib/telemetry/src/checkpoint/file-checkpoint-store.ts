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
  private readonly lockTtlMs = 15 * 60 * 1000;

  private isStaleLock(raw: string): boolean {
    try {
      const { pid, acquiredAt } = JSON.parse(raw) as { pid?: number; acquiredAt?: string };
      const ageMs = acquiredAt ? Date.now() - Date.parse(acquiredAt) : Infinity;
      if (Number.isFinite(ageMs) && ageMs > this.lockTtlMs) return true;   // aged out
      if (typeof pid === 'number') {
        try { process.kill(pid, 0); return false; }                        // signalable ⇒ alive
        catch (e) { return (e as NodeJS.ErrnoException).code === 'ESRCH'; } // ESRCH ⇒ dead ⇒ stale
      }
      return true;                                                         // no pid ⇒ unusable
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

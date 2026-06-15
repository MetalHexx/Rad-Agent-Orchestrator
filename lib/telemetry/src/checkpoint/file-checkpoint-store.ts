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
  tryLock(sessionId: string): boolean {
    try {
      const fd = fs.openSync(this.lockPath(sessionId), 'wx'); // O_CREAT|O_EXCL — fails if held
      fs.writeSync(fd, JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }));
      fs.closeSync(fd);
      return true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') return false;
      throw e;
    }
  }
  unlock(sessionId: string): void {
    try { fs.unlinkSync(this.lockPath(sessionId)); } catch { /* already released */ }
  }
}

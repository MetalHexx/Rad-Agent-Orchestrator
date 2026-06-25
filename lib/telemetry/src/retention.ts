import fs from 'node:fs';
import path from 'node:path';
import { readSavedIndex } from './saved-sessions.js';

export function pruneAgedPartitions(opts: { root: string; maxAgeDays: number; now: Date }): number {
  const usageDir = path.join(opts.root, 'usage');
  if (!fs.existsSync(usageDir)) return 0;
  const todayUtc = Date.UTC(opts.now.getUTCFullYear(), opts.now.getUTCMonth(), opts.now.getUTCDate());
  const cutoff = todayUtc - opts.maxAgeDays * 86_400_000;
  let pruned = 0;
  const liveSessions = new Set<string>();
  const saved = new Set(readSavedIndex(opts.root).sessions.map((s) => s.sessionId)); // sacred (FR-10, AD-5)
  for (const file of fs.readdirSync(usageDir)) {
    const m = /^usage-(\d{4}-\d{2}-\d{2})-(.+)\.ndjson$/.exec(file);
    if (!m) continue;
    if (saved.has(m[2])) { liveSessions.add(m[2]); continue; }           // exempt: keep file, mark live
    if (Date.parse(`${m[1]}T00:00:00Z`) < cutoff) { fs.unlinkSync(path.join(usageDir, file)); pruned++; }
    else liveSessions.add(m[2]);
  }
  for (const id of saved) liveSessions.add(id); // saved sessions keep transcripts/checkpoints even if no live partition (AD-5)
  const ckptDir = path.join(opts.root, 'checkpoints');
  if (fs.existsSync(ckptDir)) {
    for (const file of fs.readdirSync(ckptDir)) {
      const m = /^(.+)\.json$/.exec(file);
      if (m && !liveSessions.has(m[1])) { fs.unlinkSync(path.join(ckptDir, file)); pruned++; }
    }
  }
  const txDir = path.join(opts.root, 'transcripts');
  if (fs.existsSync(txDir)) {
    for (const entry of fs.readdirSync(txDir)) {
      // Independent of checkpoint deletion (AD-9): any session dir with no surviving
      // usage partition is an orphan and is removed — durability means surviving worktree
      // reaping, not permanent archival.
      if (!liveSessions.has(entry)) { fs.rmSync(path.join(txDir, entry), { recursive: true, force: true }); pruned++; }
    }
  }
  return pruned;
}

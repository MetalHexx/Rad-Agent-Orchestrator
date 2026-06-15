import fs from 'node:fs';
import path from 'node:path';

export function pruneAgedPartitions(opts: { root: string; maxAgeDays: number; now: Date }): number {
  const usageDir = path.join(opts.root, 'usage');
  if (!fs.existsSync(usageDir)) return 0;
  const todayUtc = Date.UTC(opts.now.getUTCFullYear(), opts.now.getUTCMonth(), opts.now.getUTCDate());
  const cutoff = todayUtc - opts.maxAgeDays * 86_400_000;
  let pruned = 0;
  const liveSessions = new Set<string>();
  for (const file of fs.readdirSync(usageDir)) {
    const m = /^usage-(\d{4}-\d{2}-\d{2})-(.+)\.ndjson$/.exec(file);
    if (!m) continue;
    if (Date.parse(`${m[1]}T00:00:00Z`) < cutoff) { fs.unlinkSync(path.join(usageDir, file)); pruned++; }
    else liveSessions.add(m[2]);
  }
  const ckptDir = path.join(opts.root, 'checkpoints');
  if (fs.existsSync(ckptDir)) {
    for (const file of fs.readdirSync(ckptDir)) {
      const m = /^(.+)\.json$/.exec(file);
      if (m && !liveSessions.has(m[1])) { fs.unlinkSync(path.join(ckptDir, file)); pruned++; }
    }
  }
  return pruned;
}

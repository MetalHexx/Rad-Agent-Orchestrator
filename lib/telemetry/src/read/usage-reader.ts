import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TelemetryRecord } from '../types.js';

export interface ReadUsageOptions {
  root: string;
  dates: string[];
  filter?: (record: TelemetryRecord) => boolean; // reserved seam; unused in T-3 (AD-10)
}

export function readUsageForDates(opts: ReadUsageOptions): TelemetryRecord[] {
  const usageDir = join(opts.root, 'usage');
  if (!existsSync(usageDir)) return [];
  const wanted = new Set(opts.dates);
  const files = readdirSync(usageDir)
    .map((name) => ({ name, m: /^usage-(\d{4}-\d{2}-\d{2})-(.+)\.ndjson$/.exec(name) }))
    .filter((f): f is { name: string; m: RegExpExecArray } => Boolean(f.m) && wanted.has(f.m![1]))
    .sort((a, b) => a.name.localeCompare(b.name));
  const out: TelemetryRecord[] = [];
  for (const f of files) {
    let content: string;
    try {
      content = readFileSync(join(usageDir, f.name), 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue; // partition pruned mid-read (NFR-6)
      throw err;
    }
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      try {
        const raw = JSON.parse(line) as Record<string, unknown>;
        const usageId = (raw.usageId ?? raw.radOrcId) as string | undefined;
        if (!usageId) continue;
        out.push({ ...(raw as object), usageId } as TelemetryRecord);
      } catch { /* skip malformed (NFR-4) */ }
    }
  }
  const deduped = new Map<string, TelemetryRecord>();
  for (const r of out) deduped.set(`${r.sessionId}\x00${r.usageId}`, r); // last-wins, collision-safe (FR-4, AD-3)
  const result = [...deduped.values()];
  return opts.filter ? result.filter(opts.filter) : result;
}

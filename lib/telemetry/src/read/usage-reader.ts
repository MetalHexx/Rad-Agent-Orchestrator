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
    for (const line of readFileSync(join(usageDir, f.name), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const raw = JSON.parse(line) as Record<string, unknown>;
        const usageId = (raw.usageId ?? raw.radOrcId) as string | undefined;
        if (!usageId) continue;
        out.push({ ...(raw as object), usageId } as TelemetryRecord);
      } catch { /* skip malformed (NFR-4) */ }
    }
  }
  return opts.filter ? out.filter(opts.filter) : out;
}

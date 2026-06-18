import { NextResponse } from 'next/server';
import os from 'node:os';
import path from 'node:path';
import { readUsageForDates, toObservabilityUsageRow } from '@rad-orchestration/telemetry';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function getTelemetryRoot(): string {
  return process.env.RADORC_TELEMETRY_ROOT ?? path.join(os.homedir(), '.radorc', 'telemetry');
}
function todayUtc(): string { return new Date().toISOString().slice(0, 10); }
function expandRange(start: string, end: string): string[] {
  const dates: string[] = [];
  for (let d = new Date(`${start}T00:00:00Z`); d <= new Date(`${end}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

export async function GET(req: Request) {
  try {
    const params = new URL(req.url).searchParams;
    const start = params.get('startDate') ?? todayUtc();
    const end = params.get('endDate') ?? todayUtc();
    const records = readUsageForDates({ root: getTelemetryRoot(), dates: expandRange(start, end) });
    // cache: "no-store" (FR-6, BE-API-1): force-dynamic stops Next's framework-level
    // caching, but the explicit header is what keeps a browser/CDN/proxy from caching
    // this always-fresh observability payload.
    return NextResponse.json({ rows: records.map(toObservabilityUsageRow) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: { code: 'INTERNAL', message, field: '' } }, { status: 500 });
  }
}

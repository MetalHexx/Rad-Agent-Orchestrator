import { NextResponse } from 'next/server';
import os from 'node:os'; import path from 'node:path';
import { readSavedIndex } from '@rad-orchestration/telemetry';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
function telemetryRoot(): string { return process.env.RADORC_TELEMETRY_ROOT ?? path.join(os.homedir(), '.radorc', 'telemetry'); }

export async function GET() {
  try {
    return NextResponse.json({ saved: readSavedIndex(telemetryRoot()).sessions }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: { code: 'INTERNAL', message, field: '' } }, { status: 500 });
  }
}

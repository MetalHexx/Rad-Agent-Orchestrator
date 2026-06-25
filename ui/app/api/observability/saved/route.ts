import { NextResponse } from 'next/server';
import os from 'node:os'; import path from 'node:path';
import { readSavedIndex, saveSession, computeSessionSnapshot } from '@rad-orchestration/telemetry';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
function telemetryRoot(): string { return process.env.RADORC_TELEMETRY_ROOT ?? path.join(os.homedir(), '.radorc', 'telemetry'); }

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as { sessionId?: unknown } | null;
    const sessionId = body?.sessionId;
    if (typeof sessionId !== 'string' || sessionId === '') {
      return NextResponse.json({ error: { code: 'BAD_REQUEST', message: 'sessionId is required', field: 'sessionId' } }, { status: 400 });
    }
    const root = telemetryRoot();
    const saved = saveSession(root, { sessionId, snapshot: computeSessionSnapshot(root, sessionId) });
    return NextResponse.json({ saved }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: { code: 'INTERNAL', message, field: '' } }, { status: 500 });
  }
}

export async function GET() {
  try {
    return NextResponse.json({ saved: readSavedIndex(telemetryRoot()).sessions }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: { code: 'INTERNAL', message, field: '' } }, { status: 500 });
  }
}

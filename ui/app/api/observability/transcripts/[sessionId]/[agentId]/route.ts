import { NextResponse } from 'next/server';
import os from 'node:os'; import path from 'node:path';
import { getAgentTranscript } from '@rad-orchestration/telemetry';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
function telemetryRoot(): string { return process.env.RADORC_TELEMETRY_ROOT ?? path.join(os.homedir(), '.radorc', 'telemetry'); }

export async function GET(_req: Request, { params }: { params: { sessionId: string; agentId: string } }) {
  try {
    const transcript = getAgentTranscript(telemetryRoot(), params.sessionId, params.agentId);
    if (!transcript) return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'transcript not found', field: '' } }, { status: 404 });
    return NextResponse.json({ transcript }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: { code: 'INTERNAL', message, field: '' } }, { status: 500 });
  }
}

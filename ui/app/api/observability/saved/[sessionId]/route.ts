import { NextResponse } from 'next/server';
import os from 'node:os'; import path from 'node:path';
import { isSessionSaved, updateSavedSession, unsaveSession } from '@rad-orchestration/telemetry';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
function telemetryRoot(): string { return process.env.RADORC_TELEMETRY_ROOT ?? path.join(os.homedir(), '.radorc', 'telemetry'); }

export async function GET(_req: Request, { params }: { params: { sessionId: string } }) {
  try {
    return NextResponse.json({ saved: isSessionSaved(telemetryRoot(), params.sessionId) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: { code: 'INTERNAL', message, field: '' } }, { status: 500 });
  }
}

export async function PATCH(req: Request, { params }: { params: { sessionId: string } }) {
  try {
    const body = (await req.json().catch(() => null)) as { title?: unknown } | null;
    if (typeof body?.title !== 'string' || body.title.trim() === '') {
      return NextResponse.json({ error: { code: 'BAD_REQUEST', message: 'title is required', field: 'title' } }, { status: 400 });
    }
    const saved = updateSavedSession(telemetryRoot(), params.sessionId, { title: body.title });
    return NextResponse.json({ saved }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    const notFound = /not found/i.test(message);
    return NextResponse.json({ error: { code: notFound ? 'NOT_FOUND' : 'INTERNAL', message, field: '' } }, { status: notFound ? 404 : 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: { sessionId: string } }) {
  try {
    unsaveSession(telemetryRoot(), params.sessionId);   // re-exposes raw files to pruning (AD-9)
    return NextResponse.json({ success: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: { code: 'INTERNAL', message, field: '' } }, { status: 500 });
  }
}

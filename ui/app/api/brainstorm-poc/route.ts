import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

import { randomUUID } from 'node:crypto';
import { runClaudeTurn } from '@/lib/brainstorm-poc/run-claude-turn';
import { sessionStore } from '@/lib/brainstorm-poc/session-store';
import { isValidSessionId, mintFreshSession } from '@/lib/brainstorm-poc/session-logic';

// Return the active session id for display, minting one lazily if needed (FR-4).
export async function GET() {
  let state = sessionStore.getState();
  if (!state.sessionId) {
    const { nextState } = mintFreshSession(randomUUID);
    sessionStore.setState(nextState);
    state = sessionStore.getState();
  }
  return NextResponse.json({ sessionId: state.sessionId }, { status: 200 });
}

// POST { reset: true }         -> start a fresh session (FR-5)
// POST { message, sessionId? } -> run one turn; sessionId resumes an arbitrary id (FR-3, FR-4, FR-5)
export async function POST(request: Request) {
  let body: { message?: string; sessionId?: string; reset?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (body.reset === true) {
    const { sessionId, nextState } = mintFreshSession(randomUUID);
    sessionStore.setState(nextState);
    return NextResponse.json({ sessionId }, { status: 200 });
  }

  if (!body.message || typeof body.message !== 'string') {
    return NextResponse.json({ error: 'message is required' }, { status: 400 });
  }
  if (body.sessionId && !isValidSessionId(body.sessionId)) {
    return NextResponse.json({ error: 'sessionId must be a valid UUID' }, { status: 400 });
  }

  try {
    const { reply, sessionId } = await runClaudeTurn(
      { message: body.message, clientSessionId: body.sessionId },
      { env: process.env, cwd: process.cwd(), store: sessionStore, mint: randomUUID },
    );
    return NextResponse.json({ reply, sessionId }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

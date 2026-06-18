import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

import { runClaudeTurn } from '@/lib/brainstorm-poc/run-claude-turn';
import { isValidSessionId } from '@/lib/brainstorm-poc/session-logic';

// Run the background agent rooted at the orchestration workspace (hardcoded for
// now) rather than the UI server's own cwd, so it loads the expected project
// context. TODO: make this configurable per request/project.
const AGENT_CWD = 'C:\\dev\\orchestration\\v3';

// POST { message, sessionId, resume } -> run one turn.
//   resume === false -> create the session with --session-id (turn 1)
//   resume === true  -> continue it with --resume (later turns, or a pasted id)
// The client owns the session id and the create/resume decision; the server keeps
// no session state — it is a stateless executor (FR-3..FR-5, AD-6).
export async function POST(request: Request) {
  let body: { message?: string; sessionId?: string; resume?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.message || typeof body.message !== 'string') {
    return NextResponse.json({ error: 'message is required' }, { status: 400 });
  }
  if (!body.sessionId || !isValidSessionId(body.sessionId)) {
    return NextResponse.json({ error: 'sessionId must be a valid UUID' }, { status: 400 });
  }
  if (typeof body.resume !== 'boolean') {
    return NextResponse.json({ error: 'resume must be a boolean' }, { status: 400 });
  }

  try {
    const { reply, sessionId } = await runClaudeTurn(
      { message: body.message, sessionId: body.sessionId, resume: body.resume },
      { env: process.env, cwd: AGENT_CWD },
    );
    return NextResponse.json({ reply, sessionId }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import path from 'node:path';
import { launchTerminal } from '@rad-orchestration/terminal-launch';
import { readProjectSessions, type Harness } from '@/lib/project-sessions-reader';
import { resolveProjectDir } from '@/lib/path-resolver';

const VALID_HARNESSES: ReadonlySet<string> = new Set<Harness>(['claude', 'copilot']);

// `readProjectSessions` casts on-disk JSON without narrowing `harness` to
// `Harness` — validated here at the point of use, the same defence-in-depth
// posture `isValidRecordedCwd` already applies to the recorded cwd, since an
// unrecognized value reaches none of launchTerminal's agent branches and
// opens a bare terminal while still reporting a successful launch.
function isValidHarness(harness: string): harness is Harness {
  return VALID_HARNESSES.has(harness);
}

export const dynamic = 'force-dynamic';

// Copied verbatim from app/api/projects/[name]/remove/route.ts. Rejects
// anything that isn't a single, relative path segment: '..', a '/' or '\'
// separator, empty, '.', or an absolute path. This duplicates a guard the
// library also enforces (defence in depth on an unauthenticated local server
// whose blast radius here is a whole project tree).
function isValidProjectName(name: string): boolean {
  if (!name || name === '.' || name === '..') return false;
  if (name.includes('/') || name.includes('\\')) return false;
  if (path.isAbsolute(name)) return false;
  return true;
}

// A UUID-ish shape is enough: the id is only ever compared against recorded
// session ids, never interpolated into a shell.
const SESSION_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

function isValidSessionId(sessionId: string): boolean {
  return SESSION_ID_PATTERN.test(sessionId);
}

// A recorded cwd is only ever trusted when it is absolute and carries no
// traversal-shaped segment — the same posture cli/src/commands/session/save.ts
// applies to a stale claim, applied here at the point of use rather than at
// write time.
function isValidRecordedCwd(cwd: string): boolean {
  if (!path.isAbsolute(cwd)) return false;
  return cwd.split(/[\\/]+/).every((segment) => segment !== '..');
}

// Copied verbatim from app/api/projects/[name]/remove/route.ts. Same-origin
// guard for a route that spawns a local process on request. There is no
// middleware.ts, no CORS configuration, and nothing else in the app checking
// Origin/Sec-Fetch headers — without this, any page a user's browser has open
// could POST here cross-origin (CORS only blocks reading the response, not
// sending the request). `sec-fetch-site` is the strongest signal (set by the
// browser, not script-controllable) and is checked first when present.
// Falling back to `Origin` covers older browsers that don't send
// `sec-fetch-site`. Absent both signals, fail closed — there is nothing here
// proving same-origin intent.
function isSameOriginRequest(request: NextRequest): boolean {
  const site = request.headers.get('sec-fetch-site');
  if (site !== null) return site === 'same-origin' || site === 'none';
  const origin = request.headers.get('origin');
  if (origin === null) return false;
  try {
    return new URL(origin).host === request.nextUrl.host;
  } catch {
    return false;
  }
}

function crossOriginResponse(): NextResponse {
  return NextResponse.json({ error: 'Cross-origin request rejected' }, { status: 403 });
}

function invalidNameResponse(): NextResponse {
  return NextResponse.json({ error: 'Invalid project name.' }, { status: 400 });
}

function invalidSessionIdResponse(): NextResponse {
  return NextResponse.json({ error: 'Invalid session id.' }, { status: 400 });
}

function sessionNotFoundResponse(): NextResponse {
  return NextResponse.json({ error: 'Session not found.' }, { status: 404 });
}

function invalidCwdResponse(): NextResponse {
  return NextResponse.json({ error: 'Recorded session directory is invalid.' }, { status: 400 });
}

function invalidHarnessResponse(): NextResponse {
  return NextResponse.json({ error: 'Recorded session harness is invalid.' }, { status: 400 });
}

/**
 * Launches a terminal that resumes a previously recorded session.
 *
 * The request body is never read — every value passed to `launchTerminal`
 * (`agent`, `cwd`) is looked up server-side from the project's own
 * `.project-sessions.json` by the validated `sessionId` in the URL. This is
 * the first endpoint in the codebase that spawns a local process on a
 * request, so its input surface is deliberately tiny: a body carrying `cwd`,
 * `command`, or any other field has no effect on what gets spawned.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { name: string; sessionId: string } }
): Promise<NextResponse> {
  if (!isSameOriginRequest(request)) return crossOriginResponse();

  const { name, sessionId } = params;
  if (!isValidProjectName(name)) return invalidNameResponse();
  if (!isValidSessionId(sessionId)) return invalidSessionIdResponse();

  const { sessions } = readProjectSessions(resolveProjectDir(name));
  const entry = sessions.find((s) => s.sessionId === sessionId);
  if (!entry) return sessionNotFoundResponse();

  if (!isValidRecordedCwd(entry.cwd)) return invalidCwdResponse();
  if (!isValidHarness(entry.harness)) return invalidHarnessResponse();

  const result = launchTerminal({
    agent: entry.harness,
    cwd: entry.cwd,
    resumeSessionId: sessionId,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({ launched: true, platform: result.platform }, { status: 200 });
}

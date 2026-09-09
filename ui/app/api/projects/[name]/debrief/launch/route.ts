import { NextRequest, NextResponse } from 'next/server';
import path from 'node:path';
import fs from 'node:fs';
import { launchTerminal } from '@rad-orchestration/terminal-launch';
import { WorkGraphService } from '@rad-orchestration/work-graph';
import { detectPortfolio } from '@/lib/portfolio-detect';
import { getRegistryRoot, getWorktreesRoot, getProjectsRoot } from '@/lib/path-resolver';

export const dynamic = 'force-dynamic';

const VALID_HARNESSES: ReadonlySet<string> = new Set(['claude', 'copilot']);

function isValidHarness(harness: unknown): harness is 'claude' | 'copilot' {
  return typeof harness === 'string' && VALID_HARNESSES.has(harness);
}

// Copied verbatim from app/api/projects/[name]/sessions/[sessionId]/launch/route.ts.
// Rejects anything that isn't a single, relative path segment: '..', a '/' or
// '\' separator, empty, '.', or an absolute path.
function isValidProjectName(name: string): boolean {
  if (!name || name === '.' || name === '..') return false;
  if (name.includes('/') || name.includes('\\')) return false;
  if (path.isAbsolute(name)) return false;
  return true;
}

// Copied verbatim from app/api/projects/[name]/sessions/[sessionId]/launch/route.ts.
// Same-origin guard for a route that spawns a local process on request. There
// is no middleware.ts, no CORS configuration, and nothing else in the app
// checking Origin/Sec-Fetch headers — without this, any page a user's browser
// has open could POST here cross-origin (CORS only blocks reading the
// response, not sending the request). `sec-fetch-site` is the strongest
// signal (set by the browser, not script-controllable) and is checked first
// when present. Falling back to `Origin` covers older browsers that don't
// send `sec-fetch-site`. Absent both signals, fail closed — there is nothing
// here proving same-origin intent.
function isSameOriginRequest(request: NextRequest): boolean {
  const site = request.headers.get('sec-fetch-site');
  if (site !== null) return site === 'same-origin' || site === 'none';
  const origin = request.headers.get('origin');
  if (origin === null) return false;
  try {
    // Compare the full serialized origin (scheme+host+port), not just host —
    // a web Origin is scheme+host+port (RFC 6454), so host alone would let an
    // http Origin pass for an https request or vice versa.
    return new URL(origin).origin === request.nextUrl.origin;
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

function invalidHarnessResponse(): NextResponse {
  return NextResponse.json({ error: 'Invalid or missing harness.' }, { status: 400 });
}

function notPortfolioMemberResponse(): NextResponse {
  return NextResponse.json({ error: 'Project does not belong to a portfolio.' }, { status: 404 });
}

/**
 * Launches a terminal running a portfolio debrief for `name`.
 *
 * The request body carries only `harness` — the working directory, the
 * additional directory, and the prompt are all resolved or composed
 * server-side from the validated project name, so a body carrying `cwd`,
 * `command`, `prompt`, or `addDir` has no effect on what is spawned. This is
 * an unauthenticated local server that spawns processes; a caller-supplied
 * command would turn it into an arbitrary-execution surface.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { name: string } }
): Promise<NextResponse> {
  if (!isSameOriginRequest(request)) return crossOriginResponse();

  const { name } = params;
  if (!isValidProjectName(name)) return invalidNameResponse();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return invalidHarnessResponse();
  }
  const { harness } = (body ?? {}) as { harness?: unknown };
  if (!isValidHarness(harness)) return invalidHarnessResponse();

  const detected = await detectPortfolio(name);
  if (!detected) return notPortfolioMemberResponse();

  // Do not enable git resolution: resolveWorktreeName reads state.json only
  // and never shells out, unlike the neighbouring resolveWorktrees (which
  // runs `git worktree list` and is why app/api/work-graph/route.ts disables
  // it). This route needs neither.
  const service = new WorkGraphService({ root: getRegistryRoot() });
  const workspace = path.join(getWorktreesRoot(), service.resolveWorktreeName(name));

  // Working directory and its companion --add-dir grant are one decision
  // with two branches, not two independent lookups. Both document folders
  // sit outside the workspace, so the workspace branch needs their common
  // parent (~/.radorc/projects/); the fallback's cwd is already the
  // iteration's own folder, so it only needs the portfolio root named
  // alongside it.
  const { cwd, addDir } = fs.existsSync(workspace)
    ? { cwd: workspace, addDir: getProjectsRoot() }
    : { cwd: detected.iterationDir, addDir: detected.rootDir };

  const result = launchTerminal({
    agent: harness,
    cwd,
    addDir,
    prompt: `/rad-portfolio debrief ${name}`,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  return NextResponse.json({ launched: true, platform: result.platform }, { status: 200 });
}

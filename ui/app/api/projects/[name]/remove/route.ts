import { NextRequest, NextResponse } from 'next/server';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { WorkGraphService } from '@rad-orchestration/work-graph';
import type { DeletionPlan, DeletionReport, DeletionSkip } from '@rad-orchestration/work-graph';
import { removeProjectIndexEntries } from '@rad-orchestration/telemetry';
import { getRegistryRoot, getWorktreesRoot, getSideProjectsRoot, getProjectsRoot, getTelemetryRoot, toHomeRelativePath, collapseHomeInText } from '@/lib/path-resolver';
import { getLiveRuntimeIfActive } from '@/lib/live/live-hub-runtime';
import { closeSharedWatcherIfActive, reopenSharedWatcherIfActive } from '@/lib/live/shared-watcher';
import { projectDirWasRemoved } from './project-dir-removed';

export const dynamic = 'force-dynamic';

// Rejects anything that isn't a single, relative path segment: '..', a '/' or
// '\' separator, empty, '.', or an absolute path. This duplicates a guard the
// library also enforces (defence in depth on an unauthenticated local server
// whose blast radius here is a whole project tree).
function isValidProjectName(name: string): boolean {
  if (!name || name === '.' || name === '..') return false;
  if (name.includes('/') || name.includes('\\')) return false;
  if (path.isAbsolute(name)) return false;
  return true;
}

function invalidNameResponse(): NextResponse {
  return NextResponse.json({ error: 'Invalid project name' }, { status: 400 });
}

function buildService(): WorkGraphService {
  return new WorkGraphService({
    root: getRegistryRoot(),
    worktreesDir: getWorktreesRoot(),
    sideProjectsDir: getSideProjectsRoot(),
  });
}

// A validation error from the library is 404 when the named project has no
// directory on disk (unknown project) and 400 for every other validation
// failure (e.g. containment / symlink-escape).
function validationErrorResponse(name: string, message: string): NextResponse {
  const status = existsSync(path.join(getProjectsRoot(), name)) ? 400 : 404;
  return NextResponse.json({ error: message }, { status });
}

// Collapses an item's absolute path (and, when present, its protectedReason
// prose — the library embeds the same full path there) to home-relative for
// display. `path` is `null` for graph-edges and is left null, not stringified.
function toHomeRelativeItem<T extends { path: string | null; protectedReason?: string }>(item: T): T {
  return {
    ...item,
    path: item.path === null ? null : toHomeRelativePath(item.path),
    ...(item.protectedReason !== undefined ? { protectedReason: collapseHomeInText(item.protectedReason) } : {}),
  };
}

// Only these two kinds are ever optionally skippable; 'project-dir' and
// 'graph-edges' are structurally mandatory. The body is client-controlled
// input reaching a filesystem deletion path, so validate against this closed
// set rather than forwarding whatever arrives (defence in depth — the library
// ignores out-of-set kinds too).
const SKIPPABLE_KINDS = new Set<DeletionSkip['kind']>(['worktree', 'side-project-repo']);

function isSkippableKind(kind: unknown): kind is DeletionSkip['kind'] {
  return SKIPPABLE_KINDS.has(kind as DeletionSkip['kind']);
}

// Reads and parses the request body defensively: an absent/unparseable body is
// "no selection", not an error.
async function readJsonBody(request: NextRequest): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

// Validates the optional `{ skip: DeletionSkip[] }` body. Absent body, an
// absent `skip` field, or an empty array all mean "no selection". Anything
// else that doesn't match the closed shape is rejected.
function parseSkipSelection(body: unknown): { ok: true; skip: DeletionSkip[] } | { ok: false } {
  if (typeof body !== 'object' || body === null) return { ok: true, skip: [] };
  const skipRaw = (body as Record<string, unknown>).skip;
  if (skipRaw === undefined) return { ok: true, skip: [] };
  if (!Array.isArray(skipRaw)) return { ok: false };

  const skip: DeletionSkip[] = [];
  for (const entry of skipRaw) {
    if (typeof entry !== 'object' || entry === null) return { ok: false };
    const { kind, label } = entry as Record<string, unknown>;
    if (typeof label !== 'string' || label === '') return { ok: false };
    if (!isSkippableKind(kind)) return { ok: false };
    skip.push({ kind, label });
  }
  return { ok: true, skip };
}

function invalidSkipResponse(): NextResponse {
  return NextResponse.json({ error: 'Invalid skip selection' }, { status: 400 });
}

// Same-origin guard for the destructive POST below. There is no middleware.ts,
// no CORS configuration, and nothing else in the app checking Origin/Sec-Fetch
// headers — without this, any page a user's browser has open could POST here
// cross-origin (CORS only blocks reading the response, not sending the
// request). `sec-fetch-site` is the strongest signal (set by the browser, not
// script-controllable) and is checked first when present. Falling back to
// `Origin` covers older browsers that don't send `sec-fetch-site`. Absent both
// signals, fail closed — there is nothing here proving same-origin intent.
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

export async function GET(
  _request: NextRequest,
  { params }: { params: { name: string } }
) {
  const { name } = params;
  if (!isValidProjectName(name)) return invalidNameResponse();

  const result = buildService().planProjectDeletion(name);
  if (!result.ok) return validationErrorResponse(name, result.error.message);

  const plan: DeletionPlan = { ...result.data, items: result.data.items.map(toHomeRelativeItem) };
  return NextResponse.json({ plan }, { status: 200 });
}

// Runs the suspend/delete/resume body for one request. Extracted so POST can
// serialize invocations through the module-scoped `inFlight` chain below —
// see its comment for why serialization is required.
async function runDelete(name: string, skip: DeletionSkip[]): Promise<NextResponse> {
  const svc = buildService();
  const runtime = getLiveRuntimeIfActive();
  try {
    // Both quiescing calls sit inside the try: a throw from the second one
    // must still hit the finally below, or the first suspension is never
    // undone and the dashboard goes blind to filesystem changes for the rest
    // of the process's life.
    await runtime?.suspendProjectsWatch();
    await closeSharedWatcherIfActive();

    // The library API is synchronous (fs.rmSync + synchronous git calls), so
    // this blocks the process — including the live-events stream — for the
    // duration of the delete. Accepted: the delete is a rare, user-initiated
    // action.
    const result = svc.deleteProject(name, { skip });
    if (!result.ok) return validationErrorResponse(name, result.error.message);

    const report: DeletionReport = result.data;
    // deleteProject has no existence gate of its own — an already-fully-deleted
    // project is a legitimate resumable target, not an error (mirrors the CLI's
    // `project delete`). But when every item comes back already-absent, nothing
    // was ever found for this id, matching GET's 404 for the same case rather
    // than reporting a silent "success".
    if (report.items.every((item) => item.outcome === 'already-absent')) {
      return validationErrorResponse(name, `project '${name}' does not exist`);
    }

    // Fires whenever project-dir itself came back 'removed', regardless of the
    // report's overall `complete` flag — see projectDirWasRemoved's comment.
    // This runs inside the try (before the finally resumes the watcher)
    // because the hub is independent of the chokidar watcher — a suspended
    // watch does not stop delivery.
    if (projectDirWasRemoved(report)) {
      removeProjectIndexEntries(getTelemetryRoot(), name);
      runtime?.publishProjectRemoved(name);
    }

    const homeRelativeReport: DeletionReport = { ...report, items: report.items.map(toHomeRelativeItem) };
    return NextResponse.json({ report: homeRelativeReport }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    // Resumed on every path: success, partial success, a domain error, and an
    // unexpected throw.
    runtime?.resumeProjectsWatch();
    reopenSharedWatcherIfActive();
  }
}

// Serializes runDelete invocations across overlapping POSTs. Without this, a
// second concurrent POST's suspendProjectsWatch()/closeSharedWatcherIfActive()
// could start while the first request's delete is still in flight (both
// primitives guard against re-entering themselves, but neither call queues a
// second caller behind the first) — the first request's `finally` could then
// reopen both watchers while the second request's deleteProject is still
// running, recreating the Windows open-handle failure this suspend/resume
// machinery exists to prevent. Chaining onto a module-scoped promise ensures a
// second request's runDelete never starts until the first's `finally` (resume)
// has fully completed. The `.catch(() => {})` on the stored link is load-bearing:
// without it, one request's rejection would permanently poison inFlight and
// break every later waiter's turn.
let inFlight: Promise<unknown> = Promise.resolve();

export async function POST(
  request: NextRequest,
  { params }: { params: { name: string } }
) {
  if (!isSameOriginRequest(request)) return crossOriginResponse();

  const { name } = params;
  if (!isValidProjectName(name)) return invalidNameResponse();

  const body = await readJsonBody(request);
  const skipResult = parseSkipSelection(body);
  if (!skipResult.ok) return invalidSkipResponse();

  const run = inFlight.then(() => runDelete(name, skipResult.skip));
  inFlight = run.catch(() => {});
  return run;
}

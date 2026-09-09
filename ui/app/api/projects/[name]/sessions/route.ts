import { NextRequest, NextResponse } from 'next/server';
import { readProjectSessions } from '@/lib/project-sessions-reader';
import { resolveProjectDir, getTelemetryRoot, toHomeRelativePath } from '@/lib/path-resolver';
import { computeActiveTimeMs } from '@rad-orchestration/telemetry';
import type { JourneySession } from '@/lib/journey-model';

export const dynamic = 'force-dynamic';

function byNewestAt(a: { at: string }, b: { at: string }): number {
  return a.at < b.at ? 1 : a.at > b.at ? -1 : 0;
}

function byNewestLastSeen(a: { lastSeenAt: string }, b: { lastSeenAt: string }): number {
  return a.lastSeenAt < b.lastSeenAt ? 1 : a.lastSeenAt > b.lastSeenAt ? -1 : 0;
}

/**
 * A project's saved-session journey: each session enriched with its active
 * time from telemetry and its activity trail, newest first at both levels.
 * An absent project directory, an absent sessions file, or a malformed one
 * all read as zero sessions (readProjectSessions never throws), so this
 * always answers 200 — a project with no sessions is the common case.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { name: string } },
): Promise<NextResponse> {
  const telemetryRoot = getTelemetryRoot();
  const { sessions } = readProjectSessions(resolveProjectDir(params.name));

  const journeySessions: JourneySession[] = sessions
    .map((s) => ({
      sessionId: s.sessionId,
      name: s.name,
      harness: s.harness,
      cwd: s.cwd,
      cwdLabel: toHomeRelativePath(s.cwd),
      createdAt: s.createdAt,
      lastSeenAt: s.lastSeenAt,
      activeTimeMs: computeActiveTimeMs({ root: telemetryRoot, sessionId: s.sessionId }),
      activity: [...s.activity].sort(byNewestAt),
    }))
    .sort(byNewestLastSeen);

  const totalActiveTimeMs = journeySessions.reduce((sum, s) => sum + s.activeTimeMs, 0);

  return NextResponse.json({ sessions: journeySessions, totalActiveTimeMs }, { status: 200 });
}

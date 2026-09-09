import type { Harness } from '@/lib/project-sessions-reader';

/**
 * The `GET /api/projects/:name/sessions` payload shape. Shared verbatim
 * between the producer (`ui/app/api/projects/[name]/sessions/route.ts`) and
 * its consumer (`ui/hooks/use-session-journey.ts`) so a future field change
 * fails `tsc` on both sides instead of drifting silently.
 */
export interface JourneyActivity {
  type: string;
  description: string;
  at: string;
}

export interface JourneySession {
  sessionId: string;
  name: string;
  harness: Harness;
  cwd: string;
  cwdLabel: string;
  createdAt: string;
  lastSeenAt: string;
  activeTimeMs: number;
  activity: JourneyActivity[];
}

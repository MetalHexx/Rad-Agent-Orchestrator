"use client";

import { SECTION_LABEL_CLASSES } from "@/components/dag-timeline/dag-section-group";
import { formatDuration } from "@/lib/observability/duration-format";
import { cn } from "@/lib/utils";
import { SessionCard } from "./session-card";
import { SessionJourneyEmpty } from "./session-journey-empty";
import type { JourneySession } from "@/lib/journey-model";

/**
 * The header's trailing summary — a session count and a total active time.
 * No cost figure: money is deliberately out of scope this iteration. Mirrors
 * the per-session meta line's zero-guard: a project whose sessions carry no
 * telemetry (e.g. all-Copilot) reports the count alone rather than
 * `formatDuration`'s misleading "<1m" for a total of zero.
 */
export function buildSessionJourneySummary(sessionCount: number, totalActiveTimeMs: number): string | null {
  if (sessionCount === 0) return null;
  const sessionsLabel = `${sessionCount} session${sessionCount === 1 ? "" : "s"}`;
  if (totalActiveTimeMs <= 0) return sessionsLabel;
  return `${sessionsLabel} · ${formatDuration(totalActiveTimeMs)} active`;
}

export interface SessionJourneyProps {
  /** The project these sessions belong to — threaded down to each card's launch control. */
  projectName: string;
  /** Already ordered by the caller — this section fetches nothing and sorts nothing. */
  sessions: JourneySession[];
  totalActiveTimeMs: number;
}

/**
 * The Session Journey section: a header (session count + total active time)
 * over either the ordered list of session cards or the empty state. The
 * section always renders, even with zero sessions — hiding it is how the
 * `/rad-session` capability stays undiscovered.
 */
export function SessionJourney({ projectName, sessions, totalActiveTimeMs }: SessionJourneyProps) {
  const summary = buildSessionJourneySummary(sessions.length, totalActiveTimeMs);
  return (
    <div>
      <div className={cn(SECTION_LABEL_CLASSES, "flex items-center gap-2")}>
        <span>Session Journey</span>
        {summary && (
          <span className="ml-auto normal-case tracking-normal font-normal text-muted-foreground">{summary}</span>
        )}
      </div>
      {sessions.length === 0 ? (
        <SessionJourneyEmpty />
      ) : (
        <div className="flex flex-col gap-2">
          {sessions.map((session) => (
            <SessionCard key={session.sessionId} projectName={projectName} session={session} />
          ))}
        </div>
      )}
    </div>
  );
}

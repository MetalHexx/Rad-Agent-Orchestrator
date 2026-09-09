"use client";

import * as React from "react";
import { ChevronRight } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { CARD_SHELL_CLASSES } from "@/components/dag-timeline/dag-section-group";
import { Button, buttonVariants } from "@/components/ui/button";
import { ActivityTypeBadge } from "@/components/badges/activity-type-badge";
import { formatDuration } from "@/lib/observability/duration-format";
import { cn } from "@/lib/utils";
import type { JourneyActivity, JourneySession } from "@/lib/journey-model";

// The header→first-activity gap and the activity→activity gap must stay
// equal (a house-rhythm requirement); both flex stacks below read off this
// one constant rather than two literals that happen to match.
const CARD_RHYTHM_GAP = "gap-2.5";

const ACTIVITY_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** e.g. "Aug 30 18:02" — Intl's combined date+time format minus its comma. */
export function formatActivityTime(at: string): string {
  return ACTIVITY_TIME_FORMATTER.format(new Date(at)).replace(",", "");
}

interface MetaPart {
  text: string;
  mono?: boolean;
}

/**
 * The session meta line's parts, in display order. `activeTimeMs` is
 * omitted entirely at zero rather than rendered as `formatDuration`'s
 * `"<1m"` — a session with no telemetry captured (every Copilot session
 * today) must report nothing at all, not a misleading near-zero duration.
 */
export function buildSessionMetaParts(session: JourneySession): MetaPart[] {
  const parts: MetaPart[] = [];
  if (session.activeTimeMs > 0) parts.push({ text: formatDuration(session.activeTimeMs) });
  parts.push({ text: session.harness });
  parts.push({ text: session.cwdLabel, mono: true });
  parts.push({ text: session.sessionId, mono: true });
  return parts;
}

function launchUrl(projectName: string, sessionId: string): string {
  return `/api/projects/${encodeURIComponent(projectName)}/sessions/${encodeURIComponent(sessionId)}/launch`;
}

function telemetryUrl(sessionId: string): string {
  return `/observability/session/${encodeURIComponent(sessionId)}`;
}

// The badge column is fixed-width (not content-sized) so the date column
// stays aligned across every row in the card regardless of which activity
// type heads it — it must fit the longest label, "execution-complete",
// with room to spare, or that badge butts straight up against the date.
function ActivityRow({ activity }: { activity: JourneyActivity }) {
  return (
    <div className="grid grid-cols-[10rem_6rem_1fr] items-baseline gap-3">
      <ActivityTypeBadge type={activity.type} />
      <time dateTime={activity.at} className="font-mono text-xs text-muted-foreground">
        {formatActivityTime(activity.at)}
      </time>
      <span className="min-w-0 text-sm text-muted-foreground">{activity.description}</span>
    </div>
  );
}

function SessionMeta({ session, launchError }: { session: JourneySession; launchError: string | null }) {
  const parts = buildSessionMetaParts(session);
  return (
    <div className="mt-2.5 pl-6">
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
        {parts.map((part, index) => (
          <React.Fragment key={index}>
            {index > 0 && <span aria-hidden="true">·</span>}
            <span className={part.mono ? "font-mono" : undefined}>{part.text}</span>
          </React.Fragment>
        ))}
      </div>
      {launchError && (
        <p className="mt-1 text-xs text-destructive" role="alert">
          {launchError}
        </p>
      )}
    </div>
  );
}

export interface SessionCardProps {
  /** The project this session belongs to — needed to build the launch URL. */
  projectName: string;
  session: JourneySession;
}

/**
 * One session in the Session Journey. Collapsed, every session shows a chevron,
 * the session name, and an activity count (singular for 1, plural for 2+);
 * no activities are visible until expanded. Expanded, the full activity list
 * (newest-first, as given) appears beneath the header.
 *
 * The header is a full-row `CollapsibleTrigger` overlay; `Continue Session`
 * and `View Telemetry` are real siblings rendered after it in DOM order, so
 * they paint and receive clicks on top with no `z-index`, and so keyboard
 * navigation reaches all three as distinct stops — the same pattern
 * `PlanningDocsList` uses for its open/delete row controls.
 */
export function SessionCard({ projectName, session }: SessionCardProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const [launchError, setLaunchError] = React.useState<string | null>(null);
  const activities = session.activity;
  const activitiesLabel = `${activities.length} ${activities.length === 1 ? "activity" : "activities"}`;

  async function handleContinueSession() {
    setLaunchError(null);
    try {
      const res = await fetch(launchUrl(projectName, session.sessionId), { method: "POST" });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        setLaunchError(json.error ?? `HTTP ${res.status}`);
      }
    } catch (err: unknown) {
      setLaunchError(err instanceof Error ? err.message : "Launch failed.");
    }
  }

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={setIsOpen}
      className={cn(CARD_SHELL_CLASSES, "px-4 py-3")}
    >
      <div className={cn("flex flex-col", CARD_RHYTHM_GAP)}>
        <div className="relative flex items-center gap-2">
          <CollapsibleTrigger
            aria-label={`${isOpen ? "Collapse" : "Expand"} ${session.name}`}
            className="absolute inset-0 rounded-md cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="pointer-events-none flex min-w-0 flex-1 items-center gap-2">
            <ChevronRight
              aria-hidden="true"
              className={cn(
                "size-4 shrink-0 text-muted-foreground transition-transform",
                isOpen && "rotate-90",
              )}
            />
            <span className="min-w-0 truncate text-sm font-semibold">{session.name}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{activitiesLabel}</span>
          </div>
          <div className="relative flex shrink-0 items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={handleContinueSession}>
              Continue Session
            </Button>
            {/* A plain client-side link — no new API, no new view — styled
                with the house Button's outline chrome via buttonVariants,
                the same technique ExternalLinkButton uses to look like a
                Button while staying a real anchor. */}
            <a
              href={telemetryUrl(session.sessionId)}
              className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
            >
              View Telemetry
            </a>
          </div>
        </div>

        <CollapsibleContent className={cn("flex flex-col divide-y divide-border pl-6", CARD_RHYTHM_GAP)}>
          {activities.map((activity, index) => (
            <ActivityRow key={`${activity.at}-${index}`} activity={activity} />
          ))}
        </CollapsibleContent>
      </div>

      <SessionMeta session={session} launchError={launchError} />
    </Collapsible>
  );
}

"use client";

import { CARD_SHELL_CLASSES } from "@/components/dag-timeline/dag-section-group";
import { cn } from "@/lib/utils";

/**
 * The Session Journey section's empty state — a card sitting where the
 * session list would otherwise render. Renders unconditionally rather than
 * hiding the section: most projects carry no recorded sessions, and hiding
 * it is how the `/rad-session` capability stays undiscovered.
 */
export function SessionJourneyEmpty() {
  return (
    <div className={cn(CARD_SHELL_CLASSES, "px-5 py-9 text-center")}>
      <p className="text-sm font-semibold text-foreground">No sessions have been recorded.</p>
      <p className="mt-1.5 text-xs text-muted-foreground">
        Try{" "}
        <code className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px]">
          /rad-session
        </code>{" "}
        to manually record a session.
      </p>
    </div>
  );
}

"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";

export interface ControlBarProps {
  /** All unique worktree paths seen in rows; absent worktree shown as "unknown". */
  worktrees: string[];
  /** Currently selected worktree filter; "All" means no filter. */
  worktree: string;
  onWorktree: (value: string) => void;

  /** All unique session IDs seen in filtered rows. */
  sessions: string[];
  /** Currently selected session filter; "All" means no filter. */
  session: string;
  onSession: (value: string) => void;

  /** Fires when the user clicks "Earlier". */
  onEarlier: () => void;
  /** When false the Earlier button is disabled (retention floor reached). */
  canEarlier: boolean;

  /** Fires when the user clicks the Help button. */
  onHelp: () => void;
}

/**
 * Control bar — day window & filters (P03-T01, FR-6, AD-6, DD-4, NFR-2).
 *
 * Layout: [Today] [Earlier]  [Worktree select]  [Session select]  ... [Help?]
 */
export function ControlBar({
  worktrees,
  worktree,
  onWorktree,
  sessions,
  session,
  onSession,
  onEarlier,
  canEarlier,
  onHelp,
}: ControlBarProps) {
  return (
    <div className="flex items-center gap-3 rounded-lg bg-card ring-1 ring-foreground/10 px-4 py-2">
      {/* Day window controls — Today anchor + Earlier step */}
      <div className="flex items-center gap-1">
        <span className="text-sm font-medium text-foreground">Today</span>
        <Button
          variant="outline"
          size="sm"
          disabled={!canEarlier}
          onClick={onEarlier}
        >
          Earlier
        </Button>
      </div>

      <div className="h-4 w-px bg-border" aria-hidden="true" />

      {/* Worktree filter */}
      <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
        Worktree
        <select
          className="rounded border border-border bg-background px-2 py-0.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          value={worktree}
          onChange={(e) => onWorktree(e.target.value)}
        >
          <option value="All">All</option>
          {worktrees.map((wt) => (
            <option key={wt} value={wt}>
              {wt || "unknown"}
            </option>
          ))}
        </select>
      </label>

      {/* Session filter */}
      <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
        Session
        <select
          className="rounded border border-border bg-background px-2 py-0.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          value={session}
          onChange={(e) => onSession(e.target.value)}
        >
          <option value="All">All</option>
          {sessions.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
      </label>

      {/* Spacer pushes Help to far right */}
      <div className="flex-1" />

      {/* Help button — far right */}
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Help"
        onClick={onHelp}
      >
        ?
      </Button>
    </div>
  );
}

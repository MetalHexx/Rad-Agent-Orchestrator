"use client";
import * as React from 'react';
import { ActivityDot } from '@/components/observability/activity-dot';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip';

function formatAgo(ms: number): string {
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

/** Tooltip-wrapped activity dot + label + trailing divider. Page supplies msSinceActivity
 *  (system-wide or session-scoped); a non-finite value renders the idle state (FR-5, DD-7, DD-12). */
export function ActivityIndicator({ msSinceActivity }: { msSinceActivity: number }) {
  const label = Number.isFinite(msSinceActivity) ? `updated ${formatAgo(msSinceActivity)}` : 'idle';
  return (
    <>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger
            className="flex items-center gap-1.5 cursor-default bg-transparent border-none p-0"
            aria-label={`Activity indicator: ${label}`}
          >
            <ActivityDot msSinceActivity={msSinceActivity} />
            <span className="text-xs text-muted-foreground">{label}</span>
          </TooltipTrigger>
          <TooltipContent>
            Live activity indicator — glows green when a session sent tokens recently, fades to grey when idle.
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <div className="hidden sm:block w-px h-4 bg-border" />
    </>
  );
}

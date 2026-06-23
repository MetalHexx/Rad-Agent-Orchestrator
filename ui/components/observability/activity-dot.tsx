"use client";
import * as React from "react";
import { cn } from "@/lib/utils";
import { dotRestingColor, isActive } from "@/lib/observability/activity-dot-color";

export function ActivityDot({
  msSinceActivity,
  color,
  activeWindowMs,
  className,
}: {
  msSinceActivity: number;
  color?: string;
  /** How long after last activity the dot keeps pulsing. Defaults to the 5-min decay window. */
  activeWindowMs?: number;
  className?: string;
}) {
  const active = isActive(msSinceActivity, activeWindowMs);
  const style = {
    backgroundColor: color ?? dotRestingColor(msSinceActivity),
    ...(color ? { "--activity-dot-glow-color": color } : {}),
  } as React.CSSProperties;
  return (
    <span
      data-slot="activity-dot"
      aria-label={active ? "active" : "idle"}
      className={cn("inline-block h-2.5 w-2.5 rounded-full align-middle", active && "activity-dot-pulse", className)}
      style={style}
    />
  );
}

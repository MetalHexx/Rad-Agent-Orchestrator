"use client";
import * as React from "react";
import { cn } from "@/lib/utils";
import { dotRestingColor, isActive } from "@/lib/observability/activity-dot-color";

export function ActivityDot({ msSinceActivity, className }: { msSinceActivity: number; className?: string }) {
  const active = isActive(msSinceActivity);
  return (
    <span
      data-slot="activity-dot"
      aria-label={active ? "active" : "idle"}
      className={cn("inline-block h-2.5 w-2.5 rounded-full align-middle", active && "activity-dot-pulse", className)}
      style={{ backgroundColor: dotRestingColor(msSinceActivity) }}
    />
  );
}

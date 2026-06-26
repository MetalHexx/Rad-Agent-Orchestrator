"use client";
import Link from "next/link";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ViewSwitcherProps { active: "all" | "saved"; savedCount: number; }

/** Segmented All Sessions / ★ Saved switch in the shared sub-header's leading slot (DD-8). */
export function ViewSwitcher({ active, savedCount }: ViewSwitcherProps) {
  const seg = "inline-flex h-7 items-center gap-1 rounded-md px-2.5 text-[0.8rem] transition-colors";
  const on = "bg-muted text-foreground";
  const off = "text-muted-foreground hover:text-foreground";
  return (
    <div role="tablist" aria-label="Observability views" className="inline-flex items-center gap-1 rounded-lg border border-border bg-card p-0.5">
      <Link role="tab" aria-selected={active === "all"} href="/observability" className={cn(seg, active === "all" ? on : off)}>All Sessions</Link>
      <Link role="tab" aria-selected={active === "saved"} href="/observability/saved" className={cn(seg, active === "saved" ? on : off)}>
        <Star aria-hidden="true" className="size-3" /> Saved <span className="tabular-nums opacity-70">· {savedCount}</span>
      </Link>
    </div>
  );
}

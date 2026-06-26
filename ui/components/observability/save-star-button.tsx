"use client";
import { Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface SaveStarButtonProps { saved: boolean; busy?: boolean; onToggle: () => void; }

/**
 * One-click save/unsave. Filled star = saved. No naming prompt — rename lives on the Saved page (DD-1).
 * Borderless (ghost) with a --live red glow when saved, matching the Saved-page star; the single
 * reusable star used by the All Sessions table, the Saved rows, and the session-detail header.
 */
export function SaveStarButton({ saved, busy, onToggle }: SaveStarButtonProps) {
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={saved ? "Remove from saved benchmarks" : "Save benchmark"}
      aria-pressed={saved}
      title={saved ? "Saved benchmark" : "Save benchmark"}
      disabled={busy}
      onClick={onToggle}
      className={cn(
        saved
          ? "text-[var(--live)] hover:text-destructive hover:bg-destructive/10"
          : "text-muted-foreground hover:text-[var(--live)]"
      )}
    >
      <Star aria-hidden="true" fill={saved ? "currentColor" : "none"} className="size-4" />
    </Button>
  );
}

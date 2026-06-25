"use client";
import { Star } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface SaveStarButtonProps { saved: boolean; busy?: boolean; onToggle: () => void; }

/** One-click save/unsave. Filled star = saved. No naming prompt — rename lives on the Saved page (DD-1). */
export function SaveStarButton({ saved, busy, onToggle }: SaveStarButtonProps) {
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label={saved ? "Remove from saved benchmarks" : "Save benchmark"}
      aria-pressed={saved}
      title={saved ? "Saved benchmark" : "Save benchmark"}
      disabled={busy}
      onClick={onToggle}
      className={saved ? "text-[var(--live)]" : "text-muted-foreground hover:text-[var(--live)]"}
    >
      <Star aria-hidden="true" fill={saved ? "currentColor" : "none"} />
    </Button>
  );
}

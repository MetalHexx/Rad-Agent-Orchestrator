"use client";
import * as React from "react";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Reusable master/detail back control: a ghost icon-button — no chrome at rest, a subtle
 *  highlight + pointer ("hand") cursor on hover — that pops one browser-history entry.
 *  Pure strict back, no fallback (locked decision). SSR-safe: history.back() runs only on
 *  click and is window-guarded, and it uses no Next router hook, so it renders under renderToStaticMarkup. */
export function BackButton({
  ariaLabel = "Back",
  className,
}: {
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={ariaLabel}
      className={cn("cursor-pointer text-muted-foreground hover:text-foreground", className)}
      onClick={() => { if (typeof window !== "undefined") window.history.back(); }}
    >
      <ChevronLeft />
    </Button>
  );
}

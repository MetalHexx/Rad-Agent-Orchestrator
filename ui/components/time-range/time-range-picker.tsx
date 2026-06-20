"use client";
import * as React from "react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { RelativeRangeList } from "./relative-range-list";
import { AbsoluteRangeForm } from "./absolute-range-form";
import { rangePillLabel } from "./range-label";
import { type TimeRange } from "@/lib/time-range/range";

export interface TimeRangePickerProps {
  value: TimeRange;
  onChange: (next: TimeRange) => void;
  /** Retention floor (UTC ms); starts clamp to it. */
  min?: number;
  /** Optional upper bound (UTC ms); defaults to current time at open. */
  max?: number;
  scopeLabel?: string;
}

export function TimeRangePicker({ value, onChange, min = 0, max, scopeLabel }: TimeRangePickerProps) {
  const [open, setOpen] = React.useState(false);
  const nowMs = max ?? Date.now();
  const commit = (next: TimeRange) => { onChange(next); setOpen(false); };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={cn(buttonVariants({ variant: "outline" }), "h-8 justify-start text-left font-normal")}
        aria-label={scopeLabel ? `Time range — ${scopeLabel}` : "Time range"}
      >
        {rangePillLabel(value)}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-[var(--space-3)]">
        <div className="grid grid-cols-[auto_1px_auto] gap-[var(--space-4)]">
          <RelativeRangeList
            active={value.kind === "relative" ? value.preset : undefined}
            onSelect={(preset) => commit({ kind: "relative", preset })}
          />
          <div aria-hidden className="bg-border" />
          <AbsoluteRangeForm minMs={min} nowMs={nowMs} onApply={commit} />
        </div>
      </PopoverContent>
    </Popover>
  );
}

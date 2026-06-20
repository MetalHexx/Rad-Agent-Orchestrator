"use client";
import * as React from "react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AbsoluteRangeForm } from "./absolute-range-form";
import { rangePillLabel } from "./range-label";
import { PRESET_TIERS, presetMs, type TimeRange, type RelativePreset } from "@/lib/time-range/range";
import { utcMsToLocalDateStr, utcMsToLocalTimeStr } from "@/lib/time-range/timezone";
import type { AbsoluteForm } from "./absolute-form";

export interface TimeRangePickerProps {
  value: TimeRange;
  onChange: (next: TimeRange) => void;
  /** Retention floor (UTC ms); starts clamp to it. */
  min?: number;
  /** Optional upper bound (UTC ms); defaults to current time at open. */
  max?: number;
  scopeLabel?: string;
}

type AbsoluteFormSeed = Omit<AbsoluteForm, 'floorMs' | 'nowMs'>;

function seedFromValue(value: TimeRange, nowMs: number): AbsoluteFormSeed {
  if (value.kind === 'relative') {
    const startMs = nowMs - presetMs(value.preset);
    return { startDate: utcMsToLocalDateStr(startMs), startTime: utcMsToLocalTimeStr(startMs), endMode: 'now', endDate: '', endTime: '23:59' };
  }
  if (value.kind === 'since') {
    return { startDate: utcMsToLocalDateStr(value.startMs), startTime: utcMsToLocalTimeStr(value.startMs), endMode: 'now', endDate: '', endTime: '23:59' };
  }
  return {
    startDate: utcMsToLocalDateStr(value.startMs), startTime: utcMsToLocalTimeStr(value.startMs),
    endDate: utcMsToLocalDateStr(value.endMs),     endTime: utcMsToLocalTimeStr(value.endMs),
    endMode: 'specific',
  };
}

function PresetsView({ active, onSelect, onCustom }: { active?: RelativePreset; onSelect: (p: RelativePreset) => void; onCustom: () => void }) {
  return (
    <div className="flex flex-col gap-[var(--space-1)]">
      <div className="grid grid-cols-2 gap-[var(--space-1)]">
        {PRESET_TIERS.map((t) => (
          <button key={t.id} type="button" onClick={() => onSelect(t.id)}
            className={cn(
              'h-[30px] rounded-md px-[var(--space-2)] text-left text-sm hover:bg-muted',
              t.id === active && 'bg-muted ring-1 ring-[var(--chart-2)]/55'
            )}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="h-px bg-border my-[var(--space-2)] -mx-1" />
      <button type="button" onClick={onCustom}
        className="flex w-full items-center justify-between h-[30px] px-[var(--space-2)] text-sm text-left hover:bg-muted rounded-md">
        Custom range… <span className="text-muted-foreground">›</span>
      </button>
    </div>
  );
}

export function TimeRangePicker({ value, onChange, min = 0, max, scopeLabel }: TimeRangePickerProps) {
  const [open, setOpen] = React.useState(false);
  const [view, setView] = React.useState<'presets' | 'custom'>('presets');
  const nowMs = max ?? Date.now();
  const commit = (next: TimeRange) => { onChange(next); setOpen(false); };

  React.useEffect(() => {
    if (open) setView(value.kind === 'relative' ? 'presets' : 'custom');
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={cn(buttonVariants({ variant: "outline" }), "h-8 justify-start text-left font-normal")}
        aria-label={scopeLabel ? `Time range — ${scopeLabel}` : "Time range"}
      >
        {rangePillLabel(value)}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto p-[var(--space-3)]">
        {view === 'presets' ? (
          <PresetsView
            active={value.kind === 'relative' ? value.preset : undefined}
            onSelect={(preset) => commit({ kind: 'relative', preset })}
            onCustom={() => setView('custom')}
          />
        ) : (
          <AbsoluteRangeForm
            initialValue={seedFromValue(value, nowMs)}
            minMs={min}
            nowMs={nowMs}
            onApply={commit}
            onBack={() => setView('presets')}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}

"use client";
import * as React from "react";
import { Clock2Icon } from "lucide-react";
import { type DateRange } from "react-day-picker";
import { Calendar } from "@/components/ui/calendar";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { utcMsToLocalDateStr, utcMsToLocalTimeStr } from "@/lib/time-range/timezone";
import { validateForm, formToTimeRange, type AbsoluteForm } from "./absolute-form";
import type { TimeRange } from "@/lib/time-range/range";

function localDateFromStr(dateStr: string): Date | undefined {
  if (!dateStr) return undefined;
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function AbsoluteRangeForm({
  initialValue,
  minMs,
  nowMs,
  onApply,
  onBack,
}: {
  initialValue: Omit<AbsoluteForm, 'floorMs' | 'nowMs'>;
  minMs: number;
  nowMs: number;
  onApply: (range: TimeRange) => void;
  onBack: () => void;
}) {
  const [form, setForm] = React.useState<Omit<AbsoluteForm, 'floorMs' | 'nowMs'>>({ ...initialValue });
  const [touched, setTouched] = React.useState(false);
  const full: AbsoluteForm = { ...form, floorMs: minMs, nowMs };
  const { valid, hint } = validateForm(full);

  const selectedSingle = localDateFromStr(form.startDate);
  const selectedRange: DateRange | undefined = form.endMode === 'specific'
    ? { from: localDateFromStr(form.startDate), to: localDateFromStr(form.endDate) }
    : undefined;

  const pinEnd = () => {
    setTouched(true);
    setForm(f => ({ ...f, endMode: 'specific', endDate: utcMsToLocalDateStr(nowMs), endTime: utcMsToLocalTimeStr(nowMs) }));
  };
  const revertEnd = () => {
    setTouched(true);
    setForm(f => ({ ...f, endMode: 'now', endDate: '', endTime: '23:59' }));
  };

  return (
    <div className="flex flex-col gap-[var(--space-3)]">
      {form.endMode === 'now' ? (
        <Calendar
          mode="single"
          selected={selectedSingle}
          onSelect={(d) => {
            setTouched(true);
            setForm(f => ({ ...f, startDate: d ? utcMsToLocalDateStr(d.getTime()) : '' }));
          }}
        />
      ) : (
        <Calendar
          mode="range"
          selected={selectedRange}
          onSelect={(r) => {
            setTouched(true);
            setForm(f => ({
              ...f,
              startDate: r?.from ? utcMsToLocalDateStr(r.from.getTime()) : '',
              endDate:   r?.to   ? utcMsToLocalDateStr(r.to.getTime())   : '',
            }));
          }}
        />
      )}
      <div className="h-px bg-border -mx-[var(--space-1)]" />
      <div className="grid grid-cols-[auto_1fr] items-center gap-x-[var(--space-3)] gap-y-[var(--space-2)]">
        <span className="text-xs text-muted-foreground">Start</span>
        <InputGroup>
          <InputGroupInput type="time" value={form.startTime}
            onChange={(e) => { setTouched(true); setForm(f => ({ ...f, startTime: e.target.value })); }} />
          <InputGroupAddon><Clock2Icon className="text-muted-foreground" /></InputGroupAddon>
        </InputGroup>
        <span className="text-xs text-muted-foreground">End</span>
        {form.endMode === 'now' ? (
          <button type="button" onClick={pinEnd}
            className="inline-flex items-center gap-[var(--space-2)] rounded-md border border-border bg-muted px-[var(--space-2)] py-[5px] text-sm cursor-pointer hover:border-[var(--chart-2)]/40">
            <span className="size-1.5 rounded-full bg-[var(--chart-2)] shadow-[0_0_0_3px_color-mix(in_oklch,var(--chart-2)_20%,transparent)]" />
            Now
          </button>
        ) : (
          <div className="flex items-center gap-[var(--space-3)]">
            <InputGroup>
              <InputGroupInput type="time" value={form.endTime}
                onChange={(e) => { setTouched(true); setForm(f => ({ ...f, endTime: e.target.value })); }} />
              <InputGroupAddon><Clock2Icon className="text-muted-foreground" /></InputGroupAddon>
            </InputGroup>
            <button type="button" onClick={revertEnd}
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline underline-offset-2 decoration-primary/30 hover:decoration-primary bg-transparent border-0 p-0 cursor-pointer">
              ↺ Now
            </button>
          </div>
        )}
      </div>
      <div className="flex items-center justify-between">
        <button type="button" onClick={onBack}
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline underline-offset-2 decoration-primary/30 hover:decoration-primary bg-transparent border-0 p-0 cursor-pointer">
          ‹ Quick ranges
        </button>
        <div className="flex items-center gap-[var(--space-2)]">
          {touched && !valid && hint && <span className="text-xs text-destructive">{hint}</span>}
          <button type="button" disabled={!valid}
            onClick={() => { const r = formToTimeRange(full); if (r) onApply(r); }}
            className="h-8 rounded-md bg-primary px-[var(--space-3)] text-sm text-primary-foreground disabled:opacity-50">
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}

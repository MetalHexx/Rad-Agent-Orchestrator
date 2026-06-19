"use client";
import * as React from "react";
import { Clock2Icon } from "lucide-react";
import { type DateRange } from "react-day-picker";
import { Calendar } from "@/components/ui/calendar";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { utcDateString, localOffsetLabel } from "@/lib/time-range/timezone";
import { validateForm, formToTimeRange, type AbsoluteForm } from "./absolute-form";
import type { TimeRange } from "@/lib/time-range/range";

export function AbsoluteRangeForm({
  minMs,
  nowMs,
  onApply,
}: {
  minMs: number;
  nowMs: number;
  onApply: (range: TimeRange) => void;
}) {
  const [selected, setSelected] = React.useState<DateRange | undefined>();
  const [form, setForm] = React.useState<Omit<AbsoluteForm, "floorMs" | "nowMs">>({
    startDate: "", startTime: "00:00", endMode: "now", endDate: "", endTime: "23:59",
  });
  const full: AbsoluteForm = { ...form, floorMs: minMs, nowMs };
  const { valid, hint } = validateForm(full);
  const tzLabel = localOffsetLabel(nowMs);

  return (
    <div className="flex flex-col gap-[var(--space-3)] min-w-[20rem]">
      <Calendar
        mode="range"
        selected={selected}
        onSelect={(r) => {
          setSelected(r);
          setForm((f) => ({
            ...f,
            startDate: r?.from ? utcDateString(r.from.getTime()) : "",
            endDate: r?.to ? utcDateString(r.to.getTime()) : "",
          }));
        }}
        timeZone={Intl.DateTimeFormat().resolvedOptions().timeZone}
        disabled={{ before: new Date(minMs) }}
        startMonth={new Date(minMs)}
        hidden={{ before: new Date(minMs) }}
        excludeDisabled
      />
      <div className="flex items-end gap-[var(--space-3)]">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          From <span className="sr-only">start time</span>
          <InputGroup>
            <InputGroupInput type="time" value={form.startTime}
              onChange={(e) => setForm((f) => ({ ...f, startTime: e.target.value }))} />
            <InputGroupAddon><Clock2Icon className="text-muted-foreground" /></InputGroupAddon>
          </InputGroup>
        </label>
        <ToggleGroup
          value={[form.endMode]}
          onValueChange={(v) => {
            const next = v[v.length - 1] as "now" | "specific" | undefined;
            if (next) setForm((f) => ({ ...f, endMode: next }));
          }}
        >
          <ToggleGroupItem value="now">Now</ToggleGroupItem>
          <ToggleGroupItem value="specific">Specific</ToggleGroupItem>
        </ToggleGroup>
        {form.endMode === "specific" && (
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            To
            <InputGroup>
              <InputGroupInput type="time" value={form.endTime}
                onChange={(e) => setForm((f) => ({ ...f, endTime: e.target.value }))} />
              <InputGroupAddon><Clock2Icon className="text-muted-foreground" /></InputGroupAddon>
            </InputGroup>
          </label>
        )}
      </div>
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{tzLabel}</span>
        <div className="flex items-center gap-[var(--space-2)]">
          {!valid && hint && <span className="text-xs text-destructive">{hint}</span>}
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

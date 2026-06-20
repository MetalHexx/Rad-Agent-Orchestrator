"use client";
import * as React from "react";
import { PRESET_TIERS, type RelativePreset } from "@/lib/time-range/range";

export function RelativeRangeList({
  active,
  onSelect,
}: {
  active?: RelativePreset;
  onSelect: (preset: RelativePreset) => void;
}) {
  return (
    <div role="listbox" className="flex flex-col gap-[var(--space-1)]">
      {PRESET_TIERS.map((t) => (
        <button
          key={t.id}
          type="button"
          role="option"
          aria-selected={t.id === active}
          onClick={() => onSelect(t.id)}
          className="h-8 rounded-md px-[var(--space-3)] text-left text-sm hover:bg-muted aria-selected:bg-muted"
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

"use client";
import * as React from "react";
export function FilterSelect({ label, value, options, onChange }: {
  label: string; value: string; options: string[]; onChange: (v: string) => void;
}) {
  return (
    <label className="inline-flex items-center gap-[var(--space-2)] text-sm text-muted-foreground">
      {label}
      <select className="h-8 rounded-md border border-border bg-background px-[var(--space-2)] text-sm text-foreground"
        value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="All">All</option>
        {options.map((o) => <option key={o} value={o}>{o || "unknown"}</option>)}
      </select>
    </label>
  );
}

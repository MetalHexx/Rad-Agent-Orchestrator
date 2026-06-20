"use client";
import * as React from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function FilterSelect({ label, value, options, onChange }: {
  label: string; value: string; options: string[]; onChange: (v: string) => void;
}) {
  return (
    <label className="inline-flex items-center gap-[var(--space-2)] text-sm text-muted-foreground">
      {label}
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="All">All</SelectItem>
          {options.map((o) => (
            <SelectItem key={o} value={o}>{o || "unknown"}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}

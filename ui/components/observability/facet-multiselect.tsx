"use client";
import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { facetLabel } from "@/lib/observability/transcript-view";

export interface FacetMultiselectOption {
  value: string;
  count: number;
}

export interface FacetMultiselectProps {
  /** "Tools" | "Files" — the trigger's leading text and the popover header. */
  label: string;
  options: FacetMultiselectOption[];
  selected: ReadonlySet<string> | "all";
  onChange: (next: ReadonlySet<string> | "all") => void;
}

/** The `Tools ▾` / `Files ▾` control: a checkbox-per-option dropdown with Select all / Clear all. */
export function FacetMultiselect({ label, options, selected, onChange }: FacetMultiselectProps) {
  const isFiltered = selected !== "all";
  const isChecked = (value: string) => selected === "all" || selected.has(value);

  const toggleOption = (value: string, checked: boolean) => {
    const next = new Set(selected === "all" ? options.map((o) => o.value) : selected);
    if (checked) next.add(value);
    else next.delete(value);
    onChange(next.size >= options.length ? "all" : next);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-input/40 px-2.5 text-xs text-foreground outline-none",
          "focus-visible:ring-2 focus-visible:ring-ring",
          isFiltered && "border-[color:var(--chart-2)]",
        )}
      >
        <span className="text-muted-foreground">{label}</span>
        <span className="font-semibold">{facetLabel(selected, options.length)}</span>
        <ChevronDown className="size-3 text-muted-foreground" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-60 p-2" align="start">
        <div className="mb-1 flex items-center justify-between border-b border-border px-1 pb-1.5">
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="text-[11px] font-semibold text-[color:var(--chart-2)] hover:underline"
              onClick={() => onChange("all")}
            >
              Select all
            </button>
            <button
              type="button"
              className="text-[11px] font-semibold text-[color:var(--chart-2)] hover:underline"
              onClick={() => onChange(new Set())}
            >
              Clear all
            </button>
          </div>
        </div>
        <div className="flex flex-col">
          {options.map((opt) => {
            const id = `facet-${label}-${opt.value}`;
            return (
              <label
                key={opt.value}
                htmlFor={id}
                className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1.5 text-xs hover:bg-accent"
              >
                <Checkbox
                  id={id}
                  checked={isChecked(opt.value)}
                  onCheckedChange={(checked) => toggleOption(opt.value, checked)}
                  aria-label={opt.value}
                />
                <span className="font-mono">{opt.value}</span>
                <span className="ml-auto font-mono text-[11px] text-muted-foreground">{opt.count}</span>
              </label>
            );
          })}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

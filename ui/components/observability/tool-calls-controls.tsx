"use client";
import * as React from "react";
import { Search } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { FilterSelect } from "./filter-select";

export interface ToolCallsControlsProps {
  errorsOnly: boolean; onErrorsOnly: (v: boolean) => void;
  toolFilter: string | null; onToolFilter: (v: string | null) => void;
  toolNames: string[];
  query: string; onQuery: (v: string) => void;
  shown: number; total: number;
}

// Controls-bar idiom borrowed verbatim from TranscriptControls (DD-6).
export function ToolCallsControls(props: ToolCallsControlsProps) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-2.5">
      <div className="flex items-center gap-2">
        <Switch id="tools-errors-only" checked={props.errorsOnly} onCheckedChange={props.onErrorsOnly} />
        <Label htmlFor="tools-errors-only" className="text-xs">Errors only</Label>
      </div>
      {/* FilterSelect injects its own "All" sentinel item; pass the bare tool names. */}
      <FilterSelect
        label="Tool"
        value={props.toolFilter ?? "All"}
        options={props.toolNames}
        onChange={(v) => props.onToolFilter(v === "All" ? null : v)}
      />
      <div className="relative min-w-[160px] flex-1">
        <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          value={props.query}
          onChange={(e) => props.onQuery(e.target.value)}
          placeholder="Search inputs…"
          aria-label="Search inputs"
          className="h-8 border-border bg-background pl-7"
        />
      </div>
      <span className="ml-auto text-xs text-muted-foreground">showing {props.shown} of {props.total}</span>
    </div>
  );
}

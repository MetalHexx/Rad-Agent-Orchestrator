"use client";
import * as React from "react";
import { Search, AlertTriangle } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FacetMultiselect, type FacetMultiselectOption } from "./facet-multiselect";
import type { TranscriptFacetState } from "@/lib/observability/transcript-view";

export interface TranscriptControlsProps {
  types: TranscriptFacetState["types"];
  onTypeChange: (key: keyof TranscriptFacetState["types"], value: boolean) => void;
  tools: TranscriptFacetState["tools"];
  onToolsChange: (next: TranscriptFacetState["tools"]) => void;
  toolOptions: FacetMultiselectOption[];
  files: TranscriptFacetState["files"];
  onFilesChange: (next: TranscriptFacetState["files"]) => void;
  fileOptions: FacetMultiselectOption[];
  query: string; onQuery: (v: string) => void;
  errorCount: number; onJumpError: () => void;
}

const TYPE_TOGGLES: { key: keyof TranscriptFacetState["types"]; label: string }[] = [
  { key: "user", label: "User" },
  { key: "assistant", label: "Assistant" },
  { key: "thinking", label: "Thinking" },
  { key: "toolResults", label: "Tool results" },
  { key: "errors", label: "Errors" },
];

export function TranscriptControls(props: TranscriptControlsProps) {
  return (
    <div className="flex flex-col gap-2.5 border-b border-border px-4 py-2.5">
      {/* Row 1: type toggles, then the Tools/Files multiselect dropdowns */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[10.5px] font-semibold tracking-wide text-muted-foreground uppercase">Show</span>
        {TYPE_TOGGLES.map(({ key, label }) => {
          const id = `t-type-${key}`;
          return (
            <div key={key} className="flex items-center gap-2">
              <Switch id={id} checked={props.types[key]} onCheckedChange={(v) => props.onTypeChange(key, v)} />
              <Label htmlFor={id} className="text-xs">{label}</Label>
            </div>
          );
        })}
        <div className="ml-1 flex items-center gap-2">
          <FacetMultiselect label="Tools" options={props.toolOptions} selected={props.tools} onChange={props.onToolsChange} />
          <FacetMultiselect label="Files" options={props.fileOptions} selected={props.files} onChange={props.onFilesChange} />
        </div>
      </div>
      {/* Row 2: full-width search, plus the errors jump button */}
      <div className="flex items-center gap-3">
        <div className="relative min-w-[160px] flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input value={props.query} onChange={(e) => props.onQuery(e.target.value)} placeholder="Search transcript…"
            aria-label="Search transcript" className="h-8 border-border bg-background pl-7" />
        </div>
        <Button type="button" variant="outline" size="sm" disabled={props.errorCount === 0} onClick={props.onJumpError}
          className="gap-1.5" style={{ color: "var(--model-red)", borderColor: "var(--color-error-border)" }}>
          <AlertTriangle className="size-3.5" aria-hidden="true" />
          Errors ({props.errorCount})
        </Button>
      </div>
    </div>
  );
}

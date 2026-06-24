"use client";
import * as React from "react";
import { Search, AlertTriangle } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export interface TranscriptControlsProps {
  showThinking: boolean; onShowThinking: (v: boolean) => void;
  showToolIO: boolean; onShowToolIO: (v: boolean) => void;
  query: string; onQuery: (v: string) => void;
  errorCount: number; onJumpError: () => void;
}

export function TranscriptControls(props: TranscriptControlsProps) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-2.5">
      <div className="flex items-center gap-2">
        <Switch id="t-thinking" checked={props.showThinking} onCheckedChange={props.onShowThinking} />
        <Label htmlFor="t-thinking" className="text-xs">Thinking</Label>
      </div>
      <div className="flex items-center gap-2">
        <Switch id="t-io" checked={props.showToolIO} onCheckedChange={props.onShowToolIO} />
        <Label htmlFor="t-io" className="text-xs">Tool I/O</Label>
      </div>
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
  );
}

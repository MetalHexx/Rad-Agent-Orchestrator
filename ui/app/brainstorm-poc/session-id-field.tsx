"use client";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface SessionIdFieldProps {
  sessionId: string;
  onSessionIdChange: (value: string) => void;
  onNewSession: () => void;
  disabled?: boolean;
}

export function SessionIdField({ sessionId, onSessionIdChange, onNewSession, disabled }: SessionIdFieldProps) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <label htmlFor="poc-session-id" className="text-xs font-medium text-muted-foreground">
          Session ID
        </label>
        <Input
          id="poc-session-id"
          value={sessionId}
          onChange={(e) => onSessionIdChange(e.target.value)}
          disabled={disabled}
          placeholder="session uuid"
          className="h-7 flex-1 font-mono text-xs"
        />
        <Button variant="outline" size="sm" onClick={onNewSession} disabled={disabled}>
          New session
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Paste another session ID to resume it on the next turn — a portability / hijack probe.
      </p>
    </div>
  );
}

"use client";
import * as React from "react";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { ActivityDot } from "@/components/observability/activity-dot";
import { RateSparkline } from "@/components/observability/rate-sparkline";
import { humanizeTokens } from "@/lib/observability/format";
import { formatDuration } from "@/lib/observability/duration-format";
import { sessionDuration, timeBucketedRate } from "@/lib/observability/sessions";
import type { SessionAgg } from "@/lib/observability/sessions";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";

type SortKey = "startedMs" | "lastMs" | "spend" | "worktree" | "sessionId" | "duration";
type SortDir = "asc" | "desc";

interface SessionTableProps {
  sessions: SessionAgg[];
  now: number;
  /** The shared now-anchored window (same as the Total Rate chart). When supplied, each row's
   *  scanline buckets over it so it slides/updates live; absent, it falls back to the session's
   *  own lifetime (keeps prior behavior for callers/tests that don't pass a window). */
  rangeStart?: number;
  rangeEnd?: number;
}

export function SessionTable({ sessions, now, rangeStart, rangeEnd }: SessionTableProps) {
  const [sortKey, setSortKey] = React.useState<SortKey>("startedMs");
  const [sortDir, setSortDir] = React.useState<SortDir>("desc");

  const sorted = React.useMemo(() => {
    const copy = [...sessions];
    copy.sort((a, b) => {
      let av: number | string, bv: number | string;
      switch (sortKey) {
        case "startedMs": av = a.startedMs; bv = b.startedMs; break;
        case "lastMs": av = a.lastMs; bv = b.lastMs; break;
        case "spend": av = a.spend; bv = b.spend; break;
        case "worktree": av = a.worktree ?? "unknown"; bv = b.worktree ?? "unknown"; break;
        case "sessionId": av = a.sessionId; bv = b.sessionId; break;
        case "duration": av = sessionDuration(a); bv = sessionDuration(b); break;
        default: av = a.startedMs; bv = b.startedMs;
      }
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return copy;
  }, [sessions, sortKey, sortDir]);

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  function SortableHead({ colKey, children }: { colKey: SortKey; children: React.ReactNode }) {
    return (
      <TableHead
        className="cursor-pointer select-none"
        onClick={() => handleSort(colKey)}
        aria-sort={
          sortKey === colKey
            ? sortDir === "asc"
              ? "ascending"
              : "descending"
            : undefined
        }
      >
        {children}
        {sortKey === colKey && (
          <span className="ml-1 text-xs opacity-60">{sortDir === "asc" ? "↑" : "↓"}</span>
        )}
      </TableHead>
    );
  }

  function navigateTo(sessionId: string) {
    if (typeof window !== "undefined") {
      window.location.href = `/observability/session/${sessionId}`;
    }
  }

  return (
    <div className="rounded-xl bg-card ring-1 ring-foreground/10 overflow-x-auto">
      <Table className="table-fixed w-full">
        <colgroup>
          {/* table-fixed makes these widths authoritative. Identity columns flex
              (auto) and truncate; metric columns get explicit widths sized to
              content/header. NB: the percentage shrink-to-content trick does NOT
              work under table-fixed (a percent width is taken literally → a sliver
              of the table), so metric columns must carry real pixel widths. */}
          <col style={{ width: "60px" }} />{/* Activity */}
          <col style={{ width: "auto" }} />{/* Worktree */}
          <col style={{ width: "auto" }} />{/* Session */}
          <col style={{ width: "176px" }} />{/* Started — full toLocaleString */}
          <col style={{ width: "96px" }} />{/* Duration */}
          <col style={{ width: "120px" }} />{/* Total Spend */}
          <col style={{ width: "140px" }} />{/* Current Rate (hidden < sm) */}
        </colgroup>
        <TableHeader>
          <TableRow>
            <TableHead className="text-center">Activity</TableHead>
            <SortableHead colKey="worktree">Worktree</SortableHead>
            <SortableHead colKey="sessionId">Session</SortableHead>
            <SortableHead colKey="startedMs">Started</SortableHead>
            <SortableHead colKey="duration">Duration</SortableHead>
            <SortableHead colKey="spend">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger>Total Spend</TooltipTrigger>
                  <TooltipContent>Cache-weighted effective tokens — a cost-shaped count, not a dollar amount.</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </SortableHead>
            <TableHead className="hidden sm:table-cell">Current Rate</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((s) => (
            <TableRow
              key={s.sessionId}
              role="link"
              className="cursor-pointer hover:bg-muted/70"
              onClick={() => navigateTo(s.sessionId)}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  navigateTo(s.sessionId);
                }
              }}
            >
              <TableCell className="text-center">
                <ActivityDot msSinceActivity={now - s.lastMs} />
              </TableCell>
              <TableCell
                className="truncate font-mono text-xs"
                title={s.worktree ?? "unknown"}
              >
                {s.worktree ?? "unknown"}
              </TableCell>
              <TableCell
                className="truncate font-mono text-xs"
                title={s.sessionId}
              >
                {s.sessionId}
              </TableCell>
              <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                {new Date(s.startedMs).toLocaleString()}
              </TableCell>
              <TableCell className="whitespace-nowrap text-xs tabular-nums">
                {formatDuration(sessionDuration(s))}
              </TableCell>
              <TableCell className="whitespace-nowrap text-sm font-semibold tabular-nums">
                {humanizeTokens(s.spend)}
              </TableCell>
              <TableCell className="hidden sm:table-cell">
                <RateSparkline
                  data={timeBucketedRate(s.rows, {
                    // Bucket over the SAME now-anchored, grid-snapped window as the Total Rate chart
                    // so each scanline slides and updates live exactly like it, scoped to one session.
                    // Falls back to the session's own lifetime when no window is supplied (FR-10).
                    endMs: rangeEnd ?? s.lastMs,
                    windowMs: (rangeEnd ?? s.lastMs) - (rangeStart ?? s.startedMs),
                    buckets: 30,
                    anchor: rangeEnd != null ? "grid" : "window",
                  })}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

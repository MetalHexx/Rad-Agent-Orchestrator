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
import { sessionDuration, timeBucketedRate, rowsInWindow } from "@/lib/observability/sessions";
import { bucketsForWindow } from "@/lib/observability/time-range";
import type { SessionAgg } from "@/lib/observability/sessions";
import { SPEND_LABELS, formatUsd } from "@/lib/observability/spend-display";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { SaveStarButton } from "./save-star-button";

type SortKey = "startedMs" | "lastMs" | "spend" | "worktree" | "sessionId" | "duration" | "cost";
type SortDir = "asc" | "desc";

interface SessionTableProps {
  sessions: (SessionAgg & { cost: number | null })[];
  now: number;
  /** The shared now-anchored window (same as the Total Rate chart). When supplied, each row's
   *  scanline buckets over it so it slides/updates live; absent, it falls back to the session's
   *  own lifetime (keeps prior behavior for callers/tests that don't pass a window). */
  rangeStart?: number;
  rangeEnd?: number;
  /** The nominal (snapped) window length the Total Rate chart buckets over. Sourced from the same
   *  stable value, not the live `rangeEnd - rangeStart`, so the sparkline's grid size is invariant
   *  across ticks (kills the per-tick warp). Falls back to the live span when absent. */
  nominalWindowMs?: number;
  /** Set of session IDs the user has saved; used to render the leading star column (FR-3, DD-2). */
  savedIds?: Set<string>;
  /** Called when the user clicks the star cell; the caller is responsible for optimistic update (DD-1). */
  onToggleSave?: (sessionId: string) => void;
}

export function SessionTable({ sessions, now, rangeStart, rangeEnd, nominalWindowMs, savedIds, onToggleSave }: SessionTableProps) {
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
        // Unpriced (null) sorts as the lowest value so it lands last under the default desc order.
        case "cost": av = a.cost ?? -Infinity; bv = b.cost ?? -Infinity; break;
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
          <col style={{ width: "40px" }} />{/* star (DD-2) */}
          <col style={{ width: "60px" }} />{/* Activity */}
          <col style={{ width: "auto" }} />{/* Worktree */}
          <col style={{ width: "auto" }} />{/* Session */}
          <col style={{ width: "176px" }} />{/* Started — full toLocaleString */}
          <col style={{ width: "96px" }} />{/* Duration */}
          <col style={{ width: "120px" }} />{/* Total Spend (weighted) */}
          <col style={{ width: "120px" }} />{/* Cost (USD) */}
          <col style={{ width: "220px" }} />{/* Current Rate (hidden < sm) — wide enough to decompress the scanline */}
        </colgroup>
        <TableHeader>
          <TableRow>
            <TableHead aria-hidden />
            <TableHead className="text-center">Activity</TableHead>
            <SortableHead colKey="worktree">Worktree</SortableHead>
            <SortableHead colKey="sessionId">Session</SortableHead>
            <SortableHead colKey="startedMs">Started</SortableHead>
            <SortableHead colKey="duration">Duration</SortableHead>
            <SortableHead colKey="spend">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger>Total Spend (weighted)</TooltipTrigger>
                  <TooltipContent>Cache-weighted effective tokens — a cost-shaped count, not a dollar amount.</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </SortableHead>
            <SortableHead colKey="cost">{SPEND_LABELS.cost}</SortableHead>
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
              <TableCell onClick={(e) => { e.stopPropagation(); onToggleSave?.(s.sessionId); }}>
                <SaveStarButton saved={Boolean(savedIds?.has(s.sessionId))} onToggle={() => onToggleSave?.(s.sessionId)} />
              </TableCell>
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
              <TableCell className="whitespace-nowrap text-sm font-semibold tabular-nums">
                {formatUsd(s.cost)}
              </TableCell>
              <TableCell className="hidden sm:table-cell">
                <RateSparkline
                  data={timeBucketedRate(
                    // Scope to the same window the chart uses so the two paths are textually parallel;
                    // moot once the sparkline clips its X-axis, but keeps the row set exact (FR-11).
                    rangeStart != null && rangeEnd != null ? rowsInWindow(s.rows, rangeStart, rangeEnd) : s.rows,
                    {
                      // Bucket over the SAME now-anchored, grid-snapped window as the Total Rate chart so each
                      // scanline obeys the identical window contract, scoped to one session (FR-11). Both windowMs
                      // and the bucket count come from the chart's stable nominal window (not the live span), so the
                      // grid size — and thus the curve's shape — match the chart exactly; falls back to the session's
                      // lifetime / 30 buckets when no window is supplied (FR-10).
                      endMs: rangeEnd ?? s.lastMs,
                      windowMs: nominalWindowMs ?? ((rangeEnd ?? s.lastMs) - (rangeStart ?? s.startedMs)),
                      buckets: nominalWindowMs != null ? bucketsForWindow(nominalWindowMs) : 30,
                      anchor: rangeEnd != null ? "grid" : "window",
                    }
                  )}
                  rangeStart={rangeStart}
                  rangeEnd={rangeEnd}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

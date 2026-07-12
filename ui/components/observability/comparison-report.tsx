"use client";
import * as React from "react";
import type { SavedSession } from "@rad-orchestration/telemetry";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { humanizeTokens } from "@/lib/observability/format";
import { formatDuration } from "@/lib/observability/duration-format";
import { computeDelta, METRICS } from "@/lib/observability/comparison";
import type { Delta, MetricSpec } from "@/lib/observability/comparison";
import { formatUsd } from "@/lib/observability/spend-display";

export interface ComparisonReportProps {
  baseline: SavedSession;
  candidate: SavedSession;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pctLabel(delta: Delta): string {
  if (delta.pct === null) return "—";
  const sign = delta.pct > 0 ? "+" : "";
  return `${sign}${(delta.pct * 100).toFixed(1)}%`;
}

function deltaColor(delta: Delta): string {
  if (delta.improved === true) return "color:var(--model-green)";
  if (delta.improved === false) return "color:var(--model-red)";
  return "";
}

function deltaGlyph(delta: Delta): string {
  if (delta.improved === true) return "↓";
  if (delta.improved === false) return "↑";
  return "—";
}

function formatMetric(spec: MetricSpec, value: number | string | null): string {
  if (value === null) return "—";
  if (typeof value === "string") return value;
  // Token-spend → humanizeTokens, duration → formatDuration (via spec.format); plain counts round
  // to drop any cache-weighting float cruft. Matches the hero cards and the rest of the app.
  return spec.format ? spec.format(value) : String(Math.round(value));
}

// ---------------------------------------------------------------------------
// Identity chip (session label + mono session id)
// ---------------------------------------------------------------------------

interface SessionChipProps {
  session: SavedSession;
  isBaseline?: boolean;
}

function SessionChip({ session, isBaseline = false }: SessionChipProps) {
  const titleIsSid = session.title === session.sessionId;
  return (
    <div className="flex flex-col gap-1 rounded-xl bg-card ring-1 ring-foreground/10 px-4 py-3 min-w-0">
      <div className="flex items-center gap-2 flex-wrap">
        <span className={cn("font-medium truncate", titleIsSid && "font-mono text-xs text-muted-foreground")}>
          {session.title}
        </span>
        {isBaseline && (
          <Badge variant="accent" className="shrink-0">BASELINE</Badge>
        )}
      </div>
      {!titleIsSid && (
        <span className="font-mono text-xs text-muted-foreground truncate">{session.sessionId}</span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Delta hero tile (large percentage + baseline→candidate)
// ---------------------------------------------------------------------------

interface DeltaHeroTileProps {
  label: string;
  baselineValue: string;
  candidateValue: string;
  delta: Delta;
}

function DeltaHeroTile({ label, baselineValue, candidateValue, delta }: DeltaHeroTileProps) {
  const color = deltaColor(delta);
  const label_ = pctLabel(delta);
  return (
    <div className="rounded-xl bg-card ring-1 ring-foreground/10 px-6 py-5 flex flex-col gap-1">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span
        className="text-3xl font-semibold tabular-nums"
        style={color ? { color: `var(--model-${delta.improved === true ? "green" : "red"})` } : undefined}
      >
        {label_}
      </span>
      <span className="text-xs text-muted-foreground tabular-nums">
        {baselineValue} → {candidateValue}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Full metrics table
// ---------------------------------------------------------------------------

interface MetricsTableProps {
  baseline: SavedSession;
  candidate: SavedSession;
}

function MetricsTable({ baseline, candidate }: MetricsTableProps) {
  return (
    <div className="rounded-xl bg-card ring-1 ring-foreground/10 overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th className="px-4 py-2 font-medium">Metric</th>
            <th className="px-4 py-2 font-medium tabular-nums">Baseline</th>
            <th className="px-4 py-2 font-medium tabular-nums">Candidate</th>
            <th className="px-4 py-2 font-medium tabular-nums">Δ</th>
          </tr>
        </thead>
        <tbody>
          {METRICS.map((spec) => {
            const bv = spec.get(baseline.snapshot);
            const cv = spec.get(candidate.snapshot);
            const isNumeric = typeof bv === "number" && typeof cv === "number";
            const delta: Delta = isNumeric
              ? computeDelta(bv as number, cv as number, spec.direction)
              : { pct: null, improved: null };

            const bLabel = formatMetric(spec, bv);
            const cLabel = formatMetric(spec, cv);

            // For model row: show dash if unchanged
            const unchanged = spec.direction === "neutral" && bv === cv;

            return (
              <tr key={spec.key} className="border-b border-border last:border-0 hover:bg-muted/40 transition-colors">
                <td className="px-4 py-2 text-muted-foreground">{spec.label}</td>
                <td className="px-4 py-2 tabular-nums">{bLabel}</td>
                <td className="px-4 py-2 tabular-nums">{cLabel}</td>
                <td className="px-4 py-2 tabular-nums">
                  {unchanged ? (
                    <span className="text-muted-foreground">—</span>
                  ) : delta.improved === null && delta.pct === null ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <span
                      style={
                        delta.improved !== null
                          ? { color: `var(--model-${delta.improved ? "green" : "red"})` }
                          : undefined
                      }
                    >
                      {deltaGlyph(delta)} {pctLabel(delta)}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Self-contained comparison report: identity row, delta hero (3 tiles), full metrics table.
 * Takes baseline + candidate SavedSession props; no modal dependency so it can mount on a route. (AD-8)
 */
export function ComparisonReport({ baseline, candidate }: ComparisonReportProps) {
  const bs = baseline.snapshot;
  const cs = candidate.snapshot;

  // Delta hero: Cost (USD), Total Spend (weighted), Duration
  const bCost = bs.costUsd;
  const cCost = cs.costUsd;
  const costDelta: Delta = (bCost == null || cCost == null)
    ? { pct: null, improved: null }
    : computeDelta(bCost, cCost, "lower-better");
  const spendDelta = computeDelta(bs.totalSpend, cs.totalSpend, "lower-better");
  const durationDelta = computeDelta(bs.durationMs, cs.durationMs, "lower-better");

  return (
    <div className="flex flex-col gap-6 p-4">
      {/* Delta hero — moved to the top of the report */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <DeltaHeroTile
          label="Cost (USD)"
          baselineValue={formatUsd(bCost)}
          candidateValue={formatUsd(cCost)}
          delta={costDelta}
        />
        <DeltaHeroTile
          label="Total Spend (weighted)"
          baselineValue={humanizeTokens(bs.totalSpend)}
          candidateValue={humanizeTokens(cs.totalSpend)}
          delta={spendDelta}
        />
        <DeltaHeroTile
          label="Duration"
          baselineValue={formatDuration(bs.durationMs)}
          candidateValue={formatDuration(cs.durationMs)}
          delta={durationDelta}
        />
      </div>

      {/* Identity row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <SessionChip session={baseline} isBaseline />
        <SessionChip session={candidate} />
      </div>

      {/* Full metrics table */}
      <MetricsTable baseline={baseline} candidate={candidate} />
    </div>
  );
}

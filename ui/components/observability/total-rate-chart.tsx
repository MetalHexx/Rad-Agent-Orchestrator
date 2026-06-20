"use client";
import * as React from "react";
import { Area, AreaChart, ResponsiveContainer, XAxis, YAxis } from "recharts";
import type { RatePoint } from "@/lib/observability/sessions";
import { niceMax } from "@/lib/observability/chart-scale";
import { humanizeTokens } from "@/lib/observability/format";
import { FilteredBadge } from "@/components/observability/filtered-badge";

// A small, fixed number of axis labels. Recharts' d3 time scale otherwise generates its own dense
// "nice" ticks and ignores tickCount, crowding the X axis with ~11 labels.
const AXIS_TICKS = 5;

function formatTime(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function TotalRateChart({
  data,
  rangeStart,
  rangeEnd,
  filtered = false,
}: {
  data: RatePoint[];
  rangeStart: number;
  rangeEnd: number;
  filtered?: boolean;
}) {
  const animatedOnce = React.useRef(false);
  const animate = !animatedOnce.current;
  React.useEffect(() => { animatedOnce.current = true; }, []);

  const yMax = niceMax(data.map((d) => d.value));

  // Explicit, evenly-spaced ticks so both axes show exactly AXIS_TICKS labels. The X ticks slide with
  // the window; the Y ticks span [0, yMax] and are humanized (250K / 1.2M) — raw token counts in a
  // narrow axis were clipping their leading digits into the garbled "00000".
  const xTicks = React.useMemo(
    () => Array.from({ length: AXIS_TICKS }, (_, i) => Math.round(rangeStart + (i * (rangeEnd - rangeStart)) / (AXIS_TICKS - 1))),
    [rangeStart, rangeEnd]
  );
  const yTicks = Array.from({ length: AXIS_TICKS }, (_, i) => (i * yMax) / (AXIS_TICKS - 1));

  return (
    <div className="rounded-xl bg-card ring-1 ring-foreground/10 p-[var(--space-4)]">
      <h2 className="flex items-center gap-2 text-sm font-medium text-foreground mb-2">Total Rate<FilteredBadge active={filtered} /></h2>
      <div className="h-40">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="totalRateFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--chart-2)" stopOpacity={0.85} />
                <stop offset="55%" stopColor="var(--chart-2)" stopOpacity={0.32} />
                <stop offset="100%" stopColor="var(--chart-2)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="t"
              type="number"
              domain={[rangeStart, rangeEnd]}
              scale="time"
              tickFormatter={formatTime}
              ticks={xTicks}
              interval={0}
              tick={{ fontSize: 10 }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              domain={[0, yMax]}
              ticks={yTicks}
              tickFormatter={humanizeTokens}
              allowDecimals={false}
              tick={{ fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              width={52}
            />
            <Area
              type="monotone"
              dataKey="value"
              stroke="var(--chart-2)"
              strokeWidth={2}
              fill="url(#totalRateFill)"
              isAnimationActive={animate}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

"use client";
import * as React from "react";
import { AreaChart, ResponsiveContainer } from "recharts";
import { XAxis, YAxis, Area } from "@/components/observability/recharts-compat";
import type { RatePoint } from "@/lib/observability/sessions";

interface RateSparklineProps {
  data: RatePoint[];
  /** When supplied, the X-axis clips to this window — mirroring the Total Rate chart's
   *  domain={[rangeStart, rangeEnd]} so the scanline shows the same span (no snapped-window
   *  dead space on `since` ranges). Absent → fall back to the data's own extent. */
  rangeStart?: number;
  rangeEnd?: number;
}

export function RateSparkline({ data, rangeStart, rangeEnd }: RateSparklineProps) {
  const gradientId = React.useId();
  return (
    <div className="h-8 w-full min-w-[140px]">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 1, right: 0, bottom: 1, left: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-2)" stopOpacity={0.5} />
              <stop offset="100%" stopColor="var(--chart-2)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="t"
            type="number"
            domain={rangeStart != null && rangeEnd != null ? [rangeStart, rangeEnd] : ['dataMin', 'dataMax']}
            hide
          />
          <YAxis hide domain={[0, "dataMax"]} />
          <Area
            type="monotone"
            dataKey="value"
            stroke="var(--chart-2)"
            strokeWidth={1.5}
            fill={`url(#${gradientId})`}
            isAnimationActive={false}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

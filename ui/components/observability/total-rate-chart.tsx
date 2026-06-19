"use client";
import * as React from "react";
import { Area, AreaChart, ResponsiveContainer, XAxis, YAxis } from "recharts";
import type { RatePoint } from "@/lib/observability/sessions";
import { niceMax } from "@/lib/observability/chart-scale";

function formatTime(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function TotalRateChart({
  data,
  rangeStart,
  rangeEnd,
}: {
  data: RatePoint[];
  rangeStart: number;
  rangeEnd: number;
}) {
  const animatedOnce = React.useRef(false);
  const animate = !animatedOnce.current;
  React.useEffect(() => { animatedOnce.current = true; }, []);

  const yMax = niceMax(data.map((d) => d.value));

  return (
    <div className="rounded-xl bg-card ring-1 ring-foreground/10 p-[var(--space-4)]">
      <h2 className="text-sm font-medium text-foreground mb-2">Total Rate</h2>
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
              tickCount={5}
              tick={{ fontSize: 10 }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              domain={[0, yMax]}
              tick={{ fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              width={40}
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

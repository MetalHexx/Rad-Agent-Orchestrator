"use client";
import * as React from "react";
import { Area, AreaChart, ResponsiveContainer, YAxis } from "recharts";
import type { RatePoint } from "@/lib/observability/sessions";

export function TotalRateChart({ data }: { data: RatePoint[] }) {
  const animatedOnce = React.useRef(false);
  const animate = !animatedOnce.current;
  React.useEffect(() => { animatedOnce.current = true; }, []);
  return (
    <div className="rounded-xl bg-card ring-1 ring-foreground/10 p-4">
      <h2 className="text-sm font-medium text-foreground mb-2">Total Rate</h2>
      <div className="h-40">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="totalRateFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--chart-2)" stopOpacity={0.5} />
                <stop offset="100%" stopColor="var(--chart-2)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <YAxis hide domain={[0, "dataMax"]} />
            <Area type="monotone" dataKey="value" stroke="var(--chart-2)" strokeWidth={2} fill="url(#totalRateFill)" isAnimationActive={animate} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

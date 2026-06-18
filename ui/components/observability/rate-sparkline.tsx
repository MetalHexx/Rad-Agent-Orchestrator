"use client";
import * as React from "react";
import { Area, AreaChart, ResponsiveContainer, YAxis } from "recharts";
import type { RatePoint } from "@/lib/observability/sessions";

interface RateSparklineProps {
  data: RatePoint[];
}

export function RateSparkline({ data }: RateSparklineProps) {
  const gradientId = React.useId();
  return (
    <div className="h-8 w-20">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 1, right: 0, bottom: 1, left: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-2)" stopOpacity={0.5} />
              <stop offset="100%" stopColor="var(--chart-2)" stopOpacity={0} />
            </linearGradient>
          </defs>
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

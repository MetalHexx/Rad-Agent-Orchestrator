"use client";
import * as React from "react";
import { Line, LineChart, ResponsiveContainer, XAxis, YAxis, Legend } from "recharts";
import type { ModelRatePoint } from "@/lib/observability/sessions";
import { niceMax } from "@/lib/observability/chart-scale";
import { humanizeTokens } from "@/lib/observability/format";
import { FilteredBadge } from "@/components/observability/filtered-badge";

// A small, fixed number of axis labels — recharts' d3 time scale otherwise crowds the X axis.
const AXIS_TICKS = 5;

export interface SpendRateSeries { key: string; label: string; cssVar: string; }

function formatTime(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function SpendRateChart({
  data, series, title, rangeStart, rangeEnd, filtered = false,
}: {
  data: ModelRatePoint[];
  series: SpendRateSeries[];
  title: string;
  rangeStart: number;
  rangeEnd: number;
  filtered?: boolean;
}) {
  const animatedOnce = React.useRef(false);
  const animate = !animatedOnce.current;
  React.useEffect(() => { animatedOnce.current = true; }, []);

  // Default total-only (FR-4): seed `hidden` with every NON-total series key, so only the
  // blue total line paints on first render. The user opts model lines in via the legend.
  const [hidden, setHidden] = React.useState<Set<string>>(
    () => new Set(series.filter((s) => s.key !== "total").map((s) => s.key))
  );
  const toggle = React.useCallback((key: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  // Y-scale over the visible series only (FR-5, FR-3) — the same explicit niceMax the prior chart
  // used, so the fixed humanized 5-tick axis is preserved across All Sessions and Session Detail.
  const visibleKeys = series.map((s) => s.key).filter((k) => !hidden.has(k));
  const yMax = niceMax(data.flatMap((p) => visibleKeys.map((k) => (p[k] as number) ?? 0)));

  const xTicks = React.useMemo(
    () => Array.from({ length: AXIS_TICKS }, (_, i) => Math.round(rangeStart + (i * (rangeEnd - rangeStart)) / (AXIS_TICKS - 1))),
    [rangeStart, rangeEnd]
  );
  const yTicks = Array.from({ length: AXIS_TICKS }, (_, i) => (i * yMax) / (AXIS_TICKS - 1));

  // Explicit legend payload so the greyed (inactive) state and token colors are deterministic,
  // independent of recharts' auto-derivation from the Line children (DD-3, AD-4).
  const legendPayload = series.map((s) => ({
    value: s.label, dataKey: s.key, type: "line" as const,
    color: `var(${s.cssVar})`, inactive: hidden.has(s.key),
  }));

  return (
    <div className="rounded-xl bg-card ring-1 ring-foreground/10 p-[var(--space-4)]">
      <h2 className="flex items-center gap-2 text-sm font-medium text-foreground mb-2">{title}<FilteredBadge active={filtered} /></h2>
      <div className="h-40">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <XAxis
              dataKey="t" type="number" domain={[rangeStart, rangeEnd]} scale="time"
              tickFormatter={formatTime} ticks={xTicks} interval={0}
              tick={{ fontSize: 10 }} tickLine={false} axisLine={false}
            />
            <YAxis
              domain={[0, yMax]} ticks={yTicks} tickFormatter={humanizeTokens} allowDecimals={false}
              tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={52}
            />
            <Legend
              payload={legendPayload}
              onClick={(d) => toggle(String((d as { dataKey?: string }).dataKey ?? ""))}
              wrapperStyle={{ cursor: "pointer", fontSize: 11 }}
            />
            {series.map((s) => (
              <Line
                key={s.key} type="monotone" dataKey={s.key} name={s.label}
                stroke={`var(${s.cssVar})`} strokeWidth={2} dot={false}
                hide={hidden.has(s.key)} isAnimationActive={animate}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

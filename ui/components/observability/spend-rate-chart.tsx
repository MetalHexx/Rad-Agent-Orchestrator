"use client";
import * as React from "react";
import { Area, AreaChart, ResponsiveContainer, XAxis, YAxis, Legend } from "recharts";
import type { ModelRatePoint } from "@/lib/observability/sessions";
import { DEFAULT_SHOWN_KEYS, visibleSeriesKeys } from "@/lib/observability/spend-rate";
import { niceAxis } from "@/lib/observability/chart-scale";
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

  // Default total-only (FR-4): track the user's explicit opt-ins in `shown`, seeded with just
  // the `total` key. A line is visible iff its key is in `shown`, derived synchronously during
  // render (not patched by a post-paint effect) — so a model series that first appears AFTER
  // mount (async data load / SSE live-tail) is hidden on its very first frame and never flashes
  // in before being hidden. Opt-ins survive live-tail ticks because `shown` only changes on a
  // legend click (FR-7).
  const [shown, setShown] = React.useState<Set<string>>(() => new Set(DEFAULT_SHOWN_KEYS));
  const toggle = React.useCallback((key: string) => {
    setShown((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  // Fit the Y-axis to the currently visible series (FR-5, FR-3) via niceAxis: a tight, Grafana-style
  // ceiling (the data peak plus a little padding — not a coarse round-up) with nice integer gridlines,
  // so lines nearly fill the panel and an empty/idle window reads 0,1,2,3,4 instead of "0 0 1 1 1".
  const visibleKeys = visibleSeriesKeys(series, shown);
  const dataMax = Math.max(0, ...data.flatMap((p) => visibleKeys.map((k) => (p[k] as number) ?? 0)));
  const { max: yMax, ticks: yTicks } = niceAxis(dataMax, AXIS_TICKS);

  const xTicks = React.useMemo(
    () => Array.from({ length: AXIS_TICKS }, (_, i) => Math.round(rangeStart + (i * (rangeEnd - rangeStart)) / (AXIS_TICKS - 1))),
    [rangeStart, rangeEnd]
  );

  // Explicit legend payload so the greyed (inactive) state and token colors are deterministic,
  // independent of recharts' auto-derivation from the Line children (DD-3, AD-4).
  const legendPayload = series.map((s) => ({
    value: s.label, dataKey: s.key, type: "line" as const,
    color: `var(${s.cssVar})`, inactive: !shown.has(s.key),
  }));

  return (
    <div className="rounded-xl bg-card ring-1 ring-foreground/10 p-[var(--space-4)]">
      <h2 className="flex items-center gap-2 text-sm font-medium text-foreground mb-2">{title}<FilteredBadge active={filtered} /></h2>
      <div className="h-40">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            {/* One gradient per series, keyed to its color token — the original chart's hard
                line over a soft vertical fade (0.85 → 0.32 → 0), restored across all series. */}
            <defs>
              {series.map((s) => (
                <linearGradient key={s.key} id={`spend-fill-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={`var(${s.cssVar})`} stopOpacity={0.85} />
                  <stop offset="55%" stopColor={`var(${s.cssVar})`} stopOpacity={0.32} />
                  <stop offset="100%" stopColor={`var(${s.cssVar})`} stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>
            <XAxis
              dataKey="t" type="number" domain={[rangeStart, rangeEnd]} scale="time"
              allowDataOverflow={true}
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
              <Area
                key={s.key} type="monotone" dataKey={s.key} name={s.label}
                stroke={`var(${s.cssVar})`} strokeWidth={2} dot={false}
                fill={`url(#spend-fill-${s.key})`}
                hide={!shown.has(s.key)} isAnimationActive={animate}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

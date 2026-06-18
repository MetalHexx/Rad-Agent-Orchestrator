"use client";

import * as React from "react";
import { useObservabilityLive } from "@/hooks/use-observability-live";
import { ActivityDot } from "@/components/observability/activity-dot";

function useNow(intervalMs: number): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function formatAgo(ms: number): string {
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ago`;
}

export function ObservabilityView() {
  const { rows } = useObservabilityLive();
  const now = useNow(1000);

  const latestMs = React.useMemo(() => {
    let max = 0;
    for (const row of rows.values()) {
      const t = Date.parse(row.timestamp);
      if (t > max) max = t;
    }
    return max;
  }, [rows]);

  const msSinceActivity = latestMs > 0 ? now - latestMs : Infinity;

  return (
    <main id="main-content" className="mx-auto w-full max-w-screen-2xl px-6 py-6">
      <header className="flex items-end justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-xl font-semibold text-foreground">All Sessions</h1>
          <p className="text-sm text-muted-foreground">System-wide token usage</p>
        </div>
        {latestMs > 0 && (
          <div className="flex items-center gap-1.5 pb-0.5">
            <ActivityDot msSinceActivity={msSinceActivity} />
            <span className="text-xs text-muted-foreground">updated {formatAgo(msSinceActivity)}</span>
          </div>
        )}
      </header>

      {/* summary cards — P02-T02 */}
      {/* total rate chart — P02-T03 */}
      {/* control bar — P03-T01 */}
      {/* session table — P03-T02 */}
    </main>
  );
}

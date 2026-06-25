"use client";
import { useEffect, useState } from "react";
import type { SavedSession } from "@rad-orchestration/telemetry";
import { ObservabilitySubHeader } from "@/components/observability/observability-sub-header";
import { ViewSwitcher } from "@/components/observability/view-switcher";
import { SavedRow } from "@/components/observability/saved-row";
import { listSaved } from "@/lib/observability/saved-client";

export function SavedView() {
  const [saved, setSaved] = useState<SavedSession[]>([]);
  const reload = () => listSaved().then(setSaved);
  useEffect(() => { reload(); }, []);
  return (
    <>
      <ObservabilitySubHeader
        title="Saved Benchmarks"
        subtitle="Sacred runs kept for comparison"
        ariaLabel="Saved benchmarks"
        leading={<ViewSwitcher active="saved" savedCount={saved.length} />}
        onRefresh={reload}
        onHelp={() => {}}
      />
      <main id="main-content" className="px-6 py-[var(--space-4)] space-y-[var(--space-4)]">
        {saved.length === 0 ? (
          <div className="rounded-xl bg-card ring-1 ring-foreground/10 p-10 text-center text-muted-foreground">
            No saved benchmarks yet. Star a session to keep it here. {/* DD-9 */}
          </div>
        ) : (
          <div className="rounded-xl bg-card ring-1 ring-foreground/10 overflow-x-auto">
            {saved.map((s) => <SavedRow key={s.sessionId} session={s} />)}
          </div>
        )}
      </main>
    </>
  );
}

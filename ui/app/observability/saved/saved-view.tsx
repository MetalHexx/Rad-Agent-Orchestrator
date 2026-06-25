"use client";
import { useCallback, useEffect, useState } from "react";
import type { SavedSession } from "@rad-orchestration/telemetry";
import { ObservabilitySubHeader } from "@/components/observability/observability-sub-header";
import { ViewSwitcher } from "@/components/observability/view-switcher";
import { SavedRow } from "@/components/observability/saved-row";
import { ComparisonModal } from "@/components/observability/comparison-modal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { listSaved, unsaveSession } from "@/lib/observability/saved-client";
import { toggleSelection, selectedCount, canCompare, type SelectionState } from "@/lib/observability/selection";

const EMPTY_SELECTION: SelectionState = { baseline: null, candidate: null };

export function SavedView() {
  const [saved, setSaved] = useState<SavedSession[]>([]);
  const [selection, setSelection] = useState<SelectionState>(EMPTY_SELECTION);
  const [compareModal, setCompareModal] = useState<{ baseline: SavedSession; candidate: SavedSession } | null>(null);
  const reload = () => listSaved().then(setSaved);
  useEffect(() => { reload(); }, []);

  const handleSelect = useCallback((sessionId: string) => {
    setSelection((prev) => toggleSelection(prev, sessionId));
  }, []);

  const clearSelection = useCallback(() => setSelection(EMPTY_SELECTION), []);

  const count = selectedCount(selection);
  const compareEnabled = canCompare(selection);

  const handleCompare = useCallback(() => {
    if (!compareEnabled || !selection.baseline || !selection.candidate) return;
    const baseline = saved.find((s) => s.sessionId === selection.baseline);
    const candidate = saved.find((s) => s.sessionId === selection.candidate);
    if (baseline && candidate) {
      setCompareModal({ baseline, candidate });
    }
  }, [compareEnabled, selection, saved]);

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
            {saved.map((s) => {
              const isBaseline = selection.baseline === s.sessionId;
              const isCandidate = selection.candidate === s.sessionId;
              const isSelected = isBaseline || isCandidate;
              return (
                <div key={s.sessionId} className="relative">
                  {isBaseline && (
                    <span className="absolute left-12 top-1/2 -translate-y-1/2 z-10 pointer-events-none">
                      <Badge variant="accent">BASELINE</Badge>
                    </span>
                  )}
                  <SavedRow
                    session={s}
                    selected={isSelected}
                    onSelect={() => handleSelect(s.sessionId)}
                    onRenamed={(updated) =>
                      setSaved((prev) => prev.map((x) => (x.sessionId === updated.sessionId ? updated : x)))
                    }
                    onUnsave={(id) => { unsaveSession(id).then((ok) => { if (ok) reload(); }); }}
                  />
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Comparison modal — opens when Compare fires with two selected sessions (FR-7) */}
      {compareModal && (
        <ComparisonModal
          baseline={compareModal.baseline}
          candidate={compareModal.candidate}
          onClose={() => setCompareModal(null)}
        />
      )}

      {/* Sticky Compare bar — only visible when at least one row is selected (FR-6) */}
      {count > 0 && (
        <div
          aria-label="Compare bar"
          className="fixed bottom-0 left-0 right-0 z-50 flex items-center justify-between gap-4 border-t border-[color:var(--live)]/30 bg-card/95 px-6 py-3 backdrop-blur-sm"
        >
          <span className="text-sm text-muted-foreground">
            {count === 1 ? "1 session selected" : `${count} sessions selected`}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={clearSelection}>
              Clear
            </Button>
            <Button
              size="sm"
              disabled={!compareEnabled}
              className="bg-[color:var(--live)] text-white hover:bg-[color:var(--live)]/90 disabled:opacity-40"
              onClick={handleCompare}
            >
              {`Compare (${count}) →`}
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

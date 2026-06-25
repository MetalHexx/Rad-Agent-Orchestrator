"use client";
import { useState } from "react";
import type { SavedSession } from "@rad-orchestration/telemetry";
import { ModalShell } from "@/components/modal/modal-shell";
import { ComparisonReport } from "./comparison-report";

export interface ComparisonModalProps { baseline: SavedSession; candidate: SavedSession; onClose: () => void; }

/** Modal is only the frame; ComparisonReport is portable. No onShare → only Maximize + Close render (DD-6, AD-8). */
export function ComparisonModal({ baseline, candidate, onClose }: ComparisonModalProps) {
  const [full, setFull] = useState(false);
  return (
    <ModalShell
      ariaLabel="Benchmark comparison"
      title="Benchmark Comparison"
      onClose={onClose}
      isFullScreen={full}
      onToggleFullScreen={() => setFull((v) => !v)}
    >
      <div className="h-full overflow-auto p-6">
        <ComparisonReport baseline={baseline} candidate={candidate} />
      </div>
    </ModalShell>
  );
}

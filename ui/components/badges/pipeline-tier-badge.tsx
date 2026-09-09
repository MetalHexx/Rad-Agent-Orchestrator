"use client";

import { SpinnerBadge } from "./spinner-badge";
import { STATE_PRESENTATION } from "./project-state-presentation";
import type { ProjectState } from "@/types/components";

interface PipelineTierBadgeProps {
  /** The canonical project state — drives colour and spinner via `STATE_PRESENTATION`. */
  state: ProjectState;
  /** The visible label, handed in by the caller — never reconstructed here. */
  label: string;
}

/** A pure renderer: the label is data it's handed, never a word it computes. */
export function PipelineTierBadge({ state, label }: PipelineTierBadgeProps) {
  const { cssVar, isSpinning } = STATE_PRESENTATION[state];
  const ariaLabel = isSpinning
    ? `Pipeline status: ${label}, active`
    : `Pipeline status: ${label}`;

  return (
    <SpinnerBadge
      label={label}
      cssVar={cssVar}
      isSpinning={isSpinning}
      ariaLabel={ariaLabel}
    />
  );
}

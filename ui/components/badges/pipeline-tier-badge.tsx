"use client";

import { SpinnerBadge } from "./spinner-badge";
import { PENDING_REVIEW_LABEL, PENDING_REVIEW_CSS_VAR } from "./pending-review";
import type { PipelineTier, PlanningStatus, ExecutionStatus } from "@/types/state";

interface PipelineTierBadgeProps {
  tier: PipelineTier | "not_initialized";
  planningStatus?: PlanningStatus;   // NEW — drives "Planning" (spinner) vs "Planned" (dot)
  executionStatus?: ExecutionStatus; // NEW — drives "Executing" (spinner) vs "Execution" (dot)
}

const TIER_CONFIG = {
  planning: { label: "Planning", cssVar: "--tier-planning" },
  // label is never used directly for execution — resolveBadgeState() sets it explicitly per sub-status
  execution: { label: "Approved", cssVar: "--tier-execution" },
  review: { label: PENDING_REVIEW_LABEL, cssVar: "--tier-review" },
  complete: { label: "Complete", cssVar: "--tier-complete" },
  halted: { label: "Halted", cssVar: "--tier-halted" },
  not_initialized: { label: "Not Initialized", cssVar: "--tier-not-initialized" },
} satisfies Record<PipelineTier | "not_initialized", { label: string; cssVar: string }>;

function resolveBadgeState(
  tier: PipelineTier | "not_initialized",
  planningStatus: PlanningStatus | undefined,
  executionStatus: ExecutionStatus | undefined,
): { label: string; ariaLabel: string; isSpinning: boolean; cssVar: string } {
  const base = TIER_CONFIG[tier];
  let cssVar = base.cssVar;

  let label: string;
  let isSpinning: boolean;

  if (tier === "planning") {
    if (planningStatus === "in_progress") {
      label = "Planning";
      isSpinning = true;
    } else if (planningStatus === "complete") {
      label = "Planned";
      isSpinning = false;
    } else if (planningStatus === "not_started") {
      label = "Not Started";
      isSpinning = false;
    } else {
      // undefined planningStatus → backward-compat default
      label = "Planning";
      isSpinning = false;
    }
  } else if (tier === "execution") {
    if (executionStatus === "halted") {
      label = "Halted";
      cssVar = "--tier-halted";
      isSpinning = false;
    } else if (executionStatus === "in_progress") {
      label = "Executing";
      isSpinning = true;
    } else {
      // not_started, complete, or undefined → queued state awaiting a person
      label = PENDING_REVIEW_LABEL;
      cssVar = PENDING_REVIEW_CSS_VAR;
      isSpinning = false;
    }
  } else if (tier === "review") {
    if (executionStatus === "halted") {
      label = "Halted";
      cssVar = "--tier-halted";
      isSpinning = false;
    } else if (executionStatus === "in_progress") {
      label = "Executing";
      cssVar = "--tier-execution";
      isSpinning = true; // corrective in flight
    } else {
      label = PENDING_REVIEW_LABEL;
      isSpinning = false; // parked at the gate
    }
  } else {
    label = base.label;
    isSpinning = false;
  }

  const ariaLabel = isSpinning
    ? `Pipeline status: ${label}, active`
    : `Pipeline status: ${label}`;

  return { label, ariaLabel, isSpinning, cssVar };
}

export function PipelineTierBadge({ tier, planningStatus, executionStatus }: PipelineTierBadgeProps) {
  const { label, ariaLabel, isSpinning, cssVar } = resolveBadgeState(tier, planningStatus, executionStatus);

  return (
    <SpinnerBadge
      label={label}
      cssVar={cssVar}
      isSpinning={isSpinning}
      ariaLabel={ariaLabel}
    />
  );
}

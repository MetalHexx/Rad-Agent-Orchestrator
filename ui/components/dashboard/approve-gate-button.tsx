"use client";

import React from "react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useApprovalWizard } from "@/hooks/use-approval-wizard";
import { cn } from "@/lib/utils";
import type { GateEvent } from "@/types/state";

export interface ApproveGateButtonProps {
  /** The pipeline gate event to fire: 'plan_approved' or 'final_approved'. */
  gateEvent: GateEvent;
  /** The project name (used in the API URL path). */
  projectName: string;
  /** Display name of the document being approved (e.g., "UI-HUMAN-GATE-CONTROLS-MASTER-PLAN.md"). */
  documentName: string;
  /** Button label text (e.g., "Approve Plan" or "Approve Final Review"). */
  label: string;
  /** Optional additional CSS classes for the wrapper element. */
  className?: string;
  /**
   * Optional override of the inner Button's tabIndex. When set to -1, the
   * button is removed from the page-level Tab order while remaining
   * mouse-clickable and reachable via assistive-technology virtual cursor.
   * Defaults to undefined — existing call sites render identically to today.
   */
  tabIndex?: number;
  /**
   * House Button visual weight. Defaults to `"default"` (the filled primary
   * used by the timeline and standalone dashboard). The dag-widget cards pass
   * `"outline"` so Approve matches the card's other outline+icon controls.
   */
  variant?: "default" | "outline" | "secondary";
  /**
   * Optional leading icon (e.g. a `Check`) shown before the label when idle.
   * Omit for the icon-less default.
   */
  icon?: LucideIcon;
  /**
   * CSS custom property (e.g. `--verdict-approved`) tinting the leading icon.
   * Omit to inherit the button's own foreground color.
   */
  iconCssVar?: string;
}

/**
 * The Approve trigger, and nothing more.
 *
 * It owns no dialog, no request, and no pending state: clicking it hands the
 * gate to `ApprovalWizardProvider`, which renders the wizard above every
 * live-state-driven subtree. That split is deliberate. This button is rendered
 * by dag-widget state views that the pipeline can swap out at any moment — a
 * successful final approval replaces `finalReviewView` with `completeView`
 * outright — so anything this component owned would be destroyed by the very
 * approval it just performed. Caller-side conditional rendering (`{gatePending
 * && <ApproveGateButton/>}`) is therefore safe again, and correct: a resolved
 * gate should stop offering Approve, and unmounting the trigger no longer
 * takes a dialog down with it.
 */
export const ApproveGateButton = React.forwardRef<
  HTMLButtonElement,
  ApproveGateButtonProps
>(function ApproveGateButton(
  { gateEvent, projectName, documentName, label, className, tabIndex, variant = "default", icon: Icon, iconCssVar },
  ref,
) {
  const { openApprovalWizard } = useApprovalWizard();

  return (
    <div className={className}>
      <Button
        ref={ref}
        variant={variant}
        size="sm"
        className={cn(variant === "default" && "w-full sm:w-auto")}
        tabIndex={tabIndex}
        onClick={() => openApprovalWizard({ gateEvent, projectName, documentName })}
      >
        {Icon && (
          <Icon
            style={iconCssVar ? { color: `var(${iconCssVar})` } : undefined}
            aria-hidden="true"
          />
        )}
        {label}
      </Button>
    </div>
  );
});
ApproveGateButton.displayName = "ApproveGateButton";

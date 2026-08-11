"use client";

import * as React from "react";
import type { NodeStatus } from '@/types/state';
import { SpinnerBadge } from '@/components/badges';
import { STATUS_MAP } from './node-status-map';

export { STATUS_MAP } from './node-status-map';
export type { StatusMapEntry } from './node-status-map';

interface NodeStatusBadgeProps {
  status: NodeStatus;
  label?: string;
  /**
   * Optional cssVar override (FR-1, AD-4, DD-1). When supplied, the
   * badge fill / text / icon all resolve against this token instead
   * of the default `STATUS_MAP[status].cssVar`. Used by callers that
   * have already resolved the stage-aware tier token (e.g. via
   * `resolveStageBadge`) and want the row to render in tier color.
   * Omitting it preserves the pre-stage-aware default behavior.
   */
  cssVar?: string;
  /** When true, suppresses visible label text on the badge — used by the compact row treatment (DD-1). */
  iconOnly?: boolean;
  /**
   * Optional custom icon node (AD-9, DD-5). When supplied, replaces the
   * default complete/rejected/spinner icon in SpinnerBadge. Forwarded
   * directly to SpinnerBadge's icon prop. Omitting it preserves existing
   * check/x/spinner behavior.
   */
  icon?: React.ReactNode;
  /** Optional isSpinning override. When supplied, wins over
   *  STATUS_MAP[status].isSpinning — used by resting states that are in flight
   *  but not active work (a gate awaiting a person). Omitting it preserves
   *  the STATUS_MAP-driven default. */
  isSpinning?: boolean;
}

export const NodeStatusBadge = React.forwardRef<HTMLSpanElement, NodeStatusBadgeProps>(
  function NodeStatusBadge({ status, label, cssVar, iconOnly, icon, isSpinning }, ref) {
    const entry = STATUS_MAP[status];
    const resolvedLabel = label ?? entry.defaultLabel;
    const resolvedCssVar = cssVar ?? entry.cssVar;
    return (
      <SpinnerBadge
        ref={ref}
        label={resolvedLabel}
        cssVar={resolvedCssVar}
        isSpinning={isSpinning ?? entry.isSpinning}
        isComplete={entry.isComplete}
        isRejected={entry.isRejected}
        icon={icon}
        ariaLabel={resolvedLabel}
        hideLabel={iconOnly}
      />
    );
  },
);

NodeStatusBadge.displayName = "NodeStatusBadge";

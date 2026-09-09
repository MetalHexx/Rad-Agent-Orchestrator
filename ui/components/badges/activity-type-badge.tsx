"use client";

import * as React from "react";
import { SpinnerBadge } from "./spinner-badge";

interface ActivityTypeConfig {
  label: string;
  cssVar: string;
}

// Eleven session-journey activity types sharing six hues by deliberate
// design: `brainstorming`/`requirements`/`master-plan` all read as
// planning-tier work, and `amend` draws the additive teal (mirroring
// AmendmentBadge's `provenance` variant) rather than `corrective`'s
// changes-requested tint, so an amendment never reads as remedial. Do not
// "tidy" either pairing.
const ACTIVITY_TYPE_CONFIG: Record<string, ActivityTypeConfig> = {
  brainstorming: { label: "brainstorming", cssVar: "--tier-planning" },
  requirements: { label: "requirements", cssVar: "--tier-planning" },
  "master-plan": { label: "master-plan", cssVar: "--tier-planning" },
  amend: { label: "amend", cssVar: "--model-teal" },
  execution: { label: "execution", cssVar: "--tier-execution" },
  other: { label: "other", cssVar: "--status-not-started" },
  "execution-complete": { label: "execution-complete", cssVar: "--status-complete" },
  "final-approved": { label: "final-approved", cssVar: "--verdict-approved" },
  "final-rejected": { label: "final-rejected", cssVar: "--verdict-rejected" },
  halted: { label: "halted", cssVar: "--status-halted" },
  corrective: { label: "corrective", cssVar: "--verdict-changes-requested" },
};

/**
 * Renders a session-journey activity type as a plain token-coloured pill —
 * composed from `SpinnerBadge` (`isSpinning=false`, no icon) rather than
 * restating its `color-mix` treatment locally. `type` is a plain `string` at
 * the call site (not a closed union), so an unrecognised value falls back to
 * the `other` entry rather than throwing.
 */
export function ActivityTypeBadge({ type }: { type: string }): React.ReactElement {
  const config = ACTIVITY_TYPE_CONFIG[type] ?? ACTIVITY_TYPE_CONFIG.other;
  return <SpinnerBadge label={config.label} cssVar={config.cssVar} isSpinning={false} />;
}

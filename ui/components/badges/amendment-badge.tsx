"use client";

import { Badge } from "@/components/ui/badge";

interface AmendmentBadgeProps {
  index: number;
}

/**
 * Marks a phase or task iteration introduced by a project amendment. Uses the
 * `provenance` variant (teal, drawn from `--model-teal`) so it reads distinctly
 * from the corrective group's failure-tinted treatment (`--status-failed` /
 * `--color-warning`) — an amendment is additive, not remedial. `--live` is
 * shared with the dashboard's unrelated live-indicator badges (`BASELINE`,
 * `Filtered`), so this badge draws on a variant of its own rather than
 * borrowing theirs.
 */
export function AmendmentBadge({ index }: AmendmentBadgeProps) {
  return (
    <Badge variant="provenance" aria-label={`Amendment ${index}`}>
      Amendment {index}
    </Badge>
  );
}

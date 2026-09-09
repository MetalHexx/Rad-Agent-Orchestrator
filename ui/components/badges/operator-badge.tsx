"use client";

import { Badge } from "@/components/ui/badge";

/**
 * Marks a corrective task entry the operator requested directly (e.g. at the
 * final-approval gate), distinct from the common case: a corrective a
 * reviewer's `changes_requested` verdict gave birth to, which carries no
 * `origin` at all. Shares AmendmentBadge's teal variant — both are
 * provenance markers, not failure indicators.
 */
export function OperatorBadge() {
  return (
    <Badge variant="provenance" aria-label="Operator-requested corrective">
      Operator
    </Badge>
  );
}

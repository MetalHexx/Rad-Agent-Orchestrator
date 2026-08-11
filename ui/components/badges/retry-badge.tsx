"use client";

import { Badge } from "@/components/ui/badge";

interface RetryBadgeProps {
  attempt: number;
  max: number;
}

export function RetryBadge({ attempt, max }: RetryBadgeProps) {
  return (
    <Badge
      variant="secondary"
      aria-label={`Retry attempt ${attempt} of ${max}`}
    >
      Retry {attempt}/{max}
    </Badge>
  );
}

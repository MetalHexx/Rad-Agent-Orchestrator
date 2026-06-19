import * as React from "react";
import { Filter } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export function FilteredBadge({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <Badge variant="accent"><Filter data-icon="inline-start" />Filtered</Badge>
  );
}

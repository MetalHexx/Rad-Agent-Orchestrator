import * as React from 'react';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface InspectAgentButtonProps {
  onClick: () => void;
}

// Persistently visible magnifying-glass that opens the Agent Inspector (FR-3, AD-7, DD-7).
// No opacity-0 / group-hover reveal — always shown on eligible rows.
// Accent color via --chart-2 on hover (DD-7).
export function InspectAgentButton({ onClick }: InspectAgentButtonProps) {
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label="Inspect agent"
      title="Inspect agent"
      onClick={onClick}
      className="text-muted-foreground hover:text-[var(--chart-2)]"
    >
      <Search aria-hidden="true" />
    </Button>
  );
}

import * as React from 'react';
import { MessageSquare, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface SeamLinksProps { kind: 'main' | 'subagent'; }

// Disabled per-agent placeholders (FR-7), hover-revealed. Accessible names live on the button so
// screen readers reach them even while visually hidden (NFR-6). Native title doubles as the tooltip.
export function SeamLinks({ kind }: SeamLinksProps) {
  const transcript = kind === 'main'
    ? 'Main chat transcript — ships in TELEMETRY-8'
    : 'Agent transcript — ships in TELEMETRY-8';
  const tools = 'Tool calls — coming in a later iteration';
  return (
    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-70 transition-opacity">
      <Button variant="ghost" size="icon-xs" disabled aria-disabled aria-label={transcript} title={transcript} className="text-muted-foreground cursor-not-allowed">
        <MessageSquare aria-hidden="true" />
      </Button>
      <Button variant="ghost" size="icon-xs" disabled aria-disabled aria-label={tools} title={tools} className="text-muted-foreground cursor-not-allowed">
        <Wrench aria-hidden="true" />
      </Button>
    </div>
  );
}

"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// AgentNavigatorStrip — horizontally-scrollable row of agent-name chips (FR-14, DD-5, DD-7, NFR-5)
//
// Renders one chip per agent in props order (page-supplied Breakdown order, FR-14).
// The active chip carries the --chart-2 accent ring and aria-current="true" (NFR-5).
// Edge scroll chevrons with gradient fades allow keyboard-free scrolling (DD-5).
// No hardcoded hex — uses house tokens only (NFR-4).
// ---------------------------------------------------------------------------

export interface AgentChip {
  transcriptId: string;
  label: string;
  role: 'main' | 'subagent';
}

export interface AgentNavigatorStripProps {
  agents: AgentChip[];
  activeId: string | null;
  onSelect: (transcriptId: string) => void;
}

export function AgentNavigatorStrip({ agents, activeId, onSelect }: AgentNavigatorStripProps) {
  const scrollRef = React.useRef<HTMLDivElement>(null);

  const scroll = (direction: 'left' | 'right') => {
    scrollRef.current?.scrollBy({ left: direction === 'left' ? -120 : 120, behavior: 'smooth' });
  };

  return (
    <div className="relative flex shrink-0 items-center border-t border-border bg-card">
      {/* Left edge gradient fade + chevron */}
      <div className="pointer-events-none absolute left-0 top-0 z-10 h-full w-8 bg-gradient-to-r from-card to-transparent" aria-hidden="true" />
      <button
        type="button"
        aria-label="Scroll agents left"
        onClick={() => scroll('left')}
        className="relative z-20 flex shrink-0 items-center justify-center px-1 py-2 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
      </button>

      {/* Scrollable chip row */}
      <div
        ref={scrollRef}
        className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto px-1 py-2 scrollbar-none"
        style={{ scrollbarWidth: 'none' }}
      >
        {agents.map((agent) => {
          const isActive = agent.transcriptId === activeId;
          return (
            <button
              key={agent.transcriptId}
              type="button"
              aria-current={isActive ? "true" : undefined}
              onClick={() => onSelect(agent.transcriptId)}
              className={cn(
                "inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isActive
                  ? "bg-muted text-foreground ring-1 ring-[var(--chart-2)]"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {agent.label}
            </button>
          );
        })}
      </div>

      {/* Right edge gradient fade + chevron */}
      <button
        type="button"
        aria-label="Scroll agents right"
        onClick={() => scroll('right')}
        className="relative z-20 flex shrink-0 items-center justify-center px-1 py-2 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronRight className="size-4" aria-hidden="true" />
      </button>
      <div className="pointer-events-none absolute right-0 top-0 z-10 h-full w-8 bg-gradient-to-l from-card to-transparent" aria-hidden="true" />
    </div>
  );
}

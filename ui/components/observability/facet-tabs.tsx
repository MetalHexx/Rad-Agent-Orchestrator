"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// FacetTabs — tab bar for the Agent Inspector modal (FR-13, DD-3, DD-7, NFR-5)
//
// Only the Raw facet is active; the other four render dimmed with a "soon" pill
// and aria-disabled to signal upcoming availability to assistive technology.
// Accent underline uses the --chart-2 house token (DD-7, NFR-4).
// ---------------------------------------------------------------------------

export type FacetId = 'overview' | 'transcript' | 'tools' | 'files' | 'raw';

export interface FacetTabsProps {
  active: FacetId;
  onSelect: (facet: FacetId) => void;
}

interface FacetMeta {
  id: FacetId;
  label: string;
  available: boolean;
}

const FACETS: FacetMeta[] = [
  { id: 'overview',   label: 'Overview',   available: true  },
  { id: 'transcript', label: 'Transcript', available: false },
  { id: 'tools',      label: 'Tools',      available: false },
  { id: 'files',      label: 'Files',      available: false },
  { id: 'raw',        label: 'Raw',        available: true  },
];

export function FacetTabs({ active, onSelect }: FacetTabsProps) {
  return (
    <div
      role="tablist"
      aria-label="Inspector facets"
      className="flex shrink-0 items-center gap-0 border-b border-border bg-card px-4"
    >
      {FACETS.map((facet) => {
        const isActive = facet.id === active && facet.available;

        if (!facet.available) {
          return (
            <span
              key={facet.id}
              role="tab"
              aria-disabled="true"
              aria-selected="false"
              className="relative flex cursor-not-allowed items-center gap-1.5 px-3 py-2.5 text-sm text-muted-foreground opacity-50 select-none"
            >
              {facet.label}
              <span className="rounded bg-muted px-1 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                soon
              </span>
            </span>
          );
        }

        return (
          <button
            key={facet.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onSelect(facet.id)}
            className={cn(
              "relative flex items-center px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              isActive
                ? "text-foreground after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-[var(--chart-2)]"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {facet.label}
          </button>
        );
      })}
    </div>
  );
}

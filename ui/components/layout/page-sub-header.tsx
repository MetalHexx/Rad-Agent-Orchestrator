"use client";
import * as React from 'react';

export interface PageSubHeaderProps {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  left?: React.ReactNode;     // overrides title/subtitle when provided
  actions?: React.ReactNode;  // right-region cluster
  ariaLabel?: string;
}

/** Generic, view-agnostic sub-header band: chrome + left/right region layout only. No domain
 *  knowledge and — unlike AppHeaderShell — no context providers (AD-7, DD-3). */
export function PageSubHeader({ title, subtitle, left, actions, ariaLabel }: PageSubHeaderProps) {
  return (
    <header aria-label={ariaLabel} className="border-b border-border px-6 py-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3 shrink-0">
          {left ?? (
            <>
              {title != null && <h1 className="text-lg font-semibold">{title}</h1>}
              {subtitle != null && <span className="text-sm text-muted-foreground">{subtitle}</span>}
            </>
          )}
        </div>
        {actions != null && (
          <div className="flex flex-wrap items-center gap-[var(--space-4)] sm:ml-auto">{actions}</div>
        )}
      </div>
    </header>
  );
}

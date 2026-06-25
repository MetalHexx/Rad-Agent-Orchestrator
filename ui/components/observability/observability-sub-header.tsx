"use client";
import * as React from 'react';
import { ActivityIndicator } from './activity-indicator';
import { TimeRangePicker } from '@/components/time-range/time-range-picker';
import { Button } from '@/components/ui/button';
import { RotateCcw } from 'lucide-react';
import { PageSubHeader } from '@/components/layout/page-sub-header';
import type { TimeRange } from '@/lib/time-range/range';

export interface ObservabilitySubHeaderProps {
  title: React.ReactNode;
  subtitle: React.ReactNode;
  ariaLabel: string;
  msSinceActivity?: number | null;   // null → indicator hidden (no system activity on All-Sessions)
  range?: TimeRange;
  onRangeChange?: (r: TimeRange) => void;
  rangeMin?: number;
  rangeMax?: number;
  scopeLabel?: string;
  onRefresh: () => void;
  onHelp: () => void;
  filters?: React.ReactNode;        // slot — All-Sessions passes the two FilterSelects; Detail omits
  leading?: React.ReactNode;        // slot — Detail passes a BackButton before the title; All-Sessions omits
  onResetRange?: () => void;
  actions?: React.ReactNode; // detail-view extras (e.g. the save star), placed before Refresh (DD-2)
}

/** Observability-specific header: composes the generic PageSubHeader, supplying the title and the
 *  activity → picker → [filters] → refresh → help cluster. Filters via slot, not a fork (AD-7, FR-4, DD-4). */
export function ObservabilitySubHeader(props: ObservabilitySubHeaderProps) {
  const actions = (
    <>
      {props.msSinceActivity != null && <ActivityIndicator msSinceActivity={props.msSinceActivity} />}
      {props.range && (
        <TimeRangePicker value={props.range} onChange={props.onRangeChange!}
          min={props.rangeMin!} max={props.rangeMax!} scopeLabel={props.scopeLabel!} />
      )}
      {props.onResetRange && (
        <Button variant="outline" size="sm" aria-label="Fit time range to session" onClick={props.onResetRange}>
          <RotateCcw /> Fit to session
        </Button>
      )}
      {props.filters}
      {props.actions}
      <Button variant="outline" size="icon" aria-label="Refresh now" onClick={props.onRefresh}>↻</Button>
      <Button variant="outline" size="icon" aria-label="Help" onClick={props.onHelp}>?</Button>
    </>
  );
  return (
    <PageSubHeader ariaLabel={props.ariaLabel} title={props.title} subtitle={props.subtitle} leading={props.leading} actions={actions} />
  );
}

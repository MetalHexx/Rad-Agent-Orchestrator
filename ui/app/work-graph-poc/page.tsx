'use client';

import dynamic from 'next/dynamic';
import { useState, useEffect, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { WorkGraphToolbar } from '@/components/work-graph/work-graph-toolbar';
import { useWorkGraph } from '@/hooks/use-work-graph';
import { buildWorkGraphView, resolveEnabledEdgeTypes } from '@/lib/work-graph-view';
import type { StartFrom, EdgeTypeKey } from '@/types/work-graph';

const WorkGraphCanvas = dynamic(
  () => import('@/components/work-graph/work-graph-canvas').then(m => ({ default: m.WorkGraphCanvas })),
  { ssr: false },
);

const FILTER_DEBOUNCE_MS = 250;

function resolveStartFrom(raw: string | null): StartFrom {
  return raw === 'newest' ? 'newest' : 'oldest';
}

export default function WorkGraphPocPage(): JSX.Element {
  const searchParams = useSearchParams();
  const router = useRouter();

  const scope = searchParams.get('group') ?? 'all';
  const startFrom = resolveStartFrom(searchParams.get('start'));
  const urlFilter = searchParams.get('q') ?? '';
  const rawEdges = searchParams.get('edges');
  // Memoized on the raw URL value, not recomputed fresh every render — the page
  // re-renders on every keystroke via `filterText`, and a new array identity
  // here would defeat the canvas's own useMemo, putting layout back on the
  // keystroke path the filter debounce exists to keep it off.
  const enabledEdgeTypes = useMemo(() => resolveEnabledEdgeTypes(rawEdges), [rawEdges]);

  const [filterText, setFilterText] = useState(urlFilter);
  const [debouncedFilter, setDebouncedFilter] = useState(urlFilter);

  // The URL's `q` can change from outside typing — a reload or a browser
  // back/forward navigation. Re-sync local state to it so the input and the
  // canvas both follow history, not just the debounce path below.
  useEffect(() => {
    setFilterText(urlFilter);
    setDebouncedFilter(urlFilter);
  }, [urlFilter]);

  // Debounce keystrokes before they reach the canvas or the URL — this is
  // what keeps dagre off the keystroke path and the history from filling
  // with one entry per character.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedFilter(filterText), FILTER_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [filterText]);

  useEffect(() => {
    const url = new URL(window.location.href);
    const currentQ = url.searchParams.get('q') ?? '';
    if (currentQ === debouncedFilter) return;
    if (debouncedFilter) url.searchParams.set('q', debouncedFilter);
    else url.searchParams.delete('q');
    router.replace(`${url.pathname}${url.search}`, { scroll: false });
  }, [debouncedFilter, router]);

  const { data, status, errorMessage } = useWorkGraph(scope);

  // The count for the assistive-tech announcement below must match what the
  // canvas actually draws, not a raw substring-match count — a keyword match
  // pulls in one hop of relationship context (see buildWorkGraphView), so a
  // match with non-matching neighbors draws more nodes than it matches.
  // Reusing the same pure transform the canvas runs is what keeps the two in
  // lockstep instead of drifting apart as two independent computations.
  const filteredProjectCount = useMemo(() => {
    if (!data) return 0;
    const view = buildWorkGraphView(data, { filter: debouncedFilter, scope, enabledEdgeTypes });
    return view.nodes.filter((node) => node.type === 'workGraphProject').length;
  }, [data, debouncedFilter, scope, enabledEdgeTypes]);

  function handleScopeChange(next: string): void {
    const url = new URL(window.location.href);
    if (next === 'all') url.searchParams.delete('group');
    else url.searchParams.set('group', next);
    router.replace(`${url.pathname}${url.search}`, { scroll: false });
  }

  function handleStartFromChange(next: StartFrom): void {
    const url = new URL(window.location.href);
    if (next === 'oldest') url.searchParams.delete('start');
    else url.searchParams.set('start', next);
    router.replace(`${url.pathname}${url.search}`, { scroll: false });
  }

  function handleEdgeTypesChange(next: EdgeTypeKey[]): void {
    const url = new URL(window.location.href);
    const isDefault = next.length === 1 && next[0] === 'follows';
    if (isDefault) url.searchParams.delete('edges');
    else url.searchParams.set('edges', next.join(','));
    router.replace(`${url.pathname}${url.search}`, { scroll: false });
  }

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)]">
      <main id="main-content" className="flex-1 flex flex-col overflow-hidden">
        <WorkGraphToolbar
          groups={data?.groups ?? []}
          scope={scope}
          startFrom={startFrom}
          filterText={filterText}
          danglingEdgeCount={data?.danglingEdgeCount ?? 0}
          enabledEdgeTypes={enabledEdgeTypes}
          onScopeChange={handleScopeChange}
          onStartFromChange={handleStartFromChange}
          onFilterTextChange={setFilterText}
          onEdgeTypesChange={handleEdgeTypesChange}
        />

        {/* Filtering redraws the canvas without a navigation, so announce the
            result count — otherwise the change is silent to a screen reader. */}
        <div role="status" aria-live="polite" className="sr-only">
          {status === 'loaded' &&
            `${filteredProjectCount} project${filteredProjectCount === 1 ? '' : 's'} shown`}
        </div>

        {status === 'loading' && (
          <div className="flex-1 flex items-center justify-center" role="status" aria-live="polite">
            <svg
              className="animate-spin h-5 w-5 mr-2 text-[var(--muted-foreground)]"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
            <span>Loading work graph…</span>
          </div>
        )}

        {status === 'error' && (
          <div className="flex-1 flex items-center justify-center" role="alert">
            <span className="text-[var(--destructive)]">{errorMessage}</span>
          </div>
        )}

        {status === 'loaded' && data && (
          <WorkGraphCanvas
            graph={data}
            scope={scope}
            filter={debouncedFilter}
            startFrom={startFrom}
            enabledEdgeTypes={enabledEdgeTypes}
          />
        )}
      </main>
    </div>
  );
}

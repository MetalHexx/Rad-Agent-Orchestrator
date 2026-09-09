'use client';

import { useId } from 'react';
import { Input } from '@/components/ui/input';
import { edgeTypeStrokeColor } from '@/lib/work-graph-view';
import type { StartFrom, EdgeTypeKey } from '@/types/work-graph';

interface WorkGraphToolbarProps {
  groups: { id: string; name: string }[];
  scope: string;
  startFrom: StartFrom;
  /** Raw input value, not the debounced one. */
  filterText: string;
  danglingEdgeCount: number;
  enabledEdgeTypes: EdgeTypeKey[];
  onScopeChange: (scope: string) => void;
  onStartFromChange: (value: StartFrom) => void;
  onFilterTextChange: (value: string) => void;
  onEdgeTypesChange: (value: EdgeTypeKey[]) => void;
}

/** The four edge-type rows, always rendered in this order regardless of which
 *  types the current view actually contains — this control doubles as the
 *  type→visual legend from P02-T02, so listing the full vocabulary keeps it
 *  from reflowing as scope changes. `dashed` mirrors each type's typical
 *  ranking status purely for the legend swatch. */
const EDGE_TYPE_ROWS: { key: EdgeTypeKey; label: string; dashed: boolean }[] = [
  { key: 'follows', label: 'Follows', dashed: false },
  { key: 'depends-on', label: 'Depends on', dashed: false },
  { key: 'spawned-from', label: 'Spawned from', dashed: true },
  { key: 'other', label: 'Other', dashed: true },
];

/**
 * Toolbar strip beneath the app header: Group scope, Start-from order, a name
 * filter, and the edge-type visibility/legend control, plus a right-aligned
 * dangling-edge count. Fully controlled — it owns no data-fetching, URL logic,
 * or local selection state; the page owns all of it and wires every callback.
 */
export function WorkGraphToolbar({
  groups,
  scope,
  startFrom,
  filterText,
  danglingEdgeCount,
  enabledEdgeTypes,
  onScopeChange,
  onStartFromChange,
  onFilterTextChange,
  onEdgeTypesChange,
}: WorkGraphToolbarProps): JSX.Element {
  const scopeId = useId();
  const startFromId = useId();
  const filterId = useId();
  const edgeTypeBaseId = useId();

  function handleEdgeTypeToggle(key: EdgeTypeKey, checked: boolean): void {
    const next = EDGE_TYPE_ROWS.map((row) => row.key).filter((rowKey) =>
      rowKey === key ? checked : enabledEdgeTypes.includes(rowKey),
    );
    onEdgeTypesChange(next);
  }

  return (
    <div className="flex items-center gap-2 px-4 py-2 border-b border-[var(--border)]">
      <label htmlFor={scopeId} className="text-sm font-medium">Group</label>
      <select
        id={scopeId}
        value={scope}
        onChange={(e) => onScopeChange(e.target.value)}
        className="px-2 py-1 border border-[var(--border)] rounded bg-[var(--background)] text-sm"
      >
        <option value="all">All</option>
        {groups.map((group) => (
          <option key={group.id} value={group.id}>{group.name}</option>
        ))}
      </select>

      <label htmlFor={startFromId} className="text-sm font-medium">Start from</label>
      <select
        id={startFromId}
        value={startFrom}
        onChange={(e) => onStartFromChange(e.target.value as StartFrom)}
        className="px-2 py-1 border border-[var(--border)] rounded bg-[var(--background)] text-sm"
      >
        <option value="oldest">Oldest</option>
        <option value="newest">Newest</option>
      </select>

      <label htmlFor={filterId} className="text-sm font-medium">Filter</label>
      <Input
        id={filterId}
        className="h-8 w-[220px]"
        placeholder="Filter by name"
        value={filterText}
        onChange={(e) => onFilterTextChange(e.target.value)}
      />

      <fieldset className="flex items-center gap-3 border-0 p-0 m-0">
        <legend className="text-sm font-medium mr-1">Edges</legend>
        {EDGE_TYPE_ROWS.map(({ key, label, dashed }) => {
          const rowId = `${edgeTypeBaseId}-${key}`;
          return (
            <span key={key} className="flex items-center gap-1">
              <input
                type="checkbox"
                id={rowId}
                checked={enabledEdgeTypes.includes(key)}
                onChange={(e) => handleEdgeTypeToggle(key, e.target.checked)}
              />
              <span
                aria-hidden="true"
                className="inline-block w-4"
                style={{ borderTop: `2px ${dashed ? 'dashed' : 'solid'} ${edgeTypeStrokeColor(key)}` }}
              />
              <label htmlFor={rowId} className="text-sm">{label}</label>
            </span>
          );
        })}
      </fieldset>

      <span className="ml-auto text-xs text-[var(--muted-foreground)]">
        {danglingEdgeCount} dangling edge{danglingEdgeCount === 1 ? '' : 's'}
      </span>
    </div>
  );
}

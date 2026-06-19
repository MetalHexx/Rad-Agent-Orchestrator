"use client";

import * as React from "react";
import { QUICK_RANGES, type QuickRangeId } from "@/lib/observability/time-range";

// ── Refresh interval options ─────────────────────────────────────────────────
const REFRESH_OPTIONS: { label: string; ms: number }[] = [
  { label: 'Off',       ms: 0 },
  { label: '10 s',      ms: 10_000 },
  { label: '30 s',      ms: 30_000 },
  { label: '1 min',     ms: 60_000 },
  { label: '5 min',     ms: 300_000 },
];

function refreshLabel(ms: number): string {
  return REFRESH_OPTIONS.find(o => o.ms === ms)?.label ?? `${ms / 1000} s`;
}

// ── Minimal token-styled dropdown ────────────────────────────────────────────
interface DropdownItem { label: string; value: string | number; active?: boolean }
interface DropdownProps {
  trigger: React.ReactNode;
  items: DropdownItem[];
  onSelect: (value: string | number) => void;
}
function Dropdown({ trigger, items, onSelect }: DropdownProps) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          padding: 'var(--space-1) var(--space-3)',
          borderRadius: 'var(--radius-md, 6px)',
          border: '1px solid var(--border)',
          background: 'var(--background)',
          color: 'var(--foreground)',
          fontSize: '0.875rem',
          fontWeight: 500,
          cursor: 'pointer',
        }}
      >
        {trigger}
      </button>
      {open && (
        <div
          role="listbox"
          style={{
            position: 'absolute',
            top: 'calc(100% + var(--space-1))',
            left: 0,
            zIndex: 50,
            minWidth: '10rem',
            background: 'var(--popover, var(--background))',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md, 6px)',
            boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
            padding: 'var(--space-1) 0',
          }}
        >
          {items.map(item => (
            <div
              key={item.value}
              role="option"
              aria-selected={item.active}
              onClick={() => { onSelect(item.value); setOpen(false); }}
              style={{
                padding: 'var(--space-2) var(--space-3)',
                fontSize: '0.875rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
                background: item.active ? 'var(--muted)' : 'transparent',
                color: 'var(--foreground)',
              }}
            >
              {item.active && <span aria-hidden="true">✓</span>}
              {item.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── ControlBarProps ──────────────────────────────────────────────────────────
export interface ControlBarProps {
  /** Active quick-range ID. */
  rangeId: QuickRangeId;
  onRange: (id: QuickRangeId) => void;

  /** Auto-refresh interval in ms; 0 = off. */
  refreshMs: number;
  onRefreshMs: (ms: number) => void;
  /** Fires immediately to trigger a data reload. */
  onRefreshNow: () => void;

  /** All unique worktree paths seen in rows. */
  worktrees: string[];
  /** Currently selected worktree filter; "All" means no filter. */
  worktree: string;
  onWorktree: (value: string) => void;

  /** All unique session IDs seen in filtered rows. */
  sessions: string[];
  /** Currently selected session filter; "All" means no filter. */
  session: string;
  onSession: (value: string) => void;

  /** Fires when the user clicks the Help button. */
  onHelp: () => void;
}

/**
 * Control bar — Grafana-style time-range + refresh cluster, filters, Help (FR-1, FR-2, FR-6, FR-8, NFR-2, NFR-4, AD-4, DD-9, DD-10).
 *
 * Layout: [TimeRange pill] [Refresh cluster]  |  [Worktree] [Session]  ...  [Help?]
 * Wraps responsively via flex-wrap.
 */
export function ControlBar({
  rangeId,
  onRange,
  refreshMs,
  onRefreshMs,
  onRefreshNow,
  worktrees,
  worktree,
  onWorktree,
  sessions,
  session,
  onSession,
  onHelp,
}: ControlBarProps) {
  const activeRange = QUICK_RANGES.find(r => r.id === rangeId) ?? QUICK_RANGES[3];
  const isAutoRefresh = refreshMs > 0;

  return (
    <div
      className="flex flex-wrap items-center"
      style={{
        gap: 'var(--space-4)',
        padding: 'var(--space-3)',
        borderRadius: 'var(--radius-lg, 8px)',
        background: 'var(--card)',
        boxShadow: '0 0 0 1px color-mix(in srgb, var(--foreground) 10%, transparent)',
      }}
    >
      {/* ── Time-range pill ────────────────────────────────────────────── */}
      <Dropdown
        trigger={activeRange.label}
        items={QUICK_RANGES.map(r => ({ label: r.label, value: r.id, active: r.id === rangeId }))}
        onSelect={v => onRange(v as QuickRangeId)}
      />

      {/* ── Refresh cluster: now-button + auto interval pill ───────────── */}
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        {/* Refresh now */}
        <button
          type="button"
          aria-label="Refresh now"
          onClick={onRefreshNow}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 'var(--space-6)',
            height: 'var(--space-6)',
            borderRadius: 'var(--radius-md, 6px)',
            border: '1px solid var(--border)',
            background: 'var(--background)',
            color: 'var(--foreground)',
            cursor: 'pointer',
            fontSize: '1rem',
          }}
        >
          ↻
        </button>

        {/* Auto-refresh interval pill */}
        <Dropdown
          trigger={
            <span>
              {isAutoRefresh ? (
                <>Auto · {refreshLabel(refreshMs)}</>
              ) : (
                <>Auto · Off</>
              )}
            </span>
          }
          items={REFRESH_OPTIONS.map(o => ({ label: o.label, value: o.ms, active: o.ms === refreshMs }))}
          onSelect={v => onRefreshMs(v as number)}
        />
      </div>

      {/* ── Divider ────────────────────────────────────────────────────── */}
      <div
        aria-hidden="true"
        style={{
          width: '1px',
          height: 'var(--space-4)',
          background: 'var(--border)',
        }}
      />

      {/* ── Worktree filter ────────────────────────────────────────────── */}
      <label
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          fontSize: '0.875rem',
          color: 'var(--muted-foreground)',
        }}
      >
        Worktree
        <select
          style={{
            borderRadius: 'var(--radius-md, 6px)',
            border: '1px solid var(--border)',
            background: 'var(--background)',
            padding: 'var(--space-1) var(--space-2)',
            fontSize: '0.875rem',
            color: 'var(--foreground)',
          }}
          value={worktree}
          onChange={(e) => onWorktree(e.target.value)}
        >
          <option value="All">All</option>
          {worktrees.map((wt) => (
            <option key={wt} value={wt}>
              {wt || 'unknown'}
            </option>
          ))}
        </select>
      </label>

      {/* ── Session filter ─────────────────────────────────────────────── */}
      <label
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          fontSize: '0.875rem',
          color: 'var(--muted-foreground)',
        }}
      >
        Session
        <select
          style={{
            borderRadius: 'var(--radius-md, 6px)',
            border: '1px solid var(--border)',
            background: 'var(--background)',
            padding: 'var(--space-1) var(--space-2)',
            fontSize: '0.875rem',
            color: 'var(--foreground)',
          }}
          value={session}
          onChange={(e) => onSession(e.target.value)}
        >
          <option value="All">All</option>
          {sessions.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
      </label>

      {/* ── Spacer pushes Help to far right ────────────────────────────── */}
      <div style={{ flex: 1 }} />

      {/* ── Help button ────────────────────────────────────────────────── */}
      <button
        type="button"
        aria-label="Help"
        onClick={onHelp}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 'var(--space-6)',
          height: 'var(--space-6)',
          borderRadius: 'var(--radius-md, 6px)',
          border: '1px solid transparent',
          background: 'transparent',
          color: 'var(--foreground)',
          cursor: 'pointer',
          fontSize: '0.875rem',
          fontWeight: 600,
        }}
      >
        ?
      </button>
    </div>
  );
}

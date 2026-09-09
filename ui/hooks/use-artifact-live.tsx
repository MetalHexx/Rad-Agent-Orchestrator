"use client";

import * as React from "react";
import { deriveArtifacts, type Artifact } from "@/lib/artifact-model";
import { emptyLiveState, applyDelta, clearUnseenFor, endPulseFor, type LiveState } from "@/lib/live/live-store-model";
import { fetchArtifactSnapshot, reconcileUnseen, diffSnapshots } from "@/lib/live/snapshot";
import { useSSEContext } from "@/hooks/use-sse-context";
import type { SSEEvent } from "@/types/events";

// How long a file stays in activePulse after the LAST change lands. Spans ~2 cycles
// of the 1.4s CSS breathe so an isolated change pulses clearly (not a single missable
// flash); each new change re-arms this timer below, extending the pulse while writes
// continue, then it clears so the indicator is bounded — never indefinite.
const MIN_PULSE_MS = 2600;

// How a snapshot refresh treats the result:
//   'baseline'  — initial mount / project switch: record state, NEVER diff/pulse.
//   'live'      — an artifact_change event landed: diff vs the baseline and pulse.
//   'reconcile' — reconnect self-heal: prune the unseen set, no pulse.
type RefreshMode = 'baseline' | 'live' | 'reconcile';

interface ArtifactLiveValue {
  artifacts: Artifact[];
  unseen: Set<string>;
  activePulse: Set<string>;
  /** Per-file modification times from the latest snapshot. Monotonic per file, so
   *  the viewer can reload the open HTML doc on every change — including a repeat
   *  inside the pulse-settle window the pulse edge alone misses (BUG 2). */
  mtimes: Record<string, number>;
  degraded: boolean;
  markActive: (fileName: string | null) => void;
  /** Requirements-doc frontmatter status from the latest snapshot — carried
   *  live so the Planning docs list's Draft pill clears on the next
   *  `artifact_change` refresh instead of a one-time fetch going stale. */
  requirementsStatus: string | null;
  /** Owner-guarded file list from the latest snapshot — the single source the
   *  modal's document list is built from. Empty while a switched-to project's
   *  own snapshot is still in flight. */
  files: string[];
  /** True once the CURRENT project's first snapshot has settled, success or
   *  failure. Falsy for a project whose snapshot hasn't landed yet, so the
   *  owner pairing gives the project-change reset for free. */
  snapshotLoaded: boolean;
  /** Force an immediate snapshot refresh — for a user-initiated change that
   *  must not wait on the filesystem watcher. */
  refresh: () => void;
}

export const defaultArtifactLiveValue: ArtifactLiveValue = {
  artifacts: [],
  unseen: new Set(),
  activePulse: new Set(),
  mtimes: {},
  degraded: false,
  markActive: () => {},
  requirementsStatus: null,
  files: [],
  snapshotLoaded: false,
  refresh: () => {},
};

export const ArtifactLiveContext = React.createContext<ArtifactLiveValue>(defaultArtifactLiveValue);

export function ArtifactLiveProvider({
  projectName,
  activeFileName,
  hasTimeline,
  children,
}: {
  projectName: string | null;
  activeFileName: string | null;
  /** True when the project has a parsed pipeline state (v5/v6); pins
   *  Requirements/Master Plan into this list instead of the (retired)
   *  DAG-timeline Planning rendering. */
  hasTimeline: boolean;
  children: React.ReactNode;
}) {
  // Owner-paired snapshot state: `files`/`mtimes`/`requirementsStatus` all
  // live and reset together, keyed to the project that fetched them. Derived
  // during render — the same synchronous guard the page's old `fileList` had —
  // so the instant `projectName` changes, every derived field below goes
  // empty/unloaded in that same render, with no window where an outgoing
  // project's snapshot could leak into the incoming one.
  const [owned, setOwned] = React.useState<{
    owner: string;
    files: string[];
    mtimes: Record<string, number>;
    requirementsStatus: string | null;
    loaded: boolean;
  } | null>(null);
  const isOwner = owned?.owner === projectName;
  const files = isOwner ? owned.files : [];
  const mtimes = isOwner ? owned.mtimes : {};
  const requirementsStatus = isOwner ? owned.requirementsStatus : null;
  const snapshotLoaded = isOwner && owned.loaded;

  const [live, setLive] = React.useState<LiveState>(emptyLiveState);
  const [degraded, setDegraded] = React.useState(false);
  const activeRef = React.useRef<string | null>(activeFileName);
  activeRef.current = activeFileName;
  // Tracks the project currently mounted so an in-flight refresh that resolves AFTER
  // a project switch can detect it's stale and bail (prevents cross-project diffing).
  const projectNameRef = React.useRef<string | null>(projectName);
  projectNameRef.current = projectName;

  // Live deltas now ride the single shared multiplexed EventSource via the SSE
  // provider rather than this provider opening its own connection (AD-11 fallback
  // retired): one tab holds exactly one /api/events stream.
  const { subscribe, sseStatus } = useSSEContext();

  const prevFilesRef = React.useRef<string[] | null>(null);
  const prevMtimesRef = React.useRef<Record<string, number>>({});
  // Monotonic per-fetch id: only the LATEST issued refresh may land (see refreshSnapshot).
  const requestIdRef = React.useRef(0);
  const pulseTimersRef = React.useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const applyChange = React.useCallback((fileName: string, kind: 'added' | 'changed' | 'removed') => {
    setLive((s) => applyDelta(s, { fileName, kind, activeFileName: activeRef.current }));
    const timers = pulseTimersRef.current;
    const existing = timers.get(fileName);
    if (existing) clearTimeout(existing);
    if (kind === 'removed') { timers.delete(fileName); return; }
    const timer = setTimeout(() => {
      timers.delete(fileName);
      setLive((s) => endPulseFor(s, fileName));
    }, MIN_PULSE_MS);
    timers.set(fileName, timer);
  }, []);

  const refreshSnapshot = React.useCallback(async (mode: RefreshMode) => {
    if (!projectName) return;
    const requestId = ++requestIdRef.current;
    const snap = await fetchArtifactSnapshot(projectName);

    // A newer project took over while this fetch was in flight. Bail before touching
    // any state: never store this project's files as the now-current project's diff
    // baseline, and never diff one project's snapshot against another's file list.
    // That cross-project mismatch — concurrent /files fetches resolving interleaved
    // during a project switch — is what falsely pulsed/badged every doc on switch.
    if (projectName !== projectNameRef.current) return;

    // A LATER refresh for this same project has already been issued. The owner check
    // above cannot see this one: on an A→B→A return, the first (never-cancelled) A
    // request's captured name still equals the current one, so if it resolves after
    // the second A request it would overwrite a fresher snapshot and diff baseline
    // with stale files. Only a per-fetch id can tell those two apart.
    if (requestId !== requestIdRef.current) return;

    // Record the current owner's snapshot. A failed fetch (cold start, transient 5xx,
    // aborted request) resolves to an EMPTY snapshot, so it must never overwrite a
    // payload this project already loaded — a blip would otherwise blank every tile
    // and the open doc. With no prior data for this project, that empty result is
    // still committed with `loaded: true` so the UI reveals instead of hanging on a
    // skeleton forever. Either way the diff-baseline guard just below still holds: a
    // failed fetch never becomes `prevFilesRef`, since storing [] there would make
    // the next successful snapshot diff every file as `added`.
    setOwned((prev) => {
      if (!snap.ok && prev?.owner === projectName && prev.loaded) return prev;
      return { owner: projectName, files: snap.files, mtimes: snap.mtimes, requirementsStatus: snap.requirementsStatus, loaded: true };
    });

    if (!snap.ok) return;

    // Only a 'live' refresh (an artifact_change event landed for THIS project) may
    // pulse. The initial 'baseline' snapshot just records state, so visiting or
    // switching a project never lights up its docs. 'reconcile' never diffs either.
    const prevFiles = prevFilesRef.current;
    if (mode === 'live' && prevFiles !== null) {
      for (const c of diffSnapshots(prevFiles, prevMtimesRef.current, snap.files, snap.mtimes)) {
        applyChange(c.fileName, c.kind);
      }
    }
    prevFilesRef.current = snap.files;
    prevMtimesRef.current = snap.mtimes;

    if (mode === 'reconcile') setLive((s) => ({ ...s, unseen: reconcileUnseen(s.unseen, snap.files) }));
  }, [projectName, applyChange]);

  // On project change: reset the diff baseline and take an initial snapshot.
  // `owned` itself needs no explicit reset here — the render-time owner
  // comparison above already stops matching the instant `projectName` changes,
  // which is what keeps this a synchronous guard rather than an effect-driven
  // one (an effect would leave a one-render window where the outgoing
  // project's files/mtimes still read as current).
  React.useEffect(() => {
    if (!projectName) {
      setLive(emptyLiveState());
      prevFilesRef.current = null; prevMtimesRef.current = {};
      return;
    }
    prevFilesRef.current = null;
    prevMtimesRef.current = {};
    void refreshSnapshot('baseline');
  }, [projectName, refreshSnapshot]);

  // Subscribe to the shared provider for live deltas. Where the old code held its
  // own EventSource and parsed raw MessageEvents, the provider now delivers parsed
  // SSEEvents; we filter artifact_change to the active project and forward
  // live_degraded — byte-for-byte the same reconcile/setDegraded behavior.
  React.useEffect(() => {
    if (!projectName) return;
    return subscribe((ev: SSEEvent) => {
      if (ev.type === "artifact_change") {
        const payload = ev.payload as { projectName: string; kind: 'added' | 'changed' | 'removed' };
        if (payload.projectName !== projectName) return;
        void refreshSnapshot('live');
      } else if (ev.type === "live_degraded") {
        const payload = ev.payload as { degraded: boolean };
        setDegraded(payload.degraded);
      }
    });
  }, [projectName, subscribe, refreshSnapshot]);

  // Reconnect self-heal: when the shared connection DROPS (reconnecting/disconnected)
  // after having been live, reconcile the unseen set against a fresh snapshot — a
  // 'reconcile' refresh, which prunes unseen but never diffs/pulses. The shared
  // provider initializes sseStatus to "disconnected" before its first onopen, so we
  // gate on having-connected-once: without this guard the effect would fire a
  // redundant reconcile on EVERY project select (before the connection opens),
  // doubling up on the project-change effect's initial 'baseline' refresh.
  // hasConnectedRef flips true on the first "connected" and stays true, so every
  // genuine post-connect drop still self-heals.
  const hasConnectedRef = React.useRef(false);
  React.useEffect(() => {
    if (sseStatus === "connected") { hasConnectedRef.current = true; return; }
    if (!projectName) return;
    if (!hasConnectedRef.current) return; // ignore the initial pre-connect "disconnected"
    if (sseStatus === "reconnecting" || sseStatus === "disconnected") {
      void refreshSnapshot('reconcile');
    }
  }, [projectName, sseStatus, refreshSnapshot]);

  React.useEffect(() => {
    const timers = pulseTimersRef.current;
    return () => { for (const t of timers.values()) clearTimeout(t); timers.clear(); };
  }, []);

  const markActive = React.useCallback((fileName: string | null) => {
    if (!fileName) return;
    setLive((s) => clearUnseenFor(s, fileName));
  }, []);

  // Imperative refresh for a user-initiated change (e.g. a delete) that must
  // not wait on the filesystem watcher's SSE round-trip. 'live' so it still
  // diffs and clears the deleted file rather than silently re-baselining.
  const refresh = React.useCallback(() => { void refreshSnapshot('live'); }, [refreshSnapshot]);

  const artifacts = React.useMemo(
    () => (projectName ? deriveArtifacts(projectName, files, hasTimeline) : []),
    [projectName, files, hasTimeline],
  );

  const value = React.useMemo<ArtifactLiveValue>(
    () => ({
      artifacts,
      unseen: live.unseen,
      activePulse: live.activePulse,
      mtimes,
      degraded,
      markActive,
      requirementsStatus,
      files,
      snapshotLoaded,
      refresh,
    }),
    [artifacts, live.unseen, live.activePulse, mtimes, degraded, markActive, requirementsStatus, files, snapshotLoaded, refresh],
  );

  return <ArtifactLiveContext.Provider value={value}>{children}</ArtifactLiveContext.Provider>;
}

export function useArtifactLive(): ArtifactLiveValue {
  return React.useContext(ArtifactLiveContext);
}

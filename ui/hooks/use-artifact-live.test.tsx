import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  ArtifactLiveContext,
  ArtifactLiveProvider,
  useArtifactLive,
  defaultArtifactLiveValue,
} from './use-artifact-live';

test('exports the context, provider, hook, and default value (AD-8)', () => {
  assert.notEqual(ArtifactLiveContext, undefined);
  assert.equal(typeof ArtifactLiveProvider, 'function');
  assert.equal(typeof useArtifactLive, 'function');
});

test('default value exposes artifacts, unseen, activePulse, degraded, and markActive (FR-8, AD-9)', () => {
  assert.ok(Array.isArray(defaultArtifactLiveValue.artifacts));
  assert.ok(defaultArtifactLiveValue.unseen instanceof Set);
  assert.ok(defaultArtifactLiveValue.activePulse instanceof Set);
  assert.equal(defaultArtifactLiveValue.degraded, false);
  assert.equal(typeof defaultArtifactLiveValue.markActive, 'function');
  assert.equal(defaultArtifactLiveValue.requirementsStatus, null);
});

test('default value exposes the owner-paired snapshot fields (files, snapshotLoaded, refresh) (P01-T01)', () => {
  assert.ok(Array.isArray(defaultArtifactLiveValue.files));
  assert.equal(defaultArtifactLiveValue.files.length, 0);
  assert.equal(defaultArtifactLiveValue.snapshotLoaded, false);
  assert.equal(typeof defaultArtifactLiveValue.refresh, 'function');
});

test('refreshSnapshot threads requirementsStatus from the snapshot into owner-paired state (P01-T01)', () => {
  const src = readFileSync(path.join(process.cwd(), 'hooks', 'use-artifact-live.tsx'), 'utf-8');
  const refreshIdx = src.indexOf('const refreshSnapshot = React.useCallback');
  const refreshBody = src.slice(refreshIdx, src.indexOf('}, [', refreshIdx));
  assert.ok(
    /setOwned\([\s\S]*requirementsStatus:\s*snap\.requirementsStatus[\s\S]*loaded:\s*true/.test(refreshBody),
    'refreshSnapshot commits requirementsStatus (paired with files/mtimes/loaded) from the fetched snapshot',
  );
  assert.ok(
    /requirementsStatus/.test(src.match(/const value = React\.useMemo[\s\S]*?\[[^\]]*\]\s*,?\s*\);/)?.[0] ?? ''),
    'requirementsStatus is exposed on the memoized context value',
  );
});

test('files/mtimes/requirementsStatus are owner-paired and derived from a single `owned` record, not independent state (P01-T01)', () => {
  const src = readFileSync(path.join(process.cwd(), 'hooks', 'use-artifact-live.tsx'), 'utf-8');
  assert.ok(/const \[owned, setOwned\] = React\.useState/.test(src), 'a single paired `owned` record backs files/mtimes/requirementsStatus/loaded');
  assert.ok(/const isOwner = owned\?\.owner === projectName/.test(src), 'ownership is a synchronous render-time comparison, not an effect-driven reset');
  assert.ok(!/const \[files, setFiles\] = React\.useState/.test(src), 'files is no longer its own independent useState');
  assert.ok(!/const \[mtimes, setMtimes\] = React\.useState/.test(src), 'mtimes is no longer its own independent useState');
  assert.ok(!/const \[requirementsStatus, setRequirementsStatus\] = React\.useState/.test(src), 'requirementsStatus is no longer its own independent useState');
});

test('the owned write is bracketed by the stale-project bail and the !snap.ok bail, so a settled failure still reveals the UI (P01-T01)', () => {
  const src = readFileSync(path.join(process.cwd(), 'hooks', 'use-artifact-live.tsx'), 'utf-8');
  const refreshIdx = src.indexOf('const refreshSnapshot = React.useCallback');
  const refreshBody = src.slice(refreshIdx, src.indexOf('}, [', refreshIdx));
  const staleGuardIdx = refreshBody.search(/projectName\s*!==\s*projectNameRef\.current/);
  const ownedWriteIdx = refreshBody.indexOf('setOwned(');
  const okGuardIdx = refreshBody.indexOf('if (!snap.ok) return;');
  assert.ok(staleGuardIdx >= 0 && ownedWriteIdx >= 0 && staleGuardIdx < ownedWriteIdx,
    'the stale-project bail precedes the owned-state write, so a stale response never records loaded for the wrong project');
  assert.ok(/loaded:\s*true/.test(refreshBody), 'the owned record is written with loaded: true');
  assert.ok(okGuardIdx >= 0 && ownedWriteIdx < okGuardIdx,
    'the owned write (and its loaded: true) happens BEFORE the !snap.ok bail, so a failed fetch still settles snapshotLoaded');
});

test('refresh() is a stable callback that issues a live refresh, not a silent re-baseline (P01-T01)', () => {
  const src = readFileSync(path.join(process.cwd(), 'hooks', 'use-artifact-live.tsx'), 'utf-8');
  assert.ok(
    /const refresh = React\.useCallback\(\(\) => \{ void refreshSnapshot\(['"]live['"]\); \}, \[refreshSnapshot\]\)/.test(src),
    "refresh() calls refreshSnapshot('live') so a delete still diffs and clears rather than re-baselining",
  );
});

test('provider is a Context provider with no new state-management dependency (NFR-9, AD-11)', () => {
  const src = readFileSync(path.join(process.cwd(), 'hooks', 'use-artifact-live.tsx'), 'utf-8');
  assert.ok(src.includes('createContext'), 'uses React Context idiom');
  assert.ok(!/from ['"](zustand|redux|jotai|recoil|valtio)['"]/.test(src), 'no new state library imported');
  assert.ok(src.includes('useSSEContext'), 'rides the shared SSE provider, not its own connection (single connection per tab)');
  assert.ok(!src.includes('new EventSource('), 'constructs no raw EventSource of its own');
  assert.ok(src.includes('fetchArtifactSnapshot'), 'snapshots over REST on connect');
});

test('the artifact_change path feeds live deltas into the store via snapshot diffing (FR-8, FR-9)', () => {
  const src = readFileSync(path.join(process.cwd(), 'hooks', 'use-artifact-live.tsx'), 'utf-8');
  assert.ok(src.includes('diffSnapshots'), 'derives per-file changes by diffing successive snapshots');
  assert.ok(!/void\s+applyChange/.test(src), 'applyChange is wired, not silenced with void');
  assert.ok(!/void\s+setOwned/.test(src), 'setOwned is wired, not silenced with void');
  assert.ok(/applyChange\s*\(/.test(src), 'applyChange is actually invoked');
});

test('reconnect self-heal is gated on a prior connection, not the initial disconnected state (no double-fetch per select)', () => {
  const src = readFileSync(path.join(process.cwd(), 'hooks', 'use-artifact-live.tsx'), 'utf-8');
  // The shared provider starts sseStatus = "disconnected" before its first onopen.
  // The self-heal effect must guard on having-connected-once so it does NOT fire a
  // redundant refreshSnapshot(true) on every project select on top of the
  // project-change effect's refreshSnapshot(false).
  assert.ok(/hasConnectedRef/.test(src), 'self-heal tracks whether the connection has ever opened');
  assert.ok(
    /sseStatus\s*===\s*["']connected["']/.test(src),
    'the guard flips true on the first "connected" status',
  );
  assert.ok(
    /if\s*\(\s*!hasConnectedRef\.current\s*\)\s*return/.test(src),
    'the self-heal bails out while the connection has never opened (ignores initial "disconnected")',
  );
});

test('the active pulse settles via endPulseFor on a timer (FR-6)', () => {
  const src = readFileSync(path.join(process.cwd(), 'hooks', 'use-artifact-live.tsx'), 'utf-8');
  assert.ok(src.includes('endPulseFor'), 'imports and uses the pulse-clear reducer');
  assert.ok(/setTimeout/.test(src), 'schedules a settle timer to clear the pulse');
});

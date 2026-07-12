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

test('refreshSnapshot threads requirementsStatus from the snapshot into context state', () => {
  const src = readFileSync(path.join(process.cwd(), 'hooks', 'use-artifact-live.tsx'), 'utf-8');
  assert.ok(/setRequirementsStatus\(snap\.requirementsStatus\)/.test(src), 'refreshSnapshot sets requirementsStatus from the fetched snapshot');
  assert.ok(/requirementsStatus/.test(src.match(/const value = React\.useMemo[\s\S]*?\[[^\]]*\]\s*,?\s*\);/)?.[0] ?? ''), 'requirementsStatus is exposed on the memoized context value');
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
  assert.ok(!/void\s+setMtimes/.test(src), 'setMtimes is wired, not silenced with void');
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

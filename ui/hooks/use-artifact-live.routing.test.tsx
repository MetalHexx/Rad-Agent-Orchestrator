import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// Pins the rules that keep the doc list from falsely pulsing/badging on load and on
// project switches. The pulse/badge is driven by diffSnapshots() inside
// refreshSnapshot(); it must fire ONLY for a genuine artifact_change on the project
// you're currently viewing — never for the initial/baseline snapshot, never for a
// failed fetch, and never by diffing one project's snapshot against another's baseline
// (the cross-project race that lit up every doc when switching projects). Don't revert
// to gating the diff on `prevFiles !== null` alone.

const src = readFileSync(path.join(process.cwd(), 'hooks', 'use-artifact-live.tsx'), 'utf-8');

const refreshIdx = src.indexOf('const refreshSnapshot = React.useCallback');
// Slice from the declaration to the end of its dependency array so the assertions
// inspect only the refreshSnapshot body.
const refreshBody = src.slice(refreshIdx, src.indexOf('}, [', refreshIdx));

test('refreshSnapshot takes an explicit mode and only a live refresh may diff/pulse', () => {
  assert.ok(refreshIdx >= 0, 'refreshSnapshot is defined with useCallback');
  assert.ok(
    /async\s*\(\s*mode\s*:\s*RefreshMode\s*\)/.test(refreshBody),
    'refreshSnapshot is parameterized by an explicit RefreshMode, not a bare boolean',
  );
  assert.ok(
    /mode\s*===\s*['"]live['"]/.test(refreshBody),
    "the diff is gated on mode === 'live' so the baseline snapshot never pulses",
  );
  assert.ok(
    refreshBody.includes('diffSnapshots'),
    'a live refresh still derives per-file changes via diffSnapshots',
  );
});

test('refreshSnapshot bails when the project changed mid-flight (no cross-project diff)', () => {
  assert.ok(
    /projectName\s*!==\s*projectNameRef\.current/.test(refreshBody),
    'an in-flight refresh that resolves after a project switch must bail before touching state',
  );
  // The bail must come before the baseline write, so it cannot clobber the new project's baseline.
  const staleIdx = refreshBody.search(/projectName\s*!==\s*projectNameRef\.current/);
  const baselineWriteIdx = refreshBody.indexOf('prevFilesRef.current = snap.files');
  assert.ok(
    staleIdx >= 0 && baselineWriteIdx >= 0 && staleIdx < baselineWriteIdx,
    'the stale-project guard precedes the baseline write',
  );
});

test('refreshSnapshot refuses to baseline a failed fetch', () => {
  assert.ok(
    /if\s*\(\s*!snap\.ok\s*\)\s*return/.test(refreshBody),
    'a failed snapshot (ok === false) bails so an empty file list never becomes the diff baseline',
  );
});

test('the project-change effect takes a baseline snapshot (never a diffing one)', () => {
  assert.ok(
    /refreshSnapshot\(\s*['"]baseline['"]\s*\)/.test(src),
    "selecting/switching a project calls refreshSnapshot('baseline'), which never pulses",
  );
  assert.ok(
    /refreshSnapshot\(\s*['"]live['"]\s*\)/.test(src),
    "the artifact_change handler calls refreshSnapshot('live')",
  );
  assert.ok(
    !/refreshSnapshot\(\s*(true|false)\s*\)/.test(src),
    'no caller uses the old boolean signature',
  );
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mergePreambleHook, reconcileTelemetryHooks, removeTelemetryHooks }
  from '../../lib/install/claude-hook-settings.js';

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tel-hooks-')), 'settings.json');
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

test('fresh install adds 3 marked events; PostToolUse carries matcher Agent (FR-1, AD-7)', () => {
  const p = tmp();
  reconcileTelemetryHooks({ settingsPath: p, hookCommand: 'node "shim"' });
  const s = read(p);
  for (const ev of ['PostToolUse', 'Stop', 'SessionEnd']) {
    assert.ok(s.hooks[ev].some((e) => e.hooks?.[0]?.command?.includes('rad-orc-telemetry')));
  }
  assert.equal(s.hooks.PostToolUse[0].matcher, 'Agent');
});

test('re-run is idempotent and never touches the preamble (NFR-3, NFR-5)', () => {
  const p = tmp();
  mergePreambleHook({ settingsPath: p, hookCommand: 'node "preamble"' });
  reconcileTelemetryHooks({ settingsPath: p, hookCommand: 'node "shim"' });
  const once = fs.readFileSync(p, 'utf8');
  reconcileTelemetryHooks({ settingsPath: p, hookCommand: 'node "shim"' });
  assert.equal(fs.readFileSync(p, 'utf8'), once, 'no churn on re-run');
  assert.ok(read(p).hooks.SessionStart.some((e) => e.hooks[0].command.includes('rad-orc-preamble')));
});

test('partial install self-heals to the full set (NFR-5)', () => {
  const p = tmp();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify({ hooks: { Stop: [
    { hooks: [{ type: 'command', command: 'node "shim" # rad-orc-telemetry' }] }] } }));
  reconcileTelemetryHooks({ settingsPath: p, hookCommand: 'node "shim"' });
  const s = read(p);
  assert.ok(s.hooks.PostToolUse && s.hooks.SessionEnd, 'missing events filled in');
});

test('changed command refreshes in place (NFR-5)', () => {
  const p = tmp();
  reconcileTelemetryHooks({ settingsPath: p, hookCommand: 'node "old"' });
  reconcileTelemetryHooks({ settingsPath: p, hookCommand: 'node "new"' });
  const s = read(p);
  assert.equal(s.hooks.Stop.length, 1, 'no duplicate');
  assert.ok(s.hooks.Stop[0].hooks[0].command.includes('new'));
});

test('reconcile de-duplicates extra telemetry entries to a single hook per event (NFR-5)', () => {
  const p = tmp();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  // Two telemetry-marked entries for one event (manual edit / older buggy install).
  fs.writeFileSync(p, JSON.stringify({ hooks: { Stop: [
    { hooks: [{ type: 'command', command: 'node "shim" # rad-orc-telemetry' }] },
    { hooks: [{ type: 'command', command: 'node "shim" # rad-orc-telemetry' }] },
  ] } }));
  reconcileTelemetryHooks({ settingsPath: p, hookCommand: 'node "shim"' });
  const s = read(p);
  const telemetryStop = s.hooks.Stop.filter((e) => e.hooks?.[0]?.command?.includes('rad-orc-telemetry'));
  assert.equal(telemetryStop.length, 1, 'duplicate telemetry entries collapsed to one');
});

test('uninstall removes telemetry across all 3 arrays, leaves preamble (NFR-3)', () => {
  const p = tmp();
  mergePreambleHook({ settingsPath: p, hookCommand: 'node "preamble"' });
  reconcileTelemetryHooks({ settingsPath: p, hookCommand: 'node "shim"' });
  removeTelemetryHooks({ settingsPath: p });
  const s = read(p);
  assert.ok(!s.hooks.PostToolUse, 'PostToolUse cleaned');
  assert.ok(!s.hooks.Stop, 'Stop cleaned');
  assert.ok(!s.hooks.SessionEnd, 'SessionEnd cleaned');
  assert.ok(s.hooks.SessionStart.some((e) => e.hooks[0].command.includes('rad-orc-preamble')));
});

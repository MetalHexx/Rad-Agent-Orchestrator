import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getTelemetryRoot } from '../lib/path-resolver';

test('getTelemetryRoot resolves to the .radorc/telemetry base and honors RADORC_TELEMETRY_ROOT (FR-10)', () => {
  const prev = process.env.RADORC_TELEMETRY_ROOT;
  delete process.env.RADORC_TELEMETRY_ROOT;
  try {
    assert.equal(getTelemetryRoot(), path.join(os.homedir(), '.radorc', 'telemetry'));
    process.env.RADORC_TELEMETRY_ROOT = path.join('custom', 'telem');
    assert.equal(getTelemetryRoot(), path.join('custom', 'telem'));
  } finally {
    if (prev === undefined) delete process.env.RADORC_TELEMETRY_ROOT;
    else process.env.RADORC_TELEMETRY_ROOT = prev;
  }
});

test('events route starts the telemetry watcher by passing telemetryRoot (the usage/ partition dir) to getLiveRuntime (FR-10)', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(path.join(here, '..', 'app', 'api', 'events', 'route.ts'), 'utf-8');
  const call = src.match(/getLiveRuntime\(\{([\s\S]*?)\}\)/);
  assert.ok(call, 'events route must call getLiveRuntime');
  assert.match(call[1], /telemetryRoot\s*:/, 'getLiveRuntime must receive telemetryRoot, or startTelemetryWatcher is a no-op');
  assert.match(call[1], /['"]usage['"]/, 'telemetryRoot must point at the usage/ partition directory (the watcher globs telemetryRoot + *.ndjson)');
});

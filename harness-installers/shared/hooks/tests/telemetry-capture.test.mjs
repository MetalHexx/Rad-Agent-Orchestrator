import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHookEvent, toCaptureArgs, readTelemetryEnabled } from '../telemetry-capture.mjs';

test('maps a PostToolUse payload incl. nested tool_response fields (FR-3)', () => {
  const evt = parseHookEvent(JSON.stringify({
    hook_event_name: 'PostToolUse', session_id: 's1', cwd: 'c', transcript_path: 't',
    tool_name: 'Agent', tool_response: { agent_id: 'a0', agent_transcript_path: 'sub.jsonl' },
    agent_type: 'rad-orc:reviewer', tool_use_id: 'toolu_1',
  }));
  const args = toCaptureArgs(evt);
  assert.deepEqual(args.slice(0, 4), ['telemetry', 'capture', '--event', 'PostToolUse']);
  assert.ok(args.includes('--agent-id') && args[args.indexOf('--agent-id') + 1] === 'a0');
  assert.ok(args.includes('--agent-transcript-path'));
  assert.ok(args.includes('--session') && args.includes('--tool-use-id'));
});

test('unknown event normalizes to Stop (FR-3)', () => {
  assert.equal(parseHookEvent(JSON.stringify({ hook_event_name: 'Nonsense' })).event, 'Stop');
});

test('gate reader is default-off and parity-matches the CLI contract (NFR-2, FR-4)', () => {
  const r = fs.mkdtempSync(path.join(os.tmpdir(), 'shim-gate-'));
  assert.equal(readTelemetryEnabled(r), false);                                   // missing file
  fs.writeFileSync(path.join(r, 'orchestration.yml'), 'source_control:\n  auto_pr: ask\n');
  assert.equal(readTelemetryEnabled(r), false);                                   // absent key
  fs.writeFileSync(path.join(r, 'orchestration.yml'), 'telemetry:\n  enabled: true\n');
  assert.equal(readTelemetryEnabled(r), true);                                    // explicit on
  fs.writeFileSync(path.join(r, 'orchestration.yml'), 'telemetry:\n  enabled: false\n');
  assert.equal(readTelemetryEnabled(r), false);                                   // explicit off
});

test('gate-off run is an immediate no-op exit 0 (FR-4, NFR-1, DD-4)', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'shim-home-'));
  fs.writeFileSync(path.join(home, 'orchestration.yml'), 'telemetry:\n  enabled: false\n');
  const shim = fileURLToPath(new URL('../telemetry-capture.mjs', import.meta.url));
  const res = spawnSync(process.execPath, [shim], {
    input: JSON.stringify({ hook_event_name: 'Stop', session_id: 's' }),
    env: { ...process.env, HOME: home, USERPROFILE: home }, encoding: 'utf8',
  });
  assert.equal(res.status, 0, 'exits 0 even when gated off');
});

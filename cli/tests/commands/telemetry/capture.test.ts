import { describe, it, expect } from 'vitest';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { captureCore } from '../../../src/commands/telemetry/capture.js';
import type { HookEvent } from '@rad-orchestration/telemetry';

const logs: { level: string; msg: string }[] = [];
const logger = {
  info: async (msg: string) => { logs.push({ level: 'info', msg }); },
  debug: async (msg: string) => { logs.push({ level: 'debug', msg }); },
};
function transcript(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tx-'));
  const file = path.join(dir, 'session-z.jsonl');
  fs.writeFileSync(file, JSON.stringify({
    type: 'assistant', requestId: 'req_1', timestamp: '2026-06-15T12:00:00Z',
    message: { model: 'claude-opus-4-8', usage: { input_tokens: 5, output_tokens: 9 } },
  }) + '\n', 'utf8');
  return file;
}
const sig = (transcriptPath: string): HookEvent => ({ sessionId: 's1', cwd: '.', kind: 'Stop', event: 'Stop', transcriptPath });

describe('captureCore', () => {
  it('gate off ⇒ no-op, writes nothing, logs a debug line (FR-7, DD-2)', async () => {
    const telemetryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'telem-'));
    const data = await captureCore({ telemetryRoot, enabled: false, signal: sig(transcript()), now: new Date('2026-06-15T12:00:00Z'), logger });
    expect(data).toMatchObject({ enabled: false, written: 0, skipped: 0, pruned: 0 });
    expect(fs.existsSync(path.join(telemetryRoot, 'usage'))).toBe(false);
    expect(logs.some((l) => l.level === 'debug')).toBe(true);
  });

  it('gate on ⇒ captures and returns counts + sessionId (FR-1, DD-1)', async () => {
    const telemetryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'telem-'));
    const data = await captureCore({ telemetryRoot, enabled: true, signal: sig(transcript()), now: new Date('2026-06-15T12:00:00Z'), logger });
    expect(data).toMatchObject({ enabled: true, sessionId: 's1', written: 1, pruned: 0 });
    const file = path.join(telemetryRoot, 'usage', 'usage-2026-06-15-s1.ndjson');
    expect(fs.readFileSync(file, 'utf8').trim().split('\n')).toHaveLength(1);
  });

  it('swallows internal failure — resolves ok, logs telemetry_capture_failed, never throws (AD-6)', async () => {
    const telemetryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'telem-'));
    const bad = sig(path.join(telemetryRoot, 'does-not-exist', 'nope.jsonl'));
    // Force a write-path failure: make the usage dir location a file so mkdir/append throws.
    fs.writeFileSync(path.join(telemetryRoot, 'usage'), 'x', 'utf8');
    const data = await captureCore({ telemetryRoot, enabled: true, signal: bad, now: new Date(), logger });
    expect(data.enabled).toBe(true);
    expect(data.written).toBe(0);
    expect(logs.some((l) => l.msg === 'telemetry_capture_failed')).toBe(true);
  });
});

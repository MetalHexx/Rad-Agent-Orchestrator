import { describe, it, expect, beforeEach } from 'vitest';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { captureCore, dispatchBackgroundCapture, runCapture } from '../../../src/commands/telemetry/capture.js';
import type { HookEvent } from '@rad-orchestration/telemetry';

const logs: { level: string; msg: string }[] = [];
beforeEach(() => { logs.length = 0; });
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

// A spawn spy that records calls and returns a realistic child (pid + error listener
// + unref). `pid: undefined` models a failed launch; `throwOnSpawn` a sync failure.
function spawnSpy(opts?: { pid?: number; throwOnSpawn?: boolean }) {
  const calls: { cmd: string; argv: string[]; opts: Record<string, unknown> }[] = [];
  let unrefs = 0;
  const pid = opts && 'pid' in opts ? opts.pid : 4242;
  const fn = ((cmd: string, argv: string[], o: Record<string, unknown>) => {
    calls.push({ cmd, argv, opts: o });
    if (opts?.throwOnSpawn) throw new Error('spawn EMFILE');
    return { pid, on: () => {}, unref: () => { unrefs += 1; } };
  }) as never;
  return { fn, calls, unrefs: () => unrefs };
}

describe('dispatchBackgroundCapture', () => {
  it('spawns a detached/hidden/stdio-ignored worker that re-runs with a single --inline; drops empty flags', () => {
    const s = spawnSpy();
    const ok = dispatchBackgroundCapture({
      execPath: '/usr/bin/node',
      scriptPath: '/x/radorch.mjs',
      flags: { event: 'PostToolUse', session: 's1', cwd: '/c', 'transcript-path': '/t.jsonl', 'tool-name': 'Read', 'agent-id': '', inline: true },
      spawnFn: s.fn,
    });
    expect(ok).toBe(true);
    expect(s.calls).toHaveLength(1);
    const { cmd, argv, opts } = s.calls[0];
    expect(cmd).toBe('/usr/bin/node');
    expect(argv.slice(0, 3)).toEqual(['/x/radorch.mjs', 'telemetry', 'capture']);
    expect(argv).toContain('--event'); expect(argv).toContain('PostToolUse');
    expect(argv).toContain('--session'); expect(argv).toContain('s1');
    expect(argv).toContain('--cwd'); expect(argv).toContain('/c');
    expect(argv).toContain('--transcript-path'); expect(argv).toContain('/t.jsonl');
    expect(argv).toContain('--tool-name'); expect(argv).toContain('Read');
    expect(argv).not.toContain('--agent-id');                       // empty flag omitted
    expect(argv[argv.length - 1]).toBe('--inline');                 // worker forced inline
    expect(argv.filter((a) => a === '--inline')).toHaveLength(1);   // incoming inline dropped, not duplicated
    expect(opts).toMatchObject({ detached: true, windowsHide: true, stdio: 'ignore' });
    expect(s.unrefs()).toBe(1);                                     // unref'd so child outlives parent
  });

  it('returns false (and never unrefs) when the spawn yields no pid — launch failure swallowed', () => {
    const s = spawnSpy({ pid: undefined });
    const ok = dispatchBackgroundCapture({ execPath: 'node', scriptPath: 'r.mjs', flags: { event: 'PostToolUse' }, spawnFn: s.fn });
    expect(ok).toBe(false);
    expect(s.unrefs()).toBe(0);
  });

  it('returns false when the spawn throws synchronously — never propagates to the host', () => {
    const s = spawnSpy({ throwOnSpawn: true });
    const ok = dispatchBackgroundCapture({ execPath: 'node', scriptPath: 'r.mjs', flags: { event: 'PostToolUse' }, spawnFn: s.fn });
    expect(ok).toBe(false);
  });
});

describe('runCapture (inline vs detach decision)', () => {
  const ev = (transcriptPath: string, event: HookEvent['event']): HookEvent =>
    ({ sessionId: 's1', cwd: '.', kind: event, event, transcriptPath });
  const common = (s: ReturnType<typeof spawnSpy>) =>
    ({ now: new Date('2026-06-15T12:00:00Z'), logger, execPath: 'node', scriptPath: 'r.mjs', spawnFn: s.fn });

  it('gate off ⇒ no-op: no spawn, no write (never spawns a worker when telemetry is off)', async () => {
    const telemetryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'telem-'));
    const s = spawnSpy();
    const data = await runCapture({ telemetryRoot, enabled: false, signal: ev(transcript(), 'PostToolUse'), flags: { event: 'PostToolUse' }, ...common(s) });
    expect(data).toMatchObject({ enabled: false, written: 0 });
    expect(s.calls).toHaveLength(0);
    expect(fs.existsSync(path.join(telemetryRoot, 'usage'))).toBe(false);
  });

  it('PostToolUse ⇒ detaches a worker, returns dispatched, runs nothing inline (off the critical path)', async () => {
    const telemetryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'telem-'));
    const s = spawnSpy();
    const data = await runCapture({ telemetryRoot, enabled: true, signal: ev(transcript(), 'PostToolUse'), flags: { event: 'PostToolUse' }, ...common(s) });
    expect(data).toMatchObject({ enabled: true, dispatched: true, written: 0 });
    expect(s.calls).toHaveLength(1);
    expect(fs.existsSync(path.join(telemetryRoot, 'usage'))).toBe(false);   // captureCore did NOT run inline
    expect(logs.some((l) => l.msg === 'telemetry_dispatched')).toBe(true);
  });

  it('SessionEnd ⇒ runs inline (final flush must complete before exit): writes the row, no spawn', async () => {
    const telemetryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'telem-'));
    const s = spawnSpy();
    const data = await runCapture({ telemetryRoot, enabled: true, signal: ev(transcript(), 'SessionEnd'), flags: { event: 'SessionEnd' }, ...common(s) });
    expect(data).toMatchObject({ enabled: true, written: 1 });
    expect(data.dispatched).toBeUndefined();
    expect(s.calls).toHaveLength(0);
    expect(fs.existsSync(path.join(telemetryRoot, 'usage', 'usage-2026-06-15-s1.ndjson'))).toBe(true);
  });

  it('--inline forces inline even for PostToolUse (worker re-entry / manual escape hatch): writes, no spawn', async () => {
    const telemetryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'telem-'));
    const s = spawnSpy();
    const data = await runCapture({ telemetryRoot, enabled: true, signal: ev(transcript(), 'PostToolUse'), flags: { event: 'PostToolUse', inline: true }, ...common(s) });
    expect(data).toMatchObject({ enabled: true, written: 1 });
    expect(s.calls).toHaveLength(0);
  });

  it('PostToolUse with a failing dispatch ⇒ dispatched:false, logs telemetry_dispatch_failed, no inline write (no data loss — Stop catches up)', async () => {
    const telemetryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'telem-'));
    const s = spawnSpy({ pid: undefined });   // launch fails
    const data = await runCapture({ telemetryRoot, enabled: true, signal: ev(transcript(), 'PostToolUse'), flags: { event: 'PostToolUse' }, ...common(s) });
    expect(data).toMatchObject({ enabled: true, dispatched: false, written: 0 });
    expect(s.calls).toHaveLength(1);
    expect(fs.existsSync(path.join(telemetryRoot, 'usage'))).toBe(false);   // not retried inline
    expect(logs.some((l) => l.msg === 'telemetry_dispatch_failed')).toBe(true);
  });
});

import { spawn as defaultSpawn } from 'node:child_process';
import { defineCommand } from '../../framework/command.js';
import { userDataPaths } from '../../lib/paths.js';
import { readTelemetryEnabled } from './config.js';
import type { CommandContext } from '../../framework/context.js';
import {
  ClaudeCodeAdapter, FileCheckpointStore, NdjsonSink, TelemetryCollector,
  pruneAgedPartitions, ingestTranscripts, type HookEvent,
} from '@rad-orchestration/telemetry';

export interface CaptureData {
  enabled: boolean; sessionId?: string;
  written: number; skipped: number; pruned: number; locked?: boolean; error?: string;
  dispatched?: boolean;
}
interface CaptureCoreDeps {
  telemetryRoot: string; enabled: boolean; signal: HookEvent; now: Date;
  logger: { info(m: string, p?: Record<string, unknown>): Promise<void>; debug(m: string, p?: Record<string, unknown>): Promise<void> };
}

export async function captureCore(deps: CaptureCoreDeps): Promise<CaptureData> {
  const { telemetryRoot, enabled, signal, now, logger } = deps;
  if (!enabled) {
    await logger.debug('telemetry_disabled', { event: signal.event, sessionId: signal.sessionId });
    return { enabled: false, sessionId: signal.sessionId, written: 0, skipped: 0, pruned: 0 };
  }
  try {
    const collector = new TelemetryCollector(
      new ClaudeCodeAdapter(),
      new NdjsonSink({ root: telemetryRoot }),
      new FileCheckpointStore({ root: telemetryRoot }),
    );
    const res = collector.capture(signal);
    ingestTranscripts({ root: telemetryRoot, signal, now, log: (m, p) => { void logger.debug(m, p); } });
    const pruned = pruneAgedPartitions({ root: telemetryRoot, maxAgeDays: 14, now }); // FR-6 — capture owns retention
    await logger.info('telemetry_captured', { event: signal.event, sessionId: signal.sessionId, written: res.written, skipped: res.skipped, pruned, locked: res.locked });
    return { enabled: true, sessionId: signal.sessionId, written: res.written, skipped: res.skipped, pruned, locked: res.locked };
  } catch (e) {
    // AD-6 — telemetry never fails its host command: log and return a benign success payload.
    await logger.debug('telemetry_capture_failed', { event: signal.event, sessionId: signal.sessionId, error: e instanceof Error ? e.message : String(e) });
    return { enabled: true, sessionId: signal.sessionId, written: 0, skipped: 0, pruned: 0, error: 'capture_failed' };
  }
}

interface CaptureFlags {
  event?: string; session?: string; cwd?: string;
  'transcript-path'?: string; 'agent-transcript-path'?: string;
  'agent-id'?: string; 'tool-use-id'?: string; 'tool-name'?: string; 'agent-type'?: string;
  inline?: boolean;
}

export interface DispatchDeps {
  execPath: string; scriptPath: string; flags: CaptureFlags; spawnFn?: typeof defaultSpawn;
}

/**
 * Detach a background worker that re-runs this same capture with `--inline`, so the
 * synchronous hook path (shim → CLI) returns immediately instead of blocking the
 * agent for the full transcript-parse + capture. The worker runs the identical
 * `captureCore` path (lock → seen-filter → sink), so correctness/dedup are unchanged:
 * concurrent workers serialize on the per-session lock and only new usageIds are
 * ever written.
 *
 * Uses the same detached-spawn shape as commands/ui/start.ts (detached + windowsHide
 * + stdio:'ignore' + unref) so no console window pops up and the child outlives the
 * returning parent on every OS — but launches `execPath` (absolute node) directly and,
 * because telemetry must never disturb the host, swallows launch failure: a missing
 * pid or an async 'error' event is logged-by-omission (returns false) rather than
 * thrown. args go through the array form (no shell), so values with spaces or a
 * leading '-' (Windows paths, transcript paths) survive intact, and `--inline` is
 * appended exactly once (the incoming inline flag is dropped in the loop).
 *
 * @returns true if a worker was launched, false if the spawn failed.
 */
export function dispatchBackgroundCapture(deps: DispatchDeps): boolean {
  const spawnFn = deps.spawnFn ?? defaultSpawn;
  const passthrough: string[] = [];
  for (const [name, value] of Object.entries(deps.flags)) {
    if (name === 'inline') continue;                                   // the worker sets --inline itself
    if (value === undefined || value === null || value === '') continue;
    passthrough.push(`--${name}`, String(value));
  }
  try {
    const child = spawnFn(
      deps.execPath,
      [deps.scriptPath, 'telemetry', 'capture', ...passthrough, '--inline'],
      { detached: true, windowsHide: true, stdio: 'ignore' },
    );
    child.on('error', () => { /* never let a detached-spawn failure surface to the host */ });
    if (!child.pid) return false;                                      // failed to launch
    child.unref();
    return true;
  } catch {
    return false;                                                      // synchronous spawn failure — never throw
  }
}

interface CaptureRunDeps {
  telemetryRoot: string; enabled: boolean; signal: HookEvent; flags: CaptureFlags; now: Date;
  logger: CaptureCoreDeps['logger']; execPath: string; scriptPath: string; spawnFn?: typeof defaultSpawn;
}

/**
 * Decide whether to capture inline or off-path, then do it.
 * - Gate off ⇒ no-op (and never spawn a worker).
 * - SessionEnd or --inline ⇒ run captureCore synchronously (SessionEnd's final flush
 *   must complete before the session process exits; --inline is the worker's re-entry).
 * - Everything else (PostToolUse, Stop) ⇒ detach a background worker and return fast,
 *   keeping the synchronous hook path off the agent's critical path.
 * Extracted from the command handler (like captureCore) so the inline/detach decision
 * and the spawn are unit-testable without touching real config paths or spawning node.
 */
export async function runCapture(deps: CaptureRunDeps): Promise<CaptureData> {
  const { enabled, signal, flags, logger } = deps;
  if (!enabled) {
    await logger.debug('telemetry_disabled', { event: signal.event, sessionId: signal.sessionId });
    return { enabled: false, sessionId: signal.sessionId, written: 0, skipped: 0, pruned: 0 };
  }
  const inline = Boolean(flags.inline) || signal.event === 'SessionEnd';
  if (!inline) {
    const dispatched = dispatchBackgroundCapture({ execPath: deps.execPath, scriptPath: deps.scriptPath, flags, spawnFn: deps.spawnFn });
    // A failed dispatch is not fatal and is not retried inline (that would re-block the
    // critical path) — the next Stop/SessionEnd capture still sweeps the same usageIds,
    // so no data is lost, only freshness. Log accurately rather than claiming success.
    await logger.debug(dispatched ? 'telemetry_dispatched' : 'telemetry_dispatch_failed', { event: signal.event, sessionId: signal.sessionId });
    return { enabled: true, sessionId: signal.sessionId, written: 0, skipped: 0, pruned: 0, dispatched };
  }
  return captureCore({ telemetryRoot: deps.telemetryRoot, enabled, signal, now: deps.now, logger });
}

const HOOK_EVENTS = ['PostToolUse', 'SubagentStop', 'Stop', 'SessionEnd', 'SubagentStart', 'PreToolUse'] as const;
function asHookEvent(raw: string | undefined): HookEvent['event'] {
  return (HOOK_EVENTS as readonly string[]).includes(raw ?? '') ? (raw as HookEvent['event']) : 'Stop';
}

export const telemetryCaptureCommand = defineCommand({
  name: 'telemetry-capture',
  description: 'Capture neutral usage records from a harness session transcript into the telemetry store',
  args: {},
  flags: {
    event: { description: 'Triggering hook event (PostToolUse|Stop|SessionEnd)', type: 'string' as const },
    session: { description: 'Session id', type: 'string' as const },
    cwd: { description: 'Working directory of the session', type: 'string' as const },
    'transcript-path': { description: 'Path to the main session transcript JSONL', type: 'string' as const },
    'agent-transcript-path': { description: 'Path to the subagent transcript JSONL (PostToolUse)', type: 'string' as const },
    'agent-id': { description: 'Subagent id (PostToolUse)', type: 'string' as const },
    'tool-use-id': { description: 'Spawning tool_use id (PostToolUse)', type: 'string' as const },
    'tool-name': { description: 'Tool name (Agent for a subagent completion)', type: 'string' as const },
    'agent-type': { description: 'Subagent type, e.g. rad-orc:reviewer', type: 'string' as const },
    inline: { description: 'Run capture synchronously in-process instead of detaching a background worker', type: 'boolean' as const },
  },
  handler: async ({ flags, ctx }: { args: Record<string, never>; flags: CaptureFlags; ctx: CommandContext }): Promise<CaptureData> => {
    const { root, telemetry } = userDataPaths();
    const signal: HookEvent = {
      sessionId: flags.session ?? '',
      cwd: flags.cwd ?? '',
      kind: flags.event ?? 'Stop',
      event: asHookEvent(flags.event),
      transcriptPath: flags['transcript-path'] ?? '',
      agentTranscriptPath: flags['agent-transcript-path'],
      agentId: flags['agent-id'],
      toolUseId: flags['tool-use-id'],
      toolName: flags['tool-name'],
      agentType: flags['agent-type'],
    };
    return runCapture({
      telemetryRoot: telemetry, enabled: readTelemetryEnabled({ root }), signal, flags,
      now: new Date(), logger: ctx.logger, execPath: process.execPath, scriptPath: process.argv[1] ?? '',
    });
  },
});

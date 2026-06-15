import { defineCommand } from '../../framework/command.js';
import { userDataPaths } from '../../lib/paths.js';
import { readTelemetryEnabled } from './config.js';
import type { CommandContext } from '../../framework/context.js';
import {
  ClaudeCodeAdapter, FileCheckpointStore, NdjsonSink, TelemetryCollector,
  pruneAgedPartitions, type HookEvent,
} from '@rad-orchestration/telemetry';

export interface CaptureData {
  enabled: boolean; sessionId?: string;
  written: number; skipped: number; pruned: number; locked?: boolean; error?: string;
}
interface CaptureCoreDeps {
  telemetryRoot: string; enabled: boolean; signal: HookEvent; now: Date;
  logger: { info(m: string, p?: Record<string, unknown>): Promise<void>; debug(m: string, p?: Record<string, unknown>): Promise<void> };
}

export async function captureCore(deps: CaptureCoreDeps): Promise<CaptureData> {
  const { telemetryRoot, enabled, signal, now, logger } = deps;
  if (!enabled) {
    await logger.debug('telemetry_disabled', { event: signal.event, sessionId: signal.sessionId });
    return { enabled: false, written: 0, skipped: 0, pruned: 0 };
  }
  try {
    const collector = new TelemetryCollector(
      new ClaudeCodeAdapter(),
      new NdjsonSink({ root: telemetryRoot }),
      new FileCheckpointStore({ root: telemetryRoot }),
    );
    const res = collector.capture(signal);
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
  },
  handler: async ({ flags, ctx }: { args: Record<string, never>; flags: CaptureFlags; ctx: CommandContext }): Promise<CaptureData> => {
    const { root, telemetry } = userDataPaths();
    const signal: HookEvent = {
      sessionId: flags.session ?? '',
      cwd: flags.cwd ?? process.cwd(),
      kind: flags.event ?? 'Stop',
      event: asHookEvent(flags.event),
      transcriptPath: flags['transcript-path'] ?? '',
      agentTranscriptPath: flags['agent-transcript-path'],
      agentId: flags['agent-id'],
      toolUseId: flags['tool-use-id'],
      toolName: flags['tool-name'],
      agentType: flags['agent-type'],
    };
    return captureCore({ telemetryRoot: telemetry, enabled: readTelemetryEnabled({ root }), signal, now: new Date(), logger: ctx.logger });
  },
});

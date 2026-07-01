import { processEvent } from '../../lib/pipeline-engine/engine.js';
import {
  readState, writeState, readConfig, readDocument, ensureDirectories,
} from '../../lib/pipeline-engine/state-io.js';
import { resolvePathContext, resolveDiscoveredConfigPath } from '../../lib/pipeline-engine/path-context.js';
import type { EventContext, IOAdapter, PathContext, PipelineResult } from '../../lib/pipeline-engine/types.js';
import { defineCommand } from '../../framework/command.js';
import type { CommandContext } from '../../framework/context.js';
import { parseParseErrorFlag } from './parse-error.js';

export interface PipelineSignalInput {
  event: string;
  projectDir: string;
  context: Partial<EventContext>;
  io?: IOAdapter;
  pathContext?: PathContext;
  configPath?: string;
}

export type PipelineSignalEnvelope =
  | {
      ok: true;
      data: {
        action: string | null;
        context: Record<string, unknown>;
        prompt?: string;
        completion_event?: string | null;
        has_custom_instructions?: boolean;
      };
    }
  | { ok: false; data: { event: string; field?: string }; error: { type: 'user_error'; message: string } };

export function makeDefaultIO(): IOAdapter {
  return { readState, writeState, readConfig, readDocument, ensureDirectories };
}

export async function pipelineSignal(input: PipelineSignalInput): Promise<PipelineSignalEnvelope> {
  const io = input.io ?? makeDefaultIO();
  const pathContext = input.pathContext ?? resolvePathContext();
  const configPath = input.configPath ?? resolveDiscoveredConfigPath();
  let result: PipelineResult;
  try {
    result = processEvent(input.event, input.projectDir, input.context, io, pathContext, configPath);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, data: { event: input.event || 'unknown' }, error: { type: 'user_error', message } };
  }
  if (result.error) {
    return {
      ok: false,
      data: { event: result.error.event, ...(result.error.field ? { field: result.error.field } : {}) },
      error: { type: 'user_error', message: result.error.message },
    };
  }
  const data: {
    action: string | null;
    context: Record<string, unknown>;
    prompt?: string;
    completion_event?: string | null;
    has_custom_instructions?: boolean;
  } = { action: result.action, context: result.context };
  if (result.prompt !== undefined) data.prompt = result.prompt;
  if (result.completion_event !== undefined) data.completion_event = result.completion_event;
  if (result.has_custom_instructions !== undefined) {
    data.has_custom_instructions = result.has_custom_instructions;
  }
  return { ok: true, data };
}

export function parseReposFlag(raw: string): Array<Record<string, unknown>> {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch (e) { throw new Error(`--repos must be valid JSON: ${(e as Error).message}`); }
  if (!Array.isArray(parsed)) throw new Error('--repos must be a JSON array of per-repo result objects');
  return parsed as Array<Record<string, unknown>>;
}

interface SignalArgs { event?: string; 'project-dir'?: string }
interface SignalFlags {
  'doc-path'?: string; phase?: string; task?: string; 'gate-mode'?: string; 'gate-type'?: string;
  verdict?: string; branch?: string; reason?: string;
  'pr-url'?: string; template?: string; step?: string;
  'parse-error'?: string; config?: string; repos?: string;
}

export const pipelineSignalCommand = defineCommand({
  name: 'pipeline-signal',
  description: 'Signal a pipeline event and apply the resulting state mutations',
  args: {
    event: { description: 'Pipeline event name (start, master_plan_started, plan_approved, gate_approved, task_completed, pr_created, phase_review_completed, final_review_completed, explosion_failed, …)', required: true },
    'project-dir': { description: 'Absolute path to the project directory whose state.json the event mutates', required: true },
  },
  flags: {
    'doc-path': { description: 'Absolute path to the doc the engine pre-reads (master plan, phase report, review, …)', type: 'string' },
    phase: { description: '1-based phase index', type: 'string' },
    task: { description: '1-based task index inside the current phase', type: 'string' },
    'gate-mode': { description: 'Gate mode: task | phase | autonomous', type: 'string' },
    'gate-type': { description: 'Gate type for the gate_approved event: task | phase', type: 'string' },
    verdict: { description: 'Review verdict: approved | changes_requested | rejected', type: 'string' },
    branch: { description: 'Working branch name for source-control events', type: 'string' },
    reason: { description: 'Free-text rejection reason for gate_rejected and review failures', type: 'string' },
    'pr-url': { description: 'PR URL recorded on pr_created', type: 'string' },
    template: { description: 'Pipeline template id (extra-high | high | medium | low) for the start event', type: 'string' },
    step: { description: 'Internal step identifier carried by *_started events from the v5 DAG walker', type: 'string' },
    'parse-error': { description: 'JSON object { line, expected, found, message } carried on explosion_failed', type: 'string' },
    config: { description: 'Override path to orchestration.yml; default ~/.radorc/orchestration.yml', type: 'string' },
    repos: { description: "JSON array of per-repo commit/PR results, e.g. '[{\"name\":...}]'", type: 'string' },
  },
  handler: async ({ args, flags }: { args: SignalArgs; flags: SignalFlags; ctx: CommandContext }) => {
    const event = args.event!;
    const projectDir = args['project-dir']!;
    const context: Record<string, unknown> = {};
    const copy = (src: keyof SignalFlags, dst: string): void => { if (flags[src] !== undefined) context[dst] = flags[src]; };
    copy('doc-path', 'doc_path'); copy('branch', 'branch'); copy('gate-mode', 'gate_mode'); copy('step', 'step');
    copy('verdict', 'verdict'); copy('gate-type', 'gate_type');
    copy('reason', 'reason'); copy('pr-url', 'pr_url');
    copy('template', 'template');
    if (flags.phase !== undefined) {
      const n = Number(flags.phase);
      if (!Number.isFinite(n) || n < 1) return { ok: false as const, data: { event, field: 'phase' }, error: { type: 'user_error' as const, message: `Invalid value for --phase: ${flags.phase}` } };
      context['phase'] = n;
    }
    if (flags.task !== undefined) {
      const n = Number(flags.task);
      if (!Number.isFinite(n) || n < 1) return { ok: false as const, data: { event, field: 'task' }, error: { type: 'user_error' as const, message: `Invalid value for --task: ${flags.task}` } };
      context['task'] = n;
    }
    if (flags['parse-error'] !== undefined) {
      const pe = parseParseErrorFlag(flags['parse-error']);
      if (!pe.ok) return { ok: false as const, data: { event, field: pe.error.field }, error: { type: 'user_error' as const, message: pe.error.message } };
      context['parse_error'] = pe.value;
    }
    if (flags.repos !== undefined) {
      try { context['repos'] = parseReposFlag(flags.repos); }
      catch (e) { return { ok: false as const, data: { event, field: 'repos' }, error: { type: 'user_error' as const, message: (e as Error).message } }; }
    }
    return pipelineSignal({ event, projectDir, context, configPath: flags.config });
  },
  mapResult: (r) => r.ok
    ? { ok: true as const, data: r.data }
    : { ok: false as const, data: r.data, error: r.error },
});

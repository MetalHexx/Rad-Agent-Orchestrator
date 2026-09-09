import fs from 'node:fs';
import path from 'node:path';
import { defineCommand } from '../../framework/command.js';
import { userDataPaths } from '../../lib/paths.js';
import { parseYaml } from '../../lib/yaml.js';
import { normalizeAmbientVerbosity, type AmbientVerbosity } from '../../lib/ambient-verbosity.js';
import type { CommandContext } from '../../framework/context.js';

export interface ConfigResult {
  autoCommit: string;
  autoPr: string;
  telemetryEnabled: boolean;
  ambientVerbosity: AmbientVerbosity;
  communicationStyle: { enabled: boolean; selected: string };
}
export interface ReadConfigOpts { root: string; }

interface OrchestrationConfig {
  source_control?: { auto_commit?: unknown; auto_pr?: unknown };
  telemetry?: { enabled?: unknown };
  ambient_awareness?: { verbosity?: unknown };
  communication_style?: { enabled?: unknown; selected?: unknown };
}

function scalar(value: unknown, fallback: string): string {
  return value === undefined || value === null ? fallback : String(value);
}

export function readConfig({ root }: ReadConfigOpts): ConfigResult {
  const defaults: ConfigResult = {
    autoCommit: 'ask',
    autoPr: 'ask',
    telemetryEnabled: false,
    ambientVerbosity: 'minimal',
    communicationStyle: { enabled: false, selected: 'high-level.md' },
  };
  const configPath = path.join(root, 'orchestration.yml');
  if (!fs.existsSync(configPath)) return defaults;
  let parsed: OrchestrationConfig | undefined;
  try {
    // Use the shared js-yaml loader so config semantics match the rest of the CLI.
    // Guard the parse: a malformed orchestration.yml must degrade to defaults, never throw
    // (this feeds the session-start preamble hook, which must not break the session).
    parsed = parseYaml<OrchestrationConfig>(fs.readFileSync(configPath, 'utf8'));
  } catch {
    return defaults;
  }
  const sc = (parsed && typeof parsed === 'object' ? parsed.source_control : undefined) ?? {};
  const cs = parsed && typeof parsed === 'object' && parsed.communication_style && typeof parsed.communication_style === 'object' && !Array.isArray(parsed.communication_style)
    ? parsed.communication_style
    : undefined;
  return {
    autoCommit: scalar(sc.auto_commit, defaults.autoCommit),
    autoPr: scalar(sc.auto_pr, defaults.autoPr),
    telemetryEnabled: parsed?.telemetry?.enabled === true,   // default-off
    ambientVerbosity: normalizeAmbientVerbosity(parsed?.ambient_awareness?.verbosity),
    communicationStyle: {
      enabled: cs?.enabled === true,
      selected: typeof cs?.selected === 'string' && cs.selected.length > 0 ? cs.selected : defaults.communicationStyle.selected,
    },
  };
}

export const configCommand = defineCommand({
  name: 'config',
  description: 'Read decision-relevant orchestration.yml config values (auto_commit, auto_pr)',
  args: {},
  flags: {},
  handler: async (_: { args: Record<string, never>; flags: Record<string, never>; ctx: CommandContext }) =>
    readConfig({ root: userDataPaths().root }),
});

export { configSetVerbosity, configSetVerbosityCommand } from './set-verbosity.js';
export type { ConfigSetVerbosityOptions, ConfigSetVerbosityResult } from './set-verbosity.js';

import fs from 'node:fs';
import path from 'node:path';
import { parseYaml, stringifyYaml } from '../../lib/yaml.js';
import { AMBIENT_VERBOSITY_LEVELS, type AmbientVerbosity } from '../../lib/ambient-verbosity.js';
import { UserError } from '../../framework/errors.js';
import { defineCommand } from '../../framework/command.js';
import { userDataPaths } from '../../lib/paths.js';

export interface ConfigSetVerbosityOptions { root: string; level: string; }
export interface ConfigSetVerbosityResult { verbosity: AmbientVerbosity; }

export function configSetVerbosity({ root, level }: ConfigSetVerbosityOptions): ConfigSetVerbosityResult {
  if (!(AMBIENT_VERBOSITY_LEVELS as readonly string[]).includes(level)) {
    throw new UserError(`Invalid level "${level}" — expected one of ${AMBIENT_VERBOSITY_LEVELS.join(', ')}`);
  }
  const configPath = path.join(root, 'orchestration.yml');
  let parsed: Record<string, unknown> = {};
  if (fs.existsSync(configPath)) {
    try {
      parsed = (parseYaml<Record<string, unknown>>(fs.readFileSync(configPath, 'utf8')) ?? {});
    } catch (err) {
      throw new UserError(`orchestration.yml is not valid YAML: ${(err as Error).message}`);
    }
  }
  parsed.ambient_awareness = { ...(parsed.ambient_awareness as object ?? {}), verbosity: level };

  // Atomic tmp+rename write — mirrors harness-installers/standard/lib/install/claude-hook-settings.js's writeSettings.
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const tmp = `${configPath}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
  try {
    fs.writeFileSync(tmp, stringifyYaml(parsed), 'utf8');
    fs.renameSync(tmp, configPath);
  } catch (err) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* best-effort cleanup */ }
    throw err;
  }

  return { verbosity: level as AmbientVerbosity };
}

export const configSetVerbosityCommand = defineCommand({
  name: 'config-set-verbosity',
  description: 'Persist the ambient_awareness.verbosity level to orchestration.yml',
  args: { level: { description: 'One of verbose|minimal|silent|off', required: true } },
  flags: {},
  handler: async ({ args }) => configSetVerbosity({ root: userDataPaths().root, level: args.level as string }),
});

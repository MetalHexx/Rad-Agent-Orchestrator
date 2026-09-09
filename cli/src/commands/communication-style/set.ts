import fs from 'node:fs';
import path from 'node:path';
import { defineCommand } from '../../framework/command.js';
import { UserError } from '../../framework/errors.js';
import { parseYaml, stringifyYaml } from '../../lib/yaml.js';
import { resolveStyleRef } from '../../lib/communication-style.js';
import { readConfig } from '../config/index.js';
import { userDataPaths } from '../../lib/paths.js';
import type { CommandContext } from '../../framework/context.js';

export interface CommunicationStyleSetOptions {
  root: string;
  catalogRoot: string;
  selected?: string;
  enabled?: string;
}
export interface CommunicationStyleSetResult { enabled: boolean; selected: string }

export function communicationStyleSet(opts: CommunicationStyleSetOptions): CommunicationStyleSetResult {
  const { root, catalogRoot, selected, enabled } = opts;
  if (selected === undefined && enabled === undefined) {
    throw new UserError('At least one of --selected or --enabled is required.');
  }

  let enabledValue: boolean | undefined;
  if (enabled !== undefined) {
    if (enabled !== 'true' && enabled !== 'false') {
      throw new UserError(`--enabled must be exactly 'true' or 'false', got '${enabled}'.`);
    }
    enabledValue = enabled === 'true';
  }

  let resolvedSelected: string | undefined;
  if (selected !== undefined) {
    const resolved = resolveStyleRef(catalogRoot, selected);
    if (!resolved || !fs.existsSync(resolved.abs)) {
      throw new UserError(`--selected '${selected}' does not resolve to an existing style in the catalog.`);
    }
    resolvedSelected = resolved.rel;
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
  const existing = (parsed.communication_style as Record<string, unknown> | undefined) ?? {};
  const merged: Record<string, unknown> = { ...existing };
  if (enabledValue !== undefined) merged.enabled = enabledValue;
  if (resolvedSelected !== undefined) merged.selected = resolvedSelected;
  parsed.communication_style = merged;

  // Atomic tmp+rename write — mirrors configSetVerbosity.
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const tmp = `${configPath}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
  try {
    fs.writeFileSync(tmp, stringifyYaml(parsed), 'utf8');
    fs.renameSync(tmp, configPath);
  } catch (err) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* best-effort cleanup */ }
    throw err;
  }

  return readConfig({ root }).communicationStyle;
}

interface Args { selected?: string; enabled?: string }

export const communicationStyleSetCommand = defineCommand({
  name: 'communication-style-set',
  description: 'Persist communication_style.enabled and/or .selected to orchestration.yml',
  args: {
    selected: { description: 'A bare slug or catalog-relative path to select, e.g. direct, direct.md, or custom/my-style.md' },
    enabled: { description: 'Whether the communication style is applied — exactly true or false' },
  },
  flags: {},
  handler: async ({ args }: { args: Args; ctx: CommandContext }) => {
    const paths = userDataPaths();
    return communicationStyleSet({ root: paths.root, catalogRoot: paths.communicationStyles, selected: args.selected, enabled: args.enabled });
  },
});

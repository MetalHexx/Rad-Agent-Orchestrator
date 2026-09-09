import { defineCommand } from '../../framework/command.js';
import { readConfig } from '../config/index.js';
import { listStyles, type StyleCatalogEntry } from '../../lib/communication-style.js';
import { userDataPaths } from '../../lib/paths.js';
import type { CommandContext } from '../../framework/context.js';

export interface CommunicationStyleListResult {
  catalogRoot: string;
  enabled: boolean;
  selected: string;
  styles: StyleCatalogEntry[];
}

export function communicationStyleList(opts: { root: string; catalogRoot: string }): CommunicationStyleListResult {
  const config = readConfig({ root: opts.root });
  return {
    catalogRoot: opts.catalogRoot,
    enabled: config.communicationStyle.enabled,
    selected: config.communicationStyle.selected,
    styles: listStyles(opts.catalogRoot),
  };
}

export const communicationStyleListCommand = defineCommand({
  name: 'communication-style-list',
  description: 'List the shipped and custom communication styles in the catalog',
  args: {},
  flags: {},
  handler: async (_: { args: Record<string, never>; flags: Record<string, never>; ctx: CommandContext }) => {
    const paths = userDataPaths();
    return communicationStyleList({ root: paths.root, catalogRoot: paths.communicationStyles });
  },
});

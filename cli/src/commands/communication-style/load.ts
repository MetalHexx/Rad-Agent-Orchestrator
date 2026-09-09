import fs from 'node:fs';
import path from 'node:path';
import { defineCommand } from '../../framework/command.js';
import { UserError } from '../../framework/errors.js';
import { readConfig } from '../config/index.js';
import { parseStyleFile, resolveStyleRef } from '../../lib/communication-style.js';
import { userDataPaths } from '../../lib/paths.js';
import type { CommandContext } from '../../framework/context.js';

export interface CommunicationStyleLoadResult {
  path: string;
  name: string;
  title: string;
  description: string;
  body: string;
}

export function communicationStyleLoad(opts: { root: string; catalogRoot: string; style?: string }): CommunicationStyleLoadResult {
  const config = readConfig({ root: opts.root });
  const selected = opts.style ?? config.communicationStyle.selected;

  const resolved = resolveStyleRef(opts.catalogRoot, selected);
  if (!resolved) {
    throw new UserError(`Style '${selected}' does not resolve within the communication-styles catalog.`);
  }
  const { rel: relPath, abs } = resolved;
  if (!fs.existsSync(abs)) {
    throw new UserError(`Style '${selected}' was not found in the catalog.`);
  }

  let text: string;
  try {
    text = fs.readFileSync(abs, 'utf8');
  } catch (err) {
    throw new UserError(`Could not read style '${selected}': ${(err as Error).message}`);
  }

  let parsed;
  try {
    parsed = parseStyleFile(text, path.basename(abs));
  } catch (err) {
    throw new UserError((err as Error).message);
  }

  return {
    path: relPath,
    name: parsed.name,
    title: parsed.frontmatter.title,
    description: parsed.frontmatter.description,
    body: parsed.body,
  };
}

interface Args { style?: string }

export const communicationStyleLoadCommand = defineCommand({
  name: 'communication-style-load',
  description: 'Load a communication style\'s frontmatter and body, defaulting to the configured selection',
  args: {
    style: { description: 'A bare slug or catalog-relative path to the style file (defaults to the configured selected style)' },
  },
  flags: {},
  handler: async ({ args }: { args: Args; ctx: CommandContext }) => {
    const paths = userDataPaths();
    return communicationStyleLoad({ root: paths.root, catalogRoot: paths.communicationStyles, style: args.style });
  },
});

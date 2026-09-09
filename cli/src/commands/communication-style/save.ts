import fs from 'node:fs';
import { defineCommand } from '../../framework/command.js';
import { UserError } from '../../framework/errors.js';
import { saveCustomStyle } from '../../lib/communication-style.js';
import { userDataPaths } from '../../lib/paths.js';
import type { CommandContext } from '../../framework/context.js';

export interface CommunicationStyleSaveOptions { catalogRoot: string; name: string; from: string }
export interface CommunicationStyleSaveResult { path: string; overwritten: boolean }

export function communicationStyleSave(opts: CommunicationStyleSaveOptions): CommunicationStyleSaveResult {
  let sourceText: string;
  try {
    sourceText = fs.readFileSync(opts.from, 'utf8');
  } catch (err) {
    throw new UserError(`Could not read --from '${opts.from}': ${(err as Error).message}`);
  }
  return saveCustomStyle({ catalogRoot: opts.catalogRoot, name: opts.name, sourceText });
}

interface Args { name: string; from: string }

export const communicationStyleSaveCommand = defineCommand({
  name: 'communication-style-save',
  description: 'Parse a draft style file and save it into the catalog\'s custom/ slot',
  args: {
    name: { description: 'Bare slug for the saved style, written as custom/<name>.md', required: true },
    from: { description: 'Absolute path to the draft style file to parse and save', required: true },
  },
  flags: {},
  handler: async ({ args }: { args: Args; ctx: CommandContext }) => {
    const paths = userDataPaths();
    return communicationStyleSave({ catalogRoot: paths.communicationStyles, name: args.name, from: args.from });
  },
});

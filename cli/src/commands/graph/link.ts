import { defineCommand } from '../../framework/command.js';
import { UserError } from '../../framework/errors.js';
import { userDataPaths } from '../../lib/paths.js';
import { WorkGraphService } from '@rad-orchestration/work-graph';
import type { Edge } from '@rad-orchestration/work-graph';
import type { CommandContext } from '../../framework/context.js';

export interface GraphLinkOptions {
  root: string;
  from: string;
  to: string;
  type: string;
}

export interface GraphLinkResult {
  edge: Edge;
  rev: number;
}

export interface GraphUnlinkOptions {
  root: string;
  from: string;
  to: string;
  type: string;
}

export interface GraphUnlinkResult {
  rev: number;
}

export function runGraphLink({ root, from, to, type }: GraphLinkOptions): GraphLinkResult {
  const r = new WorkGraphService({ root }).link(from, to, type);
  if (!r.ok) throw new UserError(r.error.message);
  return r.data;
}

export function runGraphUnlink({ root, from, to, type }: GraphUnlinkOptions): GraphUnlinkResult {
  const r = new WorkGraphService({ root }).unlink(from, to, type);
  if (!r.ok) throw new UserError(r.error.message);
  return r.data;
}

interface Args { from?: string; to?: string }
interface Flags { type?: string }

export const graphLinkCommand = defineCommand({
  name: 'graph-link',
  description: 'Add a relationship edge between two nodes',
  args: {
    from: { description: 'Source node id (project id or group id)', required: true },
    to: { description: 'Target node id (project id or group id)', required: true },
  },
  flags: {
    type: { description: 'Edge type. follows (this project follows another in a series — asserts an ordering), depends-on (this project is blocked by another — asserts an ordering), spawned-from (this project branched off another — asserts origin only, no ordering). Ordering types shape the graph layout; others are decoration — drawn, but exerting no ordering force. Unrecognised types are accepted and treated as decoration.', type: 'string' as const },
  },
  handler: async ({ args, flags, ctx }: { args: Args; flags: Flags; ctx: CommandContext }) => {
    if (!args.from || !args.to || !flags.type) throw new UserError('--from, --to, and --type are required');
    const out = runGraphLink({ root: userDataPaths().root, from: args.from, to: args.to, type: flags.type });
    if (!ctx.ux.json) ctx.stderr.write(`✓ linked ${out.edge.from} -[${out.edge.type}]-> ${out.edge.to} (rev ${out.rev})\n`);
    return out;
  },
});

export const graphUnlinkCommand = defineCommand({
  name: 'graph-unlink',
  description: 'Remove a relationship edge between two nodes',
  args: {
    from: { description: 'Source node id (project id or group id)', required: true },
    to: { description: 'Target node id (project id or group id)', required: true },
  },
  flags: {
    type: { description: 'Edge type to remove. follows (this project follows another in a series — asserts an ordering), depends-on (this project is blocked by another — asserts an ordering), spawned-from (this project branched off another — asserts origin only, no ordering). Ordering types shape the graph layout; others are decoration — drawn, but exerting no ordering force.', type: 'string' as const },
  },
  handler: async ({ args, flags, ctx: _ctx }: { args: Args; flags: Flags; ctx: CommandContext }) => {
    if (!args.from || !args.to || !flags.type) throw new UserError('--from, --to, and --type are required');
    return runGraphUnlink({ root: userDataPaths().root, from: args.from, to: args.to, type: flags.type });
  },
});

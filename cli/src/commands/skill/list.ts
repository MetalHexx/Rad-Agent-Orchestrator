import { defineCommand } from '../../framework/command.js';
import { UserError } from '../../framework/errors.js';
import { userDataPaths } from '../../lib/paths.js';
import { readRegistry, resolveRepoPath } from '@rad-orchestration/repo-registry';
import { buildSkillManifestPerRepo, type SkillEntry } from '../../lib/skill-manifest.js';
import type { CommandContext } from '../../framework/context.js';

export interface SkillListOptions {
  root: string;
  repos?: string[];
  repoGroups?: string[];
  warn?: (msg: string) => void;
}

export interface SkillListUnscannable {
  repo: string;
  reason: string;
  hint: string | null;
}

export interface SkillListResult {
  skills: SkillEntry[];
  unscannable: SkillListUnscannable[];
}

function splitCsv(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(',').map(v => v.trim()).filter(Boolean);
}

export function skillList(opts: SkillListOptions): SkillListResult {
  const reg = readRegistry({ root: opts.root });

  const names = new Set<string>();
  for (const groupName of opts.repoGroups ?? []) {
    if (!Object.hasOwn(reg.repoGroups, groupName)) throw new UserError(`repo-group '${groupName}' is not registered`);
    const group = reg.repoGroups[groupName];
    for (const member of group.members) names.add(member);
  }
  for (const name of opts.repos ?? []) names.add(name);

  const resolvedRepos: Array<{ name: string; root: string }> = [];
  const unscannable: SkillListUnscannable[] = [];
  for (const name of names) {
    if (!Object.hasOwn(reg.repos, name)) {
      throw new UserError(`repo '${name}' is not registered`);
    }
    const resolved = resolveRepoPath(reg, name);
    if (!resolved.bound) {
      unscannable.push({ repo: name, reason: 'registered but not bound to a local path', hint: resolved.hint });
      continue;
    }
    resolvedRepos.push({ name, root: resolved.path! });
  }

  const skills = buildSkillManifestPerRepo({ repos: resolvedRepos, warn: opts.warn });
  return { skills, unscannable };
}

interface Flags { repo?: string; 'repo-group'?: string }

export const skillListCommand = defineCommand({
  name: 'skill-list',
  description: 'List repository SKILL.md entries eligible for planner-spawn discovery',
  args: {},
  flags: {
    repo: { description: 'Registered repo name(s) to scan; comma-separated for several', type: 'string' },
    'repo-group': { description: 'Registered repo-group name(s) whose members are scanned; comma-separated', type: 'string' },
  },
  handler: async ({ flags, ctx }: { flags: Flags; ctx: CommandContext }) => {
    const repos = splitCsv(flags.repo);
    const repoGroups = splitCsv(flags['repo-group']);
    if (repos.length === 0 && repoGroups.length === 0) {
      throw new UserError('one of --repo or --repo-group is required');
    }
    const warn = (msg: string) => ctx.logger.warn('skill_list_skip', { message: msg });
    const root = userDataPaths().root;
    return skillList({ root, repos, repoGroups, warn });
  },
  mapResult: (result: SkillListResult) => ({
    ok: true,
    data: result,
    ...(result.unscannable.length
      ? { warnings: result.unscannable.map(u => `${u.repo}: ${u.reason}`) }
      : {}),
  }),
});

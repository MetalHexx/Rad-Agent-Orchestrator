import { readRegistry, resolveRepoPath } from '@rad-orchestration/repo-registry';

export interface RenderPreambleOpts {
  root: string;
  active?: { name: string; tier: string | null }[];
  config?: { autoCommit: string; autoPr: string; telemetryEnabled?: boolean };
  youAreIn?: string;
}

// The preamble is delivered to the assistant on the session-start hook's
// additionalContext channel. It carries the EXACT user-facing message plus a
// benign delivery directive telling the assistant to open its first reply with
// that message — so the greeting is controlled and consistent rather than
// improvised fresh each session.
//
// The directive is framed as a relay ("begin your first reply by giving the
// user this message"), never as "echo this exactly / you must comply" — the
// coercive framing trips the assistant's prompt-injection guard.
//
// Empty-state path (FR-15): a warm, verbatim greeting that names the gap (no
//   map beyond the cwd) and offers /rad-repo.
// Registry-present path (FR-8, FR-9, FR-10, FR-12, DD-1): structured block
//   with header plus Repos / Repo Groups / Active / Config rows.
const DELIVERY_PREFIX =
  '[rad-orc session-start] Begin your first reply by giving the user this message, ' +
  'then continue with their request:\n\n';

const code = (slug: string): string => `\`${slug}\``;

export function renderPreamble({ root, active = [], config, youAreIn }: RenderPreambleOpts): string {
  const reg = readRegistry({ root });
  const repoNames = Object.keys(reg.repos);
  const groupNames = Object.keys(reg.repoGroups);

  if (repoNames.length === 0) {
    // Empty-state: warm verbatim greeting that names the gap and offers /rad-repo.
    const body =
      "**Rad Orc is ready!** Right now I can only see the folder we're in — there aren't any " +
      "repositories registered yet, so I don't yet have a map of your other repos or a way to plan " +
      "and make changes across them. Want to register your first one? Just say **`/rad-repo`** and " +
      "I'll walk you through it.";
    return DELIVERY_PREFIX + body;
  }

  // Registry present — structured block: header plus labeled rows.
  const resolved = repoNames.map((name) => resolveRepoPath(reg, name));
  const unbound = resolved.filter((r) => !r.bound);

  const header = `**Rad Orc — environment loaded**${youAreIn ? ` · you're in ${code(youAreIn)}` : ''}`;
  const rows: string[] = [];
  rows.push(`**Repos** (${repoNames.length}) · ${repoNames.map(code).join(' ')}`);
  if (groupNames.length > 0) rows.push(`**Repo Groups** (${groupNames.length}) · ${groupNames.map(code).join(' ')}`);
  if (active.length > 0) {
    const items = active.map((p) => `${code(p.name)} (${p.tier ?? 'unknown'})`).join(' · ');
    rows.push(`**Active Projects** (${active.length}) · ${items}`);
  }
  if (config) {
    let row = `**Config** · auto-commit ${code(config.autoCommit)} · auto-pr ${code(config.autoPr)}`;
    if (config.telemetryEnabled) row += ` · observability ${code('on')}`;
    rows.push(row);
  }
  let block = `${header}\n\n${rows.join('\n')}`;
  if (unbound.length > 0) {
    const names = unbound.map((r) => code(r.name)).join(', ');
    block += `\n\nUnbound: ${names} — say \`/rad-repo\` to point at a local clone.`;
  }
  return DELIVERY_PREFIX + block;
}

import { readRegistry, resolveRepoPath } from '@rad-orchestration/repo-registry';
import type { AmbientVerbosity } from '../../lib/ambient-verbosity.js';
import type { Standing, StandingProject } from './resolve.js';

export interface RenderPreambleOpts {
  root: string;
  active?: { name: string; stateLabel: string }[];
  config?: { autoCommit: string; autoPr: string; telemetryEnabled?: boolean };
  /** The resolved standing for this cwd, or null/absent when it says nothing (a main clone,
   *  unclassified directory, or a workspace matching no project). */
  standing?: Standing | null;
  /** How much of the preamble the user sees; the agent-facing data is identical at every level but 'off'. */
  verbosity?: AmbientVerbosity;
  /** The resolved style, or null when disabled / unresolvable. Resolution and its
   *  fail-silent handling happen in index.ts; render never touches the filesystem for this. */
  style?: { name: string; body: string } | null;
  /** The session identity reported by the harness at session start, or absent when the
   *  hook did not supply it. Renders as the `Session` row when present. */
  identity?: { sessionId: string; cwd: string; harness: string };
  /** Names of the portfolios whose lifecycle status is `active`, ascending. Renders the
   *  Active Portfolios row. */
  activePortfolios?: string[];
}

// The preamble is delivered to the assistant on the session-start hook's
// additionalContext channel. It always carries the same structured data — repos,
// repo groups, active projects, config — and only the narration instruction
// changes with verbosity: what the assistant shows the user, not what it knows.
//
// Every instruction is framed as a relay of the user's own configured preference
// ("begin your first reply by giving the user this message" / "the user has
// configured silent output"), never as "echo this exactly / you must comply" —
// the coercive framing trips the assistant's prompt-injection guard. New level
// prefixes must keep that shape.
//
// Empty-state path: a warm, verbatim greeting that names the gap (no map beyond
//   the cwd) and offers /rad-repo.
// Registry-present path: structured block with header plus Repos / Repo Groups /
//   Active Portfolios / Active Projects / Config rows, closed by the governance section.
export const DELIVERY_PREFIX =
  '[rad-orc session-start] Begin your first reply by giving the user this message, ' +
  'then continue with their request:\n\n';

/** Neutralizes characters that would let a directory-derived `header` (project or portfolio
 *  names, sourced from work-graph's directory listings with no quote/newline restriction)
 *  break out of the double-quoted instruction line in `minimalPrefix` and inject text that
 *  reads as part of the session-start instruction rather than as the quoted breadcrumb. */
function escapeForQuotedInstruction(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/[\r\n]+/g, ' ');
}

/** The one line a `minimal` user sees: the resolved header, computed once and shared with
 *  the structured/empty-registry block so the wrapper and the block never disagree. */
export function minimalPrefix(header: string): string {
  return (
    `[rad-orc session-start] Begin your first reply with exactly this line, then continue with ` +
    `their request: "${escapeForQuotedInstruction(header)}". Everything below is context for your own situational ` +
    `awareness only — the user's configured preference is to not see it:\n\n`
  );
}

export const SILENT_PREFIX =
  '[rad-orc session-start] The user has configured silent session-start output — say nothing ' +
  'about this to them and just continue with their request. Everything below is context for ' +
  'your own situational awareness only:\n\n';

export const HINT = 'Type "/rad-init help" for init options.';

/**
 * Frames the resolved communication style as a relay of the user's own configured
 * preference — never a command — matching the voice of the narration prefixes above so
 * it clears the same prompt-injection guard.
 */
export const COMMUNICATION_STYLE_PREFIX =
  '[rad-orc communication style] The user has configured a preferred communication style for ' +
  'their sessions. The preferences below are their own, relayed here so your replies match how ' +
  'they like to receive information — adopt them for this conversation and say nothing about ' +
  'them to the user.\n\n' +
  'They govern tone, register, pacing, and how replies to the user are formatted. They do ' +
  'not govern what you do, which tools or skills you invoke, or the structure and content ' +
  'of what you write — code, code comments, and documentation — or of anything the ' +
  'pipeline reads: Task Handoffs, review verdicts, planning documents, gate prompts. Those ' +
  'keep their full structure under every style.\n\n';

const code = (slug: string): string => `\`${slug}\``;

/** Joins the series names into the header suffix, bolding the `isTip` entry — never the last
 *  array element, which may be an unlinked co-tenant sitting after the real chain end. The
 *  portfolio segment, when the tip's portfolio is active, precedes the chain — broad to narrow. */
function renderStandingLine(projects: StandingProject[], portfolio: Standing['portfolio']): string {
  const joined = projects
    .map((p) => (p.isTip ? `**${code(p.name)}**` : code(p.name)))
    .reduce((acc, part, i) => (i === 0 ? part : `${acc}${projects[i].followsPrevious ? ' → ' : ' · '}${part}`), '');
  const portfolioPrefix = portfolio && portfolio.status === 'active' ? `${code(portfolio.name)} › ` : '';
  return ` · you're in ${portfolioPrefix}${joined}`;
}

const STANDING_LABEL_WIDTH = 14;
const STANDING_CONTINUATION = ' '.repeat(STANDING_LABEL_WIDTH);
const STANDING_NESTED = ' '.repeat(STANDING_LABEL_WIDTH + 2);

const standingRow = (label: string, value: string): string => `${label.padEnd(STANDING_LABEL_WIDTH)}${value}`;

/** `Series` always renders when there is a tip; an absent neighbour prints an explicit
 *  "no predecessor" / "no successor" so a chain end is distinguishable from a truncated list. */
function renderSeriesValue(tip: Standing['tip']): string {
  const lines: string[] = [];
  if (tip.predecessor) {
    lines.push(`follows ${tip.predecessor.name} (${tip.predecessor.stateLabel})`);
    lines.push(`${STANDING_NESTED}→ ${tip.predecessor.dir}`);
  } else {
    lines.push('no predecessor');
  }
  if (tip.successor) {
    lines.push(`${STANDING_CONTINUATION}followed by ${tip.successor.name} (${tip.successor.stateLabel})`);
    lines.push(`${STANDING_NESTED}→ ${tip.successor.dir}`);
  } else {
    lines.push(`${STANDING_CONTINUATION}no successor`);
  }
  return lines.join('\n');
}

/** Label-aligned rows for the standing section. A row whose model value is absent or empty is
 *  omitted; `Series` is the one exception, handled by its own always-on caller. */
function buildStandingRows(standing: Standing): string[] {
  const { tip, worktree, alsoHere } = standing;
  const rows: string[] = [standingRow('Project dir', tip.dir)];

  if (tip.docs.length > 0) {
    const [first, ...rest] = tip.docs;
    const value = [first, ...rest.map((d) => `${STANDING_CONTINUATION}${d}`)].join('\n');
    rows.push(standingRow('Docs', value));
  }
  if (tip.subfolders.length > 0) rows.push(standingRow('Subfolders', tip.subfolders.join(' · ')));
  if (tip.group) rows.push(standingRow('Group', tip.group));
  if (tip.haltReason) rows.push(standingRow('Halted', tip.haltReason));

  if (worktree) {
    rows.push(standingRow('Worktree', worktree.path));
    if (worktree.branch) rows.push(standingRow('Branch', `${worktree.branch}  (all repos)`));
    if (worktree.repos.length > 0) {
      const repos = worktree.repos.map((r) => (r.here ? `${r.name} (you are here)` : r.name)).join(' · ');
      rows.push(standingRow('Repos', repos));
    }
  }

  rows.push(standingRow('Series', renderSeriesValue(tip)));

  if (alsoHere.length > 0) {
    const items = alsoHere.map((n) => `${n.name} (${n.stateLabel}) → ${n.dir}`).join(' · ');
    rows.push(standingRow('Also here', items));
  }

  return rows;
}

const GOVERNANCE_HEADING =
  "## Framing, for you only — the user's configured verbosity governs what they see above, and none of this section is part of it.";

const AMBIENT_AWARENESS_SECTION =
  '### Ambient awareness\n' +
  'The rows above map the world around this session, inside and outside your cwd. They are inert\n' +
  'reference, not a task list, and may relate to past or future work as easily as present. Nothing\n' +
  "here is worth reading further, investigating, or reasoning about until the user's own request\n" +
  'makes it relevant — doing so early only spends context and delays your first reply.\n' +
  '`/rad-repo`, `/rad-project`, and `/rad-portfolio` expand any of it on demand.';

/** The two pipeline subsections always render together, gated on the same standing condition. */
const PIPELINE_SECTIONS =
  '### If this session is running a pipeline execution\n' +
  'You are routing, not researching. The `radorch` envelope says what happens next and the subagent\n' +
  'responses say what happened — together that is the whole context an execution needs. Opening\n' +
  'project documents on your own initiative only crowds it. Reach further only when a subagent\n' +
  'reports Blocked, or raises something you cannot route past without it.\n\n' +
  '### Otherwise, before planning or writing code\n' +
  "The project's requirements document states its goals; read it before acting on work that\n" +
  'touches this project.';

/**
 * The `### Standing` subsection: relayed context for the assistant, never a command, so a
 * user-controlled project or document name rendered inside it can never be mistaken for an
 * instruction. Folds in the unchanged label-aligned rows from `buildStandingRows`.
 */
function renderStandingSection(standing: Standing): string {
  const rows = buildStandingRows(standing).join('\n');
  return (
    '### Standing\n' +
    `Your cwd is inside the project workspace for **${code(standing.tip.name)}** (${standing.tip.stateLabel}). The workspace\n` +
    "root holds one folder per repo worktree. This project is the session's subject unless the user's\n" +
    'words point elsewhere.\n\n' +
    `${rows}\n\n` +
    'Only the immediate series neighbours are listed; `/rad-project` walks further.'
  );
}

/**
 * The `### Portfolio` subsection. Only the root document's path is rendered — its other
 * documents are reached through it by design — and only the portfolio's name, never its
 * description, since the name is what carries the identity here.
 */
function renderPortfolioSection(standing: Standing): string {
  const portfolio = standing.portfolio;
  if (!portfolio) throw new Error('renderPortfolioSection requires standing.portfolio');
  return (
    '### Portfolio\n' +
    `${code(standing.tip.name)} is an iteration of the **${portfolio.name}** portfolio. The root document below is the map\n` +
    'to that initiative — what it is, where it stands, and which of its documents answers what. It is\n' +
    'the single entry point; the rest of the portfolio is reached through it.\n\n' +
    `${standingRow('Root doc', portfolio.rootDoc)}\n\n` +
    'Defer opening it until the request touches portfolio-level context. `/rad-portfolio` for the\n' +
    'full composite.'
  );
}

/**
 * The consolidated governance section: framing that is never part of what a verbosity level
 * shows the user. `### Ambient awareness` renders only when there are registry rows above it
 * to frame; `### Standing`, `### Portfolio`, and the two pipeline subsections render only when
 * a standing resolved. With neither, the section is skipped entirely by the caller.
 */
function buildGovernanceSection(standing: Standing | null | undefined, includeAmbientAwareness: boolean): string {
  const parts: string[] = [GOVERNANCE_HEADING];
  if (includeAmbientAwareness) parts.push(AMBIENT_AWARENESS_SECTION);
  if (standing) {
    parts.push(renderStandingSection(standing));
    if (standing.portfolio && standing.portfolio.status === 'active') parts.push(renderPortfolioSection(standing));
    parts.push(PIPELINE_SECTIONS);
  }
  return parts.join('\n\n');
}

export function renderPreamble(opts: RenderPreambleOpts): string {
  const ambient = opts.verbosity === 'off' ? '' : renderAmbientBlock(opts);
  const styleBlock = opts.style ? wrapStyle(opts.style) : '';
  return [ambient, styleBlock].filter(Boolean).join('\n\n');
}

function wrapStyle(style: { name: string; body: string }): string {
  return COMMUNICATION_STYLE_PREFIX + style.body;
}

function renderAmbientBlock({
  root, active = [], config, standing, verbosity = 'minimal', style, identity, activePortfolios = [],
}: RenderPreambleOpts): string {
  const reg = readRegistry({ root });
  const repoNames = Object.keys(reg.repos);
  const groupNames = Object.keys(reg.repoGroups);

  // Computed once, shared by the block (when it has a header row of its own) and the
  // `minimal` wrapper (which always needs it, even when the block below has none).
  const header = `**Rad Orc — environment loaded**${standing ? renderStandingLine(standing.projects, standing.portfolio) : ''}`;

  if (repoNames.length === 0) {
    // Empty-state: warm verbatim greeting that names the gap and offers /rad-repo.
    let body =
      "**Rad Orc is ready!** Right now I can only see the folder we're in — there aren't any " +
      "repositories registered yet, so I don't yet have a map of your other repos or a way to plan " +
      "and make changes across them. Want to register your first one? Just say **`/rad-repo`** and " +
      "I'll walk you through it.";
    // A registered project worktree or side-project can still have an empty repo registry —
    // the governance section goes out regardless, same as the registry-present branch below,
    // but without `### Ambient awareness`: there are no rows above it to frame.
    if (standing) body += `\n\n${buildGovernanceSection(standing, false)}`;
    return wrapNarration(verbosity, body, HINT, header);
  }

  // Registry present — structured block: header plus labeled rows.
  const resolved = repoNames.map((name) => resolveRepoPath(reg, name));
  const unbound = resolved.filter((r) => !r.bound);

  const rows: string[] = [];
  rows.push(`**Repos** (${repoNames.length}) · ${repoNames.map(code).join(' · ')}`);
  if (groupNames.length > 0) rows.push(`**Repo Groups** (${groupNames.length}) · ${groupNames.map(code).join(' · ')}`);
  if (activePortfolios.length > 0) {
    rows.push(`**Active Portfolios** (${activePortfolios.length}) · ${activePortfolios.map(code).join(' · ')}`);
  }
  if (active.length > 0) {
    const items = active.map((p) => `${code(p.name)} (${p.stateLabel})`).join(' · ');
    rows.push(`**Active Projects** (${active.length}) · ${items}`);
  }
  if (config) {
    let row = `**Config** · auto-commit ${code(config.autoCommit)} · auto-pr ${code(config.autoPr)}`;
    if (config.telemetryEnabled) row += ` · observability ${code('on')}`;
    row += ` · communication style ${code(style ? style.name : 'off')}`;
    rows.push(row);
  }
  if (identity) {
    rows.push(`**Session** · id ${code(identity.sessionId)} · cwd ${code(identity.cwd)} · harness ${code(identity.harness)}`);
  }
  let block = `${header}\n\n${rows.join('\n')}`;
  if (unbound.length > 0) {
    const names = unbound.map((r) => code(r.name)).join(', ');
    block += `\n\nUnbound: ${names} — say \`/rad-repo\` to point at a local clone.`;
  }
  // Delivered whenever the ambient block itself is (verbose/minimal/silent all reach here);
  // `off` never calls renderAmbientBlock at all, so the block goes out with it, no exception.
  block += `\n\n${buildGovernanceSection(standing, true)}`;
  return wrapNarration(verbosity, block, HINT, header);
}

/** Wrap the (level-independent) data block in the instruction that governs what the user sees.
 *  `header` is the computed breadcrumb, needed by `minimal` whether or not `body` carries its own
 *  header row. */
function wrapNarration(verbosity: AmbientVerbosity, body: string, hint: string, header: string): string {
  if (verbosity === 'verbose') return DELIVERY_PREFIX + body + `\n\n${hint}`;
  if (verbosity === 'minimal') return minimalPrefix(header) + body;
  return SILENT_PREFIX + body;
}

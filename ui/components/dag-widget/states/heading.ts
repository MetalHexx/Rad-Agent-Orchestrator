import { getDisplayName, parsePhaseNameFromDocPath, parseTaskNameFromDocPath } from '@/components/dag-timeline/dag-timeline-helpers';
import type { CardHeading, StateId, StateViewContext } from '../types';
import { deriveTaskNumber } from './shared';

/** Work states: `ctx.iteration` is the task iteration, not the phase. */
const WORK_STATE_IDS: ReadonlySet<StateId> = new Set(['coding', 'reviewing', 'corrective']);

/**
 * `"{prefix}: "` prepended to the work-state heading, naming the activity
 * rather than leaving a bare task title.
 */
const WORK_STATE_HEADING_PREFIX: Partial<Record<StateId, string>> = {
  coding: 'Coding',
  reviewing: 'Reviewing',
  corrective: 'Correcting',
};

/**
 * Strips a `parseTaskNameFromDocPath` / `parsePhaseNameFromDocPath` result
 * down to its title, splitting on the " — " separator and keeping the
 * remainder. Returns the string unchanged — the bare "Task N" / "Phase N" —
 * when no separator is present (no parseable title).
 */
function stripDocTitlePrefix(name: string): string {
  const parts = name.split(' — ');
  return parts.length > 1 ? parts.slice(1).join(' — ') : name;
}

/**
 * 1-based phase number parsed from the leading "Phase {N}" in a resolved
 * phase name (`"Phase 1 — Overview Facet"` or the bare `"Phase 1"`). `null`
 * when it can't be parsed — the caller omits the phase number rather than
 * guessing.
 */
function parsePhaseNumberFromName(phaseName: string | null): number | null {
  if (phaseName === null) return null;
  const match = phaseName.match(/^Phase (\d+)/);
  return match ? Number(match[1]) : null;
}

/**
 * Derives the card's `{ heading, meta }` text for the active state.
 *
 * - Work states (Coding/Reviewing/Corrective) — heading is the task title
 *   (from the task iteration's handoff doc path) stripped of its
 *   "Task N — " prefix, falling back to the bare "Task N" when the doc path
 *   carries no parseable title, then prefixed with its own state name via
 *   `WORK_STATE_HEADING_PREFIX` ("Coding: <title>" / "Reviewing: <title>" /
 *   "Correcting: <title>"). Meta is "Phase {phaseNumber} · Task {taskNumber}";
 *   the phase number is parsed from `ctx.phaseName` (the only phase signal a
 *   work state's context carries) and omitted when it can't be parsed.
 * - Phase Review — same "strip the prefix" treatment off the phase title,
 *   prefixed "Phase Review: <title>"; meta is "Phase {n}" from the phase
 *   iteration's own 1-based index.
 * - Every other state — heading falls back to the active node's display
 *   name; meta is always `null`.
 */
export function deriveCardHeading(ctx: StateViewContext): CardHeading {
  if (WORK_STATE_IDS.has(ctx.stateId)) {
    const taskName = parseTaskNameFromDocPath(ctx.iteration?.doc_path ?? null, ctx.iteration?.index ?? 0);
    const taskNumber = deriveTaskNumber(ctx.iteration);
    const phaseNumber = parsePhaseNumberFromName(ctx.phaseName);

    const metaParts: string[] = [];
    if (phaseNumber !== null) metaParts.push(`Phase ${phaseNumber}`);
    if (taskNumber !== null) metaParts.push(`Task ${taskNumber}`);

    const title = stripDocTitlePrefix(taskName);
    const prefix = WORK_STATE_HEADING_PREFIX[ctx.stateId];

    return {
      heading: prefix ? `${prefix}: ${title}` : title,
      meta: metaParts.length > 0 ? metaParts.join(' · ') : null,
    };
  }

  if (ctx.stateId === 'phase-review') {
    const phaseName = parsePhaseNameFromDocPath(ctx.iteration?.doc_path ?? null, ctx.iteration?.index ?? 0);
    const phaseNumber = ctx.iteration ? ctx.iteration.index + 1 : null;

    return {
      heading: `Phase Review: ${stripDocTitlePrefix(phaseName)}`,
      meta: phaseNumber !== null ? `Phase ${phaseNumber}` : null,
    };
  }

  // Defensive default for any non-work / non-phase-review state. The current
  // caller set (coding, reviewing, corrective, phase-review views) never
  // actually reaches this branch, but it keeps the function total: an
  // unexpected state gets a sensible display name rather than an undefined
  // return. Do not remove — it preserves the CardHeading return contract.
  return { heading: getDisplayName(ctx.nodeId), meta: null };
}

import { getDisplayName, parsePhaseNameFromDocPath, parseTaskNameFromDocPath } from '@/components/dag-timeline/dag-timeline-helpers';
import type { CardHeading, StateId, StateViewContext } from '../types';
import { deriveTaskNumber } from './shared';

/** Work states: `ctx.iteration` is the task iteration, not the phase. */
const WORK_STATE_IDS: ReadonlySet<StateId> = new Set(['coding', 'reviewing', 'corrective']);

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
 *   carries no parseable title. Meta is "Phase {phaseNumber} · Task
 *   {taskNumber}"; the phase number is parsed from `ctx.phaseName` (the only
 *   phase signal a work state's context carries) and omitted when it can't
 *   be parsed.
 * - Phase Review — same "strip the prefix" treatment off the phase title;
 *   meta is "Phase {n}" from the phase iteration's own 1-based index.
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

    return {
      heading: stripDocTitlePrefix(taskName),
      meta: metaParts.length > 0 ? metaParts.join(' · ') : null,
    };
  }

  if (ctx.stateId === 'phase-review') {
    const phaseName = parsePhaseNameFromDocPath(ctx.iteration?.doc_path ?? null, ctx.iteration?.index ?? 0);
    const phaseNumber = ctx.iteration ? ctx.iteration.index + 1 : null;

    return {
      heading: stripDocTitlePrefix(phaseName),
      meta: phaseNumber !== null ? `Phase ${phaseNumber}` : null,
    };
  }

  return { heading: getDisplayName(ctx.nodeId), meta: null };
}

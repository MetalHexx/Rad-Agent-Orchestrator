// The decoration-cadence fixture: pins the concrete shape `explosion`'s handle decorates its
// parsed phases/tasks with. Mirrors `runtime-config/templates/extra-high.yml`'s cadence — a
// per-task code review, a per-phase code review, and the final spine (final code review → PR →
// final approval) — the richest of the pre-DAG system's review tiers. Reused verbatim by the
// P05-T02 seed batch; this is the one place this iteration's cadence shape is pinned.
import type { DecorationCadence } from '../../src/rad-orc/explosion.js';

export const DECORATION_CADENCE_FIXTURE: DecorationCadence = {
  perTask: ['rad-orc:code_review'],
  perPhase: ['rad-orc:code_review'],
  spine: ['rad-orc:code_review', 'rad-orc:pr', 'rad-orc:approval'],
};

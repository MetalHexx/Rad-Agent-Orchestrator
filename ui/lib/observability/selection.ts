export interface SelectionState { baseline: string | null; candidate: string | null; }

/** Sticky-baseline two-slot selection. First pick = baseline; a third pick replaces the candidate. (DD-5) */
export function toggleSelection(state: SelectionState, id: string): SelectionState {
  if (state.baseline === id) return { baseline: null, candidate: state.candidate };
  if (state.candidate === id) return { baseline: state.baseline, candidate: null };
  if (state.baseline === null) return { baseline: id, candidate: state.candidate };
  return { baseline: state.baseline, candidate: id };
}
export function selectedCount(s: SelectionState): number { return (s.baseline ? 1 : 0) + (s.candidate ? 1 : 0); }
export function canCompare(s: SelectionState): boolean { return Boolean(s.baseline && s.candidate); }

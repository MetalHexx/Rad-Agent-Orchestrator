// ui/lib/time-range/url-state.ts
import { encodeRange, decodeRange } from './url';
import { DEFAULT_RANGE, type TimeRange } from './range';

export interface ViewState { range: TimeRange; worktree: string; session: string; }

export function readViewState(params: URLSearchParams): ViewState {
  return {
    range: decodeRange(params.get('range')) ?? DEFAULT_RANGE,
    worktree: params.get('worktree') ?? 'All',
    session: params.get('session') ?? 'All',
  };
}

export interface RangeState { range: TimeRange; }

/** Range-only deep-link codec for the detail page — shares the range primitive, omits filters. */
export function readRangeState(params: URLSearchParams): RangeState {
  return { range: decodeRange(params.get('range')) ?? DEFAULT_RANGE };
}

export function writeRangeState(params: URLSearchParams, s: RangeState): string {
  const next = new URLSearchParams(params);
  next.set('range', encodeRange(s.range));
  return next.toString().replace(/\+/g, '%20');
}

/** Returns the query string (no leading '?'); omits defaults to keep URLs clean.
 *  Encodes spaces as %20 (not as +) so deep-link URLs are unambiguous in path contexts (AD-8). */
export function writeViewState(params: URLSearchParams, s: ViewState): string {
  const next = new URLSearchParams(params);
  next.set('range', encodeRange(s.range));
  if (s.worktree && s.worktree !== 'All') next.set('worktree', s.worktree);
  else next.delete('worktree');
  if (s.session && s.session !== 'All') next.set('session', s.session);
  else next.delete('session');
  // URLSearchParams.toString() uses application/x-www-form-urlencoded (+for space);
  // replace + with %20 so deep-link URLs use RFC 3986 percent-encoding throughout.
  return next.toString().replace(/\+/g, '%20');
}

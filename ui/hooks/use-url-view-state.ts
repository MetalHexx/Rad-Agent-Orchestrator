"use client";
import * as React from 'react';

export interface UrlCodec<S> {
  read: (params: URLSearchParams) => S;
  write: (params: URLSearchParams, state: S) => string;
}

/**
 * Hydrate `state` from the URL query string on mount via codec.read, persist it on change via
 * codec.write + history.replaceState. The first (mount) persist is skipped so a deep link is not
 * clobbered with default state before the hydrate effect's setState commits. Caller MUST pass a
 * memoized `state` so the persist effect fires on value change, not on every render (AD-6, FR-8, FR-11).
 */
export function useUrlViewState<S>(codec: UrlCodec<S>, apply: (s: S) => void, state: S): void {
  const hydrated = React.useRef(false);
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (!params.toString()) return; // nothing in the URL → keep defaults
    apply(codec.read(params));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!hydrated.current) { hydrated.current = true; return; }
    const qs = codec.write(new URLSearchParams(window.location.search), state);
    window.history.replaceState(null, '', `?${qs}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
}

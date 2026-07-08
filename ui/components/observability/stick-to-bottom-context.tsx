"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

// ---------------------------------------------------------------------------
// StickToBottomContext — carries a `useStickToBottom` instance's live
// { pinned, newCount, jumpToLatest } from whichever facet owns the scroller
// (TranscriptTimeline) up to the modal-level footer (AgentNavigatorStrip's
// docked Jump-to-latest button), which is a sibling, not a descendant.
// ---------------------------------------------------------------------------

export interface StickToBottomState {
  pinned: boolean;
  newCount: number;
  jumpToLatest: () => void;
}

export interface StickToBottomContextValue extends StickToBottomState {
  /** The scroller owner (e.g. TranscriptTimeline) publishes its live state here. */
  publish: (state: StickToBottomState) => void;
}

const NOOP = () => {};

export const defaultStickToBottomState: StickToBottomState = {
  pinned: true,
  newCount: 0,
  jumpToLatest: NOOP,
};

export const defaultStickToBottomContextValue: StickToBottomContextValue = {
  ...defaultStickToBottomState,
  publish: NOOP,
};

export const StickToBottomContext = createContext<StickToBottomContextValue>(
  defaultStickToBottomContextValue,
);

export function StickToBottomProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<StickToBottomState>(defaultStickToBottomState);

  const publish = useCallback((next: StickToBottomState) => {
    setState(next);
  }, []);

  const value = useMemo<StickToBottomContextValue>(
    () => ({ ...state, publish }),
    [state, publish],
  );

  return <StickToBottomContext.Provider value={value}>{children}</StickToBottomContext.Provider>;
}

export function useStickToBottomContext(): StickToBottomContextValue {
  return useContext(StickToBottomContext);
}

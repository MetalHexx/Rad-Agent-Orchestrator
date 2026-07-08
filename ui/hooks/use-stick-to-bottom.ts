"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const DEFAULT_THRESHOLD_PX = 48;

export interface ScrollMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

/**
 * Pure distance-from-bottom check — no DOM access, so it's directly
 * unit-testable under `node --test` without jsdom.
 */
export function isNearBottom(m: ScrollMetrics, thresholdPx: number): boolean {
  const distanceFromBottom = m.scrollHeight - m.scrollTop - m.clientHeight;
  return distanceFromBottom <= thresholdPx;
}

/**
 * Pure transition for `notifyContentChanged`'s unseen-event counter: a
 * pinned view is about to auto-follow to bottom (nothing missed), a
 * disengaged view increments the count of events the user hasn't seen yet.
 */
export function nextNewCountOnContentChanged(pinned: boolean, currentCount: number): number {
  return pinned ? 0 : currentCount + 1;
}

export interface UseStickToBottomOptions {
  /** Distance (px) from the bottom edge still considered "pinned". Defaults to 48. */
  thresholdPx?: number;
}

export interface UseStickToBottomReturn {
  /** Attach to the scrollable container. */
  scrollRef: React.RefObject<HTMLDivElement>;
  /** True while the user is scrolled near the bottom (auto-follow engaged). */
  pinned: boolean;
  /** Events missed while disengaged; resets on re-pin or `jumpToLatest`. */
  newCount: number;
  /** Imperatively scroll to bottom and re-engage. */
  jumpToLatest: () => void;
  /** Call when new content lands — follows if pinned, else counts it. */
  notifyContentChanged: () => void;
}

/**
 * Reusable stick-to-bottom behavior for a scrollable live-tailing view:
 * tracks whether the user is pinned near the bottom, exposes an imperative
 * jump, and counts events missed while disengaged.
 */
export function useStickToBottom(opts?: UseStickToBottomOptions): UseStickToBottomReturn {
  const thresholdPx = opts?.thresholdPx ?? DEFAULT_THRESHOLD_PX;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);
  const [newCount, setNewCount] = useState(0);

  // Read inside callbacks without adding `pinned` to their dep arrays, so
  // `notifyContentChanged` / the scroll listener stay referentially stable.
  const pinnedRef = useRef(pinned);
  pinnedRef.current = pinned;

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, []);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const next = isNearBottom(
      { scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight },
      thresholdPx,
    );
    setPinned(next);
    if (next) setNewCount(0);
  }, [thresholdPx]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, [handleScroll]);

  const notifyContentChanged = useCallback(() => {
    const wasPinned = pinnedRef.current;
    setNewCount((n) => nextNewCountOnContentChanged(wasPinned, n));
    if (wasPinned) scrollToBottom();
  }, [scrollToBottom]);

  const jumpToLatest = useCallback(() => {
    scrollToBottom();
    setPinned(true);
    setNewCount(0);
  }, [scrollToBottom]);

  return { scrollRef, pinned, newCount, jumpToLatest, notifyContentChanged };
}

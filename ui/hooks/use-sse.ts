"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { SSEEvent, SSEEventType, SSEConnectionStatus } from "@/types/events";
import { EVENT_TYPES } from "@/types/events";
import { nextReconnectDelay } from "@/lib/sse-reconnect";

// ─── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_MAX_EVENTS = 50;

// ─── Interfaces ─────────────────────────────────────────────────────────────

interface UseSSEOptions {
  /** SSE endpoint URL (e.g., '/api/events') */
  url: string;
  /** Called for every parsed SSE event */
  onEvent?: (event: SSEEvent) => void;
  /** Called on EventSource error */
  onError?: (error: Event) => void;
  /** Called when connection opens successfully */
  onOpen?: () => void;
  /** Max events to keep in buffer (default: 50) */
  maxEvents?: number;
  /**
   * When true, skips the events buffer and lastEventTime state updates.
   * Use this when only status and reconnect are needed (e.g., SSEProvider).
   * Prevents unnecessary re-renders at the SSE event/heartbeat rate.
   */
  statusOnly?: boolean;
}

interface UseSSEReturn {
  /** Current connection status */
  status: SSEConnectionStatus;
  /** Recent events buffer (newest first), capped at maxEvents */
  events: SSEEvent[];
  /** Manually tear down and re-create the EventSource */
  reconnect: () => void;
  /** Timestamp of the last received event, or null if none */
  lastEventTime: Date | null;
}

// ─── Hook ───────────────────────────────────────────────────────────────────

export function useSSE(options: UseSSEOptions): UseSSEReturn {
  const { url, onEvent, onError, onOpen, maxEvents = DEFAULT_MAX_EVENTS, statusOnly = false } = options;

  const [status, setStatus] = useState<SSEConnectionStatus>("disconnected");
  const [events, setEvents] = useState<SSEEvent[]>([]);
  const [lastEventTime, setLastEventTime] = useState<Date | null>(null);

  const mountedRef = useRef(true);
  const esRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // null before the first retry, per nextReconnectDelay's contract.
  const backoffDelayRef = useRef<number | null>(null);

  // Store callbacks in refs to avoid re-creating the connection on callback changes
  const onEventRef = useRef(onEvent);
  const onErrorRef = useRef(onError);
  const onOpenRef = useRef(onOpen);

  onEventRef.current = onEvent;
  onErrorRef.current = onError;
  onOpenRef.current = onOpen;

  const maxEventsRef = useRef(maxEvents);
  maxEventsRef.current = maxEvents;

  const statusOnlyRef = useRef(statusOnly);
  statusOnlyRef.current = statusOnly;

  const closeEventSource = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
  }, []);

  const clearReconnectTimeout = useCallback(() => {
    if (reconnectTimeoutRef.current !== null) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);

  const createConnection = useCallback(() => {
    if (!mountedRef.current) return;

    closeEventSource();
    clearReconnectTimeout();

    const es = new EventSource(url);
    esRef.current = es;

    // ── onopen ────────────────────────────────────────────────────────
    es.onopen = () => {
      if (!mountedRef.current) return;
      setStatus("connected");
      backoffDelayRef.current = null;
      onOpenRef.current?.();
    };

    // ── onerror ───────────────────────────────────────────────────────
    // Reconnection is indefinite by design: every path below either schedules
    // another attempt or is running during unmount teardown (the mountedRef
    // early-return above). A server outage costs one request per backoff
    // interval, capped at 30s — the price of not requiring a manual reconnect.
    es.onerror = (error: Event) => {
      if (!mountedRef.current) return;

      onErrorRef.current?.(error);
      closeEventSource();

      setStatus("reconnecting");

      const delay = nextReconnectDelay(backoffDelayRef.current);
      backoffDelayRef.current = delay;

      reconnectTimeoutRef.current = setTimeout(() => {
        if (!mountedRef.current) return;
        createConnection();
      }, delay);
    };

    // ── Named event listeners ─────────────────────────────────────────
    EVENT_TYPES.forEach((eventType) => {
      es.addEventListener(eventType, (messageEvent: MessageEvent) => {
        if (!mountedRef.current) return;

        let parsed: SSEEvent;
        try {
          parsed = JSON.parse(messageEvent.data) as SSEEvent;
        } catch (err) {
          console.error(`[useSSE] Failed to parse event data for "${eventType}":`, err);
          return;
        }

        onEventRef.current?.(parsed);

        if (!statusOnlyRef.current) {
          setEvents((prev) => {
            const next = [parsed, ...prev];
            return next.length > maxEventsRef.current
              ? next.slice(0, maxEventsRef.current)
              : next;
          });

          setLastEventTime(new Date());
        }
      });
    });
  }, [url, closeEventSource, clearReconnectTimeout]);

  // ── Manual reconnect ────────────────────────────────────────────────────

  const reconnect = useCallback(() => {
    clearReconnectTimeout();
    closeEventSource();
    backoffDelayRef.current = null;
    createConnection();
  }, [clearReconnectTimeout, closeEventSource, createConnection]);

  // ── Effect: connect on mount, clean up on unmount ───────────────────────

  useEffect(() => {
    mountedRef.current = true;
    createConnection();

    return () => {
      mountedRef.current = false;
      clearReconnectTimeout();
      closeEventSource();
    };
  }, [createConnection, clearReconnectTimeout, closeEventSource]);

  return {
    status,
    events,
    reconnect,
    lastEventTime,
  };
}

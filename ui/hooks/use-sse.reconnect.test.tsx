import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useSSE } from "./use-sse";
import { BACKOFF_INITIAL_MS, BACKOFF_MAX_MS } from "@/lib/sse-reconnect";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// ─── Fake EventSource ───────────────────────────────────────────────────────
// jsdom provides no EventSource; install a controllable fake on the window
// before rendering so onopen/onerror can be driven synchronously.

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onopen: (() => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  closed = false;

  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(): void {
    // Named event listeners are irrelevant to reconnect scheduling.
  }

  close(): void {
    this.closed = true;
  }

  static latest(): FakeEventSource {
    const es = FakeEventSource.instances[FakeEventSource.instances.length - 1];
    assert.ok(es, "expected a FakeEventSource instance to have been created");
    return es;
  }
}

function setupDom(): { container: HTMLDivElement; root: Root } {
  const dom = new JSDOM(`<!doctype html><html><body><div id="root"></div></body></html>`, {
    url: "http://localhost:3000/",
  });
  Object.defineProperty(globalThis, "window", { value: dom.window, writable: true, configurable: true });
  Object.defineProperty(globalThis, "document", { value: dom.window.document, writable: true, configurable: true });
  Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, writable: true, configurable: true });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).EventSource = FakeEventSource;
  FakeEventSource.instances = [];
  const container = dom.window.document.getElementById("root") as HTMLDivElement;
  const root = createRoot(container);
  return { container, root };
}

// ─── Controllable timers ────────────────────────────────────────────────────
// The hook schedules retries on the bare global setTimeout/clearTimeout, so
// stubbing those globals intercepts every scheduled retry without touching
// real wall-clock time.

interface ScheduledCall {
  callback: () => void;
  delayMs: number;
}

function stubTimers(): { scheduled: ScheduledCall[]; restore: () => void } {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const scheduled: ScheduledCall[] = [];
  let nextHandle = 1;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).setTimeout = (callback: () => void, delayMs: number) => {
    scheduled.push({ callback, delayMs });
    return nextHandle++;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).clearTimeout = () => {
    // No-op: tests drive the schedule explicitly via `scheduled`.
  };

  return {
    scheduled,
    restore: () => {
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
    },
  };
}

function Probe({ onStatus }: { onStatus: (status: string) => void }) {
  const { status } = useSSE({ url: "/api/events" });
  React.useEffect(() => { onStatus(status); }, [status, onStatus]);
  return null;
}

test("after twelve consecutive failures another attempt is still pending (no terminal give-up)", () => {
  const { restore, scheduled } = stubTimers();
  try {
    const { root } = setupDom();
    let latestStatus = "";

    act(() => {
      root.render(<Probe onStatus={(s) => { latestStatus = s; }} />);
    });

    assert.equal(FakeEventSource.instances.length, 1, "the hook opens a connection on mount");

    // Drive twelve consecutive failures synchronously by firing onerror on the
    // current connection, invoking the retry the hook scheduled, and repeating
    // on the connection that retry creates.
    for (let i = 0; i < 12; i++) {
      const es = FakeEventSource.latest();
      act(() => { es.onerror?.(new Event("error")); });

      assert.ok(scheduled.length > 0, `attempt ${i + 1}: a retry must be scheduled after every failure`);
      const next = scheduled.pop()!;
      act(() => { next.callback(); });
    }

    assert.equal(latestStatus, "reconnecting", "status must remain reconnecting, never a terminal disconnected");
    assert.ok(scheduled.length === 0, "the retry recorded for this iteration has been consumed");

    // One more failure past the twelfth: another attempt must still be recorded.
    const es = FakeEventSource.latest();
    act(() => { es.onerror?.(new Event("error")); });
    assert.equal(scheduled.length, 1, "a thirteenth failure still schedules another attempt — no give-up value exists");

    act(() => { root.unmount(); });
  } finally {
    restore();
  }
});

test("the recorded delay sequence escalates and then holds at the 30s cap", () => {
  const { restore, scheduled } = stubTimers();
  try {
    const { root } = setupDom();

    act(() => {
      root.render(<Probe onStatus={() => {}} />);
    });

    const delays: number[] = [];
    for (let i = 0; i < 8; i++) {
      const es = FakeEventSource.latest();
      act(() => { es.onerror?.(new Event("error")); });
      const next = scheduled.pop()!;
      delays.push(next.delayMs);
      act(() => { next.callback(); });
    }

    assert.equal(delays[0], BACKOFF_INITIAL_MS, "the first retry uses the initial delay");
    for (let i = 1; i < delays.length; i++) {
      assert.ok(delays[i] >= delays[i - 1], `delay must never shrink between attempts (index ${i})`);
    }
    assert.equal(delays[delays.length - 1], BACKOFF_MAX_MS, "escalation reaches the 30s cap");
    assert.equal(delays[delays.length - 2], BACKOFF_MAX_MS, "the cap holds once reached, it does not overshoot");

    act(() => { root.unmount(); });
  } finally {
    restore();
  }
});

test("a successful reconnect resets the delay back to the initial value", () => {
  const { restore, scheduled } = stubTimers();
  try {
    const { root } = setupDom();

    act(() => {
      root.render(<Probe onStatus={() => {}} />);
    });

    // Escalate a few times.
    for (let i = 0; i < 3; i++) {
      const es = FakeEventSource.latest();
      act(() => { es.onerror?.(new Event("error")); });
      const next = scheduled.pop()!;
      act(() => { next.callback(); });
    }

    // The connection created by the last retry now opens successfully.
    const recovered = FakeEventSource.latest();
    act(() => { recovered.onopen?.(); });

    // The next failure must schedule at the initial delay again, not a
    // continuation of the prior escalation.
    act(() => { recovered.onerror?.(new Event("error")); });
    const afterRecovery = scheduled.pop()!;
    assert.equal(afterRecovery.delayMs, BACKOFF_INITIAL_MS, "backoff resets after a successful open");

    act(() => { root.unmount(); });
  } finally {
    restore();
  }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TranscriptTimeline } from './transcript-timeline';
import { StickToBottomProvider, useStickToBottomContext } from './stick-to-bottom-context';
import { originatingToolByResult } from '@/lib/observability/tool-calls';
Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const events = [
  { seq: 1, timestamp: '2026-06-24T09:00:00.000Z', kind: 'message', role: 'user', text: 'build it' },
  { seq: 2, timestamp: '2026-06-24T09:00:01.000Z', kind: 'thinking', text: 'planning' },
  { seq: 3, timestamp: '2026-06-24T09:00:02.000Z', kind: 'tool_call', tool: { name: 'Bash', input: { text: 'npm run build' }, toolUseId: 'a' } },
  { seq: 4, timestamp: '2026-06-24T09:00:03.000Z', kind: 'tool_result', result: { toolUseId: 'a', output: { text: 'done' }, isError: false } },
];
const render = (over: Record<string, unknown> = {}) =>
  renderToStaticMarkup(createElement(TranscriptTimeline, {
    events,
    originatingToolByResultSeq: originatingToolByResult(events as never),
    errorCursor: -1,
    ...over,
  } as never));

test('renders already-filtered events in order as cards (FR-2, FR-11)', () => {
  const html = render();
  assert.ok(html.indexOf('build it') < html.indexOf('planning'), 'chronological order preserved');
  assert.ok(html.includes('Bash') && html.includes('done'), 'tool pair rendered');
});

test('tool-result bodies render by default — filtering is upstream via applyFacets, not a showToolIO prop', () => {
  const html = render();
  assert.ok(html.includes('done'), 'result body visible without any showToolIO wiring');
});

test('an empty (already-filtered) event list shows the empty state, never a blank panel (FR-2)', () => {
  assert.ok(/no events match/i.test(render({ events: [] })), 'empty-state shown when a facet-off empties the list');
});

// Regression (phase review Finding 1): a Read tool_call absent from the rendered
// event list (e.g. scrolled out of a windowed view) while its tool_result stays
// visible must not reintroduce the doubled line-number gutter. originatingToolByResultSeq
// is threaded in from the caller (built from the FULL, unfiltered transcript — see
// transcript-facet.tsx), so it must still resolve even though `events` here (what
// the rendered/windowed list looks like) no longer contains the Read tool_call.
test('a Read tool_result still suppresses the line-number gutter when its tool_call is absent from the rendered list', () => {
  const fullEvents = [
    { seq: 1, timestamp: '2026-07-08T09:00:00.000Z', kind: 'tool_call', tool: { name: 'Read', input: { text: JSON.stringify({ file_path: 'ui/lib/foo.ts' }) }, toolUseId: 'r1' } },
    { seq: 2, timestamp: '2026-07-08T09:00:01.000Z', kind: 'tool_result', result: { toolUseId: 'r1', output: { text: '     1\tfoo\n     2\tbar' }, isError: false } },
    { seq: 3, timestamp: '2026-07-08T09:00:02.000Z', kind: 'tool_call', tool: { name: 'Bash', input: { text: 'npm test' }, toolUseId: 'b1' } },
    { seq: 4, timestamp: '2026-07-08T09:00:03.000Z', kind: 'tool_result', result: { toolUseId: 'b1', output: { text: 'ok' }, isError: false } },
  ];
  // Simulates a windowed/scrolled view where the Read tool_call has scrolled out
  // but its result is still shown — the mechanism under test (no doubled gutter)
  // is orthogonal to why the call is missing from the rendered list.
  const rendered = fullEvents.slice(1);
  assert.ok(
    !rendered.some((e) => e.kind === 'tool_call' && e.tool?.name === 'Read'),
    'sanity: the Read tool_call is not in the events the timeline renders',
  );
  assert.ok(
    rendered.some((e) => e.kind === 'tool_result' && e.result?.toolUseId === 'r1'),
    'sanity: the Read tool_result is still present',
  );

  const html = render({
    events: rendered,
    originatingToolByResultSeq: originatingToolByResult(fullEvents as never), // built from the FULL list
  });
  // Scope the assertion to the Read result's own card (data-seq="2") — the
  // sibling Bash result legitimately keeps its added gutter, so a whole-document
  // check would false-positive on that unrelated card's numbering.
  const cardMatch = /<div data-seq="2">([\s\S]*?)<\/div><div data-seq="3">/.exec(html);
  assert.ok(cardMatch, 'the Read result card is present in the rendered output');
  const card = cardMatch![1];
  assert.ok(card.includes('foo') && card.includes('bar'), 'Read result body still renders');
  assert.ok(!/>1</.test(card) && !/>2</.test(card), 'no added line-number gutter doubling the baked-in cat -n numbers');
});

// Regression (phase review Finding 1): TranscriptTimeline owns one useStickToBottom
// instance for its component lifetime. The production fix keys the scroller's mount
// point by agentId (agent-inspector-modal.tsx: `<TranscriptFacet key={agentId} .../>`)
// so that lifetime ends on every agent switch. This test proves the mechanism that
// fix relies on: remounting via a fresh key resets pinned/newCount (and stops a
// stale disengaged state from misreporting against the next agent's own content)
// instead of carrying it over the way an in-place prop update would.
test('agent switch: remounting on a fresh key resets pinned/newCount instead of leaking the previous agent\'s disengaged state', async () => {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<!doctype html><div id="root"></div>');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).window = dom.window;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).document = dom.window.document;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).HTMLElement = dom.window.HTMLElement;

  const { createRoot } = await import('react-dom/client');
  const { act } = await import('react');

  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);

  // Reads the state TranscriptTimeline publishes, mirroring how AgentNavigatorStrip's
  // Jump-to-latest button consumes it — without reaching into the hook's internals.
  function Probe() {
    const { pinned, newCount } = useStickToBottomContext();
    return createElement('div', { 'data-testid': 'probe', 'data-pinned': String(pinned), 'data-newcount': String(newCount) });
  }

  function Harness({ agentId, evts }: { agentId: string; evts: typeof events }) {
    return createElement(
      StickToBottomProvider,
      null,
      createElement(TranscriptTimeline, {
        key: agentId,
        events: evts,
        originatingToolByResultSeq: originatingToolByResult(evts as never),
        errorCursor: -1,
      }),
      createElement(Probe),
    );
  }

  await act(async () => {
    root.render(createElement(Harness, { agentId: 'agent-a', evts: events }));
  });

  const scroller = container.querySelector('div.overflow-y-auto') as HTMLDivElement;
  assert.ok(scroller, 'scroller mounted for agent A');
  const probe = () => container.querySelector('[data-testid=probe]') as HTMLElement;
  assert.equal(probe().dataset.pinned, 'true', 'starts pinned to the bottom by default');

  // Disengage: scroll well above the near-bottom threshold.
  Object.defineProperty(scroller, 'scrollHeight', { value: 1000, configurable: true });
  Object.defineProperty(scroller, 'clientHeight', { value: 200, configurable: true });
  Object.defineProperty(scroller, 'scrollTop', { value: 0, configurable: true, writable: true });
  await act(async () => {
    scroller.dispatchEvent(new dom.window.Event('scroll'));
  });
  assert.equal(probe().dataset.pinned, 'false', 'disengaged after scrolling away from the bottom on agent A');

  // A new event lands on agent A while disengaged — newCount bumps (content missed).
  const agentAWithNewEvent = [
    ...events,
    { seq: 5, timestamp: '2026-06-24T09:00:04.000Z', kind: 'message', role: 'assistant', text: 'more' },
  ];
  await act(async () => {
    root.render(createElement(Harness, { agentId: 'agent-a', evts: agentAWithNewEvent }));
  });
  assert.equal(probe().dataset.newcount, '1', 'newCount increments for content missed while disengaged on agent A');

  // Switch to a different agent: fresh key, a longer events array of its own. Without
  // the remount, this larger length would re-trigger notifyContentChanged() against
  // the stale disengaged pinned=false from agent A — a phantom bump unrelated to
  // anything actually missed on agent B.
  const agentBEvents = [
    ...agentAWithNewEvent,
    { seq: 6, timestamp: '2026-06-24T09:05:00.000Z', kind: 'message', role: 'user', text: 'agent b says hi' },
    { seq: 7, timestamp: '2026-06-24T09:05:01.000Z', kind: 'message', role: 'assistant', text: 'agent b replies' },
  ];
  await act(async () => {
    root.render(createElement(Harness, { agentId: 'agent-b', evts: agentBEvents }));
  });

  assert.equal(probe().dataset.pinned, 'true', 'agent switch remounts pinned-to-bottom by default rather than carrying over agent A\'s disengaged state');
  assert.equal(probe().dataset.newcount, '0', 'agent switch resets newCount to 0 rather than leaking or bumping it against agent B\'s own unrelated content');

  await act(async () => { root.unmount(); });
});

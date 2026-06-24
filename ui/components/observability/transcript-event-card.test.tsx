import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TranscriptEventCard } from './transcript-event-card';
Object.assign(globalThis, { React });

const card = (event: Record<string, unknown>, props: Record<string, unknown> = {}) =>
  renderToStaticMarkup(createElement(TranscriptEventCard, { event, ...props } as never));

test('renders kind label, clock, and a colored left border (DD-1, DD-3, FR-2)', () => {
  const html = card({ seq: 1, timestamp: '2026-06-24T09:08:07.000Z', kind: 'message', role: 'assistant', text: 'hello' });
  assert.ok(html.includes('Assistant'), 'assistant label present');
  assert.ok(html.includes('09:08:07'), 'clock rendered');
  assert.ok(html.includes('var(--chart-2)'), 'assistant border token applied');
  assert.ok(!/#[0-9a-fA-F]{6}/.test(html), 'no literal hex (NFR-3)');
});

test('thinking renders italic muted; user renders plain text (DD-4)', () => {
  const t = card({ seq: 2, timestamp: '2026-06-24T09:00:00.000Z', kind: 'thinking', text: 'pondering' });
  assert.ok(t.includes('italic') && t.includes('pondering'), 'thinking italic body');
  const u = card({ seq: 3, timestamp: '2026-06-24T09:00:00.000Z', kind: 'message', role: 'user', text: 'do this' });
  assert.ok(u.includes('User') && u.includes('do this'), 'user label + text');
});

test('file_change shows op + filename, no diffstat (DD-4)', () => {
  const html = card({ seq: 4, timestamp: '2026-06-24T09:00:00.000Z', kind: 'file_change', file: { path: 'ui/x.tsx', op: 'write' } });
  assert.ok(/write/i.test(html) && html.includes('ui/x.tsx'), 'op + filename present');
});

test('un-themed system kind still renders a card, never dropped (AD-7)', () => {
  const html = card({ seq: 5, timestamp: '2026-06-24T09:00:00.000Z', kind: 'system', text: 'boot' });
  assert.ok(html.includes('System') && html.includes('var(--model-grey)'), 'system label + neutral border');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SessionDetailView } from './session-detail-view';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
(globalThis as { React?: unknown }).React = React;

test('the route file is a server shell that reads params.id and renders the client view (AD-8, FR-2)', () => {
  const src = readFileSync(resolve(import.meta.dirname, 'page.tsx'), 'utf8');
  assert.doesNotMatch(src, /"use client"/, 'route stays a server component');
  assert.match(src, /params\.id/, 'reads the route param on the server');
  assert.match(src, /SessionDetailView/, 'delegates to the client view');
});

test('detail hero is titled for the session scope; sub-header omits filters (FR-3, FR-4, DD-6)', () => {
  const html = renderToStaticMarkup(createElement(SessionDetailView, { sessionId: 'abcdef1234567890' }));
  assert.ok(html.includes('Token Spend Rate · This Session'), 'hero title signals session scope');
  assert.ok(html.includes('Session abcdef12'), 'sub-header shows the shortened session id');
  assert.ok(!html.includes('Worktree'), 'worktree filter is absent on the detail page');
});

test('detail view always renders its scaffold (header + titled chart), never a silent blank; the "no activity" flash is gone (FR-9, FR-10, smooth-load)', () => {
  const html = renderToStaticMarkup(createElement(SessionDetailView, { sessionId: '__nope__' }));
  assert.ok(html.includes('Session detail page'), 'sub-header still renders (reads as a real page)');
  assert.ok(html.includes('Token Spend Rate · This Session'), 'the titled chart card renders — not a blank body');
  assert.ok(!html.includes('no activity in this range'), 'the flashy empty-range message is removed');
});

test('detail header carries a back control to the left of the session title (back-nav)', () => {
  const html = renderToStaticMarkup(createElement(SessionDetailView, { sessionId: 'abcdef1234567890' }));
  assert.ok(html.includes('aria-label="Back to all sessions"'), 'back control renders in the header');
  assert.ok(
    html.indexOf('Back to all sessions') < html.indexOf('Session abcdef12'),
    'the back control sits before the title in the header'
  );
});

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

test('detail view renders the session summary cards under the hero, guarded on session existence (FR-5, DD-4)', () => {
  const src = readFileSync(resolve(import.meta.dirname, 'session-detail-view.tsx'), 'utf8');
  assert.match(src, /import \{ SessionSummaryCards \}/, 'imports the session summary cards');
  assert.match(src, /\{session && <SessionSummaryCards session=\{windowedSession!\} \/>\}/, 'cards are guarded on session; feeds windowedSession');
});

test('session-detail-view source: windowed data pipeline (AD-6, FR-5)', () => {
  const src = readFileSync(resolve(import.meta.dirname, 'session-detail-view.tsx'), 'utf8');
  assert.match(src, /rowsInWindow\(sessionRows, rangeStart, rangeEnd\)/, 'windowRows derived from rowsInWindow');
  assert.match(src, /buildSubagentTree\(windowRows\)/, 'subagentTree builds from windowed rows');
  assert.match(src, /session=\{windowedSession!\}/, 'cards receive windowedSession');
  assert.match(src, /onResetRange=\{hasDefault \? onResetRange : undefined\}/, 'onResetRange passed to sub-header');
});

test('session-detail-view source: pin gated on ready and fitToSession called with Date.now() (AD-9)', () => {
  const src = readFileSync(resolve(import.meta.dirname, 'session-detail-view.tsx'), 'utf8');
  assert.match(src, /if \(ready && session\)/, 'pin effect gated on ready && session');
  assert.match(src, /fitToSession\(/, 'fitToSession is called in the pin effect');
  assert.match(src, /Date\.now\(\)/, 'Date.now() used for nowMs in the pin effect');
});

test('reset button absent in SSR no-data frame (ready is false on initial render)', () => {
  const html = renderToStaticMarkup(createElement(SessionDetailView, { sessionId: '__nope__' }));
  assert.ok(!html.includes('Fit time range to session'), 'reset button absent when hasDefault is false (ready=false in SSR)');
});

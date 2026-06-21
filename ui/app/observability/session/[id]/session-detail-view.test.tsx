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

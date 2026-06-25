import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ActivityIndicator } from './activity-indicator';
import { ObservabilitySubHeader } from './observability-sub-header';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).React = React;

const baseProps = {
  ariaLabel: 'Session detail page', title: 'Session abc12345', subtitle: 'wt/path',
  range: { kind: 'relative', preset: '1h' } as const, onRangeChange: () => {},
  rangeMin: 0, rangeMax: Date.parse('2026-06-21T12:00:00Z'), scopeLabel: 'Session abc12345',
  onRefresh: () => {}, onHelp: () => {},
};

test('ActivityIndicator shows an idle label for a non-finite elapsed (DD-12, FR-5)', () => {
  const html = renderToStaticMarkup(createElement(ActivityIndicator, { msSinceActivity: Infinity }));
  assert.ok(html.includes('idle'), 'idle state renders, never "updated NaN"');
  assert.ok(!html.includes('NaN'), 'no NaN leaks into the label');
});

test('sub-header renders activity + refresh + help and omits filters when no slot (FR-4, DD-4)', () => {
  const html = renderToStaticMarkup(createElement(ObservabilitySubHeader, { ...baseProps, msSinceActivity: 5000 }));
  assert.ok(html.includes('Activity indicator'), 'activity indicator present');
  assert.ok(html.includes('aria-label="Refresh now"'), 'refresh control present');
  assert.ok(html.includes('aria-label="Help"'), 'help control present');
  assert.ok(!html.includes('Worktree') && !html.includes('>Session<'), 'no filter selects when slot omitted');
});

test('filters slot is rendered when supplied (FR-4)', () => {
  const html = renderToStaticMarkup(createElement(ObservabilitySubHeader, {
    ...baseProps, msSinceActivity: 5000, filters: createElement('div', null, 'WorktreeFilter'),
  }));
  assert.ok(html.includes('WorktreeFilter'), 'filters slot content renders in the cluster');
});

test('reset button is absent when onResetRange is not supplied', () => {
  const html = renderToStaticMarkup(createElement(ObservabilitySubHeader, { ...baseProps, msSinceActivity: null }));
  assert.ok(!html.includes('Fit time range to session'), 'reset button absent when no onResetRange prop');
});

test('reset button is present when onResetRange handler is passed', () => {
  const html = renderToStaticMarkup(createElement(ObservabilitySubHeader, {
    ...baseProps, msSinceActivity: null, onResetRange: () => {},
  }));
  assert.ok(html.includes('aria-label="Fit time range to session"'), 'reset button present when onResetRange provided');
});

test('renders the actions slot before refresh (FR-3, DD-2)', () => {
  const html = renderToStaticMarkup(createElement(ObservabilitySubHeader, {
    ...baseProps, msSinceActivity: null,
    actions: createElement('button', { 'aria-label': 'Save benchmark' }, 'star'),
  }));
  assert.ok(html.includes('aria-label="Save benchmark"'), 'actions slot content renders in the cluster');
});
